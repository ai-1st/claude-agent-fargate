import type { SessionDetailResponse, SessionSummary } from "../../types.js";

export function sessionsFingerprint(sessions: SessionSummary[]): string {
  return sessions
    .map((s) => `${s.id}\t${s.status}\t${s.createdAt}\t${s.name ?? ""}\t${s.persona}`)
    .join("\n");
}

export function detailFingerprint(d: SessionDetailResponse): string {
  const s = d.session;
  const head = [
    s.status,
    s.submitResult ?? "",
    String(d.canSend),
    String(d.browserBound),
    s.inputUrl ?? "",
  ].join("\t");
  const msgs = d.messages
    .map((m) => [m.sk, m.status, m.kind ?? "", m.prompt, m.result ?? "", m.error ?? ""].join("\t"))
    .join("\n");
  return `${head}\n${msgs}`;
}
