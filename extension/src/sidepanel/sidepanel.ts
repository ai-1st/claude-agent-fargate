import type { OverlayState } from "../types.js";
import { readState, onStateChanged } from "../state.js";

const dot = document.getElementById("statusDot") as HTMLSpanElement;
const headerTitle = document.getElementById("headerTitle") as HTMLSpanElement;
const headerSubtitle = document.getElementById("headerSubtitle") as HTMLDivElement;
const boundCard = document.getElementById("boundCard") as HTMLDivElement;
const unboundCard = document.getElementById("unboundCard") as HTMLDivElement;
const sidEl = document.getElementById("sid") as HTMLElement;
const lastPollEl = document.getElementById("lastPoll") as HTMLDivElement;
const pollErrorEl = document.getElementById("pollError") as HTMLDivElement;
const unbindBtn = document.getElementById("unbindBtn") as HTMLButtonElement;

unbindBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "unbind" });
  await refresh();
});

onStateChanged(() => void refresh());
void refresh();
setInterval(() => void refresh(), 5_000);

async function refresh(): Promise<void> {
  const st = await readState();
  if (!st.sid || !st.token || !st.base) {
    applyDot("unbound");
    headerTitle.textContent = "ClaudeClaw";
    headerSubtitle.textContent = "Not bound to any session.";
    boundCard.style.display = "none";
    unboundCard.style.display = "block";
    return;
  }
  applyDot((st.state ?? "idle") as OverlayState);
  headerTitle.textContent = "ClaudeClaw";
  headerSubtitle.textContent = `Bound · ${st.base}`;
  boundCard.style.display = "block";
  unboundCard.style.display = "none";
  sidEl.textContent = st.sid;
  lastPollEl.textContent = st.lastPollAt ? `Last poll: ${new Date(st.lastPollAt).toLocaleTimeString()}` : "Polling…";
  pollErrorEl.textContent = st.lastPollError ? `Error: ${st.lastPollError}` : "";
}

function applyDot(state: OverlayState): void {
  dot.className = `dot ${state}`;
}
