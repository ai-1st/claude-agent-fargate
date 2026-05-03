import type { Session, Message, Persona, MemoryFile, Schedule } from "../shared/types.js";
import { sessionId } from "../shared/types.js";

export function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — Claw</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="bg-gray-50 text-gray-900">
  <main class="max-w-5xl mx-auto px-4 py-6">
    <nav class="mb-6 flex items-center gap-4">
      <a href="/" class="text-lg font-bold text-gray-900 hover:text-blue-600">Claw</a>
      <a href="/personas" class="text-sm text-gray-700 hover:text-blue-600">Personas</a>
      <a href="/" class="text-sm text-gray-700 hover:text-blue-600">Sessions</a>
    </nav>
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

export function renderHome(sessions: Session[], personas: string[]): string {
  const personaOptions = personas.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  return renderPage("Home", `
    <h2 class="text-2xl font-semibold mb-4">New Session</h2>
    <form method="POST" action="/sessions" class="space-y-3 mb-8">
      <label class="block">
        <span class="block text-sm font-medium mb-1">Persona</span>
        <select name="persona" required class="w-full px-3 py-2 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">${personaOptions}</select>
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
      const personaName = s.persona ?? (s as unknown as { project?: string }).project ?? "(unknown)";
      const created = (s.createdAt ?? "").replace("T", " ").slice(0, 19);
      return `<tr class="border-t border-gray-200">
        <td class="px-3 py-2"><a href="/sessions/${esc(id)}" class="text-blue-600 hover:underline">${esc(id.slice(0, 8))}</a></td>
        <td class="px-3 py-2">${esc(personaName)}</td>
        <td class="px-3 py-2">${statusBadge(s.status)}</td>
        <td class="px-3 py-2 text-sm text-gray-600">${esc(created)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="overflow-x-auto border border-gray-200 rounded">
    <table class="min-w-full bg-white">
      <thead class="bg-gray-100 text-left text-sm font-semibold">
        <tr><th class="px-3 py-2">ID</th><th class="px-3 py-2">Persona</th><th class="px-3 py-2">Status</th><th class="px-3 py-2">Created</th></tr>
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
  const personaName = session.persona ?? (session as unknown as { project?: string }).project ?? "(unknown)";
  const created = (session.createdAt ?? "").replace("T", " ").slice(0, 19);
  const hasRunning = messages.some((m) => m.status === "RUNNING");
  const pollAttr = hasRunning ? ` hx-get="/sessions/${esc(id)}/messages" hx-trigger="every 3s" hx-target="#messages"` : "";
  const disableFollow = hasRunning ? " disabled" : "";
  const disableCls = hasRunning ? " opacity-50 cursor-not-allowed" : "";
  return renderPage(`Session ${id.slice(0, 8)}`, `
    <h2 class="text-2xl font-semibold mb-2">Session ${esc(id.slice(0, 8))} ${statusBadge(session.status)}</h2>
    <p class="mb-4 text-sm text-gray-600">Persona: <a href="/personas/${esc(personaName)}" class="text-blue-600 hover:underline font-semibold">${esc(personaName)}</a> · Created: ${esc(created)} ${session.agentSessionId ? ` · agent=${esc(session.agentSessionId.slice(0, 8))}` : ""}</p>
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
      const sortKey = (m.sk ?? "").replace("MSG#", "");
      const isRunning = m.status === "RUNNING";
      const created = (m.createdAt ?? "").replace("T", " ").slice(0, 19);
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
      const kindBadge = m.kind === "heartbeat"
        ? `<span class="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800 mr-2">heartbeat</span>`
        : "";
      const blockId = `msg-${esc(sessionIdStr)}-${sortKey}`;
      const preserveAttr = !isRunning ? ` hx-preserve="true"` : "";
      return `<div id="${blockId}"${preserveAttr} class="border border-gray-200 rounded-lg p-4 bg-white">
        <div class="font-semibold mb-2 whitespace-pre-wrap">${kindBadge}#${sortKey}: ${esc(m.prompt)}</div>
        ${isRunning ? `<p class="mb-2 flex items-center gap-2">${statusBadge("RUNNING")} <span class="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin"></span> Processing...</p>` : ""}
        ${m.result ? `<div class="whitespace-pre-wrap font-mono text-sm text-gray-800">${esc(m.result)}</div>` : ""}
        ${m.error ? `<div class="whitespace-pre-wrap text-red-700">Error: ${esc(m.error)}</div>` : ""}
        ${liveLogBlock}
        ${completedLogBlock}
        <small class="block mt-2 text-gray-500">${statusBadge(m.status)} · ${esc(created)}</small>
      </div>`;
    })
    .join("");
}

// --- Personas ---

export function renderPersonaList(personas: Persona[]): string {
  const rows = personas.length
    ? personas.map((p) => `<tr class="border-t border-gray-200">
        <td class="px-3 py-2"><a href="/personas/${esc(p.name)}" class="text-blue-600 hover:underline font-semibold">${esc(p.name)}</a></td>
        <td class="px-3 py-2">${p.heartbeatCron ? `<code class="text-xs">${esc(p.heartbeatCron)}</code>` : `<span class="text-gray-400 text-xs">—</span>`}</td>
        <td class="px-3 py-2">${p.memoryEnabled !== false ? "yes" : "no"}</td>
        <td class="px-3 py-2 text-sm text-gray-600">${esc(p.updatedAt.replace("T", " ").slice(0, 19))}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="px-3 py-2 text-gray-500">No personas yet. Upload one with <code>scripts/upload-project.ts</code>.</td></tr>`;
  return renderPage("Personas", `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-semibold">Personas</h2>
    </div>
    <div class="overflow-x-auto border border-gray-200 rounded">
      <table class="min-w-full bg-white">
        <thead class="bg-gray-100 text-left text-sm font-semibold">
          <tr><th class="px-3 py-2">Name</th><th class="px-3 py-2">Heartbeat</th><th class="px-3 py-2">Memory</th><th class="px-3 py-2">Updated</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
}

export function renderPersonaForm(p?: Persona): string {
  return renderPage("Edit Persona", `
    <h2 class="text-2xl font-semibold mb-4">${p ? `Edit ${esc(p.name)}` : "Configure Persona"}</h2>
    <form method="POST" action="/personas" class="space-y-3 max-w-2xl">
      <label class="block">
        <span class="block text-sm font-medium mb-1">Name (must already exist via upload-project)</span>
        <input name="name" required value="${esc(p?.name ?? "")}" class="w-full px-3 py-2 border border-gray-300 rounded">
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">System Prompt (overrides CLAUDE.md)</span>
        <textarea name="systemPrompt" rows="6" class="w-full px-3 py-2 border border-gray-300 rounded font-mono text-sm">${esc(p?.systemPrompt ?? "")}</textarea>
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Allowed Tools (comma-separated; blank = default)</span>
        <input name="allowedTools" value="${esc((p?.allowedTools ?? []).join(", "))}" class="w-full px-3 py-2 border border-gray-300 rounded">
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" name="memoryEnabled" ${p?.memoryEnabled !== false ? "checked" : ""}>
        <span class="text-sm">Enable persistent memory</span>
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" name="mcpEnabled" ${p?.mcpEnabled ? "checked" : ""}>
        <span class="text-sm">Enable MCP servers from mcp.json</span>
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Heartbeat (cron expression, e.g. <code>cron(*/30 * * * ? *)</code> or <code>rate(30 minutes)</code>)</span>
        <input name="heartbeatCron" value="${esc(p?.heartbeatCron ?? "")}" placeholder="rate(30 minutes)" class="w-full px-3 py-2 border border-gray-300 rounded font-mono text-sm">
      </label>
      <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
    </form>
  `);
}

export function renderPersonaDetail(
  p: Persona,
  memory: MemoryFile[],
  schedules: Schedule[],
  skills: Array<{ name: string; description: string }>
): string {
  const memList = memory.length
    ? memory.map((m) => `<li><a href="/personas/${esc(p.name)}/memory/${esc(m.path)}" class="text-blue-600 hover:underline font-mono text-sm">${esc(m.path)}</a> <span class="text-gray-500 text-xs">(${m.size} bytes)</span></li>`).join("")
    : `<li class="text-gray-500">No memory files yet.</li>`;

  const schedList = schedules.length
    ? schedules.map((s) => `<tr class="border-t border-gray-200">
        <td class="px-3 py-2 font-mono text-xs">${esc(s.id)}</td>
        <td class="px-3 py-2 font-mono text-xs">${esc(s.cron)}</td>
        <td class="px-3 py-2 text-sm">${esc(s.prompt.slice(0, 80))}${s.prompt.length > 80 ? "…" : ""}</td>
        <td class="px-3 py-2 text-xs text-gray-500">${esc(s.lastRun ?? "—")}</td>
        <td class="px-3 py-2"><form method="POST" action="/personas/${esc(p.name)}/schedules/${esc(s.id)}/delete" onsubmit="return confirm('Delete schedule?')"><button class="text-red-600 hover:underline text-xs">delete</button></form></td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="px-3 py-2 text-gray-500">No scheduled tasks.</td></tr>`;

  const skillList = skills.length
    ? skills.map((s) => `<li><span class="font-mono text-sm">${esc(s.name)}</span> — <span class="text-gray-600 text-sm">${esc(s.description)}</span></li>`).join("")
    : `<li class="text-gray-500 text-sm">Skills are auto-loaded from the project tarball via <code>settingSources:["project"]</code>. No skill index in DB yet.</li>`;

  return renderPage(p.name, `
    <h2 class="text-2xl font-semibold mb-2">${esc(p.name)}</h2>
    <p class="text-sm text-gray-600 mb-6">s3://${esc(p.s3Key)} · updated ${esc(p.updatedAt.replace("T", " ").slice(0, 19))}</p>

    <section class="mb-8">
      <h3 class="text-lg font-semibold mb-2">Configuration</h3>
      <div class="bg-white border border-gray-200 rounded p-4 text-sm space-y-1">
        <div><strong>Memory:</strong> ${p.memoryEnabled !== false ? "enabled" : "disabled"}</div>
        <div><strong>MCP:</strong> ${p.mcpEnabled ? "enabled" : "disabled"}</div>
        <div><strong>Heartbeat:</strong> ${p.heartbeatCron ? `<code>${esc(p.heartbeatCron)}</code>` : "off"}</div>
        <div><strong>Allowed tools:</strong> <code>${esc((p.allowedTools ?? []).join(", ") || "(default)")}</code></div>
        ${p.systemPrompt ? `<details class="mt-2"><summary class="cursor-pointer text-blue-600">System prompt override</summary><pre class="mt-2 bg-gray-50 p-2 rounded whitespace-pre-wrap font-mono text-xs">${esc(p.systemPrompt)}</pre></details>` : ""}
      </div>
      <p class="mt-2"><a href="/personas/new" class="text-blue-600 hover:underline text-sm">Edit configuration →</a></p>
    </section>

    <section class="mb-8">
      <h3 class="text-lg font-semibold mb-2">Skills</h3>
      <ul class="list-disc list-inside bg-white border border-gray-200 rounded p-4 space-y-1">${skillList}</ul>
    </section>

    <section class="mb-8">
      <h3 class="text-lg font-semibold mb-2">Memory</h3>
      <ul class="list-disc list-inside bg-white border border-gray-200 rounded p-4 space-y-1">${memList}</ul>
    </section>

    <section class="mb-8">
      <h3 class="text-lg font-semibold mb-2">Scheduled Tasks</h3>
      <div class="overflow-x-auto border border-gray-200 rounded mb-3">
        <table class="min-w-full bg-white">
          <thead class="bg-gray-100 text-left text-sm font-semibold">
            <tr><th class="px-3 py-2">ID</th><th class="px-3 py-2">Cron</th><th class="px-3 py-2">Prompt</th><th class="px-3 py-2">Last run</th><th class="px-3 py-2"></th></tr>
          </thead>
          <tbody>${schedList}</tbody>
        </table>
      </div>
      <form method="POST" action="/personas/${esc(p.name)}/schedules" class="space-y-2 bg-white border border-gray-200 rounded p-4">
        <h4 class="font-semibold text-sm">Add Schedule</h4>
        <input name="cron" required placeholder="rate(1 hour)  or  cron(0 9 * * ? *)" class="w-full px-3 py-2 border border-gray-300 rounded font-mono text-sm">
        <textarea name="prompt" rows="2" required placeholder="What should the agent do on each tick?" class="w-full px-3 py-2 border border-gray-300 rounded text-sm"></textarea>
        <button type="submit" class="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">Add</button>
      </form>
    </section>
  `);
}

export function renderMemoryFile(persona: string, path: string, content: string): string {
  return renderPage(`${persona}/${path}`, `
    <p class="mb-2 text-sm"><a href="/personas/${esc(persona)}" class="text-blue-600 hover:underline">← ${esc(persona)}</a></p>
    <h2 class="text-xl font-semibold mb-3 font-mono">${esc(path)}</h2>
    <pre class="bg-white border border-gray-200 rounded p-4 whitespace-pre-wrap font-mono text-sm">${esc(content)}</pre>
  `);
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

function esc(s: string | undefined | null): string {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
