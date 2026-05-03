import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, dirname } from "node:path";
import { homedir } from "node:os";

const TABLE = process.env.TABLE_NAME!;
const BUCKET = process.env.BUCKET_NAME!;
const SESSION_ID = process.env.SESSION_ID!;
const MESSAGE_SK = process.env.MESSAGE_SK!;
const PROJECT_DIR = "/tmp/project";
const SDK_PROJECTS_DIR = join(homedir(), ".claude", "projects");
// SDK sanitizes cwd: non-alphanum -> '-' (matches sdk.mjs F1())
const SDK_SESSION_DIR = join(SDK_PROJECTS_DIR, PROJECT_DIR.replace(/[^a-zA-Z0-9]/g, "-"));
const AGENT_STATE_KEY = `agent-state/${SESSION_ID}.tgz`;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const ssm = new SSMClient({});

interface Session {
  pk: string;
  sk: string;
  persona?: string;
  project?: string;
  status: string;
  agentSessionId?: string;
}

interface Message {
  pk: string;
  sk: string;
  prompt: string;
  status: string;
  result?: string;
  kind?: string;
}

interface Persona {
  pk: string;
  sk: string;
  name: string;
  s3Key: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mcpEnabled?: boolean;
  memoryEnabled?: boolean;
}

interface MemoryFile {
  pk: string;
  sk: string;
  path: string;
  s3Key: string;
  sha256: string;
  size: number;
  updatedAt: string;
}

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];

function log(stage: string, ...args: unknown[]) {
  console.log(`[${stage}]`, ...args);
}

