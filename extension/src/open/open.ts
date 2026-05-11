const params = new URLSearchParams(location.search);
const sid = params.get("sid") ?? "";
const token = params.get("token") ?? "";
const base = params.get("base") ?? "";
const inputUrl = params.get("inputUrl") ?? undefined;

const statusEl = document.getElementById("status") as HTMLParagraphElement;
const inputUrlEl = document.getElementById("inputUrl") as HTMLElement;
if (inputUrlEl && inputUrl) inputUrlEl.textContent = inputUrl;

if (!sid || !token || !base) {
  statusEl.textContent = "Missing sid/token/base in the URL — aborting.";
  statusEl.classList.add("err");
} else {
  chrome.runtime
    .sendMessage({ type: "open_session", sid, token, base, inputUrl })
    .then(() => {
      statusEl.textContent = `Bound to session ${sid.slice(0, 8)}${inputUrl ? `; opening ${inputUrl}` : ""}.`;
      if (!inputUrl) {
        setTimeout(() => window.close(), 800);
      }
    })
    .catch((e) => {
      statusEl.textContent = `Failed to bind: ${(e as Error).message}`;
      statusEl.classList.add("err");
    });
}
