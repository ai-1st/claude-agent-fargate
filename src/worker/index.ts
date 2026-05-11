import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  SchedulerClient,
  CreateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import Ajv from "ajv";
import { writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync, lstatSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Context } from "aws-lambda";
import {
  getSession,
  getMessages,
  updateMessage,
  updateSessionStatus,
  setSessionAgentId,
  setSubmitResult,
  setSessionWakeAt,
  getPersona,
  scanPersonas,
  listActiveSessions,
  nextBrCmdSeq,
  putBrCmd,
  getBrRes,
} from "../shared/dynamo.js";
import { dispatchSession, DEFAULT_RESULT_SCHEMA } from "../shared/dispatch.js";
import type { BrowserOp, Persona, FirstMessageAuthor } from "../shared/types.js";

const S3_MOUNT = process.env.S3_MOUNT ?? "/mnt/s3";
const WORKER_FUNCTION_NAME = process.env.WORKER_FUNCTION_NAME!;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN!;
const STACK_NAME = process.env.STACK_NAME ?? "claude-agent-serverless";
const WORK_DIR = "/tmp/work";

const ssm = new SSMClient({});
const lambda = new LambdaClient({});
const scheduler = new SchedulerClient({});

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];

// Margin (ms) on remaining Lambda runtime to abort cleanly between SDK
// yields and re-invoke ourselves. ~45s leaves room for cleanup, EventBridge
// CreateSchedule (sleep), Dynamo writes, and the re-invoke call.
const BUDGET_INTERRUPT_MARGIN_MS = 45_000;

interface WorkerEvent {
  SESSION_ID: string;
  MESSAGE_SK: string;
  resume?: "wake" | "budget";
  nudge?: string;
}

interface SleepState {
  requested?: { atIso: string; reason?: string };
}

function log(stage: string, ...args: unknown[]) {
  console.log(`[${stage}]`, ...args);
}

