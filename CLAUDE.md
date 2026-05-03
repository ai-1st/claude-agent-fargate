# Claude Agent Fargate

## Overview
Each agent session runs in its own Fargate task (Graviton/ARM64). A Lambda Function URL serves an HTMX UI and launches ECS tasks. DynamoDB single-table design for persistence. Projects stored as .tgz on S3. Per-project secrets in SSM Parameter Store.

## Tech Stack
- TypeScript (ES2022 modules)
- AWS SAM for deployment (`AWS_PROFILE=co`)
- DynamoDB single table (`AgentTable`): PK/SK + GSI1
- Lambda Function URL (ARM64, nodejs20.x, esbuild) serving HTMX UI
- ECS Fargate tasks (ARM64, 2 vCPU / 8GB) running @anthropic-ai/claude-agent-sdk
- S3 for project .tgz files
- SSM Parameter Store for secrets
- Multi-arch Docker images (arm64 + amd64)

## DynamoDB Single Table Design
- Project: `pk=PROJECT#<name>` `sk=PROJECT`
- Session: `pk=SESSION#<id>` `sk=META` `gsi1pk=SESSIONS` `gsi1sk=<createdAt>`
- Message: `pk=SESSION#<id>` `sk=MSG#<sortKey>` (sortKey = zero-padded counter)

## Project Layout
- `src/shared/` — types and DynamoDB helpers (shared by Lambda + Worker)
- `src/lambda/` — Lambda Function URL handler + HTMX views
- `src/worker/` — Fargate task entry point (single-session runner)
- `projects/` — named project directories (uploaded to S3 via CLI)
- `scripts/` — CLI tools (upload-project, set-secret, deploy)

## Key Commands
```bash
make deploy                           # Build + deploy everything
npx tsx scripts/upload-project.ts --name devops --dir ./projects/devops --profile ce
npx tsx scripts/set-secret.ts --project devops --key JIRA_API_KEY --value "..." --profile ce
```

## Agent SDK Usage
- First message: `query({ prompt, options: { cwd, settingSources: ["project"], allowedTools: [...], permissionMode: "acceptEdits" } })`
- Follow-ups: `query({ prompt, options: { resume: agentSessionId } })`
- `agentSessionId` captured from `system/init` message on first run, stored on session META record.
- Per-project secrets written as `.env` file in extracted project dir.
