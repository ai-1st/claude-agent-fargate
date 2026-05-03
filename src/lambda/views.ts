import type { Session, Message } from "../shared/types.js";
import { sessionId } from "../shared/types.js";

export function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — Claude Agent</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="bg-gray-50 text-gray-900">
  <main class="max-w-5xl mx-auto px-4 py-6">
    <nav class="mb-6"><a href="/" class="text-lg font-bold text-gray-900 hover:text-blue-600">Claude Agent</a></nav>
    ${body}
  </main>
</body>
</html>`;
}

export function renderLogin(error?: string): string {
  return renderPage("Login", `
    <h2 class="text-2xl font-semibold mb-4">Login</h2>
    ${error ? `<p class="text-red-700 mb-2">${esc(error)}</p>` : ""}
    <form method="POST" action="/login" class="space-y-3 max-w-sm">
      <label class="block">
        <span class="block text-sm font-medium mb-1">Password</span>
        <input type="password" name="password" required autofocus class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
      </label>
      <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Login</button>
    </form>
  `);
}

export function renderHome(sessions: Session[], projects: string[]): string {
  const projectOptions = projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  return renderPage("Home", `
    <h2 class="text-2xl font-semibold mb-4">New Session</h2>
    <form method="POST" action="/sessions" class="space-y-3 mb-8">
      <label class="block">
        <span class="block text-sm font-medium mb-1">Project</span>
        <select name="project" required class="w-full px-3 py-2 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">${projectOptions}</select>
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Prompt</span>
        <textarea name="prompt" rows="4" required class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
      </label>
      <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Start Session</button>
    </form>
    <h2 class="text-2xl font-semibold mb-4">Sessions</h2>
    ${renderSessionTable(sessions)}
  `);
}

export function renderSessionTable(sessions: Session[]): string {
  if (!sessions.length) return `<p class="text-gray-500">No sessions yet.</p>`;
  const rows = sessions
    .map((s) => {
      const id = sessionId(s.pk);
      return `<tr class="border-t border-gray-200">
        <td class="px-3 py-2"><a href="/sessions/${esc(id)}" class="text-blue-600 hover:underline">${esc(id.slice(0, 8))}</a></td>
        <td class="px-3 py-2">${esc(s.project)}</td>
        <td class="px-3 py-2">${statusBadge(s.status)}</td>
        <td class="px-3 py-2 text-sm text-gray-600">${esc(s.createdAt.replace("T", " ").slice(0, 19))}</td>
      </tr>`;
    })
    .join("");
  return `<div class="overflow-x-auto border border-gray-200 rounded">
    <table class="min-w-full bg-white">
      <thead class="bg-gray-100 text-left text-sm font-semibold">
        <tr><th class="px-3 py-2">ID</th><th class="px-3 py-2">Project</th><th class="px-3 py-2">Status</th><th class="px-3 py-2">Created</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function renderSessionDetail(
  session: Session,
  messages: Message[],
  liveLogs: Map<string, string> = new Map()
): string {
  const id = sessionId(session.pk);
  const hasRunning = messages.some((m) => m.status === "RUNNING");
  const pollAttr = hasRunning ? ` hx-get="/sessions/${esc(id)}/messages" hx-trigger="every 3s" hx-target="#messages"` : "";
  const disableFollow = hasRunning ? " disabled" : "";
  const disableCls = hasRunning ? " opacity-50 cursor-not-allowed" : "";
  return renderPage(`Session ${id.slice(0, 8)}`, `
    <h2 class="text-2xl font-semibold mb-2">Session ${esc(id.slice(0, 8))} ${statusBadge(session.status)}</h2>
    <p class="mb-4 text-sm text-gray-600">Project: <strong class="text-gray-900">${esc(session.project)}</strong> · Created: ${esc(session.createdAt.replace("T", " ").slice(0, 19))}</p>
    <div id="messages"${pollAttr} class="space-y-4">
      ${renderMessageList(messages, id, liveLogs)}
    </div>
    <form method="POST" action="/sessions/${esc(id)}/messages" class="mt-6 space-y-3">
      <label class="block">
        <span class="block text-sm font-medium mb-1">Follow-up</span>
        <textarea name="prompt" rows="3" required${disableFollow} class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500${disableCls}"></textarea>
      </label>
      <button type="submit"${disableFollow} class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700${disableCls}">Send</button>
    </form>
    <p class="mt-6"><a href="/" class="text-blue-600 hover:underline">← Back</a></p>
  `);
}

export function renderMessageList(
  messages: Message[],
  sessionIdStr: string,
  liveLogs: Map<string, string> = new Map()
): string {
  if (!messages.length) return `<p class="text-gray-500">No messages.</p>`;
  return messages
    .map((m) => {
      const sortKey = m.sk.replace("MSG#", "");
      const isRunning = m.status === "RUNNING";
      const log = liveLogs.get(m.sk);
      const logsUrl = `/sessions/${esc(sessionIdStr)}/messages/${esc(sortKey)}/logs`;
      const liveLogBlock = isRunning && m.taskArn
        ? `<pre class="mt-2 max-h-72 overflow-auto bg-gray-900 text-gray-100 text-xs font-mono p-3 rounded whitespace-pre-wrap">${esc(log ?? "(waiting for logs...)")}</pre>`
        : "";
      const detailsId = `logs-${esc(sessionIdStr)}-${sortKey}`;
      const completedLogBlock = !isRunning && m.taskArn
        ? `<details id="${detailsId}" hx-preserve="true" class="mt-2 group">
            <summary class="cursor-pointer text-sm text-blue-600 hover:underline select-none"
                     hx-get="${logsUrl}"
                     hx-target="next pre"
                     hx-trigger="click once"
                     hx-swap="innerHTML">Show logs</summary>
            <pre class="mt-2 max-h-96 overflow-auto bg-gray-900 text-gray-100 text-xs font-mono p-3 rounded whitespace-pre-wrap">loading...</pre>
          </details>`
        : "";
      return `<div class="border border-gray-200 rounded-lg p-4 bg-white">
        <div class="font-semibold mb-2 whitespace-pre-wrap">#${sortKey}: ${esc(m.prompt)}</div>
        ${isRunning ? `<p class="mb-2 flex items-center gap-2">${statusBadge("RUNNING")} <span class="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin"></span> Processing...</p>` : ""}
        ${m.result ? `<div class="whitespace-pre-wrap font-mono text-sm text-gray-800">${esc(m.result)}</div>` : ""}
        ${m.error ? `<div class="whitespace-pre-wrap text-red-700">Error: ${esc(m.error)}</div>` : ""}
        ${liveLogBlock}
        ${completedLogBlock}
        <small class="block mt-2 text-gray-500">${statusBadge(m.status)} · ${esc(m.createdAt.replace("T", " ").slice(0, 19))}</small>
      </div>`;
    })
    .join("");
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    RUNNING: "bg-yellow-100 text-yellow-800",
    COMPLETED: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
    IDLE: "bg-gray-200 text-gray-700",
  };
  const cls = map[status.toUpperCase()] ?? "bg-gray-200 text-gray-700";
  return `<span class="inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}">${status}</span>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
