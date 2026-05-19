# CloudClaw — DynamoDB schema

Single-table design. Table name is `${STACK_NAME}-table` (default `claude-agent-serverless-table`). All entities share `pk` (HASH) + `sk` (RANGE), distinguished by `pk` prefix.

## Indexes

| Index | HASH       | RANGE       | Used for                                           |
|-------|------------|-------------|----------------------------------------------------|
| —     | `pk`       | `sk`        | Direct gets, child-row scans within a session.     |
| GSI1  | `gsi1pk`   | `gsi1sk`    | Recent sessions ordered by `createdAt` desc.       |
| GSI2  | `gsi2pk`   | `gsi2sk`    | Reserved. Not written by any current code path.    |

All attributes are sparse (DynamoDB skips items without the GSI key). GSI2 exists in the CFN template but every row in the current model leaves it unset.

## Entities

### Persona — `pk = "PERSONA#<name>" sk = "META"`

Defined in [src/shared/types.ts](src/shared/types.ts) `interface Persona`.

| Attribute           | Type      | Notes                                                                       |
|---------------------|-----------|------------------------------------------------------------------------------|
| `name`              | S         | Unique. `[A-Za-z0-9][A-Za-z0-9_-]{0,40}`.                                    |
| `s3Key`             | S         | `lambda/personas/<name>/`. Empty before first template application.          |
| `description`       | S?        | Free-form one-liner; shown in dropdowns and `sessions_list_active`.          |
| `actions`           | SS?       | Free-form action labels for cross-persona discovery (display only).          |
| `systemPrompt`      | S?        | Optional override; appended in front of `CLAUDE.md` from the project.        |
| `allowedTools`      | SS?       | If set, replaces the worker's `DEFAULT_TOOLS` list (built-in MCP tool names are always appended). |
| `mcpEnabled`        | BOOL?     | If true, worker reads `mcp.json` from the project dir and registers external MCP servers. |
| `memoryEnabled`     | BOOL?     | Default true. Controls whether `memory/<name>/` is symlinked into the worker cwd. |
| `heartbeatCron`     | S?        | `rate(...)` or `cron(...)`. Bound to an EventBridge schedule via `ensureHeartbeatSchedule`. |
| `scheduleArn`       | S?        | EventBridge schedule ARN, written when a heartbeat schedule is created.      |
| `templateName`      | S?        | Template currently applied (if any).                                         |
| `templateSha`       | S?        | sha256 captured at the moment of the last apply; stale-detection.            |
| `templateAppliedAt` | S?        | ISO timestamp of last template apply.                                        |
| `createdAt`         | S         |                                                                              |
| `updatedAt`         | S         |                                                                              |

No `kind` field — personas are uniform.

### Template — `pk = "TEMPLATE#<name>" sk = "META"`

Defined in `interface Template`. Populated by `scripts/sync-templates.ts`.

| Attribute      | Type | Notes                                                  |
|----------------|------|--------------------------------------------------------|
| `name`         | S    | Template name = directory name under `./projects/`.    |
| `s3Key`        | S    | `lambda/templates/<name>/`.                            |
| `description`  | S?   | Copied from `persona.json` at sync time.               |
| `actions`      | SS?  | Copied from `persona.json` at sync time.               |
| `sha256`       | S?   | SHA-256 of the template's file tree (used for staleness checks). |
| `createdAt`    | S    |                                                        |
| `updatedAt`    | S    |                                                        |

### Memory file — `pk = "PERSONA#<name>" sk = "MEM#<path>"`

Pointer row. The actual bytes live at `s3://<bucket>/lambda/memory/<persona>/<path>`.

| Attribute   | Type | Notes                                |
|-------------|------|--------------------------------------|
| `path`      | S    | Relative path under `memory/`.       |
| `s3Key`     | S    | Full S3 key.                         |
| `sha256`    | S    | Content sha256 for change detection. |
| `size`      | N    | Bytes.                               |
| `updatedAt` | S    |                                      |

### Schedule (per-persona cron) — `pk = "PERSONA#<name>" sk = "CRON#<id>"`

| Attribute     | Type   | Notes                                                    |
|---------------|--------|----------------------------------------------------------|
| `id`          | S      | 8-char uuid slice.                                       |
| `cron`        | S      | `rate(...)` or `cron(...)`.                              |
| `prompt`      | S      | The prompt the worker sees on each tick.                 |
| `enabled`     | BOOL   |                                                          |
| `lastRun`     | S?     | ISO; bumped on each invocation.                          |
| `scheduleArn` | S?     | EventBridge ARN.                                         |
| `createdAt`   | S      |                                                          |

### Skill — `pk = "PERSONA#<name>" sk = "SKILL#<name>"`

Defined in `interface Skill`. Currently the worker uses the SDK's auto-discovery via `settingSources:["project"]` and no rows are written; the type exists for future indexing.

### Session — `pk = "SESSION#<id>" sk = "META"`

Defined in `interface Session`. `<id>` is a uuid v4.