async function main() {
  log("init", `session=${SESSION_ID} message=${MESSAGE_SK}`);
  log("init", `TABLE=${TABLE} BUCKET=${BUCKET}`);

  try {
    log("db", "Fetching session...");
    const session = await getItem<Session>(`SESSION#${SESSION_ID}`, "META");
    if (!session) throw new Error("Session not found");
    const personaName = session.persona ?? session.project;
    if (!personaName) throw new Error("Session has no persona/project");
    log("db", `Session persona=${personaName} status=${session.status} agentSessionId=${session.agentSessionId ?? "(new)"}`);

    log("db", "Fetching message...");
    const message = await getItem<Message>(`SESSION#${SESSION_ID}`, `MSG#${MESSAGE_SK}`);
    if (!message) throw new Error("Message not found");
    log("db", `Message kind=${message.kind ?? "user"} prompt="${message.prompt.slice(0, 80)}..."`);

    log("db", "Fetching persona...");
    let persona = await getItem<Persona>(`PERSONA#${personaName}`, "META");
    if (!persona) {
      log("db", `PERSONA#${personaName} not found, falling back to legacy PROJECT#${personaName}`);
      persona = await getItem<Persona>(`PROJECT#${personaName}`, "PROJECT");
    }
    if (!persona) throw new Error(`Persona ${personaName} not found`);
    log("db", `Persona s3Key=${persona.s3Key} memoryEnabled=${persona.memoryEnabled !== false}`);

    const projectDir = PROJECT_DIR;
    mkdirSync(projectDir, { recursive: true });

    log("s3", `Downloading ${persona.s3Key}...`);
    await downloadAndExtract(persona.s3Key, projectDir);
    log("s3", "Project extracted");

    log("ssm", `Fetching secrets for ${personaName}...`);
    await writeSecrets(personaName, projectDir);

    const memoryDir = join(projectDir, "memory");
    let memoryManifest = new Map<string, string>();
    if (persona.memoryEnabled !== false) {
      log("memory", "Hydrating memory from S3...");
      memoryManifest = await hydrateMemory(personaName, memoryDir);
      log("memory", `Hydrated ${memoryManifest.size} files`);
    }

    const mcpServers = readMcpConfig(projectDir);
    if (mcpServers) log("mcp", `Loaded ${Object.keys(mcpServers).length} server(s): ${Object.keys(mcpServers).join(", ")}`);

    const allowedTools = persona.allowedTools && persona.allowedTools.length > 0 ? persona.allowedTools : DEFAULT_TOOLS;
    log("agent", `allowedTools=${allowedTools.join(",")}`);

    let isFollowUp = !!session.agentSessionId;
    if (isFollowUp) {
      log("agent-state", `Restoring SDK session state from s3://${BUCKET}/${AGENT_STATE_KEY}...`);
      const restored = await restoreAgentState();
      if (!restored) {
        log("agent-state", "No prior state — falling back to fresh session (continuity for this turn lost).");
        isFollowUp = false;
      }
    }

    const baseOptions: Record<string, unknown> = {
      cwd: projectDir,
      allowedTools,
      permissionMode: "acceptEdits" as const,
    };
    if (mcpServers) baseOptions.mcpServers = mcpServers;
    if (persona.systemPrompt) baseOptions.systemPrompt = persona.systemPrompt;

    const options = isFollowUp
      ? { ...baseOptions, resume: session.agentSessionId }
      : { ...baseOptions, settingSources: ["project" as const] };

    const prompt = message.prompt;
    log("agent", `Starting Agent SDK query (resume=${isFollowUp})...`);

    let result = "";
    let capturedAgentSessionId: string | undefined;
    let msgCount = 0;
    for await (const msg of query({ prompt, options })) {
      msgCount++;
      const m = msg as Record<string, unknown>;
      const msgType = m.type ?? "unknown";
      if (msgCount <= 5 || msgCount % 10 === 0) {
        log("agent", `msg #${msgCount} type=${msgType}${m.subtype ? ` subtype=${m.subtype}` : ""}`);
      }
      if (m.type === "system" && m.subtype === "init" && typeof m.session_id === "string") {
        capturedAgentSessionId = m.session_id;
        log("agent", `Captured agentSessionId=${capturedAgentSessionId}`);
      }
      if ("result" in m) {
        result = m.result as string;
        log("agent", `Got result (${result.length} chars)`);
      }
    }
    log("agent", `Query complete, ${msgCount} messages total`);

    if (capturedAgentSessionId && capturedAgentSessionId !== session.agentSessionId) {
      log("db", `Saving agentSessionId=${capturedAgentSessionId} on session META...`);
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { pk: `SESSION#${SESSION_ID}`, sk: "META" },
          UpdateExpression: "SET agentSessionId = :a, updatedAt = :now",
          ExpressionAttributeValues: { ":a": capturedAgentSessionId, ":now": new Date().toISOString() },
        })
      );
    }

    if (persona.memoryEnabled !== false) {
      log("memory", "Syncing memory back to S3...");
      const synced = await syncMemoryBack(personaName, memoryDir, memoryManifest);
      log("memory", `Synced ${synced.uploaded} uploaded, ${synced.deleted} deleted`);
    }

    log("agent-state", `Saving SDK session state to s3://${BUCKET}/${AGENT_STATE_KEY}...`);
    await saveAgentState();

    log("db", "Updating message status to COMPLETED...");
    await updateMessageStatus("COMPLETED", result);
    log("db", "Updating session status to COMPLETED...");
    await updateSessionStatus("COMPLETED");

    log("done", "Worker completed successfully");
  } catch (err: unknown) {
    console.error("[error] Worker failed:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    log("error", `Updating DDB with FAILED status: ${errorMsg.slice(0, 200)}`);
    await updateMessageStatus("FAILED", undefined, errorMsg).catch((e) =>
      console.error("[error] Failed to update message:", e)
    );
    await updateSessionStatus("FAILED").catch((e) =>
      console.error("[error] Failed to update session:", e)
    );
    process.exit(1);
  }
}

async function getItem<T>(pk: string, sk: string): Promise<T | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }));
  return res.Item as T | undefined;
}

async function downloadAndExtract(s3Key: string, dir: string): Promise<void> {
  const tgzPath = "/tmp/project.tgz";
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const body = res.Body;
  if (!body) throw new Error("Empty S3 response");

  const chunks: Buffer[] = [];
  // @ts-expect-error body is a Readable stream in Node
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  writeFileSync(tgzPath, Buffer.concat(chunks));
  execSync(`tar xzf ${tgzPath} -C ${dir}`, { stdio: "inherit" });
}

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
  writeFileSync(`${dir}/.env`, envContent + "\n");
  console.log(`Wrote ${params.length} secrets to .env`);
}

// --- SDK agent state persistence (~/.claude/projects/<sanitized-cwd>/) ---

