# Claw (Claude Agent Fargate)

OpenClaw-style personal AI agent platform on AWS. Each user message launches its own Fargate task. Personas, persistent memory, scheduled heartbeats, MCP, and Skills layered on top.

## Tech Stack
- TypeScript (ES2022 modules)
- AWS SAM for deployment (`AWS_PROFILE=co`)
- DynamoDB single table (`AgentTable`): PK/SK + GSI1
- Lambda Function URL (ARM64, nodejs20.x, esbuild) serving HTMX UI + heartbeat endpoint
- ECS Fargate tasks (ARM64, 2 vCPU / 8GB) running @anthropic-ai/claude-agent-sdk
- S3 for persona .tgz files AND per-persona memory/
- SSM Parameter Store for per-persona secrets
- EventBridge Scheduler for heartbeats and cron tasks
- Multi-arch Docker images (arm64 + amd64)

## DynamoDB Single Table Design
- Persona: `pk=PERSONA#<name>` `sk=META`
- Memory file: `pk=PERSONA#<name>` `sk=MEM#<path>` (bytes in S3 at `memory/<name>/<path>`)
- Schedule: `pk=PERSONA#<name>` `sk=CRON#<id>`
- Session: `pk=SESSION#<id>` `sk=META` `gsi1pk=SESSIONS` `gsi1sk=<createdAt>` (carries `agentSessionId` for SDK resume)
- Message: `pk=SESSION#<id>` `sk=MSG#<sortKey>` (sortKey = zero-padded counter)

## Persona Tarball Layout (S3 .tgz)
```
CLAUDE.md            # system prompt / persona identity
mcp.json             # optional MCP servers (passed to query() options.mcpServers)
skills/<name>/SKILL.md   # skill metadata; SDK auto-loads via settingSources:["project"]
memory/              # hydrated from s3://bucket/memory/<persona>/ at runtime, synced back on exit
```

## Project Layout
- `src/shared/` — types and DynamoDB helpers (shared by Lambda + Worker)
- `src/lambda/` — Lambda Function URL handler + HTMX views (control plane)
- `src/worker/` — Fargate task entry point (single-message runner with memory sync + MCP + resume)
- `projects/` — named persona directories (uploaded to S3 via CLI)
- `scripts/` — CLI tools (upload-project, set-secret, skill-add, memory-sync, deploy)

## Key Commands
```bash
make deploy
npx tsx scripts/upload-project.ts --name devops --dir ./projects/devops --profile ce \
  --heartbeat-cron 'rate(30 minutes)' --memory-enabled true --mcp-enabled true
npx tsx scripts/set-secret.ts --project devops --key JIRA_API_KEY --value "..." --profile ce
npx tsx scripts/skill-add.ts --persona devops --skill-dir ./some/skill --project-dir ./projects/devops --profile ce
npx tsx scripts/memory-sync.ts --persona devops --dir ./local-memory --direction pull --profile ce
```

## Agent SDK Usage
- First message: `query({ prompt, options: { cwd, settingSources: ["project"], allowedTools, permissionMode: "acceptEdits", mcpServers, systemPrompt? } })`
- Follow-ups: `query({ prompt, options: { cwd, allowedTools, mcpServers, systemPrompt?, resume: agentSessionId } })`
- `agentSessionId` captured from `system/init` SDK message (`session_id` field), stored on session META.
- Per-persona secrets written as `.env` file in extracted persona dir.

## Heartbeat / Cron
- Persona META `heartbeatCron` field, e.g. `rate(30 minutes)`. The web UI's "Save" form ensures the EventBridge Schedule.
- Per-schedule cron entries (`POST /personas/{name}/schedules`) for scoped recurring tasks; each carries a custom prompt.
- Scheduler invokes the Lambda directly with a synthetic event for `POST /heartbeat`. Auth via `X-Heartbeat-Secret: $APP_PASSWORD`.

## Channels
v1 is web only. The handler is the single ingress; new channels (Telegram, Slack, Discord, email) plug in as additional routes that translate inbound messages into `createSession` + `launchTask` calls.
