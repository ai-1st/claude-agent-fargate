import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  Persona,
  Session,
  Message,
  MemoryFile,
  Schedule,
  SessionStatus,
  MessageStatus,
  MessageKind,
  FirstMessageAuthor,
  BrowserCommand,
  BrowserOp,
  BrowserResult,
  HandoffRequest,
  HandoffKind,
  Template,
} from "./types.js";
import { padSeq } from "./types.js";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE = process.env.TABLE_NAME!;

// --- Persona ---

export async function putPersona(p: Partial<Persona> & { name: string; s3Key: string }): Promise<Persona> {
  const now = new Date().toISOString();
  const existing = await getPersona(p.name);
  const item: Persona = {
    pk: `PERSONA#${p.name}`,
    sk: "META",
    name: p.name,
    s3Key: p.s3Key,
    description: p.description ?? existing?.description,
    actions: p.actions ?? existing?.actions,
    systemPrompt: p.systemPrompt ?? existing?.systemPrompt,
    allowedTools: p.allowedTools ?? existing?.allowedTools,
    mcpEnabled: p.mcpEnabled ?? existing?.mcpEnabled,
    memoryEnabled: p.memoryEnabled ?? existing?.memoryEnabled ?? true,
    heartbeatCron: p.heartbeatCron ?? existing?.heartbeatCron,
    scheduleArn: p.scheduleArn ?? existing?.scheduleArn,
    templateName: p.templateName ?? existing?.templateName,
    templateSha: p.templateSha ?? existing?.templateSha,
    templateAppliedAt: p.templateAppliedAt ?? existing?.templateAppliedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function updatePersonaTemplateLink(
  name: string,
  templateName: string,
  templateSha: string,
  s3Key: string
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `PERSONA#${name}`, sk: "META" },
      UpdateExpression:
        "SET templateName = :t, templateSha = :sha, templateAppliedAt = :now, s3Key = :k, updatedAt = :now",
      ExpressionAttributeValues: {
        ":t": templateName,
        ":sha": templateSha,
        ":k": s3Key,
        ":now": new Date().toISOString(),
      },
    })
  );
}

// --- Template ---

export async function putTemplate(t: Partial<Template> & { name: string; s3Key: string }): Promise<Template> {
  const now = new Date().toISOString();
  const existing = await getTemplate(t.name);
  const item: Template = {
    pk: `TEMPLATE#${t.name}`,
    sk: "META",
    name: t.name,
    s3Key: t.s3Key,
    description: t.description ?? existing?.description,
    actions: t.actions ?? existing?.actions,
    sha256: t.sha256 ?? existing?.sha256,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function getTemplate(name: string): Promise<Template | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `TEMPLATE#${name}`, sk: "META" } })
  );
  return res.Item as Template | undefined;
}

export async function listTemplates(): Promise<Template[]> {
  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: "sk = :sk AND begins_with(pk, :pfx)",
      ExpressionAttributeValues: { ":sk": "META", ":pfx": "TEMPLATE#" },
    })
  );
  return ((res.Items ?? []) as Template[]).sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteTemplate(name: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: `TEMPLATE#${name}`, sk: "META" } })
  );
}

export async function getPersona(name: string): Promise<Persona | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `PERSONA#${name}`, sk: "META" } })
  );
  return res.Item as Persona | undefined;
}

export async function scanPersonas(): Promise<Persona[]> {
  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: "sk = :sk AND begins_with(pk, :pfx)",
      ExpressionAttributeValues: { ":sk": "META", ":pfx": "PERSONA#" },
    })
  );
  return (res.Items ?? []) as Persona[];
}

