import type { RuntimeMessage, BrowserOp, OverlayState } from "./types.js";
import { readState, writeState, clearBrowserBinding } from "./state.js";
import { poll, postResult } from "./api.js";

const POLL_ALARM = "claw-poll";
const POLL_PERIOD_MINUTES = 10 / 60; // ~10s

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.runtime.onInstalled.addListener(() => resetAlarm());
chrome.runtime.onStartup.addListener(() => resetAlarm());
resetAlarm();

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === POLL_ALARM) void tick();
});

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "open_session") {
        const cur = await readState();
        await writeState({
          ...cur,
          sid: msg.sid,
          token: msg.token,
          base: msg.base,
          inputUrl: msg.inputUrl,
          state: "idle",
          boundTabId: undefined,
        });
        if (msg.inputUrl) {
          const created = await chrome.tabs.create({ url: msg.inputUrl, active: true });
          if (created.id) await writeState({ boundTabId: created.id });
        }
        ensureAlarm();
        void tick();
        sendResponse({ ok: true });
      } else if (msg.type === "unbind") {
        await clearBrowserBinding();
        await broadcastState("unbound");
        sendResponse({ ok: true });
      } else if (msg.type === "poll_now") {
        void tick();
        sendResponse({ ok: true });
      } else if (msg.type === "get_state") {
        sendResponse(await readState());
      } else if (msg.type === "capture_screenshot") {
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
          sendResponse({ dataUrl });
        } catch (e) {
          sendResponse({ error: (e as Error).message });
        }
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
  })();
  return true;
});

function ensureAlarm(): void {
  chrome.alarms.get(POLL_ALARM, (existing) => {
    if (!existing || existing.periodInMinutes !== POLL_PERIOD_MINUTES) {
      chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES });
    }
  });
}

function resetAlarm(): void {
  chrome.alarms.clear(POLL_ALARM, () => {
    chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES });
  });
}

async function boundCfg(): Promise<{ base: string; sid: string; token: string } | undefined> {
  const st = await readState();
  if (!st.base || !st.sid || !st.token) return undefined;
  return { base: st.base, sid: st.sid, token: st.token };
}

async function tick(): Promise<void> {
  const cfg = await boundCfg();
  if (!cfg) {
    await broadcastState("unbound");
    return;
  }

  try {
    const r = await poll(cfg);
    await writeState({ lastPollAt: Date.now(), lastPollError: undefined });

    if (r.terminal) {
      await broadcastState("idle");
      await clearBrowserBinding();
      return;
    }

    if (r.command) {
      await broadcastState("working");
      await dispatchCommand(cfg, r.command.seq, r.command.op, r.command.args);
      setTimeout(() => void tick(), 50);
      return;
    }

    if (r.canSend) {
      await broadcastState("needs_human");
      return;
    }

    await broadcastState(r.active ? "working" : "idle");
  } catch (e) {
    await writeState({ lastPollError: (e as Error).message, lastPollAt: Date.now() });
  }
}

async function dispatchCommand(
  cfg: { base: string; sid: string; token: string },
  seq: string,
  op: BrowserOp,
  args: Record<string, unknown>
): Promise<void> {
  try {
    if (op === "open") {
      const tabId = await openUrl(String(args.url));
      await writeState({ boundTabId: tabId });
      await postResult(cfg, seq, true, { tabId, url: args.url });
      return;
    }

    const tabId = await ensureBoundTab();
    const resp = await chrome.tabs
      .sendMessage(tabId, { type: "execute_op", op, args, seq })
      .catch((e) => ({ ok: false, error: (e as Error).message }));
    const typed = resp as { ok: boolean; data?: unknown; error?: string };
    await postResult(cfg, seq, typed.ok === true, typed.data, typed.error);
  } catch (e) {
    await postResult(cfg, seq, false, undefined, (e as Error).message);
  }
}

async function openUrl(url: string): Promise<number> {
  const st = await readState();
  if (st.boundTabId) {
    try {
      await chrome.tabs.update(st.boundTabId, { url, active: true });
      await waitForTabLoad(st.boundTabId);
      return st.boundTabId;
    } catch {
      // tab was closed
    }
  }
  const created = await chrome.tabs.create({ url, active: true });
  const tabId = created.id!;
  await waitForTabLoad(tabId);
  return tabId;
}

async function ensureBoundTab(): Promise<number> {
  const st = await readState();
  if (!st.boundTabId) throw new Error("no bound tab yet; call browser_open first");
  try {
    await chrome.tabs.get(st.boundTabId);
    return st.boundTabId;
  } catch {
    throw new Error("bound tab was closed");
  }
}

function waitForTabLoad(tabId: number, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      chrome.tabs.get(tabId).then(
        (t) => {
          if (t.status === "complete" || Date.now() - start > timeoutMs) {
            resolve();
          } else {
            setTimeout(check, 250);
          }
        },
        () => resolve()
      );
    };
    check();
  });
}

async function broadcastState(state: OverlayState): Promise<void> {
  await writeState({ state });
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (t.id !== undefined) {
        chrome.tabs
          .sendMessage(t.id, { type: "overlay_set", state } satisfies RuntimeMessage)
          .catch(() => {});
      }
    }
  });
}
