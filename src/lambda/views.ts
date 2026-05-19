import type { Session, Message, Persona, MemoryFile, Schedule, Template } from "../shared/types.js";
import { sessionId } from "../shared/types.js";

function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — CloudClaw</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,${encodeURIComponent(faviconSvg())}">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    .clawmark { display:inline-block; vertical-align:-3px; }
  </style>
</head>
<body class="bg-gradient-to-b from-gray-50 to-gray-100 text-gray-900 min-h-screen">
  <main class="max-w-5xl mx-auto px-4 py-6">
    <nav class="mb-6 flex items-center gap-5 pb-3 border-b border-gray-200">
      <a href="/" class="flex items-center gap-2 text-lg font-bold text-gray-900 hover:text-blue-600">
        ${clawLogo()}
        <span>CloudClaw</span>
      </a>
      <a href="/personas" class="text-sm text-gray-700 hover:text-blue-600">Personas</a>
      <a href="/" class="text-sm text-gray-700 hover:text-blue-600">Sessions</a>
      <a href="/inbox" class="text-sm text-gray-700 hover:text-blue-600">Inbox</a>
    </nav>
    ${body}
  </main>
</body>
</html>`;
}

function clawLogo(): string {
  return `<svg class="clawmark" width="26" height="26" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="claw-grad" x1="4" y1="32" x2="28" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#1e88e5"/>
        <stop offset="1" stop-color="#7c3aed"/>
      </linearGradient>
    </defs>
    <path d="M9 28 C 6 22, 6 16, 8 9 L 11 8 C 11 14, 11 20, 13 27 Z" fill="url(#claw-grad)"/>
    <path d="M16 29 C 14 22, 14 15, 17 7 L 20 6.5 C 19 13, 19 21, 20 28 Z" fill="url(#claw-grad)"/>
    <path d="M23 28 C 22 21, 23 14, 27 7 L 30 7 C 28 13, 27 20, 27 27 Z" fill="url(#claw-grad)"/>
  </svg>`;
}

function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#ffffff"/><path d="M9 28 C 6 22,6 16,8 9 L 11 8 C 11 14,11 20,13 27 Z" fill="#1e88e5"/><path d="M16 29 C 14 22,14 15,17 7 L 20 6.5 C 19 13,19 21,20 28 Z" fill="#5e35b5"/><path d="M23 28 C 22 21,23 14,27 7 L 30 7 C 28 13,27 20,27 27 Z" fill="#7c3aed"/></svg>`;
}

export function renderLogin(error?: string): string {
  return renderPage("Login", `
    <div class="max-w-md mx-auto mt-12">
      <div class="flex flex-col items-center mb-6">
        ${heroLogo()}
        <h2 class="text-2xl font-semibold mt-3">CloudClaw</h2>
        <p class="text-gray-500 text-sm">Personal AI agent platform</p>
      </div>
      ${error ? `<p class="text-red-700 mb-2 text-sm">${esc(error)}</p>` : ""}
      <form method="POST" action="/login" class="space-y-3 bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <label class="block">
          <span class="block text-sm font-medium mb-1">Password</span>
          <input type="password" name="password" required autofocus class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
        </label>
        <button type="submit" class="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Login</button>
      </form>
    </div>
  `);
}

function heroLogo(): string {
  return `<svg width="96" height="96" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="hero-grad" x1="4" y1="32" x2="28" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#1e88e5"/>
        <stop offset="0.5" stop-color="#5e35b5"/>
        <stop offset="1" stop-color="#7c3aed"/>
      </linearGradient>
    </defs>
    <path d="M9 28 C 6 22, 6 16, 8 9 L 11 8 C 11 14, 11 20, 13 27 Z" fill="url(#hero-grad)"/>
    <path d="M16 29 C 14 22, 14 15, 17 7 L 20 6.5 C 19 13, 19 21, 20 28 Z" fill="url(#hero-grad)"/>
    <path d="M23 28 C 22 21, 23 14, 27 7 L 30 7 C 28 13, 27 20, 27 27 Z" fill="url(#hero-grad)"/>
  </svg>`;
}

