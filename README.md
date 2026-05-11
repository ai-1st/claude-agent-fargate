# ClaudeClaw

OpenClaw-style personal AI agent platform on AWS. Each user message launches its own worker Lambda invocation. Personas, persistent memory, scheduled heartbeats, MCP, and Skills layered on top.

## Architecture

- **Lambda (Function URL)** — HTMX UI, control plane, invokes the worker Lambda, hosts heartbeat + extension endpoints.
- **Worker Lambda (ARM64 container, 10 GB / 15 min)** — one async invocation per message. Reads persona files + memory through an S3 Files (EFS-backed) mount at `/mnt/s3`, runs `@anthropic-ai/claude-agent-sdk`, persists agent SDK state back to the mount so subsequent invocations resume via `resume: agentSessionId`. Validates every `submit_result` payload against the session's `resultSchema` using `ajv` before going COMPLETED.
- **DynamoDB single table** — `PK/SK + GSI1` (GSI2 reserved but currently unused). Personas, memory pointers, schedules, sessions, messages, browser commands/results.
- **S3 + S3 Files** — loose objects under `s3://<bucket>/lambda/{personas,memory,templates,agent-state}/`. The S3 Files access point roots at `/lambda` with `PosixUser=1001` so the worker Lambda can write back. ECR repo for the worker image is bootstrapped by `scripts/deploy.sh`.
- **SSM Parameter Store** — per-persona secrets, materialized as `.env` in the worker's per-invocation cwd (`/tmp/work/persona/.env`).
- **EventBridge Scheduler** — persona heartbeat crons + per-schedule scoped crons.

## Key architectural decisions

