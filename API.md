# CloudClaw — Internal APIs

All HTTP routes are served by the `${STACK_NAME}-api` Lambda Function URL. Implementations live in [src/lambda/handler.ts](src/lambda/handler.ts). MCP tools are registered by the worker Lambda; implementations live in [src/worker/index.ts](src/worker/index.ts).

## Authentication

- **Web UI** (everything except `/login`, `/heartbeat`, `/ext/*`): a single shared `APP_PASSWORD` set as `auth` cookie. `POST /login` issues the cookie with `HttpOnly; SameSite=Strict; Max-Age=30d`. Unauthenticated requests get 302→`/login`.
- **Heartbeat / scheduler invocations**: `POST /heartbeat` requires header `X-Heartbeat-Secret: ${APP_PASSWORD}`. Invoked by EventBridge Scheduler with a synthetic event payload (no cookie).
- **Extension polling**: `/ext/*` requires the session-scoped `extToken` (24-byte hex), validated against `Session.extToken` on each request. The token is minted by `POST /sessions/:id/bind-ext` and embedded in a `chrome-extension://${EXT_CHROME_ID}/open.html?...` redirect URL.

Responses are HTML for web routes (HTMX), JSON for `/ext/*` and `/heartbeat`. The `parseBody` helper handles both `application/json` and `application/x-www-form-urlencoded`.

## HTTP routes

### Auth

| Method | Path     | Body / Query                  | Response                                                        |
|--------|----------|-------------------------------|-----------------------------------------------------------------|
| GET    | `/login` | —                             | HTML login form.                                                |
| POST   | `/login` | form: `password`              | On success: 302 `/` + `Set-Cookie: auth=...`. On failure: HTML form with error. |

### Home / sessions list

| Method | Path        | Notes                                                                                  |
|--------|-------------|----------------------------------------------------------------------------------------|
| GET    | `/`         | HTMX home: "New Session" form + recent sessions table (50 newest via GSI1).             |
| GET    | `/sessions` | 302 `/`. Kept for backward links.                                                       |

### Personas (CRUD + memory + schedules)

| Method | Path                                                  | Body / Query                                                                                                                       | Notes |
|--------|-------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|-------|
| GET    | `/personas`                                           | —                                                                                                                                  | HTML list of all personas (`scanPersonas`). |
| GET    | `/personas/new`                                       | —                                                                                                                                  | Create form. |
| POST   | `/personas`                                           | form: `mode` (`create` or `update`), `name`, `template` (required on create), `description?`, `systemPrompt?`, `allowedTools?` (comma-sep), `memoryEnabled` (`on`), `mcpEnabled` (`on`), `heartbeatCron?` | Create copies template files into `lambda/personas/<name>/` via `applyTemplateToPersona`. Update edits Persona META and (re)wires the EventBridge heartbeat schedule. Redirect to `/personas/:name` on success. |
| GET    | `/personas/:name`                                     | —                                                                                                                                  | Detail page: config, template, sessions, memory list, skills, schedules. |
| GET    | `/personas/:name/edit`                                | —                                                                                                                                  | Edit form. |
| POST   | `/personas/:name/reprovision`                         | —                                                                                                                                  | Re-apply the persona's currently linked template; preserves `memory/`. |
| POST   | `/personas/:name/switch-template`                     | form: `template`                                                                                                                   | Apply a different template; preserves `memory/`. |
| GET    | `/personas/:name/memory/:path`                        | —                                                                                                                                  | Streams a memory file from S3 and renders it as `<pre>` HTML. |
| POST   | `/personas/:name/schedules`                           | form: `cron`, `prompt`                                                                                                             | Create a per-persona cron entry + EventBridge schedule. |
| POST   | `/personas/:name/schedules/:id/delete`                | —                                                                                                                                  | Delete the cron entry and its schedule. |

### Sessions

| Method | Path                                          | Body                                                                                                                                                                | Notes |
|--------|-----------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------|
| POST   | `/sessions`                                   | form: `persona`, `name`, `prompt`, `firstMessageAuthor` (`user` or `agent`; default `user`), `resultSchema` (JSON; default `{"type":"object"}`), `inputUrl?`        | Creates a session row + `MSG#000` via `dispatchSession`. If `firstMessageAuthor=user`, async-invokes the worker immediately. Redirect to `/sessions/:id`. |
| GET    | `/sessions/:id`                               | —                                                                                                                                                                   | Full session detail page (HTMX-polled). Shows name, status, persona, schema, inputUrl, "Open in Extension" button, message list, composer. |
| GET    | `/sessions/:id/messages`                      | —                                                                                                                                                                   | HTMX partial: the message list + an OOB composer + status badge. Returns HTTP 286 when terminal so HTMX cancels the polling trigger. |
| POST   | `/sessions/:id/messages`                      | form: `prompt`                                                                                                                                                      | Append a user message, flip session to `RUNNING`, async-invoke the worker. Redirect to `/sessions/:id`. |
| POST   | `/sessions/:id/messages/:sk/restart`          | —                                                                                                                                                                   | Re-invoke the worker for a `RUNNING` message (manual recovery for crashes). 409 if the message isn't `RUNNING`. |
| POST   | `/sessions/:id/bind-ext`                      | —                                                                                                                                                                   | Mint a random `extToken`, store on the session, 302 to `chrome-extension://${EXT_CHROME_ID}/open.html?sid=...&token=...&base=...&inputUrl=...`. 409 if session is `COMPLETED` or `FAILED`. 500 if `EXT_CHROME_ID` is unset. |

