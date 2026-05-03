export interface Persona {
  pk: string; // PERSONA#<name>
  sk: string; // META
  name: string;
  s3Key: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mcpEnabled?: boolean;
  memoryEnabled?: boolean;
  heartbeatCron?: string;
  scheduleArn?: string;
  createdAt: string;
  updatedAt: string;
}

export type SessionStatus = "RUNNING" | "COMPLETED" | "FAILED" | "IDLE";

export interface Session {
  pk: string; // SESSION#<id>
  sk: string; // META
  gsi1pk: string; // SESSIONS
  gsi1sk: string; // <createdAt>
  persona: string;
  status: SessionStatus;
  agentSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageStatus = "RUNNING" | "COMPLETED" | "FAILED";
export type MessageKind = "user" | "heartbeat";

export interface Message {
  pk: string; // SESSION#<id>
  sk: string; // MSG#<sortKey>
  prompt: string;
  status: MessageStatus;
  kind?: MessageKind;
  taskArn?: string;
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

export function sessionId(pk: string): string {
  return pk.replace("SESSION#", "");
}

export function personaName(pk: string): string {
  return pk.replace("PERSONA#", "");
}
