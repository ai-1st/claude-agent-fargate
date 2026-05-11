import type { PollResponse } from "./types.js";

export interface BoundConfig {
  base: string;
  sid: string;
  token: string;
}

function trim(url: string): string {
  return url.replace(/\/+$/, "");
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