export async function handler(event: WorkerEvent, context: Context): Promise<{ ok: boolean; status?: string }> {
  const sessionId = event.SESSION_ID;
  const messageSk = event.MESSAGE_SK;
  const isResume = event.resume === "wake" || event.resume === "budget";
  const resumeKind = event.resume;
  const nudgeText = event.nudge;

  if (!sessionId || !messageSk) throw new Error("missing SESSION_ID/MESSAGE_SK");
  log("init", `session=${sessionId} message=${messageSk} resume=${resumeKind ?? "no"} remaining=${context.getRemainingTimeInMillis()}ms`);

  try {
    const session = await getSession(sessionId);
    if (!session) throw new Error("Session not found");
    log("db", `session persona=${session.persona} status=${session.status} firstAuthor=${session.firstMessageAuthor}`);

    const messages = await getMessages(sessionId);
    const message = messages.find((m) => m.sk === `MSG#${messageSk}`);
    if (!message) throw new Error("Message not found");
    log("db", `message kind=${message.kind ?? "user"} prompt="${message.prompt.slice(0, 80)}"`);

    const persona = await getPersona(session.persona);
    if (!persona) throw new Error(`Persona ${session.persona} not found`);

    // S3 Files mount is read-only for files uploaded via the S3 API (they
    // appear with uid=0 ownership; Lambda's PosixUser=1001 cannot write into
    // those subtrees). Copy the persona to /tmp so we can mutate it freely
    // (.env, memory/ symlink). Persona files are tiny (KBs) so this is cheap.
    const sourceDir = `${S3_MOUNT}/personas/${persona.name}`;
    if (!existsSync(sourceDir)) {
      throw new Error(
        `persona dir missing on mount: ${sourceDir}. Did you upload via scripts/upload-project.ts?`
      );
    }
    const projectDir = `${WORK_DIR}/persona`;
    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(WORK_DIR, { recursive: true });
    cpSync(sourceDir, projectDir, { recursive: true, dereference: true });

    log("ssm", `fetching secrets for ${persona.name}...`);
    await writeSecrets(persona.name, projectDir);

    if (persona.memoryEnabled !== false) {
      const memMount = `${S3_MOUNT}/memory/${persona.name}`;
      mkdirSync(memMount, { recursive: true });
      ensureSymlink(memMount, join(projectDir, "memory"));
    }

    const externalMcpServers = readMcpConfig(projectDir);
    if (externalMcpServers) {
      log("mcp", `loaded ${Object.keys(externalMcpServers).length} external server(s)`);
    }

    const submitState: { called: boolean; payloadJson?: string } = { called: false };
    const sleepState: SleepState = {};

    const builtinMcpServers: Record<string, unknown> = {};
    builtinMcpServers.personas = createPersonasMcpServer();
    builtinMcpServers.control = createControlMcpServer(submitState, sleepState);
    builtinMcpServers.browser = createBrowserMcpServer(sessionId);

    const mcpServers: Record<string, unknown> = {
      ...(externalMcpServers ?? {}),
      ...builtinMcpServers,
    };

    const explicitAllowed = persona.allowedTools && persona.allowedTools.length > 0 ? persona.allowedTools : undefined;
    const baseAllowed = explicitAllowed ?? DEFAULT_TOOLS;
    const mcpToolNames = Object.keys(builtinMcpServers).flatMap((name) => mcpToolList(name));
    const allowedTools = [...baseAllowed, ...mcpToolNames];
    log("agent", `allowedTools=${allowedTools.join(",")}`);

    // Agent SDK persists conversation state under $HOME/.claude/projects/<encoded-cwd>/<sid>.jsonl
    // Persist that directly to the S3 Files mount, keyed by our session id.
    const agentStateDir = `${S3_MOUNT}/agent-state/${sessionId}`;
    mkdirSync(agentStateDir, { recursive: true });
    process.env.HOME = agentStateDir;
    mkdirSync(join(agentStateDir, ".claude"), { recursive: true });

    const isFollowUp = !!session.agentSessionId;
    const ac = new AbortController();
    const baseOptions: Record<string, unknown> = {
      cwd: projectDir,
      allowedTools,
      permissionMode: "acceptEdits" as const,
      mcpServers,
      abortController: ac,
    };

    // Compose systemPrompt. For firstMessageAuthor="agent" boot (first ever
    // SDK invocation after the human replied), inject the assistant seed so
    // the LLM has context — the SDK doesn't know we already "said" something.
    let composedSystemPrompt = persona.systemPrompt;
    if (!isFollowUp && !isResume && session.firstMessageAuthor === "agent") {
      const seed = messages.find((m) => m.sk === "MSG#000" && m.kind === "assistant");
      if (seed) {
        const seedNote = `<prior_assistant_message>\nYou previously said the following to start this session, and the human has now replied to it:\n\n${seed.prompt}\n</prior_assistant_message>`;
        composedSystemPrompt = composedSystemPrompt
          ? `${composedSystemPrompt}\n\n${seedNote}`
          : seedNote;
      }
    }
    // Inject resultSchema reminder so the model knows submit_result's expected shape.
    const schemaJson = JSON.stringify(session.resultSchema ?? DEFAULT_RESULT_SCHEMA);
    const schemaNote = `<result_schema>\nWhen you call submit_result, the payload must validate against this JSON Schema:\n${schemaJson}\n</result_schema>`;
    composedSystemPrompt = composedSystemPrompt
      ? `${composedSystemPrompt}\n\n${schemaNote}`
      : schemaNote;
    if (composedSystemPrompt) baseOptions.systemPrompt = composedSystemPrompt;

    const options = isFollowUp
      ? { ...baseOptions, resume: session.agentSessionId }
      : { ...baseOptions, settingSources: ["project" as const] };

    // Resume invocations replace the message prompt with the nudge text so the
    // SDK has a fresh user turn to chew on while picking up the session.
    const prompt = isResume && nudgeText
      ? nudgeText
      : message.prompt;
    log("agent", `starting Agent SDK query (resume=${isFollowUp || isResume}, kind=${resumeKind ?? "user"})...`);

    let result = "";
    let capturedAgentSessionId: string | undefined;
    let msgCount = 0;
    let abortReason: "sleep" | "budget" | undefined;

    const q = query({ prompt, options });
    for await (const msg of q) {
      msgCount++;
      const m = msg as Record<string, unknown>;
      const msgType = m.type ?? "unknown";
      if (msgCount <= 5 || msgCount % 10 === 0) {
        log("agent", `msg #${msgCount} type=${msgType}${m.subtype ? ` subtype=${m.subtype}` : ""}`);
      }
      if (m.type === "system" && m.subtype === "init" && typeof m.session_id === "string") {
        capturedAgentSessionId = m.session_id;
        log("agent", `captured agentSessionId=${capturedAgentSessionId}`);
      }
      if ("result" in m) {
        result = m.result as string;
        log("agent", `got result (${result.length} chars)`);
      }

      if (sleepState.requested) {
        log("budget", `sleep requested at=${sleepState.requested.atIso} → interrupting`);
        abortReason = "sleep";
        try { await q.interrupt(); } catch (e) { log("budget", "interrupt threw:", e); }
        try { ac.abort(); } catch { /* ignore */ }
        break;
      }
      const remaining = context.getRemainingTimeInMillis();
      if (remaining < BUDGET_INTERRUPT_MARGIN_MS) {
        log("budget", `remaining=${remaining}ms < ${BUDGET_INTERRUPT_MARGIN_MS}ms → interrupting for re-invoke`);
        abortReason = "budget";
        try { await q.interrupt(); } catch (e) { log("budget", "interrupt threw:", e); }
        try { ac.abort(); } catch { /* ignore */ }
        break;
      }
    }
    log("agent", `query loop exited after ${msgCount} messages (abort=${abortReason ?? "no"})`);

    if (!isFollowUp && capturedAgentSessionId) {
      await setSessionAgentId(sessionId, capturedAgentSessionId);
    }

    if (abortReason === "sleep" && sleepState.requested) {
      const wakeAt = sleepState.requested.atIso;
      await scheduleWake(sessionId, messageSk, wakeAt, sleepState.requested.reason, context);
      await setSessionWakeAt(sessionId, wakeAt);
      await updateSessionStatus(sessionId, "SLEEPING");
      log("sleep", `scheduled wake at ${wakeAt}; status=SLEEPING; exiting`);
      return { ok: true, status: "SLEEPING" };
    }

    if (abortReason === "budget") {
      await reinvokeSelf({
        SESSION_ID: sessionId,
        MESSAGE_SK: messageSk,
        resume: "budget",
        nudge:
          "[continuation] You were interrupted by the runtime mid-turn (Lambda budget). Continue exactly where you left off. If you were in the middle of a tool call, redo it. Do not start over.",
      });
      log("budget", "self re-invoked; exiting; message stays RUNNING");
      return { ok: true, status: "RUNNING" };
    }

    if (submitState.called) {
      const payloadJson = submitState.payloadJson ?? "null";
      const validation = validateAgainstSchema(payloadJson, session.resultSchema);
      if (!validation.ok) {
        const errMsg = (validation as { ok: false; error: string }).error;
        log("done", `submit_result payload failed schema validation: ${errMsg}`);
        await updateMessage(sessionId, messageSk, "FAILED", payloadJson, `submit_result schema validation failed: ${errMsg}`);
        await updateSessionStatus(sessionId, "FAILED");
        return { ok: false, status: "FAILED" };
      }
      await updateMessage(sessionId, messageSk, "COMPLETED", payloadJson);
      await setSubmitResult(sessionId, payloadJson);
      log("done", "submit_result called -> COMPLETED");
    } else {
      const text = (result || "").trim();
      await updateMessage(sessionId, messageSk, "COMPLETED", text);
      await updateSessionStatus(sessionId, "WAITING_HUMAN");
      log("done", `no submit_result -> WAITING_HUMAN (assistant text len=${text.length})`);
    }
    return { ok: true, status: "COMPLETED" };
  } catch (err: unknown) {
    console.error("[error] worker failed:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateMessage(sessionId, messageSk, "FAILED", undefined, errorMsg).catch((e) =>
      console.error("[error] failed to update message:", e)
    );
    await updateSessionStatus(sessionId, "FAILED").catch((e) =>
      console.error("[error] failed to update session:", e)
    );
    throw err;
  }
}