| Attribute              | Type | Notes                                                                            |
|------------------------|------|----------------------------------------------------------------------------------|
| `gsi1pk`               | S    | Constant `"SESSIONS"`. Sparse partition for the global session feed.             |
| `gsi1sk`               | S    | `createdAt` ISO. `ScanIndexForward=false` returns newest first.                  |
| `persona`              | S    | Persona name this session belongs to.                                            |
| `name`                 | S    | Descriptive label shown in `/`, `/inbox`, and the asker's `sessions_get` output. |
| `status`               | S    | `RUNNING \| WAITING_HUMAN \| COMPLETED \| FAILED \| IDLE \| SLEEPING`.            |
| `firstMessageAuthor`   | S    | `"user"` or `"agent"`. Drives the worker's initial-prompt composition.           |
| `resultSchema`         | M    | JSON Schema object. `submit_result(payload)` is validated against this via Ajv before the session goes `COMPLETED`. |
| `inputUrl`             | S?   | URL given to the extension as the starting page on "Open in Extension".          |
| `extToken`             | S?   | Minted on demand by `POST /sessions/:id/bind-ext`. Random 24-byte hex.           |
| `extTokenLastSeenAt`   | S?   | Bumped each time the extension hits `/ext/poll` or `/ext/result` for this sid.   |
| `agentSessionId`       | S?   | Agent SDK session id; captured from the first `system/init` SDK message. Used to `resume` on follow-up turns. |
| `callerPersona`        | S?   | If the session was created by another persona via the `sessions_create` MCP tool, that caller's name is recorded here for traceability. |
| `submitResult`         | S?   | JSON-serialised payload from the agent's `submit_result` call. Set together with `status = COMPLETED`. |
| `wakeAt`               | S?   | ISO timestamp; set when `agent_sleep` schedules a wake. Cleared on resume.       |
| `createdAt`            | S    |                                                                                  |
| `updatedAt`            | S    |                                                                                  |

### Message — `pk = "SESSION#<id>" sk = "MSG#<sortKey>"`

Defined in `interface Message`. `<sortKey>` is a zero-padded 3-digit counter (`000`, `001`, ...).

| Attribute          | Type | Notes                                                                     |
|--------------------|------|---------------------------------------------------------------------------|
| `kind`             | S?   | `"user" \| "heartbeat" \| "assistant"`. Default `"user"`.                  |
| `prompt`           | S    | For user/heartbeat: the human (or scheduler) prompt. For assistant: the assistant text (only used when `firstMessageAuthor === "agent"` to seed `MSG#000`). |
| `status`           | S    | `"RUNNING" \| "COMPLETED" \| "FAILED" \| "SLEEPING"`. The triggering message is `RUNNING` until the worker finishes the turn. |
| `result`           | S?   | Final assistant text for this turn (when the agent did NOT call `submit_result`). For runs that call `submit_result`, stores the JSON payload instead. |
| `error`            | S?   | Error message when `status = "FAILED"`.                                   |
| `lambdaRequestId`  | S?   | Async-invoke request id of the most recent worker invocation for this message. Set by the control plane right after `lambda:Invoke`. |
| `restartCount`     | N?   | Incremented each time `setMessageInvokeId` runs for the same message (manual re-invokes, budget self-reinvokes, wakes). |
| `createdAt`        | S    |                                                                           |

### Browser command — `pk = "SESSION#<id>" sk = "BRCMD#<seq>"`

Defined in `interface BrowserCommand`. Written by the worker's `browser` MCP tools; drained by the extension via `/ext/poll`.

| Attribute   | Type | Notes                                                                       |
|-------------|------|------------------------------------------------------------------------------|
| `seq`       | S    | 6-digit zero-padded counter per session.                                     |
| `op`        | S    | `"open" \| "readText" \| "click" \| "fill" \| "scroll" \| "extract" \| "screenshot" \| "run_scraper"`. |
| `args`      | M    | Op-specific JSON args.                                                       |
| `status`    | S    | `"PENDING" \| "DISPATCHED" \| "DONE"`.                                       |
| `createdAt` | S    |                                                                              |

### Browser result — `pk = "SESSION#<id>" sk = "BRRES#<seq>"`

Defined in `interface BrowserResult`. Posted by the extension via `/ext/result`; read by the worker's `waitForResult` polling loop.

| Attribute     | Type     | Notes                                            |
|---------------|----------|--------------------------------------------------|
| `seq`         | S        | Matches the BRCMD seq.                           |
| `ok`          | BOOL     |                                                  |
| `data`        | any?     | Whatever the content script returned.            |
| `error`       | S?       | When `ok = false`.                               |
| `completedAt` | S        |                                                  |

### Handoff request — `pk = "SESSION#<id>" sk = "HANDOFF#<seq>"`

Type defined (`interface HandoffRequest`) and helpers exist (`nextHandoffSeq`, `putHandoff`, `getHandoff`, `listHandoffs`, `nextPendingHandoff`, `resolveHandoff`) but no production path currently writes these rows. Kept for forward compatibility.

## Removed (kept for migration awareness)

Earlier CloudClaw versions had these and they are NO LONGER WRITTEN by any code path:

- `PersonaKind` field on Persona (`headless | operator | approver`).
- `Persona.extToken` (replaced by session-scoped `extToken`).
- `Session.kind` (uniform model).
- `Session.approvalPrompt / approvalContext / approvalResult / approvalComment` (replaced by `name`, `resultSchema`, `submitResult`).
- `Session.gsi2pk / gsi2sk` (replaced by `listInbox` / `listActiveSessions` over GSI1).
- `Session` statuses `QUEUED` and `AWAITING_APPROVAL`.
- `EXT#<token>` rows (the entire `ExtToken` table) — replaced by per-session `extToken`.

If you upgrade a stale stack, delete `EXT#*` and `SESSION#*` rows before retesting. Old persona rows can stay (extra `kind`/`extToken` attributes are ignored).

## Bucket layout (S3, not DynamoDB)

The S3 Files mount at `/mnt/s3` is rooted at `s3://<bucket>/lambda/`:

```
lambda/
  personas/<name>/          # CLAUDE.md, persona.json, mcp.json, skills/...
  memory/<name>/            # mounted as memory/ inside the persona cwd
  templates/<name>/         # synced by scripts/sync-templates.ts
  agent-state/<sid>/        # HOME for the Agent SDK; .claude/projects/.../<agentSessionId>.jsonl
```
