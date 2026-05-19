import type { PollResponse, SessionDetailResponse, SessionSummary } from "./types.js";

export interface ApiAuth {
  base: string;
  password: string;
}

function trim(url: string): string {
  return url.replace(/\/+$/, "");
}

function authHeaders(auth: ApiAuth): Record<string, string> {
  return {
    "X-App-Password": auth.password,
    "Content-Type": "application/json",
  };
}

export async function listSessions(auth: ApiAuth): Promise<SessionSummary[]> {
  const r = await fetch(`${trim(auth.base)}/ext/sessions`, {
    method: "GET",
    headers: authHeaders(auth),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`list sessions ${r.status}`);
  return (await r.json()) as SessionSummary[];
}

export async function getSessionDetail(auth: ApiAuth, id: string): Promise<SessionDetailResponse> {
  const r = await fetch(`${trim(auth.base)}/ext/sessions/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: authHeaders(auth),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`session ${r.status}`);
  return (await r.json()) as SessionDetailResponse;
}

export async function sendSessionMessage(
  auth: ApiAuth,
  id: string,
  prompt: string
): Promise<{ ok: boolean; sortKey?: string }> {
  const r = await fetch(`${trim(auth.base)}/ext/sessions/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ prompt }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(body || `send ${r.status}`);
  }
  return (await r.json()) as { ok: boolean; sortKey?: string };
}

export async function bindSessionBrowser(
  auth: ApiAuth,
  id: string
): Promise<{ sid: string; token: string; base: string; inputUrl?: string }> {
  const r = await fetch(`${trim(auth.base)}/ext/sessions/${encodeURIComponent(id)}/bind`, {
    method: "POST",
    headers: authHeaders(auth),
    body: "{}",
  });
  if (!r.ok) throw new Error(`bind ${r.status}`);
  return (await r.json()) as { sid: string; token: string; base: string; inputUrl?: string };
}

export interface BoundConfig {
  base: string;
  sid: string;
  token: string;
}

export async function poll(cfg: BoundConfig): Promise<PollResponse> {
  const r = await fetch(
    `${trim(cfg.base)}/ext/poll?sid=${encodeURIComponent(cfg.sid)}&token=${encodeURIComponent(cfg.token)}`,
    { method: "GET", cache: "no-store" }
  );
  if (!r.ok) throw new Error(`poll ${r.status}`);
  return (await r.json()) as PollResponse;
}

export async function postResult(
  cfg: BoundConfig,
  seq: string,
  ok: boolean,
  data?: unknown,
  error?: string
): Promise<void> {
  await fetch(`${trim(cfg.base)}/ext/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sid: cfg.sid, token: cfg.token, seq, ok, data, error }),
  });
}

export async function sendChatMessage(
  cfg: BoundConfig,
  prompt: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const r = await fetch(`${trim(cfg.base)}/ext/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sid: cfg.sid, token: cfg.token, prompt }),
  });
  const body = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, body };
}