function emptySessionsSvg(): string {
  return `<svg width="120" height="90" viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" class="mx-auto" aria-hidden="true">
    <rect x="30" y="30" width="140" height="80" rx="8" fill="#eff6ff" stroke="#1e88e5" stroke-width="2"/>
    <line x1="30" y1="50" x2="170" y2="50" stroke="#1e88e5" stroke-width="2"/>
    <circle cx="42" cy="40" r="2.5" fill="#1e88e5"/>
    <circle cx="50" cy="40" r="2.5" fill="#1e88e5"/>
    <circle cx="58" cy="40" r="2.5" fill="#1e88e5"/>
    <line x1="50" y1="68" x2="120" y2="68" stroke="#93c5fd" stroke-width="3" stroke-linecap="round"/>
    <line x1="50" y1="80" x2="150" y2="80" stroke="#93c5fd" stroke-width="3" stroke-linecap="round"/>
    <line x1="50" y1="92" x2="100" y2="92" stroke="#93c5fd" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

function emptyInboxSvg(): string {
  return `<svg width="120" height="100" viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg" class="mx-auto" aria-hidden="true">
    <circle cx="100" cy="80" r="58" fill="#ecfdf5" stroke="#10b981" stroke-width="2" stroke-dasharray="3 4"/>
    <path d="M75 82 L92 100 L128 60" stroke="#10b981" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="40" cy="35" r="3" fill="#10b981" opacity="0.5"/>
    <circle cx="170" cy="50" r="2.5" fill="#7c3aed" opacity="0.5"/>
    <circle cx="160" cy="125" r="3" fill="#1e88e5" opacity="0.5"/>
    <circle cx="35" cy="120" r="2.5" fill="#fbc02d" opacity="0.5"/>
  </svg>`;
}

const DEFAULT_RESULT_SCHEMA_JSON = `{
  "type": "object"
}`;

export function renderHome(sessions: Session[], personas: Persona[]): string {
  const personaOptions = personas
    .map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`)
    .join("");
  return renderPage(
    "Home",
    `
    <h2 class="text-2xl font-semibold mb-4">New Session</h2>
    <form method="POST" action="/sessions" class="space-y-3 mb-8 bg-white border border-gray-200 rounded p-4">
      <label class="block">
        <span class="block text-sm font-medium mb-1">Persona</span>
        <select name="persona" required class="w-full px-3 py-2 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">${personaOptions}</select>
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Name</span>
        <input name="name" required placeholder="Descriptive session name (shown in lists and inbox)" class="w-full px-3 py-2 border border-gray-300 rounded text-sm">
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">First message</span>
        <textarea name="prompt" rows="4" required placeholder="What should the agent do? (or, if 'first author = agent', what does the agent say to start the session)" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
      </label>
      <fieldset class="space-y-1">
        <legend class="text-sm font-medium mb-1">First message author</legend>
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="firstMessageAuthor" value="user" checked> user (agent runs immediately)
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="firstMessageAuthor" value="agent"> agent (session opens with this assistant message; waits for human reply before running)
        </label>
      </fieldset>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Input URL <span class="text-xs text-gray-500">(optional; used by 'Open in Extension' to load a starting page)</span></span>
        <input name="inputUrl" placeholder="https://..." class="w-full px-3 py-2 border border-gray-300 rounded text-sm">
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Result schema (JSON Schema)</span>
        <textarea name="resultSchema" rows="4" class="w-full px-3 py-2 border border-gray-300 rounded font-mono text-xs">${esc(DEFAULT_RESULT_SCHEMA_JSON)}</textarea>
        <span class="text-xs text-gray-500">The agent's <code>submit_result</code> payload is validated against this schema. Default <code>{"type":"object"}</code> accepts any object.</span>
      </label>
      <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Start Session</button>
    </form>
    <h2 class="text-2xl font-semibold mb-4">Sessions</h2>
    ${renderSessionTable(sessions)}
  `);
}

