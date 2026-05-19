# CloudClaw browser extension

Chrome MV3 extension. The **side panel** is the primary session UI: list all sessions, expand threads, reply, and optionally drive the browser for one session at a time. The web app (`/` and `/sessions/:id`) remains for testing without the extension.

## Build

The side panel is a **Svelte 5** app (Vite); background/content scripts use esbuild.

```bash
cd extension
npm install
npm run build          # produces ./dist
npm run watch          # esbuild watch (re-run build for sidepanel changes)
```

The side panel polls every 5s but only updates the UI when session list or thread fingerprints change, so scroll position and composer drafts are preserved.

## Stable extension ID

Chrome assigns a random extension ID to unpacked loads unless you pin one with a `"key"` field (base64 RSA public key) in `public/manifest.json`. The ID derived from that key must match `EXT_CHROME_ID` on the API Lambda so **Open in Extension** redirects to this extension.

## Load in Chrome

1. `chrome://extensions` → toggle **Developer mode** on.
2. Click **Load unpacked** and select `extension/dist`.
3. Pin the extension, click its icon to open the **side panel**.

## Configure the side panel

1. Deploy CloudClaw (`make deploy`) and note the Lambda Function URL (same host you use in the browser for the web UI).
2. In the side panel, open **API settings** and enter:
   - **Function URL** — e.g. `https://….lambda-url.us-west-2.on.aws`
   - **App password** — same value as `APP_PASSWORD` / web login
3. Click **Save**. Sessions load automatically and refresh every few seconds.

From an expanded session you can **Send** replies (when the agent is not running), **Drive browser** (mint extension token + start poll loop for `browser_*` tools), or open **Web UI** for the full detail page.

## Open in Extension (from web)

On a session detail page, **Open in Extension** redirects to `open.html` with `sid`, `token`, and `base`. That binds browser polling for that session. You still need **API settings** in the side panel once so the session list can authenticate to `/ext/sessions*`.

## Browser binding

While bound, the background script polls `/ext/poll` every ~10s, runs queued `browser_*` commands in the bound tab, and posts results to `/ext/result`. A thin color bar on pages shows state: blue = working, yellow = needs human input, gray = idle.

## Scrapers

Bundled scrapers live in `src/scrapers/`. Each exports a `Scraper` with named actions invoked via `browser_run_scraper(name, action, args)`.

- `generic`: textOf, countOf, attrOf, allText, waitFor, title, url.
- `linkedin`: searchPeople, getProfile, getFeed.
- `reddit`: getPost, getSubredditTop.
