import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "node:crypto";
import {
  getSession,
  listSessions,
  listSessionsByPersona,
  listInbox,
  getMessages,
  createMessage,
  nextMessageSortKey,
  setMessageInvokeId,
  updateMessage,
  updateSessionStatus,
  setSessionExtToken,
  bumpSessionExtSeen,
  scanPersonas,
  getPersona,
  putPersona,
  updatePersonaSchedule,
  listMemoryFiles,
  putSchedule,
  getSchedule,
  listSchedules,
  deleteSchedule,
  updateScheduleLastRun,
  nextPendingBrCmd,
  markBrCmdDispatched,
  markBrCmdDone,
  putBrRes,
  listTemplates,
  getTemplate,
} from "../shared/dynamo.js";
import { launchTask, dispatchSession, DEFAULT_RESULT_SCHEMA } from "../shared/dispatch.js";
import { applyTemplateToPersona, reprovisionPersona, memoryS3Prefix } from "../shared/templates.js";
import {
  renderHome,
  renderLogin,
  renderSessionDetail,
  renderPersonaList,
  renderPersonaDetail,
  renderPersonaForm,
  renderPersonaCreateForm,
  renderMemoryFile,
  renderInboxList,
  renderMessageListWithOob,
} from "./views.js";
import type { FirstMessageAuthor } from "../shared/types.js";
import { sessionId } from "../shared/types.js";

const scheduler = new SchedulerClient({});
const s3 = new S3Client({});

const {
  BUCKET_NAME,
  APP_PASSWORD,
  STACK_NAME,
  SCHEDULER_ROLE_ARN,
  FUNCTION_ARN,
  EXT_CHROME_ID,
} = process.env;