export async function updatePersonaSchedule(name: string, cron: string | undefined, scheduleArn: string | undefined): Promise<void> {
  const updates: string[] = ["updatedAt = :now"];
  const values: Record<string, unknown> = { ":now": new Date().toISOString() };
  const removes: string[] = [];
  if (cron === undefined) removes.push("heartbeatCron");
  else { updates.push("heartbeatCron = :c"); values[":c"] = cron; }
  if (scheduleArn === undefined) removes.push("scheduleArn");
  else { updates.push("scheduleArn = :a"); values[":a"] = scheduleArn; }
  let expr = `SET ${updates.join(", ")}`;
  if (removes.length) expr += ` REMOVE ${removes.join(", ")}`;
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `PERSONA#${name}`, sk: "META" },
      UpdateExpression: expr,
      ExpressionAttributeValues: values,
    })
  );
}

// --- Session ---

export interface CreateSessionInput {
  id: string;
  persona: string;
  name: string;
  firstMessageAuthor: FirstMessageAuthor;
  resultSchema: Record<string, unknown>;
  inputUrl?: string;
  status?: SessionStatus;
  callerPersona?: string;
}

export async function createSession(input: CreateSessionInput): Promise<Session> {
  const now = new Date().toISOString();
  const status: SessionStatus = input.status ?? "RUNNING";
  const item: Session = {
    pk: `SESSION#${input.id}`,
    sk: "META",
    gsi1pk: "SESSIONS",
    gsi1sk: now,
    persona: input.persona,
    name: input.name,
    status,
    firstMessageAuthor: input.firstMessageAuthor,
    resultSchema: input.resultSchema,
    createdAt: now,
    updatedAt: now,
  };
  if (input.inputUrl) item.inputUrl = input.inputUrl;
  if (input.callerPersona) item.callerPersona = input.callerPersona;
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function getSession(id: string): Promise<Session | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `SESSION#${id}`, sk: "META" } })
  );
  return res.Item as Session | undefined;
}

export async function listSessions(limit = 50): Promise<Session[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": "SESSIONS" },
      ScanIndexForward: false,
      Limit: limit,
    })
  );
  return (res.Items ?? []) as Session[];
}

export async function listSessionsByPersona(name: string, limit = 100): Promise<Session[]> {
  const sessions = await listSessions(500);
  return sessions.filter((s) => s.persona === name).slice(0, limit);
}

export async function listInbox(): Promise<Session[]> {
  // Sessions waiting on a human reply, across all personas.
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": "SESSIONS", ":s": "WAITING_HUMAN" },
      FilterExpression: "#status = :s",
      ExpressionAttributeNames: { "#status": "status" },
      ScanIndexForward: false,
      Limit: 200,
    })
  );
  return (res.Items ?? []) as Session[];
}

export async function listActiveSessions(personaName?: string): Promise<Session[]> {
  const sessions = await listSessions(500);
  const filtered = sessions.filter(
    (s) => s.status !== "COMPLETED" && s.status !== "FAILED"
  );
  return personaName ? filtered.filter((s) => s.persona === personaName) : filtered;
}

export async function updateSessionStatus(id: string, status: SessionStatus): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${id}`, sk: "META" },
      UpdateExpression: "SET #status = :status, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status, ":now": new Date().toISOString() },
    })
  );
}

export async function setSessionAgentId(id: string, agentSessionId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${id}`, sk: "META" },
      UpdateExpression: "SET agentSessionId = :a, updatedAt = :now",
      ExpressionAttributeValues: { ":a": agentSessionId, ":now": new Date().toISOString() },
    })
  );
}

export async function setSessionExtToken(id: string, token: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${id}`, sk: "META" },
      UpdateExpression: "SET extToken = :t, extTokenLastSeenAt = :now, updatedAt = :now",
      ExpressionAttributeValues: { ":t": token, ":now": new Date().toISOString() },
    })
  );
}

export async function bumpSessionExtSeen(id: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${id}`, sk: "META" },
      UpdateExpression: "SET extTokenLastSeenAt = :now",
      ExpressionAttributeValues: { ":now": new Date().toISOString() },
    })
  );
}