function mcpToolList(serverName: string): string[] {
  if (serverName === "personas") {
    return [
      "mcp__personas__personas_list",
      "mcp__personas__sessions_create",
      "mcp__personas__sessions_list_active",
      "mcp__personas__sessions_get",
    ];
  }
  if (serverName === "control") {
    return ["mcp__control__agent_sleep", "mcp__control__submit_result"];
  }
  if (serverName === "browser") {
    return [
      "mcp__browser__browser_open",
      "mcp__browser__browser_readText",
      "mcp__browser__browser_click",
      "mcp__browser__browser_fill",
      "mcp__browser__browser_scroll",
      "mcp__browser__browser_extract",
      "mcp__browser__browser_screenshot",
      "mcp__browser__browser_run_scraper",
      "mcp__browser__browser_save_dom",
    ];
  }
  return [];
}

// --- Schema validation ---

const ajv = new Ajv({ allErrors: true, strict: false });

function validateAgainstSchema(
  payloadJson: string,
  schema: Record<string, unknown> | undefined
): { ok: true } | { ok: false; error: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch (e) {
    return { ok: false, error: `payload is not valid JSON: ${(e as Error).message}` };
  }
  const effectiveSchema = schema ?? DEFAULT_RESULT_SCHEMA;
  try {
    const validate = ajv.compile(effectiveSchema);
    const ok = validate(payload);
    if (ok) return { ok: true };
    const msg = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    return { ok: false, error: msg || "schema validation failed" };
  } catch (e) {
    return { ok: false, error: `schema compile error: ${(e as Error).message}` };
  }
}

