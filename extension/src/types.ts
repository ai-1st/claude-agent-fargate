export type BrowserOp =
  | "open"
  | "readText"
  | "click"
  | "fill"
  | "scroll"
  | "extract"
  | "screenshot"
  | "run_scraper";

export type OverlayState = "idle" | "working" | "needs_human" | "unbound";

export interface SessionSummary {
  id: string;
  name?: string;
  persona: string;
  status: string;
  createdAt: string;
  firstMessageAuthor?: string;
}

export interface ChatMessage {
  sk: string;
  kind: "user" | "assistant" | "heartbeat";
  prompt: string;
  result?: string;
  status: string;
  error?: string;
  createdAt: string;
}

export interface SessionDetailResponse {
  session: SessionSummary & { inputUrl?: string; submitResult?: string };
  messages: ChatMessage[];
  canSend: boolean;
  browserBound: boolean;
}

export interface PollResponse {
  active?: { sessionId: string; status: string; name?: string; inputUrl?: string } | null;
  command?: { seq: string; op: BrowserOp; args: Record<string, unknown> };
  messages?: ChatMessage[];
  canSend?: boolean;
  terminal?: boolean;
  status?: string;
  error?: string;
}

export type RuntimeMessage =
  | { type: "open_session"; sid: string; token: string; base: string; inputUrl?: string }
  | { type: "execute_op"; op: BrowserOp; args: Record<string, unknown>; seq: string }
  | { type: "op_result"; seq: string; ok: boolean; data?: unknown; error?: string }
  | { type: "overlay_set"; state: OverlayState }
  | { type: "unbind" }
  | { type: "get_state" }
  | { type: "poll_now" }
  | { type: "capture_screenshot" };