export function renderSessionTable(sessions: Session[]): string {
  if (!sessions.length) {
    return `<div class="bg-white border border-gray-200 rounded-lg p-8 text-center">
      ${emptySessionsSvg()}
      <p class="mt-3 text-gray-700 font-medium">No sessions yet.</p>
      <p class="text-sm text-gray-500">Start one above by picking a persona and writing a prompt.</p>
    </div>`;
  }
  const rows = sessions
    .map((s) => {
      const id = sessionId(s.pk);
      const personaName = s.persona ?? "(unknown)";
      const created = (s.createdAt ?? "").replace("T", " ").slice(0, 19);
      return `<tr class="border-t border-gray-200">
        <td class="px-3 py-2"><a href="/sessions/${esc(id)}" class="text-blue-600 hover:underline">${esc(id.slice(0, 8))}</a></td>
        <td class="px-3 py-2 text-sm">${esc(s.name ?? "")}</td>
        <td class="px-3 py-2">${esc(personaName)}</td>
        <td class="px-3 py-2">${statusBadge(s.status)}</td>
        <td class="px-3 py-2 text-sm text-gray-600">${esc(created)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="overflow-x-auto border border-gray-200 rounded">
    <table class="min-w-full bg-white">
      <thead class="bg-gray-100 text-left text-sm font-semibold">
        <tr><th class="px-3 py-2">ID</th><th class="px-3 py-2">Name</th><th class="px-3 py-2">Persona</th><th class="px-3 py-2">Status</th><th class="px-3 py-2">Created</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function renderSessionDetail(
  session: Session,
  messages: Message[]): string {
  const id = sessionId(session.pk);
  const personaName = session.persona ?? "(unknown)";
  const created = (session.createdAt ?? "").replace("T", " ").slice(0, 19);
  const hasRunning = messages.some((m) => m.status === "RUNNING");
  const isSleeping = session.status === "SLEEPING";
  const terminal = session.status === "COMPLETED" || session.status === "FAILED";
  const pollAttr = hasRunning || isSleeping ? ` hx-get="/sessions/${esc(id)}/messages" hx-trigger="every 3s" hx-target="#messages"` : "";
  const sleepBanner = isSleeping
    ? `<div class="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded text-sm">Sleeping until <code>${esc(session.wakeAt ?? "?")}</code> — the worker Lambda will be re-invoked by EventBridge Scheduler at that time.</div>`
    : "";
  const schemaJson = safePrettyJson(JSON.stringify(session.resultSchema ?? {}));
  const submit = session.submitResult ? safePrettyJson(session.submitResult) : undefined;
  const submitBlock = submit
    ? `<details class="mb-4 bg-white border border-gray-200 rounded p-3" open>
        <summary class="cursor-pointer text-sm font-medium">Result <span class="text-xs text-gray-500">(${esc(session.status)})</span></summary>
        <pre class="mt-2 text-xs whitespace-pre-wrap font-mono">${esc(submit)}</pre>
      </details>`
    : "";
  const inputUrlLine = session.inputUrl
    ? `<div class="mb-3 text-sm">Input URL: <a href="${esc(session.inputUrl)}" target="_blank" rel="noopener" class="text-blue-600 hover:underline break-all">${esc(session.inputUrl)}</a></div>`
    : "";
  const openExtBtn = !terminal && process.env.EXT_CHROME_ID !== undefined
    ? `<form method="POST" action="/sessions/${esc(id)}/bind-ext" class="inline-block">
        <button class="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">Open in Extension</button>
      </form>`
    : !terminal
      ? `<form method="POST" action="/sessions/${esc(id)}/bind-ext" class="inline-block">
          <button class="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">Open in Extension</button>
        </form>`
      : "";
  return renderPage(
    `Session ${id.slice(0, 8)}`,
    `
    <h2 class="text-2xl font-semibold mb-2">${esc(session.name ?? `Session ${id.slice(0, 8)}`)} <span id="status-badge">${statusBadge(session.status)}</span></h2>
    <p class="mb-3 text-sm text-gray-600">${esc(id.slice(0, 8))} · Persona: <a href="/personas/${esc(personaName)}" class="text-blue-600 hover:underline font-semibold">${esc(personaName)}</a> · ${esc(created)}${session.callerPersona ? ` · asked by <code>${esc(session.callerPersona)}</code>` : ""} · firstAuthor=${esc(session.firstMessageAuthor)}</p>
    ${inputUrlLine}
    <div class="mb-4 flex gap-2 items-center">${openExtBtn}${session.extToken ? `<span class="text-xs text-gray-500">extension bound · last seen ${esc((session.extTokenLastSeenAt ?? "—").replace("T", " ").slice(0, 19))}</span>` : ""}</div>
    ${submitBlock}
    <details class="mb-4 bg-white border border-gray-200 rounded p-3">
      <summary class="cursor-pointer text-sm font-medium">Result schema (JSON Schema)</summary>
      <pre class="mt-2 text-xs whitespace-pre-wrap font-mono">${esc(schemaJson)}</pre>
    </details>
    ${sleepBanner}
    <div id="messages"${pollAttr} class="space-y-3 bg-gray-50 border border-gray-200 rounded p-4">
      ${renderMessageList(messages, id)}
    </div>
    ${composerForm(session, personaName, hasRunning, false)}
    <p class="mt-6"><a href="/" class="text-blue-600 hover:underline">← Back</a></p>
  `
  );
}

export function composerForm(
  session: Session,
  personaName: string,
  hasRunning: boolean,
  oob: boolean
): string {
  const id = sessionId(session.pk);
  const terminal = session.status === "COMPLETED" || session.status === "FAILED";
  const disabled = hasRunning || terminal;
  const disableAttr = disabled ? " disabled" : "";
  const disableCls = disabled ? " opacity-50 cursor-not-allowed" : "";
  const placeholder = hasRunning
    ? "Agent is working — wait for it to finish."
    : terminal
      ? "Session is closed."
      : `Reply to ${personaName}…  (Cmd/Ctrl+Enter to send)`;
  return `<form id="composer"${oob ? ' hx-swap-oob="true"' : ""} method="POST" action="/sessions/${esc(id)}/messages" class="mt-4 flex gap-2 items-start"
          onkeydown="if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();this.requestSubmit();}">
      <textarea name="prompt" rows="2" required${disableAttr} placeholder="${esc(placeholder)}"
                class="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500${disableCls}"></textarea>
      <button type="submit"${disableAttr} class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700${disableCls}">Send</button>
    </form>`;
}

export function renderMessageListWithOob(
  session: Session,
  messages: Message[]
): string {
  const id = sessionId(session.pk);
  const personaName = session.persona ?? "(unknown)";
  const hasRunning = messages.some((m) => m.status === "RUNNING");
  const messagesHtml = renderMessageList(messages, id);
  const badgeOob = `<span id="status-badge" hx-swap-oob="true">${statusBadge(session.status)}</span>`;
  const composerOob = composerForm(session, personaName, hasRunning, true);
  return `${messagesHtml}\n${badgeOob}\n${composerOob}`;
}

export function renderMessageList(
  messages: Message[],
  sessionIdStr: string
): string {
  if (!messages.length) return `<p class="text-gray-500 italic text-sm">No messages.</p>`;
  return messages.map((m) => renderTurnBubbles(m, sessionIdStr)).join("");
}

function renderTurnBubbles(
  m: Message,
  sessionIdStr: string
): string {
  const sortKey = (m.sk ?? "").replace("MSG#", "");
  const kind = m.kind ?? "user";
  const isRunning = m.status === "RUNNING";
  const created = (m.createdAt ?? "").replace("T", " ").slice(0, 19);
  const blockId = `msg-${esc(sessionIdStr)}-${sortKey}`;

  const isAssistantOnly = kind === "assistant";
  const userBubbleCls =
    kind === "heartbeat"
      ? "bg-purple-100 border border-purple-300 text-purple-900"
      : "bg-blue-600 text-white";
  const userLabel = kind === "heartbeat" ? "heartbeat" : "you";

  const userBubble = !isAssistantOnly
    ? `<div class="flex flex-col items-end">
        <div class="text-[10px] uppercase tracking-wide text-gray-500 mb-1 mr-1">#${sortKey} · ${esc(userLabel)}</div>
        <div class="max-w-[80%] ${userBubbleCls} rounded-2xl rounded-tr-sm px-4 py-2 whitespace-pre-wrap text-sm">${esc(m.prompt ?? "")}</div>
      </div>`
    : "";

  const replyText = isAssistantOnly ? (m.prompt ?? "") : (m.result ?? "");
  const replyBubble = replyText
    ? `<div class="flex flex-col items-start">
        <div class="text-[10px] uppercase tracking-wide text-gray-500 mb-1 ml-1">agent</div>
        <div class="max-w-[80%] bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-2 whitespace-pre-wrap text-sm text-gray-800">${esc(replyText)}</div>
      </div>`
    : "";

  const restarts = m.restartCount ?? 0;
  const reinvokes = restarts > 1 ? restarts - 1 : 0;
  const reinvokeForm = isRunning
    ? `<form method="POST" action="/sessions/${esc(sessionIdStr)}/messages/${esc(sortKey)}/restart" class="ml-2 inline">
        <button class="text-xs text-blue-600 hover:underline" title="Re-invoke the worker Lambda for this message (use if it appears stuck or you suspect a crash)">re-invoke</button>
      </form>`
    : "";

  const runningIndicator = isRunning
    ? `<div class="flex flex-col items-start w-full">
        <div class="text-[10px] uppercase tracking-wide text-gray-500 mb-1 ml-1 flex items-center gap-2">
          <span class="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin shrink-0"></span>
          <span>agent${reinvokes > 0 ? ` <span class="text-gray-400">(invoke ${restarts})</span>` : ""}</span>
          ${reinvokeForm}
        </div>
      </div>`
    : "";

  const errorBubble = m.error
    ? `<div class="flex flex-col items-start">
        <div class="text-[10px] uppercase tracking-wide text-red-600 mb-1 ml-1">error</div>
        <div class="max-w-[80%] bg-red-50 border border-red-200 text-red-800 rounded-2xl rounded-tl-sm px-4 py-2 whitespace-pre-wrap text-sm">${esc(m.error)}</div>
      </div>`
    : "";

  return `<div id="${blockId}" class="space-y-2" data-created="${esc(created)}">
    ${userBubble}
    ${runningIndicator}
    ${replyBubble}
    ${errorBubble}
  </div>`;
}

// --- Personas ---

export function renderPersonaList(personas: Persona[]): string {
  const rows = personas.length
    ? personas.map((p) => {
        const hasProject = !!p.s3Key;
        return `<tr class="border-t border-gray-200">
        <td class="px-3 py-2"><a href="/personas/${esc(p.name)}" class="text-blue-600 hover:underline font-semibold">${esc(p.name)}</a>${!hasProject ? ` <span class="ml-1 text-xs text-amber-700" title="Project files not synced to S3 yet — run scripts/upload-project.ts.">no project</span>` : ""}</td>
        <td class="px-3 py-2 text-sm text-gray-700">${esc((p.description ?? "").slice(0, 80))}</td>
        <td class="px-3 py-2">${p.heartbeatCron ? `<code class="text-xs">${esc(p.heartbeatCron)}</code>` : `<span class="text-gray-400 text-xs">—</span>`}</td>
        <td class="px-3 py-2 text-sm text-gray-600">${esc(p.updatedAt.replace("T", " ").slice(0, 19))}</td>
      </tr>`;
      }).join("")
    : `<tr><td colspan="4" class="px-3 py-2 text-gray-500">No personas yet. Create one below, or upload a project with <code>scripts/upload-project.ts</code>.</td></tr>`;
  return renderPage("Personas", `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-semibold">Personas</h2>
      <a href="/personas/new" class="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">+ New persona</a>
    </div>
    <div class="overflow-x-auto border border-gray-200 rounded">
      <table class="min-w-full bg-white">
        <thead class="bg-gray-100 text-left text-sm font-semibold">
          <tr><th class="px-3 py-2">Name</th><th class="px-3 py-2">Description</th><th class="px-3 py-2">Heartbeat</th><th class="px-3 py-2">Updated</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
  );
}

export function renderPersonaCreateForm(
  opts: { templates?: Template[]; error?: string } = {}): string {
  const { templates = [], error } = opts;
  const templateOptions = [
    `<option value="">— pick a template —</option>`,
    ...templates.map((t) => {
      const label = `${t.name}${t.description ? ` — ${t.description}` : ""}`;
      const descAttr = t.description ? ` data-description="${esc(t.description)}"` : "";
      return `<option value="${esc(t.name)}"${descAttr}>${esc(label)}</option>`;
    }),
  ].join("");

  return renderPage("New persona", `
    <h2 class="text-2xl font-semibold mb-4">New persona</h2>
    ${error ? `<p class="text-red-700 mb-3">${esc(error)}</p>` : ""}
    <form method="POST" action="/personas" class="space-y-4 max-w-2xl bg-white border border-gray-200 rounded p-4">
      <input type="hidden" name="mode" value="create">
      <label class="block">
        <span class="block text-sm font-medium mb-1">Name</span>
        <input name="name" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,40}" placeholder="my-persona" class="w-full px-3 py-2 border border-gray-300 rounded font-mono">
        <span class="text-xs text-gray-500">letters, digits, hyphens, underscores; max 41 chars.</span>
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Template</span>
        <select id="template" name="template" required class="w-full px-3 py-2 border border-gray-300 rounded bg-white">
          ${templateOptions}
        </select>
        <span class="text-xs text-gray-500">Templates are synced from <code>./projects/</code> during <code>make deploy</code>. Picking a template pre-fills description, and copies its project files into this persona's S3 prefix on creation.</span>
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Description (for discovery)</span>
        <input id="description" name="description" placeholder="One-liner that other personas will see when delegating" class="w-full px-3 py-2 border border-gray-300 rounded">
      </label>
      <div class="flex gap-2">
        <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Create</button>
        <a href="/personas" class="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50">Cancel</a>
      </div>
    </form>
    <script>
      (function() {
        var t = document.getElementById("template");
        var d = document.getElementById("description");
        t.addEventListener("change", function() {
          var opt = t.selectedOptions[0];
          if (!opt) return;
          var dd = opt.getAttribute("data-description");
          if (dd && !d.value) d.value = dd;
        });
      })();
    </script>
  `
  );
}

export function renderPersonaForm(p: Persona | undefined): string {
  return renderPage(
    "Edit Persona",
    `
    <h2 class="text-2xl font-semibold mb-4">${p ? `Edit ${esc(p.name)}` : "Configure Persona"}</h2>
    <form method="POST" action="/personas" class="space-y-3 max-w-2xl">
      <input type="hidden" name="mode" value="update">
      <label class="block">
        <span class="block text-sm font-medium mb-1">Name</span>
        <input name="name" required readonly value="${esc(p?.name ?? "")}" class="w-full px-3 py-2 border border-gray-300 rounded bg-gray-50">
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Description</span>
        <input name="description" value="${esc(p?.description ?? "")}" placeholder="One-liner for discovery" class="w-full px-3 py-2 border border-gray-300 rounded">
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
  `
  );
}

export function renderPersonaDetail(
  p: Persona,
  memory: MemoryFile[],
  schedules: Schedule[],
  skills: Array<{ name: string; description: string }>,
  sessions: Session[] = [],
  templates: Template[] = []): string {
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
    : `<li class="text-gray-500 text-sm">Skills are auto-loaded from the project files via <code>settingSources:["project"]</code>. No skill index in DB yet.</li>`;

  let sessionsSection = "";
  if (sessions.length) {
    sessionsSection = `
    <section class="mb-8">
      <h3 class="text-lg font-semibold mb-2">Recent sessions</h3>
      ${renderSessionTable(sessions.slice(0, 20))}
    </section>`;
  }

  let startSessionSection = "";
  if (p.s3Key) {
    startSessionSection = `
    <section class="mb-8">
      <h3 class="text-lg font-semibold mb-2">Start a session</h3>
      <form method="POST" action="/sessions" class="space-y-3 bg-white border border-gray-200 rounded p-4">
        <input type="hidden" name="persona" value="${esc(p.name)}">
        <input name="name" required placeholder="Session name" class="w-full px-3 py-2 border border-gray-300 rounded text-sm">
        <textarea name="prompt" rows="3" required placeholder="First message" class="w-full px-3 py-2 border border-gray-300 rounded text-sm"></textarea>
        <fieldset class="flex items-center gap-4 text-sm">
          <label class="flex items-center gap-2"><input type="radio" name="firstMessageAuthor" value="user" checked> user</label>
          <label class="flex items-center gap-2"><input type="radio" name="firstMessageAuthor" value="agent"> agent</label>
        </fieldset>
        <input name="inputUrl" placeholder="Input URL (optional)" class="w-full px-3 py-2 border border-gray-300 rounded text-sm">
        <textarea name="resultSchema" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded font-mono text-xs">${esc(DEFAULT_RESULT_SCHEMA_JSON)}</textarea>
        <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">Start session</button>
      </form>
    </section>`;
  }

  const needsProject = !p.s3Key;
  const projectWarning = needsProject
    ? `<div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
        <strong>No project files yet.</strong> Pick a template below, or run
        <code>npx tsx scripts/upload-project.ts --name ${esc(p.name)} --dir ./projects/${esc(p.name)}</code>.
      </div>`
    : "";

  const currentTmpl = p.templateName ? templates.find((t) => t.name === p.templateName) : undefined;
  const stale = !!(currentTmpl && p.templateSha && currentTmpl.sha256 && p.templateSha !== currentTmpl.sha256);
  const otherTemplates = templates.filter((t) => t.name !== p.templateName);
  const currentLine = p.templateName
    ? `<div><strong>Current template:</strong> <code>${esc(p.templateName)}</code>${
        p.templateAppliedAt ? ` · applied ${esc(p.templateAppliedAt.replace("T", " ").slice(0, 19))}` : ""
      }${stale ? ` · <span class="text-amber-700 font-semibold">out of date</span>` : ""}</div>`
    : `<div class="text-gray-600">Not linked to any template.</div>`;
  const reprovForm = p.templateName
    ? `<form method="POST" action="/personas/${esc(p.name)}/reprovision" onsubmit="return confirm('Re-apply template ${esc(p.templateName)}? Memory stays intact; project files (CLAUDE.md, skills, mcp.json) get overwritten.')">
        <button class="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">${stale ? "Update from template" : "Re-apply template"}</button>
      </form>`
    : "";
  const switchForm = templates.length
    ? `<form method="POST" action="/personas/${esc(p.name)}/switch-template" class="flex items-center gap-2" onsubmit="return confirm('Switch template? Memory stays intact; project files are replaced.')">
        <select name="template" class="px-2 py-1 border border-gray-300 rounded text-sm">
          ${otherTemplates
            .map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`)
            .join("")}
        </select>
        <button class="px-3 py-1.5 border border-blue-600 text-blue-600 rounded text-sm hover:bg-blue-50">Switch template</button>
      </form>`
    : "";
  const templateSection = `
    <section class="mb-8">
      <h3 class="text-lg font-semibold mb-2">Template</h3>
      <div class="bg-white border border-gray-200 rounded p-4 text-sm space-y-3">
        ${currentLine}
        <div class="flex flex-wrap gap-3 items-center">${reprovForm} ${switchForm}</div>
        <div class="text-xs text-gray-500">Memory under <code>memory/${esc(p.name)}/</code> is never touched by template updates. Only <code>CLAUDE.md</code>, <code>persona.json</code>, <code>skills/</code>, and <code>mcp.json</code> get overwritten.</div>
      </div>
    </section>`;

  return renderPage(p.name, `
    <h2 class="text-2xl font-semibold mb-2">${esc(p.name)}</h2>
    ${p.description ? `<p class="text-gray-700 mb-2">${esc(p.description)}</p>` : ""}
    <p class="text-sm text-gray-600 mb-6">${p.s3Key ? `s3://${esc(p.s3Key)} · ` : ""}updated ${esc(p.updatedAt.replace("T", " ").slice(0, 19))}</p>
    ${projectWarning}

    ${templateSection}

    <section class="mb-8">
      <h3 class="text-lg font-semibold mb-2">Configuration</h3>
      <div class="bg-white border border-gray-200 rounded p-4 text-sm space-y-1">
        <div><strong>Memory:</strong> ${p.memoryEnabled !== false ? "enabled" : "disabled"}</div>
        <div><strong>MCP:</strong> ${p.mcpEnabled ? "enabled" : "disabled"}</div>
        <div><strong>Heartbeat:</strong> ${p.heartbeatCron ? `<code>${esc(p.heartbeatCron)}</code>` : "off"}</div>
        <div><strong>Allowed tools:</strong> <code>${esc((p.allowedTools ?? []).join(", ") || "(default)")}</code></div>
        ${(p.actions ?? []).length ? `<div><strong>Declared actions:</strong> <code>${esc((p.actions ?? []).join(", "))}</code></div>` : ""}
        ${p.systemPrompt ? `<details class="mt-2"><summary class="cursor-pointer text-blue-600">System prompt override</summary><pre class="mt-2 bg-gray-50 p-2 rounded whitespace-pre-wrap font-mono text-xs">${esc(p.systemPrompt)}</pre></details>` : ""}
      </div>
      <p class="mt-2"><a href="/personas/${esc(p.name)}/edit" class="text-blue-600 hover:underline text-sm">Edit configuration →</a></p>
    </section>

    ${startSessionSection}
    ${sessionsSection}

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
  `
  );
}

export function renderMemoryFile(
  persona: string,
  path: string,
  content: string): string {
  return renderPage(
    `${persona}/${path}`,
    `
    <p class="mb-2 text-sm"><a href="/personas/${esc(persona)}" class="text-blue-600 hover:underline">← ${esc(persona)}</a></p>
    <h2 class="text-xl font-semibold mb-3 font-mono">${esc(path)}</h2>
    <pre class="bg-white border border-gray-200 rounded p-4 whitespace-pre-wrap font-mono text-sm">${esc(content)}</pre>
  `
  );
}

// --- Inbox ---

export function renderInboxList(
  pending: Session[],
  personas: Map<string, Persona>): string {
  if (!pending.length) {
    return renderPage(
      "Inbox",
      `
      <h2 class="text-2xl font-semibold mb-4">Inbox</h2>
      <div class="bg-white border border-gray-200 rounded-lg p-10 text-center">
        ${emptyInboxSvg()}
        <p class="mt-4 text-gray-700 font-medium">All caught up.</p>
        <p class="text-sm text-gray-500">Sessions waiting on a human reply appear here.</p>
      </div>
    `
    );
  }
  const rows = pending.map((s) => {
    const id = sessionId(s.pk);
    const persona = personas.get(s.persona);
    const personaLabel = persona?.description ? `${s.persona} — ${persona.description}` : s.persona;
    const created = (s.createdAt ?? "").replace("T", " ").slice(0, 19);
    return `<a href="/sessions/${esc(id)}" class="block border border-gray-200 rounded-lg bg-white p-4 mb-3 hover:bg-gray-50">
      <div class="flex items-center justify-between mb-2">
        <span class="font-semibold text-sm">${esc(s.name ?? id.slice(0, 8))}</span>
        <span class="flex items-center gap-2 text-xs text-gray-500">${statusBadge(s.status)}<span>${esc(created)}</span></span>
      </div>
      <div class="text-sm text-gray-600 mb-1">Persona: <strong>${esc(personaLabel)}</strong>${s.callerPersona ? ` · asked by <code>${esc(s.callerPersona)}</code>` : ""} · firstAuthor=${esc(s.firstMessageAuthor)}</div>
      <div class="font-mono text-[11px] text-gray-400">${esc(id.slice(0, 8))}</div>
    </a>`;
  }).join("");
  return renderPage(
    "Inbox",
    `
    <h2 class="text-2xl font-semibold mb-4">Inbox <span class="text-sm text-gray-500">(${pending.length})</span></h2>
    ${rows}
  `
  );
}

function safePrettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    RUNNING: "bg-yellow-100 text-yellow-800",
    WAITING_HUMAN: "bg-orange-100 text-orange-800",
    COMPLETED: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
    IDLE: "bg-gray-200 text-gray-700",
    SLEEPING: "bg-indigo-100 text-indigo-800",
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