// --- In-process MCP: control (submit_result + agent_sleep) ---

function createControlMcpServer(
  submitState: { called: boolean; payloadJson?: string },
  sleepState: SleepState
) {
  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  });
  const tools: ReturnType<typeof tool>[] = [
    tool(
      "agent_sleep",
      "Schedule a wake-up and end this Lambda invocation. Use this for backoff (poll a slow external system later), nightly batches, or anything where waiting in-process would burn the runtime budget. Either pass `seconds` (relative) or `untilIso` (absolute). The session's status becomes SLEEPING; at the wake time the same session is resumed via the SDK with a short nudge prompt.",
      {
        seconds: z
          .number()
          .int()
          .min(60)
          .max(60 * 60 * 24 * 30)
          .optional()
          .describe("Sleep this many seconds from now (60s minimum, 30d maximum)."),
        untilIso: z.string().optional().describe("Absolute UTC ISO-8601 wake time (e.g. 2026-05-11T09:00:00Z)."),
        reason: z.string().optional().describe("Free-form note explaining why we're sleeping (kept in logs)."),
      },
      async (a) => {
        let atIso: string;
        if (a.untilIso) {
          const d = new Date(a.untilIso);
          if (isNaN(d.getTime())) throw new Error(`bad untilIso: ${a.untilIso}`);
          atIso = d.toISOString();
        } else if (typeof a.seconds === "number") {
          atIso = new Date(Date.now() + a.seconds * 1000).toISOString();
        } else {
          throw new Error("agent_sleep needs either `seconds` or `untilIso`");
        }
        sleepState.requested = { atIso, reason: a.reason };
        return ok({ sleeping: true, atIso, reason: a.reason ?? null });
      }
    ),
    tool(
      "submit_result",
      "Send the final result back to the caller and end the session. Call this exactly ONCE when you have completed the work. The payload MUST validate against this session's resultSchema (see the <result_schema> in your system prompt). Anything you say in plain assistant text (not via this tool) is treated as a chat message to the human — they will reply and you will be resumed. Only submit_result terminates the session.",
      {
        payload: z
          .unknown()
          .describe("JSON-serializable result that conforms to this session's resultSchema."),
      },
      async (a) => {
        submitState.called = true;
        submitState.payloadJson = JSON.stringify(a.payload ?? null);
        return ok({ ok: true, accepted: true });
      }
    ),
  ];
  return createSdkMcpServer({
    name: "control",
    version: "1.0.0",
    tools,
  });
}

