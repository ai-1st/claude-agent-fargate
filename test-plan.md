# ClaudeClaw — Test Plan

## Cross-persona orchestration — scheduled devops triage

Exercises the `personas` built-in MCP server (`sessions_create`, `sessions_list_active`, `sessions_get`), the heartbeat path, and the per-session `resultSchema` enforcement. Single scenario delegates through three personas with the new uniform model — no `PersonaKind`, no persistent extension binding.

### Personas under test
- `devops` — has heartbeat cron, AWS SDK installed, MCP tool `personas` enabled.
- `browser-operator` — drives a logged-in Chrome window via the extension when the human clicks "Open in Extension" on each delegated session.
- `approver` — human-only verdict persona; agent prompts the human in the web UI and submits a structured verdict.

### Setup
```bash
npx tsx scripts/upload-project.ts --name devops --dir ./projects/devops \
  --memory-enabled true --mcp-enabled true --heartbeat-cron 'rate(30 minutes)' --profile co
npx tsx scripts/upload-project.ts --name browser-operator --dir ./projects/browser-operator --profile co
npx tsx scripts/upload-project.ts --name approver         --dir ./projects/approver         --profile co
```
The ClaudeClaw Chrome extension is installed; no token/binding pre-config is needed. The human is logged into AWS Console (SSO) and Jira in their browser.

### Steps
1. **Heartbeat fires.** EventBridge Scheduler invokes Lambda with synthetic `POST /heartbeat` + `X-Heartbeat-Secret`. Lambda creates a `devops` session: `name="Heartbeat ..."`, `firstMessageAuthor="user"`, `resultSchema={"type":"object"}`, prompt = `routine: check prod RDS CPU; if anomalous, get human approval and file a Jira ticket`. Worker Lambda invoked.
2. **devops asks `browser-operator` for short-lived AWS creds.**
   - SDK call: `sessions_create({ persona:"browser-operator", name:"AWS creds for 1234/AdminAccess", prompt:"Playbook A1: copy SSO CLI creds for account=1234 role=AdminAccess.", resultSchema:{type:"object", required:["accessKeyId","secretAccessKey","sessionToken"], properties:{accessKeyId:{type:"string"}, secretAccessKey:{type:"string"}, sessionToken:{type:"string"}, expiration:{type:"string"}}}, inputUrl:"https://signin.aws.amazon.com/...", waitMs:300000 })`.
   - Lambda creates session A with `callerPersona="devops"` and launches its worker.
   - The session shows up in `/inbox` (status=WAITING_HUMAN once the agent posts its prompt). Human opens it → clicks **Open in Extension** → Lambda mints `extToken`, redirects to `chrome-extension://<EXT_CHROME_ID>/open.html?...`. The extension opens a new tab to the AWS SSO `inputUrl` and starts polling.
   - Operator agent runs through Playbook A1 against the bound tab, then calls `submit_result({accessKeyId, secretAccessKey, sessionToken, expiration})`. Ajv validates against `resultSchema`. Session A → COMPLETED. `sessions_create` resolves; devops worker receives the JSON.
3. **devops fetches CloudWatch metrics.** Using the returned creds, devops calls AWS SDK directly (no MCP) — `GetMetricData` for `AWS/RDS CPUUtilization` over the last hour. Detects p95 > 85%.
4. **devops asks `approver` for approval.**
   - SDK call: `sessions_create({ persona:"approver", name:"Approve P2 incident: RDS prod-db CPU 91%", prompt:"RDS prod-db p95 CPU = 91% over last 1h. File P2 Jira ticket?\n\n<metric snapshot JSON>", resultSchema:{type:"object", required:["approved"], properties:{approved:{type:"boolean"}, comment:{type:"string"}}}, waitMs:600000 })`.
   - Lambda creates session B with `callerPersona="devops"` and launches its worker.
   - Approver agent reads the prompt, posts an assistant chat message to the human, status → WAITING_HUMAN. Item appears in `/inbox`.
   - Human replies "yes, P2" via the web UI `/sessions/:id`. Worker resumes; agent calls `submit_result({approved:true, comment:"proceed, P2"})`. Ajv validates. Session B → COMPLETED.
   - `sessions_create` on the devops side resolves with `{approved:true, comment:"proceed, P2"}`.
5. **devops asks `browser-operator` to file the Jira ticket.**
   - SDK call: `sessions_create({ persona:"browser-operator", name:"File Jira OPS P2 incident", prompt:"Playbook B1: create issue in project=OPS, issueType=Incident, priority=P2, summary='RDS prod-db high CPU (91% p95 1h)', description=<metric snapshot> + 'approved by human'.", resultSchema:{type:"object", required:["issueKey","url"], properties:{issueKey:{type:"string"}, url:{type:"string"}}}, inputUrl:"https://<jira>/secure/CreateIssue!default.jspa", waitMs:300000 })`.
   - Lambda creates session C. Human opens it in the extension; operator switches to the Jira tab, fills the form, submits, reads back the new issue key (e.g. `OPS-4271`).
   - `submit_result({issueKey:"OPS-4271", url:"https://…/browse/OPS-4271"})`. Session C → COMPLETED.
6. **devops finalizes.**
   - Writes `memory/incidents/2026-05-05-rds-cpu.md` with metric snapshot + approver comment + Jira link.
   - Final assistant message summarizes the chain. Worker exits, memory synced, devops session → WAITING_HUMAN (no `submit_result` was called; the default freeform schema doesn't require one).

### Expected
- Four sessions written to DynamoDB: 1 `devops` (heartbeat), 2 `browser-operator` (sessions A and C), 1 `approver` (session B). Sessions A/B/C all terminate `COMPLETED` with payloads validated against their `resultSchema`.
- Each delegated session row carries `callerPersona="devops"` and the appropriate `name` for `/inbox` display.
- The two `browser-operator` sessions execute in series because the human opens each one in turn — but nothing forces ordering at the platform level; the queue invariant is gone.
- All `submit_result` payloads validate against their schemas. A mis-shaped payload (e.g. omitting `approved`) would fail validation, mark the message FAILED, and surface the schema error.
- `memory/incidents/2026-05-05-rds-cpu.md` exists in S3 and contains the Jira issue key.
- AWS creds appear only in session A's submitResult and in transient devops worker memory; not persisted to `memory/`.

### Negative branch (sanity, not happy path)
If the human replies "no" at step 4, the approver agent calls `submit_result({approved:false, comment:"…"})`. devops must skip step 5 and write `memory/incidents/…` with `outcome: skipped (rejected)`. No second `browser-operator` session is created.
