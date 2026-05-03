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
} from "./types.js";

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
    systemPrompt: p.systemPrompt ?? existing?.systemPrompt,
    allowedTools: p.allowedTools ?? existing?.allowedTools,
    mcpEnabled: p.mcpEnabled ?? existing?.mcpEnabled,
    memoryEnabled: p.memoryEnabled ?? existing?.memoryEnabled ?? true,
    heartbeatCron: p.heartbeatCron ?? existing?.heartbeatCron,
    scheduleArn: p.scheduleArn ?? existing?.scheduleArn,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
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

export async function createSession(id: string, persona: string): Promise<Session> {
  const now = new Date().toISOString();
  const item: Session = {
    pk: `SESSION#${id}`,
    sk: "META",
    gsi1pk: "SESSIONS",
    gsi1sk: now,
    persona,
    status: "RUNNING",
    createdAt: now,
    updatedAt: now,
  };
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

// --- Message ---

export async function createMessage(
  sessionId: string,
  sortKey: string,
  prompt: string,
  kind: MessageKind = "user"
): Promise<Message> {
  const now = new Date().toISOString();
  const item: Message = {
    pk: `SESSION#${sessionId}`,
    sk: `MSG#${sortKey}`,
    prompt,
    status: "RUNNING",
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

export async function setMessageTaskArn(
  sessionId: string,
  sortKey: string,
  taskArn: string
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${sessionId}`, sk: `MSG#${sortKey}` },
      UpdateExpression: "SET taskArn = :arn",
      ExpressionAttributeValues: { ":arn": taskArn },
    })
  );
}

export async function nextMessageSortKey(sessionId: string): Promise<string> {
  const msgs = await getMessages(sessionId);
  return String(msgs.length).padStart(3, "0");
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