async function restoreAgentState(): Promise<boolean> {
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: AGENT_STATE_KEY }));
    const chunks: Buffer[] = [];
    const body = got.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    const tgzPath = "/tmp/agent-state.tgz";
    writeFileSync(tgzPath, Buffer.concat(chunks));
    mkdirSync(SDK_SESSION_DIR, { recursive: true });
    execSync(`tar xzf ${tgzPath} -C ${SDK_SESSION_DIR}`, { stdio: "inherit" });
    console.log(`[agent-state] Restored ${chunks.length} chunks → ${SDK_SESSION_DIR}`);
    return true;
  } catch (e: unknown) {
    const name = e instanceof Error ? e.name : String(e);
    if (name === "NoSuchKey" || name === "NotFound") {
      console.log("[agent-state] No prior state in S3");
      return false;
    }
    throw e;
  }
}

async function saveAgentState(): Promise<void> {
  if (!existsSync(SDK_SESSION_DIR)) {
    console.log(`[agent-state] ${SDK_SESSION_DIR} does not exist, nothing to save`);
    return;
  }
  const tgzPath = "/tmp/agent-state.tgz";
  execSync(`tar czf ${tgzPath} -C ${SDK_SESSION_DIR} .`, { stdio: "inherit" });
  const buf = readFileSync(tgzPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: AGENT_STATE_KEY,
      Body: buf,
      ContentType: "application/gzip",
    })
  );
  console.log(`[agent-state] Saved ${buf.length} bytes`);
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

// --- Memory hydration / sync ---

async function hydrateMemory(persona: string, memoryDir: string): Promise<Map<string, string>> {
  mkdirSync(memoryDir, { recursive: true });
  const prefix = `memory/${persona}/`;
  const manifest = new Map<string, string>(); // path -> sha256

  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      const relPath = obj.Key.slice(prefix.length);
      if (!relPath) continue;
      const localPath = join(memoryDir, relPath);
      mkdirSync(dirname(localPath), { recursive: true });
      const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      const chunks: Buffer[] = [];
      const body = got.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      const buf = Buffer.concat(chunks);
      writeFileSync(localPath, buf);
      manifest.set(relPath, sha256(buf));
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return manifest;
}

async function syncMemoryBack(
  persona: string,
  memoryDir: string,
  oldManifest: Map<string, string>
): Promise<{ uploaded: number; deleted: number }> {
  if (!existsSync(memoryDir)) return { uploaded: 0, deleted: 0 };
  const prefix = `memory/${persona}/`;
  const seen = new Set<string>();
  let uploaded = 0;
  let deleted = 0;

  for (const relPath of walk(memoryDir, "")) {
    const abs = join(memoryDir, relPath);
    const buf = readFileSync(abs);
    const sha = sha256(buf);
    seen.add(relPath);
    if (oldManifest.get(relPath) === sha) continue;
    const key = prefix + relPath;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buf,
        ContentType: guessContentType(relPath),
      })
    );
    const item: MemoryFile = {
      pk: `PERSONA#${persona}`,
      sk: `MEM#${relPath}`,
      path: relPath,
      s3Key: key,
      sha256: sha,
      size: buf.length,
      updatedAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    uploaded++;
  }

  for (const oldPath of oldManifest.keys()) {
    if (seen.has(oldPath)) continue;
    const key = prefix + oldPath;
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    await ddb.send(
      new (await import("@aws-sdk/lib-dynamodb")).DeleteCommand({
        TableName: TABLE,
        Key: { pk: `PERSONA#${persona}`, sk: `MEM#${oldPath}` },
      })
    );
    deleted++;
  }
  return { uploaded, deleted };
}

function* walk(root: string, sub: string): Generator<string> {
  const here = join(root, sub);
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    const child = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(root, child);
    else if (entry.isFile()) {
      const st = statSync(join(root, child));
      if (st.size > 0) yield child;
    }
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function guessContentType(p: string): string {
  if (p.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function updateMessageStatus(
  status: string,
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
      Key: { pk: `SESSION#${SESSION_ID}`, sk: `MSG#${MESSAGE_SK}` },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

async function updateSessionStatus(status: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `SESSION#${SESSION_ID}`, sk: "META" },
      UpdateExpression: "SET #status = :status, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status, ":now": new Date().toISOString() },
    })
  );
}

// silence unused-import warnings on QueryCommand/relative
void QueryCommand;
void relative;

main();