const COOKIE_NAME = "auth";
const COOKIE_MAX_AGE = 86400 * 30;

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  const isSchedulerCall =
    method === "POST" &&
    path === "/heartbeat" &&
    (event.headers?.["x-heartbeat-secret"] === APP_PASSWORD);

  const isExtCall = path.startsWith("/ext/");

  if (
    !isSchedulerCall &&
    !isExtCall &&
    !(method === "POST" && path === "/login") &&
    !(method === "GET" && path === "/login")
  ) {
    if (!isAuthenticated(event)) return redirect("/login");
  }

  try {
    if (method === "GET" && path === "/login") return html(renderLogin());

    if (method === "POST" && path === "/login") {
      const body = parseBody(event);
      if (body.password === APP_PASSWORD) {
        return {
          statusCode: 302,
          headers: {
            location: "/",
            "set-cookie": `${COOKIE_NAME}=${APP_PASSWORD}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`,
          },
          body: "",
        };
      }
      return html(renderLogin("Invalid password"));
    }

    if (method === "GET" && path === "/") {
      const [sessions, personas] = await Promise.all([listSessions(40), scanPersonas()]);
      return html(renderHome(sessions, personas));
    }

    // --- Personas ---
    if (method === "GET" && path === "/personas") {
      const personas = await scanPersonas();
      return html(renderPersonaList(personas));
    }

    if (method === "GET" && path === "/personas/new") {
      const templates = await listTemplates();
      return html(renderPersonaCreateForm({ templates }));
    }

    const personaEditMatch = path.match(/^\/personas\/([^/]+)\/edit$/);
    if (method === "GET" && personaEditMatch) {
      const name = decodeURIComponent(personaEditMatch[1]);
      const persona = await getPersona(name);
      if (!persona) return html("Persona not found", 404);
      return html(renderPersonaForm(persona));
    }

    if (method === "POST" && path === "/personas") {
      const body = parseBody(event);
      const name = String(body.name ?? "").trim();
      const mode = String(body.mode ?? "").trim();
      if (!name) return html("Missing name", 400);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(name)) {
        const templates = await listTemplates();
        return html(
          renderPersonaCreateForm({
            templates,
            error:
              "Invalid name: letters, digits, hyphens, underscores; max 41 chars; must start with alphanumeric.",
          }),
          400
        );
      }
      const existing = await getPersona(name);

      if (mode === "create" || !existing) {
        const templates = await listTemplates();
        if (existing)
          return html(
            renderPersonaCreateForm({ templates, error: `Persona "${name}" already exists.` }),
            409
          );
        const templateName = String(body.template ?? "").trim() || undefined;
        if (!templateName) {
          return html(
            renderPersonaCreateForm({
              templates,
              error: "Pick a template (every persona needs project files in S3).",
            }),
            400
          );
        }
        const template = await getTemplate(templateName);
        if (!template)
          return html(
            renderPersonaCreateForm({ templates, error: `Template "${templateName}" not found.` }),
            400
          );
        if (!template.s3Key)
          return html(
            renderPersonaCreateForm({
              templates,
              error: `Template "${templateName}" has no files in S3. Run make sync-templates.`,
            }),
            400
          );

        await putPersona({
          name,
          s3Key: "",
          description:
            (body.description ? String(body.description) : undefined) ?? template.description,
          actions: template.actions,
          memoryEnabled: true,
        });

        try {
          await applyTemplateToPersona(name, template.name);
        } catch (e) {
          return html(
            renderPersonaCreateForm({
              templates,
              error: `Created META but failed to copy template: ${(e as Error).message}`,
            }),
            500
          );
        }
        return redirect(`/personas/${encodeURIComponent(name)}`);
      }

      const allowedTools = String(body.allowedTools ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const heartbeatCron = String(body.heartbeatCron ?? "").trim() || undefined;
      await putPersona({
        name,
        s3Key: existing.s3Key,
        description: body.description ? String(body.description) : undefined,
        systemPrompt: body.systemPrompt ? String(body.systemPrompt) : undefined,
        allowedTools: allowedTools.length ? allowedTools : undefined,
        memoryEnabled: body.memoryEnabled === "on",
        mcpEnabled: body.mcpEnabled === "on",
        heartbeatCron,
      });
      if (heartbeatCron) await ensureHeartbeatSchedule(name, heartbeatCron);
      else await deleteHeartbeatSchedule(name);
      return redirect(`/personas/${encodeURIComponent(name)}`);
    }

    const personaMatch = path.match(/^\/personas\/([^/]+)$/);
    if (method === "GET" && personaMatch) {
      const name = decodeURIComponent(personaMatch[1]);
      const persona = await getPersona(name);
      if (!persona) return html("Persona not found", 404);
      const [memory, schedules, skills, personaSessions, templates] = await Promise.all([
        listMemoryFiles(name),
        listSchedules(name),
        listSkillsFromTarball(persona.s3Key),
        listSessionsByPersona(name, 25),
        listTemplates(),
      ]);
      return html(
        renderPersonaDetail(persona, memory, schedules, skills, personaSessions, templates)
      );
    }

    // --- Templates: reprovision / switch ---
    const reprovMatch = path.match(/^\/personas\/([^/]+)\/reprovision$/);
    if (method === "POST" && reprovMatch) {
      const name = decodeURIComponent(reprovMatch[1]);
      const persona = await getPersona(name);
      if (!persona) return html("Persona not found", 404);
      try {
        await reprovisionPersona(name);
      } catch (e) {
        return html(`Reprovision failed: ${(e as Error).message}`, 400);
      }
      return redirect(`/personas/${encodeURIComponent(name)}`);
    }

    const switchTmplMatch = path.match(/^\/personas\/([^/]+)\/switch-template$/);
    if (method === "POST" && switchTmplMatch) {
      const name = decodeURIComponent(switchTmplMatch[1]);
      const persona = await getPersona(name);
      if (!persona) return html("Persona not found", 404);
      const body = parseBody(event);
      const templateName = String(body.template ?? "").trim();
      if (!templateName) return html("Missing template", 400);
      const t = await getTemplate(templateName);
      if (!t) return html("Template not found", 404);
      try {
        await applyTemplateToPersona(name, templateName);
      } catch (e) {
        return html(`Switch template failed: ${(e as Error).message}`, 400);
      }
      return redirect(`/personas/${encodeURIComponent(name)}`);
    }

    // --- Memory file viewer ---
    const memMatch = path.match(/^\/personas\/([^/]+)\/memory\/(.+)$/);
    if (method === "GET" && memMatch) {
      const name = decodeURIComponent(memMatch[1]);
      const filePath = decodeURIComponent(memMatch[2]);
      const key = `${memoryS3Prefix(name)}${filePath}`;
      try {
        const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
        const text = await streamToString(got.Body);
        return html(renderMemoryFile(name, filePath, text));
      } catch {
        return html("Memory file not found", 404);
      }
    }

    // --- Schedules ---
    const schedListMatch = path.match(/^\/personas\/([^/]+)\/schedules$/);
    if (method === "POST" && schedListMatch) {
      const name = decodeURIComponent(schedListMatch[1]);
      const persona = await getPersona(name);
      if (!persona) return html("Persona not found", 404);
      const body = parseBody(event);
      const cron = (body.cron ?? "").trim();
      const prompt = (body.prompt ?? "").trim();
      if (!cron || !prompt) return html("Missing cron or prompt", 400);
      const id = uuidv4().slice(0, 8);
      const arn = await createCronSchedule(name, id, cron);
      await putSchedule({
        pk: `PERSONA#${name}`,
        sk: `CRON#${id}`,
        id,
        cron,
        prompt,
        enabled: true,
        scheduleArn: arn,
        createdAt: new Date().toISOString(),
      });
      return redirect(`/personas/${encodeURIComponent(name)}`);
    }

    const schedDelMatch = path.match(/^\/personas\/([^/]+)\/schedules\/([^/]+)\/delete$/);
    if (method === "POST" && schedDelMatch) {
      const name = decodeURIComponent(schedDelMatch[1]);
      const id = decodeURIComponent(schedDelMatch[2]);
      const sched = await getSchedule(name, id);
      if (sched) await deleteCronSchedule(name, id);
      await deleteSchedule(name, id);
      return redirect(`/personas/${encodeURIComponent(name)}`);
    }

    // --- Heartbeat (invoked by EventBridge Scheduler) ---
    if (isSchedulerCall) {
      const body = parseBody(event);
      const personaName = body.persona;
      const scheduleId = body.scheduleId;
      const customPrompt = body.prompt;
      if (!personaName) return json({ error: "missing persona" }, 400);
      const persona = await getPersona(personaName);
      if (!persona) return json({ error: "persona not found" }, 404);

      let prompt: string;
      let name: string;
      if (customPrompt) {
        prompt = customPrompt;
        name = `Custom heartbeat ${new Date().toISOString()}`;
      } else if (scheduleId) {
        const sched = await getSchedule(personaName, scheduleId);
        prompt = sched?.prompt ?? `Scheduled task ${scheduleId} at ${new Date().toISOString()}.`;
        name = `Scheduled: ${scheduleId}`;
      } else {
        prompt = `Heartbeat at ${new Date().toISOString()}. Review your memory/ for any pending TODOs, scheduled work, or proactive actions you should take. If nothing to do, respond briefly.`;
        name = `Heartbeat ${new Date().toISOString()}`;
      }

      const res = await dispatchSession({
        personaName,
        name,
        prompt,
        firstMessageAuthor: "user",
        resultSchema: DEFAULT_RESULT_SCHEMA,
        heartbeat: true,
      });
      if (scheduleId) await updateScheduleLastRun(personaName, scheduleId).catch(() => {});
      return json({
        ok: true,
        sessionId: res.sessionId,
        invokeId: res.invokeId,
        launched: res.launched,
      });
    }

    // --- Inbox (web UI) ---
    if (method === "GET" && path === "/inbox") {
      const pending = await listInbox();
      const personas = await scanPersonas();
      const byName = new Map(personas.map((p) => [p.name, p]));
      return html(renderInboxList(pending, byName));
    }

    // --- Session ext-binding ---
    const bindExtMatch = path.match(/^\/sessions\/([^/]+)\/bind-ext$/);
    if (method === "POST" && bindExtMatch) {
      const id = decodeURIComponent(bindExtMatch[1]);
      const session = await getSession(id);
      if (!session) return html("Session not found", 404);
      if (session.status === "COMPLETED" || session.status === "FAILED")
        return html(`Cannot bind extension to a ${session.status} session`, 409);
      if (!EXT_CHROME_ID)
        return html("EXT_CHROME_ID is not configured on the Lambda", 500);
      const token = randomBytes(24).toString("hex");
      await setSessionExtToken(id, token);
      const base = lambdaBaseUrl(event);
      const params = new URLSearchParams({ sid: id, token, base });
      if (session.inputUrl) params.set("inputUrl", session.inputUrl);
      const url = `chrome-extension://${EXT_CHROME_ID}/open.html?${params.toString()}`;
      return redirect(url);
    }

    // --- Extension API (app password; used by side panel session list) ---
    if (method === "GET" && path === "/ext/sessions") {
      if (!extAppAuthed(event)) return json({ error: "unauthorized" }, 401);
      const sessions = await listSessions(50);
      return json(
        sessions.map((s) => ({
          id: sessionId(s.pk),
          name: s.name,
          persona: s.persona,
          status: s.status,
          createdAt: s.createdAt,
          firstMessageAuthor: s.firstMessageAuthor,
        }))
      );
    }

    const extSessionMatch = path.match(/^\/ext\/sessions\/([^/]+)$/);
    if (method === "GET" && extSessionMatch) {
      if (!extAppAuthed(event)) return json({ error: "unauthorized" }, 401);
      const id = extSessionMatch[1];
      const [session, messages] = await Promise.all([getSession(id), getMessages(id)]);
      if (!session) return json({ error: "session not found" }, 404);
      const hasRunning = messages.some((m) => m.status === "RUNNING");
      const terminal = session.status === "COMPLETED" || session.status === "FAILED";
      return json({
        session: {
          id,
          name: session.name,
          persona: session.persona,
          status: session.status,
          createdAt: session.createdAt,
          inputUrl: session.inputUrl,
          submitResult: session.submitResult,
        },
        messages: messages.map((m) => ({
          sk: m.sk,
          kind: m.kind ?? "user",
          prompt: m.prompt,
          result: m.result,
          status: m.status,
          error: m.error,
          createdAt: m.createdAt,
        })),
        canSend: !hasRunning && !terminal,
        browserBound: !!session.extToken,
      });
    }

    const extSessionMsgMatch = path.match(/^\/ext\/sessions\/([^/]+)\/messages$/);
    if (method === "POST" && extSessionMsgMatch) {
      if (!extAppAuthed(event)) return json({ error: "unauthorized" }, 401);
      const id = extSessionMsgMatch[1];
      const session = await getSession(id);
      if (!session) return json({ error: "session not found" }, 404);
      const body = parseBody(event);
      const prompt = String(body.prompt ?? "").trim();
      if (!prompt) return json({ error: "missing prompt" }, 400);
      const sortKey = await nextMessageSortKey(id);
      await createMessage(id, sortKey, prompt);
      await updateSessionStatus(id, "RUNNING");
      const invokeId = await launchTask(id, sortKey);
      if (invokeId) await setMessageInvokeId(id, sortKey, invokeId);
      return json({ ok: true, sortKey, invokeId });
    }

    const extSessionBindMatch = path.match(/^\/ext\/sessions\/([^/]+)\/bind$/);
    if (method === "POST" && extSessionBindMatch) {
      if (!extAppAuthed(event)) return json({ error: "unauthorized" }, 401);
      const id = extSessionBindMatch[1];
      const session = await getSession(id);
      if (!session) return json({ error: "session not found" }, 404);
      if (session.status === "COMPLETED" || session.status === "FAILED")
        return json({ error: `cannot bind to ${session.status} session` }, 409);
      const token = randomBytes(24).toString("hex");
      await setSessionExtToken(id, token);
      return json({ sid: id, token, base: lambdaBaseUrl(event), inputUrl: session.inputUrl });
    }

    // --- Extension short-poll endpoints (session-scoped ext token) ---
    if (method === "GET" && path === "/ext/poll") {
      const qs = event.queryStringParameters ?? {};
      const sid = qs.sid ?? "";
      const token = qs.token ?? "";
      if (!sid || !token) return json({ error: "missing sid or token" }, 400);
      const session = await getSession(sid);
      if (!session) return json({ error: "session not found" }, 404);
      if (session.extToken !== token) return json({ error: "invalid token" }, 401);
      await bumpSessionExtSeen(sid);

      const terminal = session.status === "COMPLETED" || session.status === "FAILED";
      if (terminal) return json({ active: null, terminal: true, status: session.status });

      const pendingCmd = await nextPendingBrCmd(sid);
      if (pendingCmd) {
        await markBrCmdDispatched(sid, pendingCmd.seq);
        return json({
          active: { sessionId: sid, status: session.status },
          command: {
            seq: pendingCmd.seq,
            op: pendingCmd.op,
            args: pendingCmd.args,
          },
        });
      }

      const allMsgs = await getMessages(sid);
      const tail = allMsgs.slice(-30).map((m) => ({
        sk: m.sk,
        kind: m.kind ?? "user",
        prompt: m.prompt,
        result: m.result,
        status: m.status,
        error: m.error,
        createdAt: m.createdAt,
      }));
      return json({
        active: { sessionId: sid, status: session.status, name: session.name, inputUrl: session.inputUrl },
        messages: tail,
        canSend: session.status === "WAITING_HUMAN",
      });
    }

    if (method === "POST" && path === "/ext/result") {
      const body = parseBody(event);
      const sid = body.sid ?? body.sessionId ?? "";
      const token = body.token ?? "";
      const seq = body.seq;
      if (!sid || !token || !seq) return json({ error: "missing sid/token/seq" }, 400);
      const session = await getSession(sid);
      if (!session) return json({ error: "session not found" }, 404);
      if (session.extToken !== token) return json({ error: "invalid token" }, 401);
      await bumpSessionExtSeen(sid);
      const ok = body.ok === true || body.ok === "true";
      let data: unknown = undefined;
      if (body.data !== undefined) {
        try {
          data = typeof body.data === "string" ? JSON.parse(body.data) : body.data;
        } catch {
          data = body.data;
        }
      }
      await putBrRes({
        pk: `SESSION#${sid}`,
        sk: `BRRES#${seq}`,
        seq,
        ok,
        data,
        error: body.error || undefined,
        completedAt: new Date().toISOString(),
      });
      await markBrCmdDone(sid, seq);
      return json({ ok: true });
    }

    if (method === "POST" && path === "/ext/messages") {
      // Human-in-the-extension reply path (extension may post a message on
      // behalf of the user without going through the web UI).
      const body = parseBody(event);
      const sid = body.sid ?? "";
      const token = body.token ?? "";
      const prompt = body.prompt ?? "";
      if (!sid || !token || !prompt) return json({ error: "missing sid/token/prompt" }, 400);
      const session = await getSession(sid);
      if (!session) return json({ error: "session not found" }, 404);
      if (session.extToken !== token) return json({ error: "invalid token" }, 401);
      if (session.status !== "WAITING_HUMAN")
        return json({ error: `cannot send while session.status=${session.status}` }, 409);
      const sortKey = await nextMessageSortKey(sid);
      await createMessage(sid, sortKey, prompt);
      await updateSessionStatus(sid, "RUNNING");
      const invokeId = await launchTask(sid, sortKey);
      if (invokeId) await setMessageInvokeId(sid, sortKey, invokeId);
      return json({ ok: true, sortKey, invokeId });
    }

    // --- Sessions (web UI) ---
    if (method === "GET" && path === "/sessions") return redirect("/");

    if (method === "POST" && path === "/sessions") {
      const body = parseBody(event);
      const personaName = body.persona ?? body.project;
      const name = String(body.name ?? "").trim();
      const prompt = body.prompt;
      const firstMessageAuthor = (body.firstMessageAuthor === "agent" ? "agent" : "user") as FirstMessageAuthor;
      const inputUrl = String(body.inputUrl ?? "").trim() || undefined;
      const resultSchemaRaw = String(body.resultSchema ?? "").trim();
      if (!personaName || !prompt || !name)
        return html("Missing persona, name or prompt", 400);
      let resultSchema: Record<string, unknown> = DEFAULT_RESULT_SCHEMA;
      if (resultSchemaRaw) {
        try {
          const parsed = JSON.parse(resultSchemaRaw);
          if (parsed && typeof parsed === "object") {
            resultSchema = parsed as Record<string, unknown>;
          } else {
            return html("resultSchema must be a JSON object", 400);
          }
        } catch (e) {
          return html(`resultSchema is not valid JSON: ${(e as Error).message}`, 400);
        }
      }
      const persona = await getPersona(personaName);
      if (!persona) return html(`Persona "${personaName}" not found`, 404);
      const res = await dispatchSession({
        personaName,
        name,
        prompt,
        firstMessageAuthor,
        resultSchema,
        inputUrl,
      });
      return redirect(`/sessions/${res.sessionId}`);
    }

    const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
    if (method === "GET" && sessionMatch) {
      const id = sessionMatch[1];
      const [session, messages] = await Promise.all([getSession(id), getMessages(id)]);
      if (!session) return html("Session not found", 404);
      return html(renderSessionDetail(session, messages));
    }

    const msgPostMatch = path.match(/^\/sessions\/([^/]+)\/messages$/);
    if (method === "POST" && msgPostMatch) {
      const id = msgPostMatch[1];
      const session = await getSession(id);
      if (!session) return html("Session not found", 404);
      const body = parseBody(event);
      const prompt = body.prompt;
      if (!prompt) return html("Missing prompt", 400);
      const sortKey = await nextMessageSortKey(id);
      await createMessage(id, sortKey, prompt);
      await updateSessionStatus(id, "RUNNING");
      const invokeId = await launchTask(id, sortKey);
      if (invokeId) await setMessageInvokeId(id, sortKey, invokeId);
      return redirect(`/sessions/${id}`);
    }

    const msgGetMatch = path.match(/^\/sessions\/([^/]+)\/messages$/);
    if (method === "GET" && msgGetMatch) {
      const id = msgGetMatch[1];
      const session = await getSession(id);
      if (!session) return html("Session not found", 404);
      const messages = await getMessages(id);
      const hasRunning = messages.some((m) => m.status === "RUNNING");
      const isTerminal =
        !hasRunning &&
        session.status !== "SLEEPING" &&
        session.status !== "RUNNING";
      // 286 tells HTMX to cancel the polling trigger after this swap so the
      // composer textarea isn't blown away every 3s on a completed session.
      const status = isTerminal ? 286 : 200;
      return html(renderMessageListWithOob(session, messages), status);
    }

    const msgRestartMatch = path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)\/restart$/);
    if (method === "POST" && msgRestartMatch) {
      const id = msgRestartMatch[1];
      const sk = msgRestartMatch[2];
      const messages = await getMessages(id);
      const msg = messages.find((m) => m.sk === `MSG#${sk}`);
      if (!msg) return html("Message not found", 404);
      if (msg.status !== "RUNNING")
        return html(`Message status is ${msg.status}; only RUNNING messages can be re-invoked.`, 409);
      try {
        const invokeId = await launchTask(id, sk);
        if (invokeId) await setMessageInvokeId(id, sk, invokeId);
      } catch (e) {
        return html(`Failed to invoke worker: ${(e as Error).message}`, 500);
      }
      return redirect(`/sessions/${id}`);
    }

    if (method === "GET" && path === "/projects") {
      const personas = await scanPersonas();
      return json(personas.map((p) => ({ name: p.name, updatedAt: p.updatedAt })));
    }

    return html("Not found", 404);
  } catch (err: unknown) {
    console.error(err);
    return html(`Internal error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
}

function isAuthenticated(event: APIGatewayProxyEventV2): boolean {
  if (!APP_PASSWORD) return true;
  const cookies = event.cookies ?? [];
  return cookies.some((c) => {
    const [name, ...rest] = c.split("=");
    return name.trim() === COOKIE_NAME && rest.join("=").trim() === APP_PASSWORD;
  });
}

function lambdaBaseUrl(event: APIGatewayProxyEventV2): string {
  const headers = event.headers ?? {};
  const proto = headers["x-forwarded-proto"] ?? "https";
  const host = headers.host ?? "";
  return `${proto}://${host}`;
}

// --- Scheduler helpers ---

function schedName(persona: string, suffix: string): string {
  const safe = persona.replace(/[^a-zA-Z0-9-]/g, "-");
  return `${STACK_NAME ?? "claude-agent"}-${safe}-${suffix}`;
}

function buildSchedulerEventInput(bodyJson: string): string {
  return JSON.stringify({
    requestContext: { http: { method: "POST" } },
    rawPath: "/heartbeat",
    headers: {
      "content-type": "application/json",
      "x-heartbeat-secret": APP_PASSWORD ?? "",
    },
    body: bodyJson,
  });
}

async function ensureHeartbeatSchedule(persona: string, cron: string): Promise<void> {
  const name = schedName(persona, "heartbeat");
  const expr = toScheduleExpression(cron);
  const target = {
    Arn: FUNCTION_ARN!,
    RoleArn: SCHEDULER_ROLE_ARN!,
    Input: buildSchedulerEventInput(JSON.stringify({ persona })),
  };
  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: name,
        ScheduleExpression: expr,
        FlexibleTimeWindow: { Mode: "OFF" },
        Target: target,
      })
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "ConflictException") {
      await scheduler.send(
        new UpdateScheduleCommand({
          Name: name,
          ScheduleExpression: expr,
          FlexibleTimeWindow: { Mode: "OFF" },
          Target: target,
        })
      );
    } else throw e;
  }
  const arn = `arn:aws:scheduler:::schedule/default/${name}`;
  await updatePersonaSchedule(persona, cron, arn);
}