export async function setSessionWakeAt(id: string, wakeAt: string | undefined): Promise<void> {
  if (wakeAt === undefined) {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `SESSION#${id}`, sk: "META" },
        UpdateExpression: "SET updatedAt = :now REMOVE wakeAt",
        ExpressionAttributeValues: { ":now": new Date().toISOString() },
      })
    );
    return;
  }
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${id}`, sk: "META" },
      UpdateExpression: "SET wakeAt = :w, updatedAt = :now",
      ExpressionAttributeValues: { ":w": wakeAt, ":now": new Date().toISOString() },
    })
  );
}

export async function setSubmitResult(id: string, payloadJson: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${id}`, sk: "META" },
      UpdateExpression:
        "SET submitResult = :r, #status = :s, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":r": payloadJson,
        ":s": "COMPLETED",
        ":now": new Date().toISOString(),
      },
    })
  );
}

// --- Message ---

export async function createMessage(
  sessionId: string,
  sortKey: string,
  prompt: string,
  kind: MessageKind = "user",
  status: MessageStatus = "RUNNING"
): Promise<Message> {
  const now = new Date().toISOString();
  const item: Message = {
    pk: `SESSION#${sessionId}`,
    sk: `MSG#${sortKey}`,
    prompt,
    status,
    kind,
    createdAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `SESSION#${sessionId}`, ":sk": "MSG#" },
    })
  );
  return (res.Items ?? []) as Message[];
}

export async function updateMessage(
  sessionId: string,
  sortKey: string,
  status: MessageStatus,
  result?: string,
  error?: string
): Promise<void> {
  const updates: string[] = ["#status = :status"];
  const names: Record<string, string> = { "#status": "status" };
  const values: Record<string, unknown> = { ":status": status };
  if (result !== undefined) {
    updates.push("#result = :result");
    names["#result"] = "result";
    values[":result"] = result;
  }
  if (error !== undefined) {
    updates.push("#error = :error");
    names["#error"] = "error";
    values[":error"] = error;
  }
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${sessionId}`, sk: `MSG#${sortKey}` },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

export async function setMessageInvokeId(
  sessionId: string,
  sortKey: string,
  lambdaRequestId: string
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${sessionId}`, sk: `MSG#${sortKey}` },
      UpdateExpression:
        "SET lambdaRequestId = :rid, restartCount = if_not_exists(restartCount, :zero) + :one",
      ExpressionAttributeValues: {
        ":rid": lambdaRequestId,
        ":zero": 0,
        ":one": 1,
      },
    })
  );
}

export async function nextMessageSortKey(sessionId: string): Promise<string> {
  const msgs = await getMessages(sessionId);
  return String(msgs.length).padStart(3, "0");
}

export async function firstPendingMessageSk(sessionId: string): Promise<string | undefined> {
  const msgs = await getMessages(sessionId);
  const m = msgs.find((x) => !x.lambdaRequestId && x.status === "RUNNING");
  return m ? (m.sk ?? "").replace("MSG#", "") : undefined;
}

// --- Memory ---

export async function putMemoryFile(file: MemoryFile): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: file }));
}

export async function listMemoryFiles(persona: string): Promise<MemoryFile[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `PERSONA#${persona}`, ":sk": "MEM#" },
    })
  );
  return (res.Items ?? []) as MemoryFile[];
}

export async function deleteMemoryFile(persona: string, path: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: `PERSONA#${persona}`, sk: `MEM#${path}` },
    })
  );
}

// --- Schedule ---

export async function putSchedule(s: Schedule): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: s }));
}

export async function getSchedule(persona: string, id: string): Promise<Schedule | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `PERSONA#${persona}`, sk: `CRON#${id}` } })
  );
  return res.Item as Schedule | undefined;
}

export async function listSchedules(persona: string): Promise<Schedule[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `PERSONA#${persona}`, ":sk": "CRON#" },
    })
  );
  return (res.Items ?? []) as Schedule[];
}