### Single-message worker Lambda invocation
- Lambda control plane creates a `Session` + first `Message` row, then async-invokes the worker Lambda with `{SESSION_ID, MESSAGE_SK}`.
- Worker reads persona files via the S3 Files mount, copies them to `/tmp/work/persona/` (S3 Files dirs are uid=0; PosixUser=1001 can't mutate them in place), symlinks `memory/` from there to `/mnt/s3/memory/<persona>/` so writes persist.
- SDK conversation state lives at `/mnt/s3/agent-state/<sessionId>/.claude/` (HOME). First turn captures `agentSessionId`; subsequent turns pass `resume: agentSessionId`.
- If a turn would exceed Lambda's 15 min budget the worker self re-invokes (`resume: "budget"`) and the message stays RUNNING. `agent_sleep` schedules an EventBridge wake.

### Uniform personas, behaviour on the session
Personas have no `kind` field — they are defined entirely by their project contents (CLAUDE.md, skills, mcp.json) and metadata (description, allowedTools, memoryEnabled, mcpEnabled, heartbeatCron). All behavioural knobs live on the **session**:

| Session field            | Meaning                                                                                                     |
|--------------------------|-------------------------------------------------------------------------------------------------------------|
| `name`                   | Descriptive label shown in lists and `/inbox`.                                                              |
| `firstMessageAuthor`     | `user` (worker runs immediately) or `agent` (first message stored as an assistant seed; session opens WAITING_HUMAN; worker fires when the human replies). |
| `resultSchema`           | JSON Schema. `submit_result(payload)` is validated against it before the session goes COMPLETED.           |
| `inputUrl?`              | Optional URL fed to the extension when the user clicks "Open in Extension".                                 |
| `extToken?`              | Minted on demand when the user clicks "Open in Extension" — never set at session creation.                  |
| `callerPersona?`         | Recorded when another persona created this session via the `sessions_create` MCP tool.                      |
| `submitResult?`          | JSON-serialized final payload.                                                                              |

Statuses: `RUNNING | WAITING_HUMAN | COMPLETED | FAILED | IDLE | SLEEPING`.

### Browser extension is per-session, not per-persona
- No persistent extension binding. The user clicks **Open in Extension** on `/sessions/:id`.
- Lambda mints a session-scoped `extToken`, stores it on the session row, and 302-redirects to `chrome-extension://${EXT_CHROME_ID}/open.html?sid=...&token=...&base=...&inputUrl=...`.
- The extension's `open.html` stores the binding, opens a new tab to `inputUrl` (if any), and polls `/ext/poll?sid=...&token=...` for `BRCMD#` rows.
- Worker `browser_*` tool calls queue regardless of whether an extension is bound; they only execute once the user opens the session in their browser. Unbound calls time out after 10 minutes.

### MCP tools available to every persona
- `personas_list` — discover other personas + their `actions`.
- `sessions_create({persona, name, prompt, firstMessageAuthor?, resultSchema, inputUrl?, waitMs?})` — create a session on any persona; optionally block until COMPLETED.
- `sessions_list_active({persona?})` — list non-terminal sessions.
- `sessions_get({sessionId})` — poll status + parsed `submitResult` once COMPLETED.
- `agent_sleep`, `submit_result(payload)` — control plane (terminal).
- `browser_*` — browser tools (only useful while the extension is bound to this session).

### DynamoDB single-table layout

| Entity            | pk                     | sk                | GSI1                                  |
|-------------------|------------------------|-------------------|---------------------------------------|
| Persona           | `PERSONA#<name>`       | `META`            | —                                     |
| Memory file       | `PERSONA#<name>`       | `MEM#<path>`      | —                                     |
| Schedule          | `PERSONA#<name>`       | `CRON#<id>`       | —                                     |
| Session           | `SESSION#<id>`         | `META`            | `gsi1pk=SESSIONS, gsi1sk=<createdAt>` |
| Message           | `SESSION#<id>`         | `MSG#<sk>`        | —                                     |
| Browser command   | `SESSION#<id>`         | `BRCMD#<seq>`     | —                                     |
| Browser result    | `SESSION#<id>`         | `BRRES#<seq>`     | —                                     |
| Template          | `TEMPLATE#<name>`      | `META`            | —                                     |

### Persona files (loose objects under `s3://<bucket>/lambda/personas/<name>/`)

```
CLAUDE.md            # system prompt / persona identity
mcp.json             # optional MCP servers
persona.json         # { description?, actions?: string[] } (optional)
skills/<name>/SKILL.md
```
Memory lives separately at `s3://<bucket>/lambda/memory/<persona>/` and is symlinked into the per-invocation cwd as `memory/`. SDK agent state lives at `s3://<bucket>/lambda/agent-state/<sessionId>/`.

### Heartbeats and cron
- `Persona.heartbeatCron` (e.g. `rate(30 minutes)`) → EventBridge schedule managed via web UI.
- Per-schedule cron entries (`POST /personas/{name}/schedules`) carry custom prompts.
- Scheduler invokes Lambda directly with a synthetic `POST /heartbeat`; auth via `X-Heartbeat-Secret: $APP_PASSWORD`. Heartbeat sessions are created with `firstMessageAuthor="user"` and a default freeform `resultSchema = {"type":"object"}`.

### Channels
v1 is web + extension. The Lambda handler is the single ingress; new channels (Telegram, Slack, Discord, email) plug in by translating inbound messages into `createSession` + (optionally) `launchTask`.

## Project layout

```
src/shared/   # types, DynamoDB helpers, dispatch (createSession + launchTask) — shared by Lambda + worker
src/lambda/   # Function URL handler + HTMX views (control plane, /ext/*, /inbox)
src/worker/   # Worker Lambda entrypoint: persona load, memory symlink, MCP, SDK resume, self re-invoke
extension/    # Chrome MV3 extension; open.html is the per-session entry point.
projects/     # local persona sources, uploaded to S3 by CLI
scripts/      # upload-project, set-secret, skill-add, memory-sync, sync-templates, deploy
template.yaml # SAM template
```

## Deploy

```bash
make deploy   # ensures ECR repo, builds worker image (linux/arm64), pushes :latest, sam deploy, syncs templates
```

Override the AWS profile via `AWS_PROFILE=...` (default `co`). Pass the Chrome extension's stable ID as the `ExtChromeId` CloudFormation parameter so the "Open in Extension" redirect points at the right extension. (Drop a `"key"` field into `extension/public/manifest.json` to get a stable ID across users.)

Existing data from earlier ClaudeClaw versions (with `Persona.kind`, `Session.kind`, `ExtToken#` rows, `gsi2` indexes, etc.) is not migrated — nuke and redeploy the DynamoDB table when upgrading.

## Persona upload

```bash
npx tsx scripts/upload-project.ts --name devops --dir ./projects/devops --profile co \
  --heartbeat-cron 'rate(30 minutes)' --memory-enabled true --mcp-enabled true
npx tsx scripts/set-secret.ts --project devops --key JIRA_API_KEY --value "..." --profile co
npx tsx scripts/skill-add.ts --persona devops --skill-dir ./some/skill --project-dir ./projects/devops --profile co
npx tsx scripts/memory-sync.ts --persona devops --dir ./local-memory --direction pull --profile co
```

## Agent SDK usage

- First message: `query({ prompt, options: { cwd, settingSources: ["project"], allowedTools, permissionMode: "acceptEdits", mcpServers, systemPrompt? } })`
- Follow-ups: `query({ prompt, options: { cwd, allowedTools, mcpServers, systemPrompt?, resume: agentSessionId } })`
- `agentSessionId` captured from `system/init` SDK message, stored on session META, reused across warm-worker turns and across cold restarts (state restored from S3).
- The worker injects `<result_schema>` and (for agent-author seeds) `<prior_assistant_message>` into the system prompt so the model knows its end-shape and any prior context.

## Out of scope (v1)

- Non-Chrome browsers, cross-device extension binding, encrypted command payloads, screenshot streaming.
- Access permissions on sessions (deferred).