// --- In-process MCP: browser (always registered; queues commands in DDB) ---

function createBrowserMcpServer(sessionId: string) {
  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  });
  const fail = (error: string) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
    isError: true,
  });
  const runCmd = async (op: BrowserOp, args: Record<string, unknown>) => {
    const seq = await nextBrCmdSeq(sessionId);
    await putBrCmd(sessionId, seq, op, args);
    return waitForResult(sessionId, seq);
  };

  return createSdkMcpServer({
    name: "browser",
    version: "1.0.0",
    tools: [
      tool(
        "browser_open",
        "Navigate the bound browser tab to a URL. The user must have clicked 'Open in Extension' on this session for browser commands to drain.",
        { url: z.string().describe("Absolute URL to load") },
        async (args) => {
          const r = await runCmd("open", { url: args.url });
          return r.ok ? ok(r.data) : fail(r.error ?? "open failed");
        }
      ),
      tool(
        "browser_readText",
        "Read visible text from the page, optionally scoped to a CSS selector.",
        { selector: z.string().optional() },
        async (args) => {
          const r = await runCmd("readText", { selector: args.selector });
          return r.ok ? ok(r.data) : fail(r.error ?? "readText failed");
        }
      ),
      tool(
        "browser_click",
        "Click an element matching a CSS selector.",
        { selector: z.string() },
        async (args) => {
          const r = await runCmd("click", { selector: args.selector });
          return r.ok ? ok(r.data) : fail(r.error ?? "click failed");
        }
      ),
      tool(
        "browser_fill",
        "Set an input/textarea value and fire an input event.",
        { selector: z.string(), value: z.string() },
        async (args) => {
          const r = await runCmd("fill", { selector: args.selector, value: args.value });
          return r.ok ? ok(r.data) : fail(r.error ?? "fill failed");
        }
      ),
      tool(
        "browser_scroll",
        "Scroll the bound tab by a direction or amount.",
        {
          direction: z.enum(["top", "bottom", "up", "down"]).optional(),
          pixels: z.number().optional(),
        },
        async (args) => {
          const r = await runCmd("scroll", args);
          return r.ok ? ok(r.data) : fail(r.error ?? "scroll failed");
        }
      ),
      tool(
        "browser_extract",
        "Extract structured data from the page via a map of fields to CSS selectors (use 'selector@attr' for attributes).",
        { selectors: z.record(z.string(), z.string()) },
        async (args) => {
          const r = await runCmd("extract", { selectors: args.selectors });
          return r.ok ? ok(r.data) : fail(r.error ?? "extract failed");
        }
      ),
      tool(
        "browser_screenshot",
        "Return a base64 PNG data URL of the current tab viewport.",
        {},
        async () => {
          const r = await runCmd("screenshot", {});
          return r.ok ? ok(r.data) : fail(r.error ?? "screenshot failed");
        }
      ),
      tool(
        "browser_run_scraper",
        "Invoke a named scraper action bundled with the extension (e.g. linkedin.searchPeople).",
        {
          name: z.string().describe("Scraper name, e.g. 'linkedin'"),
          action: z.string().describe("Action name within the scraper"),
          args: z.record(z.string(), z.unknown()).optional(),
        },
        async (a) => {
          const r = await runCmd("run_scraper", {
            name: a.name,
            action: a.action,
            args: a.args ?? {},
          });
          return r.ok ? ok(r.data) : fail(r.error ?? "scraper failed");
        }
      ),
      tool(
        "browser_save_dom",
        `Capture the current page DOM (or a subtree) and save it to a local file under ${WORK_DIR}. Returns the absolute path. Use Read/Bash on the saved file to extract data with Python, jq, regex, etc. Prefer this over readText for large pages.`,
        {
          path: z
            .string()
            .describe(
              `Filename or relative path under ${WORK_DIR} (e.g. "page.html" or "out/jira.html")`
            ),
          selector: z
            .string()
            .optional()
            .describe("Optional CSS selector to limit the snapshot to a subtree"),
        },
        async (a) => {
          const r = await runCmd("readText", {
            selector: a.selector,
            mode: "outerHTML",
          });
          if (!r.ok) return fail(r.error ?? "save_dom failed");
          const html = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
          const safeRel = a.path.replace(/^\/+/, "").replace(/\.\.+/g, ".");
          const abs = join(WORK_DIR, safeRel);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, html, "utf-8");
          return ok({ path: abs, bytes: Buffer.byteLength(html, "utf-8") });
        }
      ),
    ],
  });
}