export async function deleteSchedule(persona: string, id: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: `PERSONA#${persona}`, sk: `CRON#${id}` },
    })
  );
}

export async function updateScheduleLastRun(persona: string, id: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `PERSONA#${persona}`, sk: `CRON#${id}` },
      UpdateExpression: "SET lastRun = :now",
      ExpressionAttributeValues: { ":now": new Date().toISOString() },
    })
  );
}

// --- Browser commands / results ---

export async function nextBrCmdSeq(sessionId: string): Promise<string> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `SESSION#${sessionId}`, ":sk": "BRCMD#" },
      Select: "COUNT",
    })
  );
  return padSeq(res.Count ?? 0);
}

export async function putBrCmd(
  sessionId: string,
  seq: string,
  op: BrowserOp,
  args: Record<string, unknown>
): Promise<BrowserCommand> {
  const item: BrowserCommand = {
    pk: `SESSION#${sessionId}`,
    sk: `BRCMD#${seq}`,
    seq,
    op,
    args,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function getBrCmd(sessionId: string, seq: string): Promise<BrowserCommand | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `SESSION#${sessionId}`, sk: `BRCMD#${seq}` } })
  );
  return res.Item as BrowserCommand | undefined;
}

export async function listBrCmds(sessionId: string): Promise<BrowserCommand[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `SESSION#${sessionId}`, ":sk": "BRCMD#" },
    })
  );
  return (res.Items ?? []) as BrowserCommand[];
}

export async function nextPendingBrCmd(sessionId: string): Promise<BrowserCommand | undefined> {
  const cmds = await listBrCmds(sessionId);
  return cmds.find((c) => c.status === "PENDING");
}

export async function markBrCmdDispatched(sessionId: string, seq: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${sessionId}`, sk: `BRCMD#${seq}` },
      UpdateExpression: "SET #status = :s",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":s": "DISPATCHED" },
    })
  );
}

export async function markBrCmdDone(sessionId: string, seq: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${sessionId}`, sk: `BRCMD#${seq}` },
      UpdateExpression: "SET #status = :s",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":s": "DONE" },
    })
  );
}

export async function putBrRes(res: BrowserResult): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: res }));
}

export async function getBrRes(sessionId: string, seq: string): Promise<BrowserResult | undefined> {
  const r = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `SESSION#${sessionId}`, sk: `BRRES#${seq}` } })
  );
  return r.Item as BrowserResult | undefined;
}

// --- Handoffs ---

export async function nextHandoffSeq(sessionId: string): Promise<string> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `SESSION#${sessionId}`, ":sk": "HANDOFF#" },
      Select: "COUNT",
    })
  );
  return padSeq(res.Count ?? 0);
}

export async function putHandoff(
  sessionId: string,
  seq: string,
  prompt: string,
  kind: HandoffKind
): Promise<HandoffRequest> {
  const item: HandoffRequest = {
    pk: `SESSION#${sessionId}`,
    sk: `HANDOFF#${seq}`,
    seq,
    prompt,
    kind,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

export async function getHandoff(sessionId: string, seq: string): Promise<HandoffRequest | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `SESSION#${sessionId}`, sk: `HANDOFF#${seq}` } })
  );
  return res.Item as HandoffRequest | undefined;
}

export async function listHandoffs(sessionId: string): Promise<HandoffRequest[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `SESSION#${sessionId}`, ":sk": "HANDOFF#" },
    })
  );
  return (res.Items ?? []) as HandoffRequest[];
}

export async function nextPendingHandoff(sessionId: string): Promise<HandoffRequest | undefined> {
  const items = await listHandoffs(sessionId);
  return items.find((h) => h.status === "PENDING");
}

export async function resolveHandoff(sessionId: string, seq: string, response: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${sessionId}`, sk: `HANDOFF#${seq}` },
      UpdateExpression: "SET #status = :s, response = :r, resolvedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":s": "DONE",
        ":r": response,
        ":now": new Date().toISOString(),
      },
    })
  );
}