async function deleteHeartbeatSchedule(persona: string): Promise<void> {
  const name = schedName(persona, "heartbeat");
  await scheduler.send(new DeleteScheduleCommand({ Name: name })).catch(() => {});
  await updatePersonaSchedule(persona, undefined, undefined);
}

async function createCronSchedule(persona: string, id: string, cron: string): Promise<string> {
  const name = schedName(persona, `cron-${id}`);
  const expr = toScheduleExpression(cron);
  const target = {
    Arn: FUNCTION_ARN!,
    RoleArn: SCHEDULER_ROLE_ARN!,
    Input: buildSchedulerEventInput(JSON.stringify({ persona, scheduleId: id })),
  };
  await scheduler.send(
    new CreateScheduleCommand({
      Name: name,
      ScheduleExpression: expr,
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: target,
    })
  );
  return `arn:aws:scheduler:::schedule/default/${name}`;
}

async function deleteCronSchedule(persona: string, id: string): Promise<void> {
  const name = schedName(persona, `cron-${id}`);
  await scheduler.send(new DeleteScheduleCommand({ Name: name })).catch(() => {});
}

function toScheduleExpression(cron: string): string {
  const trimmed = cron.trim();
  if (trimmed.startsWith("rate(") || trimmed.startsWith("cron(")) return trimmed;
  return `cron(${trimmed})`;
}

async function listSkillsFromTarball(_s3Key: string): Promise<Array<{ name: string; description: string }>> {
  return [];
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, any> {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString()
    : event.body ?? "";

  const ct = event.headers?.["content-type"] ?? "";
  if (ct.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  for (const [k, v] of params) result[k] = v;
  return result;
}

function extAppAuthed(event: APIGatewayProxyEventV2): boolean {
  if (!APP_PASSWORD) return false;
  const h = event.headers?.["x-app-password"] ?? event.headers?.["X-App-Password"];
  return h === APP_PASSWORD;
}

function html(body: string, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
  };
}

function json(data: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(data),
  };
}

function redirect(location: string): APIGatewayProxyResultV2 {
  return { statusCode: 302, headers: { location }, body: "" };
}

async function streamToString(body: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  // @ts-expect-error stream
  for await (const c of body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf-8");
}