// --- In-process MCP: personas (uniform persona delegation) ---

function createPersonasMcpServer() {
  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  });
  const fail = (error: string) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
    isError: true,
  });
  const summarize = (p: Persona) => ({
    name: p.name,
    description: p.description,
    actions: p.actions,
  });
  return createSdkMcpServer({
    name: "personas",
    version: "1.0.0",
    tools: [
      tool(
        "personas_list",
        "List personas available for delegation.",
        {},
        async () => {
          const all = await scanPersonas();
          return ok(all.map(summarize));
        }
      ),
      tool(
        "sessions_create",
        "Create a new session for any persona and (optionally) block until it concludes. The agent of the target persona runs and ends by calling submit_result with a payload matching `resultSchema`. Plain assistant text mid-run becomes a chat message; the human can reply via the web UI. If `firstMessageAuthor` is \"agent\", the prompt is stored as the first assistant turn and the session waits for a human reply before launching the agent.",
        {
          persona: z.string().describe("Target persona name"),
          name: z.string().describe("Descriptive session name shown in lists/inbox"),
          prompt: z.string().describe("First message text"),
          firstMessageAuthor: z.enum(["user", "agent"]).optional(),
          resultSchema: z.record(z.string(), z.unknown()).describe("JSON Schema for submit_result payload"),
          inputUrl: z.string().optional().describe("Optional URL to feed to the extension when the user opens this session in their browser"),
          waitMs: z.number().int().min(0).max(900_000).optional().describe("If > 0, block until COMPLETED/FAILED or timeout"),
        },
        async (a) => {
          const target = await getPersona(a.persona);
          if (!target) return fail(`persona ${a.persona} not found`);
          const res = await dispatchSession({
            personaName: a.persona,
            name: a.name,
            prompt: a.prompt,
            firstMessageAuthor: (a.firstMessageAuthor ?? "user") as FirstMessageAuthor,
            resultSchema: a.resultSchema,
            inputUrl: a.inputUrl,
            callerPersona: process.env.__CALLER_PERSONA__,
          });
          const waitMs = a.waitMs ?? 0;
          if (waitMs <= 0) {
            const s = await getSession(res.sessionId);
            return ok({ sessionId: res.sessionId, status: s?.status ?? "RUNNING" });
          }
          const out = await pollForSubmit(res.sessionId, waitMs);
          return ok({ sessionId: res.sessionId, ...out });
        }
      ),
      tool(
        "sessions_list_active",
        "List sessions that are not yet COMPLETED or FAILED. Optionally filter by persona.",
        { persona: z.string().optional() },
        async (a) => {
          const list = await listActiveSessions(a.persona);
          return ok(
            list.map((s) => ({
              sessionId: s.pk.replace("SESSION#", ""),
              persona: s.persona,
              name: s.name,
              status: s.status,
              firstMessageAuthor: s.firstMessageAuthor,
              callerPersona: s.callerPersona,
              createdAt: s.createdAt,
            }))
          );
        }
      ),
      tool(
        "sessions_get",
        "Get the status (and submit_result payload, if COMPLETED) for a session.",
        { sessionId: z.string() },
        async (a) => {
          const s = await getSession(a.sessionId);
          if (!s) return fail("not found");
          return ok({
            status: s.status,
            name: s.name,
            persona: s.persona,
            result: s.status === "COMPLETED" ? safeParse(s.submitResult) : undefined,
          });
        }
      ),
    ],
  });
}

function safeParse(s: string | undefined): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// --- Polling helpers ---

async function waitForResult(
  sessionId: string,
  seq: string,
  timeoutMs = 600_000
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await getBrRes(sessionId, seq);
    if (r) return { ok: r.ok, data: r.data, error: r.error };
    await sleep(1000);
  }
  return { ok: false, error: "browser command timed out (no extension bound or extension not polling)" };
}

