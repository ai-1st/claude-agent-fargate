export interface Persona {
  pk: string; // PERSONA#<name>
  sk: string; // META
  name: string;
  s3Key: string;
  description?: string;
  actions?: string[];
  systemPrompt?: string;
  allowedTools?: string[];
  mcpEnabled?: boolean;
  memoryEnabled?: boolean;
  heartbeatCron?: string;
  scheduleArn?: string;
  templateName?: string;
  templateSha?: string;
  templateAppliedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  pk: string; // TEMPLATE#<name>
  sk: string; // META
  name: string;
  s3Key: string;
  description?: string;
  actions?: string[];
  sha256?: string;
  createdAt: string;
  updatedAt: string;
}

export type SessionStatus =
  | "RUNNING"
  | "WAITING_HUMAN"
  | "COMPLETED"
  | "FAILED"
  | "IDLE"
  | "SLEEPING";

export type FirstMessageAuthor = "user" | "agent";

export interface Session {
  pk: string; // SESSION#<id>
  sk: string; // META
  gsi1pk: string; // SESSIONS
  gsi1sk: string; // <createdAt>
  persona: string;
  name: string;
  status: SessionStatus;
  firstMessageAuthor: FirstMessageAuthor;
  resultSchema: Record<string, unknown>; // JSON Schema
  inputUrl?: string;
  extToken?: string; // minted on Open-in-Extension click
  extTokenLastSeenAt?: string;
  agentSessionId?: string;
  callerPersona?: string;
  submitResult?: string; // JSON-serialized payload from submit_result tool
  wakeAt?: string; // ISO when an agent_sleep wake-up is scheduled
  createdAt: string;
  updatedAt: string;
}

export type MessageStatus = "RUNNING" | "COMPLETED" | "FAILED" | "SLEEPING";
export type MessageKind = "user" | "heartbeat" | "assistant";

export interface Message {
  pk: string; // SESSION#<id>
  sk: string; // MSG#<sortKey>
  prompt: string; // for user/heartbeat: the human prompt; for assistant: the assistant text
  status: MessageStatus;
  kind?: MessageKind;
  lambdaRequestId?: string; // most recent worker Lambda async invoke request id
  restartCount?: number; // how many times we re-invoked the worker for this message
  result?: string;
  error?: string;
  createdAt: string;
}

export interface MemoryFile {
  pk: string; // PERSONA#<name>
  sk: string; // MEM#<path>
  path: string;
  s3Key: string;
  sha256: string;
  size: number;
  updatedAt: string;
}

export interface Schedule {
  pk: string; // PERSONA#<name>
  sk: string; // CRON#<id>
  id: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRun?: string;
  scheduleArn?: string;
  createdAt: string;
}

export interface Skill {
  pk: string; // PERSONA#<name>
  sk: string; // SKILL#<name>
  name: string;
  description: string;
  path: string;
}

// --- Browser extension bridge ---

export type BrowserOp =
  | "open"
  | "readText"
  | "click"
  | "fill"
  | "scroll"
  | "extract"
  | "screenshot"
  | "run_scraper";

export interface BrowserCommand {
  pk: string; // SESSION#<id>
  sk: string; // BRCMD#<seq>
  seq: string;
  op: BrowserOp;
  args: Record<string, unknown>;
  status: "PENDING" | "DISPATCHED" | "DONE";
  createdAt: string;
}

export interface BrowserResult {
  pk: string; // SESSION#<id>
  sk: string; // BRRES#<seq>
  seq: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  completedAt: string;
}

export type HandoffKind = "approve" | "text" | "mfa" | "captcha";

export interface HandoffRequest {
  pk: string; // SESSION#<id>
  sk: string; // HANDOFF#<seq>
  seq: string;
  prompt: string;
  kind: HandoffKind;
  response?: string;
  status: "PENDING" | "DONE";
  createdAt: string;
  resolvedAt?: string;
}

export function sessionId(pk: string): string {
  return pk.replace("SESSION#", "");
}

export function personaName(pk: string): string {
  return pk.replace("PERSONA#", "");
}

export function seqOf(sk: string): string {
  return sk.split("#").pop() ?? "";
}

export function padSeq(n: number): string {
  return String(n).padStart(6, "0");
}
