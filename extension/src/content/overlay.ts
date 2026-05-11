import type { RuntimeMessage, OverlayState } from "../types.js";

const BAR_ID = "__claw_overlay_bar__";
const COLORS: Record<OverlayState, string> = {
  working: "#1e88e5",
  needs_human: "#fbc02d",
  idle: "#263238",
  unbound: "transparent",
};

function ensureBar(): HTMLDivElement {
  let el = document.getElementById(BAR_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = BAR_ID;
    Object.assign(el.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      height: "8px",
      zIndex: "2147483647",
      pointerEvents: "none",
      transition: "background-color 200ms",
    } satisfies Partial<CSSStyleDeclaration>);
    (document.documentElement || document.body).appendChild(el);
  }
  return el;
}

function applyState(state: OverlayState): void {
  const el = ensureBar();
  el.style.backgroundColor = COLORS[state];
  if (state === "needs_human") {
    el.style.animation = "claw-pulse 1200ms ease-in-out infinite";
    if (!document.getElementById("__claw_overlay_style__")) {
      const style = document.createElement("style");
      style.id = "__claw_overlay_style__";
      style.textContent = `
@keyframes claw-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}`;
      document.head?.appendChild(style);
    }
  } else {
    el.style.animation = "";
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage) => {
  if (msg.type === "overlay_set") applyState(msg.state);
});

chrome.storage.local.get("claw", (r) => {
  const st = (r?.claw ?? {}) as { state?: OverlayState };
  applyState(st.state ?? "unbound");
});
