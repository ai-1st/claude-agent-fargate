# Claude Agent Fargate

Per-session ECS Fargate runner for the Claude Agent SDK, fronted by an HTMX UI on a Lambda Function URL.

## Architecture

- **Lambda (Function URL)** — HTMX UI, launches ECS tasks, polls/streams worker logs.
- **ECS Fargate (ARM64, 2 vCPU / 8 GB)** — one task per session, runs `@anthropic-ai/claude-agent-sdk`.
- **DynamoDB** — single table (`PK/SK + GSI1`) for projects, sessions, messages.
- **S3** — project bundles (`.tgz`).
- **SSM Parameter Store** — per-project secrets, materialized as `.env` in the worker.
- **CloudWatch Logs** — worker stdout, surfaced inline in the UI.

## DynamoDB layout

| Entity   | pk                  | sk           | GSI1                                     |
|----------|---------------------|--------------|------------------------------------------|
| Project  | `PROJECT#<name>`    | `PROJECT`    | —                                        |
| Session  | `SESSION#<id>`      | `META`       | `gsi1pk=SESSIONS, gsi1sk=<createdAt>`    |
| Message  | `SESSION#<id>`      | `MSG#<sk>`   | —                                        |

## Layout

```
src/shared/   # types + DynamoDB + CloudWatch helpers (Lambda + Worker)
src/lambda/   # Function URL handler + HTMX views
src/worker/   # Fargate task entrypoint (one session per task)
projects/     # local project sources, uploaded to S3 by CLI
scripts/      # upload-project, set-secret, deploy
template.yaml # SAM template
```

## Deploy

```bash
make deploy   # build worker image (multi-arch ARM64+AMD64), push to ECR, sam deploy
```

Override the AWS profile via `AWS_PROFILE=...` (default `co`).

## Project upload

```bash
npx tsx scripts/upload-project.ts --name devops --dir ./projects/devops --profile ce
npx tsx scripts/set-secret.ts --project devops --key JIRA_API_KEY --value "..." --profile ce
```

## Agent SDK usage

- First message: `query({ prompt, options: { cwd, settingSources: ["project"], allowedTools, permissionMode: "acceptEdits" } })`
- Follow-ups: `query({ prompt, options: { resume: agentSessionId } })`
- `agentSessionId` is captured from the `system/init` message on the first run and stored on the session META record.