### Inbox

| Method | Path     | Notes                                                                                          |
|--------|----------|------------------------------------------------------------------------------------------------|
| GET    | `/inbox` | HTML list of sessions with `status = "WAITING_HUMAN"` (across all personas). Links to `/sessions/:id`. |

### Extension bridge (`/ext/*` — token-authed, JSON)

The extension binds per-session: it reads `sid`, `token`, `base`, `inputUrl?` from URL params on `open.html` and then drives those endpoints.

| Method | Path             | Query / Body                                                          | Response                                                                                       |
|--------|------------------|-----------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| GET    | `/ext/poll`      | query: `sid`, `token`                                                 | If session is `COMPLETED`/`FAILED`: `{active: null, terminal: true, status}`. Else if there's a pending BRCMD: `{active: {sessionId, status}, command: {seq, op, args}}` (and BRCMD is flipped to `DISPATCHED`). Else: `{active: {sessionId, status, name, inputUrl}, messages: [...last 30...], canSend: status === "WAITING_HUMAN"}`. 401 on bad token. |
| POST   | `/ext/result`    | JSON: `{sid, token, seq, ok, data?, error?}`                          | Writes the BRRES row and flips the matching BRCMD to `DONE`. `{ok: true}`.                      |
| POST   | `/ext/messages`  | JSON: `{sid, token, prompt}`                                          | Append a user message to the session, flip to `RUNNING`, async-invoke the worker. 409 if not `WAITING_HUMAN`. |

### Heartbeat (scheduler-only)

| Method | Path         | Body                                                                                                  | Notes |
|--------|--------------|-------------------------------------------------------------------------------------------------------|-------|
| POST   | `/heartbeat` | JSON: `{persona, scheduleId?, prompt?}` — header `X-Heartbeat-Secret: ${APP_PASSWORD}`               | Creates a session with `firstMessageAuthor="user"`, `resultSchema={"type":"object"}`. `name` derived from `scheduleId` if present, otherwise `"Heartbeat <iso>"`. The first `MSG#000` is `kind="heartbeat"`. Returns `{ok, sessionId, invokeId, launched}`. |

### Misc

| Method | Path        | Notes                                                                              |
|--------|-------------|------------------------------------------------------------------------------------|
| GET    | `/projects` | JSON list of personas (`[{name, updatedAt}]`). Convenience for external automation.|

All unknown paths return `404 Not Found`. Unhandled errors return `500` with the error message in the body.

## Worker → control-plane (internal)

These are not HTTP — they are direct DynamoDB and Lambda Invoke calls. Documented here because they ARE the contract the worker depends on:

- **Async Lambda invoke** from the API Lambda to the worker (`InvocationType: "Event"`) with payload `{SESSION_ID, MESSAGE_SK, resume?, nudge?}`. Initiated by:
  - `POST /sessions` and `POST /sessions/:id/messages` and `POST /ext/messages` (new user turn).
  - `POST /sessions/:id/messages/:sk/restart` (manual recovery).
  - The worker's own self-reinvoke on budget interrupt.
  - EventBridge Scheduler `at(...)` schedule created by `agent_sleep`.

- **DynamoDB writes** during a worker turn:
  - `setSessionAgentId(sid, agentSessionId)` — first invocation only.
  - `updateMessage(sid, sk, status, result?, error?)` — sets the triggering message's terminal state.
  - `updateSessionStatus(sid, status)` — `WAITING_HUMAN` or `SLEEPING` or `FAILED`.
  - `setSubmitResult(sid, payloadJson)` — on `submit_result`: writes `submitResult` + `status = COMPLETED` atomically.
  - `setSessionWakeAt(sid, atIso)` — on `agent_sleep`.
  - `putBrCmd(sid, seq, op, args)` / `getBrRes(sid, seq)` — for `browser_*` tool calls.

- **EventBridge Scheduler** writes: `CreateSchedule` (heartbeats, per-persona crons, agent_sleep wakes); `UpdateSchedule` / `DeleteSchedule` mirror the lifecycle.

## MCP tools available to every persona

Registered by [src/worker/index.ts](src/worker/index.ts) in three in-process MCP servers. The worker computes `allowedTools = [...persona.allowedTools ?? DEFAULT_TOOLS, ...all built-in mcp tool names]` and passes it to the Agent SDK.

### Server: `personas`

