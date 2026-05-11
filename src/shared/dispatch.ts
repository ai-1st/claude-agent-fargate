import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  createMessage,
  setMessageInvokeId,
  getPersona,
} from "./dynamo.js";
import type { FirstMessageAuthor } from "./types.js";

const lambda = new LambdaClient({});

const WORKER_FUNCTION_NAME = process.env.WORKER_FUNCTION_NAME;

export const DEFAULT_RESULT_SCHEMA: Record<string, unknown> = { type: "object" };

export async function launchTask(sessionId: string, messageSk: string): Promise<string | undefined> {
  if (!WORKER_FUNCTION_NAME) {
    throw new Error("dispatch.launchTask: missing WORKER_FUNCTION_NAME");
  }
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: WORKER_FUNCTION_NAME,
      InvocationType: "Event",
      Payload: Buffer.from(
        JSON.stringify({ SESSION_ID: sessionId, MESSAGE_SK: messageSk })
      ),
    })
  );
  // For async invokes Lambda returns 202 with no body. The SDK puts the request
  // id in the response metadata; surface it so we can correlate logs.
  return res.$metadata?.requestId;
}

/**
 * Create a session + first message and (conditionally) launch the worker.
 *
 * - firstMessageAuthor="user" (or heartbeat): session RUNNING, MSG#000 stored
 *   as user/heartbeat, worker launched immediately.
 * - firstMessageAuthor="agent": session WAITING_HUMAN, MSG#000 stored as
 *   assistant (already COMPLETED — it's a seed, not produced by the LLM). No
 *   worker is launched until a human replies via /sessions/:id/messages.
 */
export interface DispatchInput {
  personaName: string;
  name: string;
  prompt: string;
  firstMessageAuthor: FirstMessageAuthor;
  resultSchema: Record<string, unknown>;
  inputUrl?: string;
  callerPersona?: string;
  heartbeat?: boolean;
}

export interface DispatchResult {
  sessionId: string;
  sortKey: string;
  launched: boolean;
  invokeId?: string;
}

export async function dispatchSession(input: DispatchInput): Promise<DispatchResult> {
  const persona = await getPersona(input.personaName);
  if (!persona) throw new Error(`Persona "${input.personaName}" not found`);
  const sid = uuidv4();
  const sortKey = "000";

  if (input.firstMessageAuthor === "agent") {
    await createSession({
      id: sid,
      persona: input.personaName,
      name: input.name,
      firstMessageAuthor: "agent",
      resultSchema: input.resultSchema,
      inputUrl: input.inputUrl,
      status: "WAITING_HUMAN",
      callerPersona: input.callerPersona,
    });
    await createMessage(sid, sortKey, input.prompt, "assistant", "COMPLETED");
    return { sessionId: sid, sortKey, launched: false };
  }

  await createSession({
    id: sid,
    persona: input.personaName,
    name: input.name,
    firstMessageAuthor: "user",
    resultSchema: input.resultSchema,
    inputUrl: input.inputUrl,
    status: "RUNNING",
    callerPersona: input.callerPersona,
  });
  await createMessage(sid, sortKey, input.prompt, input.heartbeat ? "heartbeat" : "user");
  const invokeId = await launchTask(sid, sortKey);
  if (invokeId) await setMessageInvokeId(sid, sortKey, invokeId);
  return { sessionId: sid, sortKey, launched: true, invokeId };
}
