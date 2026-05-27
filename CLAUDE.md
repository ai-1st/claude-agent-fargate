# CloudClaw

OpenClaw-style personal AI agent platform on AWS. Each user message launches its own worker Lambda invocation. Personas, persistent memory, scheduled heartbeats, MCP, and Skills layered on top.

## Tech Stack
- TypeScript (ES2022 modules)
- AWS SAM for deployment (`AWS_PROFILE=co`)
- DynamoDB single table (`AgentTable`): PK/SK + GSI1 (GSI2 reserved but currently unused)
- Lambda Function URL (ARM64, nodejs22.x, esbuild) serving HTMX UI + heartbeat endpoint
- Worker Lambda (ARM64 container image, 10 GB memory, 15 min timeout) running @anthropic-ai/claude-agent-sdk
- S3 + S3 Files (EFS-backed) mount at `/mnt/s3` on the worker for persona files, per-persona `memory/`, and SDK agent state. ECR repo bootstrapped by `scripts/deploy.sh`.
- SSM Parameter Store for per-persona secrets
- EventBridge Scheduler for heartbeats and cron tasks
- Bucket key prefix: `lambda/` (S3 Files access point roots at `/lambda` so Lambda's PosixUser=1001 can write).
- `ajv` validates every `submit_result` payload against the session's `resultSchema`.

## Personas
Personas are **uniform** — there's no `kind` field. A persona is defined by its project contents (CLAUDE.md, skills, mcp.json) and persona-level config (description, allowedTools, memoryEnabled, mcpEnabled, heartbeatCron). All behavioral knobs live on the **session**, not the persona.

## Sessions
Each session row carries:
- `name` — descriptive label shown in lists and `/inbox`.
- `firstMessageAuthor` — `user` (default; agent runs immediately) or `agent` (session opens with this assistant message and waits for a human reply before launching the worker).
- `resultSchema` — JSON Schema (required). The agent ends by calling `submit_result(payload)`; the payload is validated against this schema before the session goes COMPLETED.
- `inputUrl?` — optional URL. "Open in Extension" uses it as the starting page in the bound tab.
- `extToken?` / `extTokenLastSeenAt?` — minted on-demand when a human clicks "Open in Extension" on the session detail page. Never set at creation time.
- `agentSessionId?` — Agent SDK session id for resume.
- `callerPersona?` — set when another persona called `sessions_create`.
- `submitResult?` — JSON-serialized final payload.

Statuses: `RUNNING | WAITING_HUMAN | COMPLETED | FAILED | IDLE | SLEEPING`.

## DynamoDB Single Table Design
- Persona: `pk=PERSONA#<name>` `sk=META`
- Memory file: `pk=PERSONA#<name>` `sk=MEM#<path>` (bytes in S3 at `memory/<name>/<path>`)
- Schedule: `pk=PERSONA#<name>` `sk=CRON#<id>`
- Session: `pk=SESSION#<id>` `sk=META` `gsi1pk=SESSIONS` `gsi1sk=<createdAt>`
- Message: `pk=SESSION#<id>` `sk=MSG#<sortKey>` (sortKey = zero-padded counter)
- Browser command/result: `pk=SESSION#<id>` `sk=BRCMD#<seq>` / `BRRES#<seq>`
- Template: `pk=TEMPLATE#<name>` `sk=META`

## Extension binding
There are no persistent extension bindings. The flow:
1. Human visits `/sessions/:id` in the web UI and clicks **Open in Extension**.
2. Lambda mints a random `extToken`, stores it on the session row, and 302-redirects to `chrome-extension://${EXT_CHROME_ID}/open.html?sid=...&token=...&base=...&inputUrl=...`.
3. The extension's `open.html` reads the params, stores them in `chrome.storage.local`, opens a new tab to `inputUrl` (if any), and starts polling `/ext/poll?sid=...&token=...`.
4. The worker's `browser_*` tool calls queue as `BRCMD#` rows; the extension drains them and POSTs `BRRES#` results back to `/ext/result`.

`EXT_CHROME_ID` is the stable extension ID (derived from a `"key"` field in the extension manifest) and must be passed as a CloudFormation parameter at deploy time.

## Persona Layout (loose objects under `s3://<bucket>/lambda/personas/<name>/`)
```
CLAUDE.md                # system prompt / persona identity
persona.json             # optional: description, actions
mcp.json                 # optional MCP servers (passed to query() options.mcpServers)
skills/<name>/SKILL.md   # skill metadata; SDK auto-loads via settingSources:["project"]
```
Memory lives at `s3://<bucket>/lambda/memory/<persona>/`. The worker copies persona files to `/tmp/work/persona` at startup (S3-uploaded dirs are uid=0 and Lambda can't mutate them) and symlinks `memory/` from there to `/mnt/s3/memory/<persona>` so writes persist back through S3 Files.

## Project Layout
- `src/shared/` — types and DynamoDB helpers (shared by Lambda + Worker)
- `src/lambda/` — Lambda Function URL handler + HTMX views (control plane)
- `src/worker/` — Worker Lambda entry point (single-message runner with memory sync + MCP + resume)
- `projects/` — named persona directories (uploaded to S3 via CLI)
- `scripts/` — CLI tools (upload-project, set-secret, skill-add, memory-sync, sync-templates, deploy)
- `extension/` — Chrome MV3 extension; `open.html` is the per-session entry point.

## Key Commands
```bash
make deploy
npx tsx scripts/upload-project.ts --name devops --dir ./projects/devops --profile ce \
  --heartbeat-cron 'rate(30 minutes)' --memory-enabled true --mcp-enabled true
npx tsx scripts/upload-project.ts --name browser-operator --dir ./projects/browser-operator --profile ce
npx tsx scripts/upload-project.ts --name approver --dir ./projects/approver --profile ce
npx tsx scripts/set-secret.ts --project devops --key JIRA_API_KEY --value "..." --profile ce
npx tsx scripts/skill-add.ts --persona devops --skill-dir ./some/skill --project-dir ./projects/devops --profile ce
npx tsx scripts/memory-sync.ts --persona devops --dir ./local-memory --direction pull --profile ce
cd extension && npm install && npm run build   # then load unpacked from extension/dist
```

## Agent SDK Usage
- First message: `query({ prompt, options: { cwd, settingSources: ["project"], allowedTools, permissionMode: "acceptEdits", mcpServers, systemPrompt? } })`
- Follow-ups: `query({ prompt, options: { cwd, allowedTools, mcpServers, systemPrompt?, resume: agentSessionId } })`
- `agentSessionId` captured from `system/init` SDK message (`session_id` field), stored on session META.
- The worker injects `<result_schema>` and (when applicable) `<prior_assistant_message>` into the system prompt so the model knows its end-shape and any agent-author seed.
- Per-persona secrets written as `.env` file in the per-invocation `/tmp/work/persona/` cwd.

## Built-in MCP servers (registered for every persona)
- `personas` — `personas_list`, `sessions_create({persona, name, prompt, firstMessageAuthor?, resultSchema, inputUrl?, waitMs?})`, `sessions_list_active({persona?})`, `sessions_get({sessionId})`.
- `control` — `agent_sleep`, `submit_result(payload)` (validated against `session.resultSchema`).
- `browser` — `browser_open/readText/click/fill/scroll/extract/screenshot/run_scraper/save_dom`. Commands queue in DDB regardless; they only execute once a human binds the extension to the session.

## Heartbeat / Cron
- Persona META `heartbeatCron` field, e.g. `rate(30 minutes)`. The web UI's "Save" form ensures the EventBridge Schedule.
- Per-schedule cron entries (`POST /personas/{name}/schedules`) for scoped recurring tasks; each carries a custom prompt.
- Scheduler invokes the Lambda directly with a synthetic event for `POST /heartbeat`. Auth via `X-Heartbeat-Secret: $APP_PASSWORD`. Heartbeat sessions are created with `firstMessageAuthor="user"` and a default freeform `resultSchema = {"type":"object"}`.

## Channels
v1 is web only. The handler is the single ingress; new channels (Telegram, Slack, Discord, email) plug in as additional routes that translate inbound messages into `createSession` + `launchTask` calls.

## gstack
Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.