| Tool                       | Params                                                                                                       | Returns                                                                                                       |
|----------------------------|--------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `personas_list`            | —                                                                                                            | `[{name, description, actions}, ...]` for every persona in the table.                                          |
| `sessions_create`          | `persona, name, prompt, firstMessageAuthor? ("user"\|"agent"), resultSchema (JSON Schema), inputUrl?, waitMs?` | If `waitMs <= 0` or omitted: `{sessionId, status}` returns immediately. Else polls every 2s up to `waitMs`; returns `{sessionId, status, result?}` where `result` is the parsed `submitResult` on `COMPLETED`. `callerPersona` is recorded from `process.env.__CALLER_PERSONA__`. |
| `sessions_list_active`     | `persona?`                                                                                                   | Sessions with status not in `COMPLETED \| FAILED`. `[{sessionId, persona, name, status, firstMessageAuthor, callerPersona?, createdAt}]`. |
| `sessions_get`             | `sessionId`                                                                                                  | `{status, name, persona, result?}` — `result` is the parsed `submitResult` when `status === "COMPLETED"`.     |

### Server: `control`

| Tool             | Params                                                              | Effect                                                                                                                                                  |
|------------------|---------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| `agent_sleep`    | `seconds?` (60..30d), `untilIso?`, `reason?`                        | Records the sleep request; the worker's SDK loop interrupts and the post-loop handler creates an EventBridge `at(...)` schedule that re-invokes the worker with `resume:"wake"` + nudge. Session status → `SLEEPING`. |
| `submit_result`  | `payload` (anything)                                                | Records the payload. After the SDK loop exits, the worker JSON-serialises it, validates against the session's `resultSchema` via Ajv (allErrors, non-strict). On pass: `submitResult` written + `status = COMPLETED`. On fail: `message.status = FAILED` with the validation error, session `status = FAILED`. Calling this terminates the session — call exactly ONCE. |

### Server: `browser`

Always registered. Every tool call writes a `BRCMD#<seq>` row and polls `BRRES#<seq>` for up to 10 minutes. If no extension is bound to the session, the call times out and returns `{error: "browser command timed out (no extension bound or extension not polling)"}`.

| Tool                  | Params                                                                                          | Returns / data                                                                                              |
|-----------------------|-------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| `browser_open`        | `url`                                                                                           | Navigates the bound tab (or creates one) to the URL. `{tabId, url}`.                                         |
| `browser_readText`    | `selector?`                                                                                     | Text content of the page or selector (truncated to 20 000 chars).                                            |
| `browser_click`       | `selector`                                                                                      | `{clicked: true}`.                                                                                           |
| `browser_fill`        | `selector, value`                                                                               | `{filled: true}`. Uses the real input-value setter so frameworks see the change.                             |
| `browser_scroll`      | `direction? ("top"\|"bottom"\|"up"\|"down")`, `pixels?`                                          | `{scrolled: true}`.                                                                                          |
| `browser_extract`     | `selectors: {field: "sel" \| "sel@attr"}`                                                       | `{field: value or [values] or null, ...}`.                                                                   |
| `browser_screenshot`  | —                                                                                                | `{dataUrl}` — base64 PNG of the visible viewport.                                                            |
| `browser_run_scraper` | `name, action, args?`                                                                            | Bundled extension scrapers (e.g. `linkedin.searchPeople`).                                                   |
| `browser_save_dom`    | `path` (relative under `/tmp/work/`), `selector?`                                                | `{path, bytes}`. Captures `outerHTML` and writes to disk; downstream tools (`Read`, `Bash`) parse the file. |

## Heartbeat invocation envelope

The API Lambda crafts the synthetic event for EventBridge Scheduler in `buildSchedulerEventInput`:

```json
{
  "requestContext": {"http": {"method": "POST"}},
  "rawPath": "/heartbeat",
  "headers": {
    "content-type": "application/json",
    "x-heartbeat-secret": "<APP_PASSWORD>"
  },
  "body": "<JSON body>"
}
```

`body` is `{"persona": "<name>"}` for heartbeats and `{"persona": "<name>", "scheduleId": "<id>"}` for per-persona crons. The worker's resulting session uses `firstMessageAuthor="user"`, the default freeform `resultSchema = {"type": "object"}`, and the heartbeat prompt as the seed message.

## Worker event envelope

Async Lambda invocations into the worker carry:

```typescript
interface WorkerEvent {
  SESSION_ID: string;
  MESSAGE_SK: string;
  resume?: "wake" | "budget";
  nudge?: string;
}
```

- Normal invoke: `{SESSION_ID, MESSAGE_SK}`.
- Budget self-reinvoke: `resume:"budget"`, `nudge:"[continuation] You were interrupted..."`.
- Wake from `agent_sleep`: `resume:"wake"`, `nudge:"[wake] You scheduled a wake-up at <ts>..."`.

On any `resume`, the worker uses `MESSAGE_SK` (still `RUNNING`) and replaces the prompt with `nudge` to give the SDK fresh user-turn input while resuming the Agent SDK session via `resume: session.agentSessionId`.
