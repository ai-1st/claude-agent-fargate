import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  getSession,
  listSessions,
  getMessages,
  createMessage,
  nextMessageSortKey,
  setMessageTaskArn,
  updateSessionStatus,
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
} from "../shared/dynamo.js";
import {
  renderHome,
  renderLogin,
  renderSessionDetail,
  renderMessageList,
  renderPersonaList,
  renderPersonaDetail,
  renderPersonaForm,
  renderMemoryFile,
} from "./views.js";
import { getTaskLogs } from "../shared/logs.js";
import type { Message } from "../shared/types.js";

const ecs = new ECSClient({});
const scheduler = new SchedulerClient({});
const s3 = new S3Client({});

const {
  TABLE_NAME: _TABLE_NAME,
  BUCKET_NAME,
  CLUSTER_ARN,
  TASK_DEF_ARN,
  SUBNET_IDS,
  SG_ID,
  APP_PASSWORD,
  STACK_NAME,
  SCHEDULER_ROLE_ARN,
  FUNCTION_ARN,
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

  if (!isSchedulerCall && !(method === "POST" && path === "/login") && !(method === "GET" && path === "/login")) {
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
      const [sessions, personas] = await Promise.all([listSessions(), scanPersonas()]);
      return html(renderHome(sessions, personas.map((p) => p.name)));
    }

    // --- Personas ---
    if (method === "GET" && path === "/personas") {
      const personas = await scanPersonas();
      return html(renderPersonaList(personas));
    }

    if (method === "GET" && path === "/personas/new") {
      return html(renderPersonaForm());
    }

    if (method === "POST" && path === "/personas") {
      const body = parseBody(event);
      const name = (body.name ?? "").trim();
      if (!name) return html("Missing name", 400);
      const existing = await getPersona(name);
      if (!existing) return html(`Persona "${name}" not found. Upload via CLI first.`, 404);
      const allowedTools = (body.allowedTools ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const heartbeatCron = (body.heartbeatCron ?? "").trim() || undefined;
      await putPersona({
        name,
        s3Key: existing.s3Key,
        systemPrompt: body.systemPrompt || undefined,
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
      const [memory, schedules, skills] = await Promise.all([
        listMemoryFiles(name),
        listSchedules(name),
        listSkillsFromTarball(persona.s3Key),
      ]);
      return html(renderPersonaDetail(persona, memory, schedules, skills));
    }

    // --- Memory file viewer ---
    const memMatch = path.match(/^\/personas\/([^/]+)\/memory\/(.+)$/);
    if (method === "GET" && memMatch) {
      const name = decodeURIComponent(memMatch[1]);
      const filePath = decodeURIComponent(memMatch[2]);
      const key = `memory/${name}/${filePath}`;
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
      const scheduleId = body.scheduleId; // optional, for cron
      const customPrompt = body.prompt;
      if (!personaName) return json({ error: "missing persona" }, 400);
      const persona = await getPersona(personaName);
      if (!persona) return json({ error: "persona not found" }, 404);

      let prompt: string;
      if (customPrompt) {
        prompt = customPrompt;
      } else if (scheduleId) {
        const sched = await getSchedule(personaName, scheduleId);
        prompt = sched?.prompt ?? `Scheduled task ${scheduleId} at ${new Date().toISOString()}.`;
      } else {
        prompt = `Heartbeat at ${new Date().toISOString()}. Review your memory/ for any pending TODOs, scheduled work, or proactive actions you should take. If nothing to do, respond briefly.`;
      }

      const id = uuidv4();
      await createSession(id, personaName);
      const sortKey = "000";
      await createMessage(id, sortKey, prompt, "heartbeat");
      const taskArn = await launchTask(id, sortKey);
      if (taskArn) await setMessageTaskArn(id, sortKey, taskArn);
      if (scheduleId) await updateScheduleLastRun(personaName, scheduleId).catch(() => {});
      return json({ ok: true, sessionId: id, taskArn });
    }

    // --- Sessions (existing) ---
    if (method === "POST" && path === "/sessions") {
      const body = parseBody(event);
      const personaName = body.persona ?? body.project;
      const prompt = body.prompt;
      if (!personaName || !prompt) return html("Missing persona or prompt", 400);

      const persona = await getPersona(personaName);
      if (!persona) return html(`Persona "${personaName}" not found`, 404);

      const id = uuidv4();
      await createSession(id, personaName);
      const sortKey = "000";
      await createMessage(id, sortKey, prompt);

      const taskArn = await launchTask(id, sortKey);
      if (taskArn) await setMessageTaskArn(id, sortKey, taskArn);

      return redirect(`/sessions/${id}`);
    }

    const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
    if (method === "GET" && sessionMatch) {
      const id = sessionMatch[1];
      const [session, messages] = await Promise.all([getSession(id), getMessages(id)]);
      if (!session) return html("Session not found", 404);
      const liveLogs = await fetchRunningLogs(messages);
      return html(renderSessionDetail(session, messages, liveLogs));
    }

    const logMatch = path.match(/^\/sessions\/([^/]+)\/messages\/([^/]+)\/logs$/);
    if (method === "GET" && logMatch) {
      const id = logMatch[1];
      const sk = `MSG#${logMatch[2]}`;
      const messages = await getMessages(id);
      const msg = messages.find((m) => m.sk === sk);
      if (!msg) return html("Message not found", 404);
      if (!msg.taskArn) return html("(no task arn)");
      const log = await getTaskLogs(msg.taskArn, 1000);
      return html(esc(log) || "(empty)");
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

      const taskArn = await launchTask(id, sortKey);
      if (taskArn) await setMessageTaskArn(id, sortKey, taskArn);

      return redirect(`/sessions/${id}`);
    }

    const msgGetMatch = path.match(/^\/sessions\/([^/]+)\/messages$/);
    if (method === "GET" && msgGetMatch) {
      const id = msgGetMatch[1];
      const messages = await getMessages(id);
      const liveLogs = await fetchRunningLogs(messages);
      return html(renderMessageList(messages, id, liveLogs));
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

async function launchTask(sessionId: string, messageSk: string): Promise<string | undefined> {
  const res = await ecs.send(
    new RunTaskCommand({
      cluster: CLUSTER_ARN,
      taskDefinition: TASK_DEF_ARN,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: SUBNET_IDS!.split(","),
          securityGroups: [SG_ID!],
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "worker",
            environment: [
              { name: "SESSION_ID", value: sessionId },
              { name: "MESSAGE_SK", value: messageSk },
            ],
          },
        ],
      },
    })
  );
  return res.tasks?.[0]?.taskArn;
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

// --- Skills (read SKILL.md headers from tarball without extracting fully) ---

async function listSkillsFromTarball(_s3Key: string): Promise<Array<{ name: string; description: string }>> {
  // Light-weight: list SKILL.md files in S3 sidecar prefix if pre-indexed; otherwise empty.
  // Skills live in the tarball; full extraction in Lambda is wasteful. Return empty for now;
  // worker registers skills implicitly via settingSources:["project"].
  return [];
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, string> {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString()
    : event.body ?? "";

  const ct = event.headers?.["content-type"] ?? "";
  if (ct.includes("application/json")) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  for (const [k, v] of params) result[k] = v;
  return result;
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  };
}

function redirect(location: string): APIGatewayProxyResultV2 {
  return { statusCode: 302, headers: { location }, body: "" };
}

async function fetchRunningLogs(messages: Message[]): Promise<Map<string, string>> {
  const running = messages.filter((m) => m.status === "RUNNING" && m.taskArn);
  const entries = await Promise.all(
    running.map(async (m) => [m.sk, await getTaskLogs(m.taskArn!, 100)] as const)
  );
  return new Map(entries);
}

async function streamToString(body: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  // @ts-expect-error stream
  for await (const c of body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf-8");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// silence unused warnings
void ListObjectsV2Command;