async function pollForSubmit(
  sessionId: string,
  timeoutMs: number
): Promise<{ status: string; result?: unknown }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getSession(sessionId);
    if (!s) return { status: "UNKNOWN" };
    if (s.status === "COMPLETED") {
      return { status: "COMPLETED", result: safeParse(s.submitResult) };
    }
    if (s.status === "FAILED") {
      return { status: "FAILED" };
    }
    await sleep(2000);
  }
  const s = await getSession(sessionId);
  return { status: s?.status ?? "UNKNOWN" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Persona setup helpers ---

async function writeSecrets(personaName: string, dir: string): Promise<void> {
  const prefix = `/claude-agent/projects/${personaName}/`;
  const params: Array<{ Name: string; Value: string }> = [];

  let nextToken: string | undefined;
  do {
    const res = await ssm.send(
      new GetParametersByPathCommand({
        Path: prefix,
        WithDecryption: true,
        NextToken: nextToken,
      })
    );
    for (const p of res.Parameters ?? []) {
      if (p.Name && p.Value) params.push({ Name: p.Name, Value: p.Value });
    }
    nextToken = res.NextToken;
  } while (nextToken);

  if (params.length === 0) return;

  const envContent = params
    .map((p) => `${p.Name.split("/").pop()}=${p.Value}`)
    .join("\n");
  // .env lives in /tmp/persona-env/<name>.env to avoid writing to the read-mostly mount.
  const envDir = "/tmp/persona-env";
  mkdirSync(envDir, { recursive: true });
  const envPath = `${envDir}/${personaName}.env`;
  writeFileSync(envPath, envContent + "\n");
  // Also surface in cwd as .env via symlink so tools that look for it just work.
  ensureSymlink(envPath, `${dir}/.env`);
  console.log(`wrote ${params.length} secrets to ${envPath}`);
}

function readMcpConfig(dir: string): Record<string, unknown> | undefined {
  const path = join(dir, "mcp.json");
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (raw && typeof raw === "object" && "mcpServers" in raw) return raw.mcpServers as Record<string, unknown>;
    return raw as Record<string, unknown>;
  } catch (e) {
    console.error("[mcp] Failed to parse mcp.json:", e);
    return undefined;
  }
}

function ensureSymlink(target: string, linkPath: string): void {
  try {
    const st = lstatSync(linkPath);
    if (st.isSymbolicLink()) return;
  } catch {
    // not present — create
  }
  try {
    mkdirSync(dirname(linkPath), { recursive: true });
    mkdirSync(target, { recursive: true });
    symlinkSync(target, linkPath);
  } catch (e) {
    console.error(`[symlink] failed ${linkPath} -> ${target}:`, e);
  }
}

// --- Self re-invoke + EventBridge wake schedule ---

async function reinvokeSelf(payload: WorkerEvent): Promise<void> {
  await lambda.send(
    new InvokeCommand({
      FunctionName: WORKER_FUNCTION_NAME,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );
}

async function scheduleWake(
  sessionId: string,
  messageSk: string,
  atIso: string,
  reason: string | undefined,
  context: Context
): Promise<void> {
  const safeId = sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24);
  const safeSk = messageSk.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8);
  const ts = Date.now().toString(36);
  const name = `${STACK_NAME}-wake-${safeId}-${safeSk}-${ts}`.slice(0, 64);
  const payload: WorkerEvent = {
    SESSION_ID: sessionId,
    MESSAGE_SK: messageSk,
    resume: "wake",
    nudge: `[wake] You scheduled a wake-up at ${atIso}${reason ? ` (reason: ${reason})` : ""}. The current time is ${new Date().toISOString()}. Continue.`,
  };
  // EventBridge Scheduler `at(...)` expects yyyy-mm-ddThh:mm:ss (no millis, no Z).
  const expr = atIso.replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
  await scheduler.send(
    new CreateScheduleCommand({
      Name: name,
      ScheduleExpression: `at(${expr})`,
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE",
      Target: {
        Arn: context.invokedFunctionArn,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify(payload),
      },
    })
  );
}
