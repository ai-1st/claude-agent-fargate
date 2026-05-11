# ClaudeClaw browser extension

Chrome MV3 extension that binds a browser window to one `operator` persona in a running ClaudeClaw stack. Polls the ClaudeClaw Lambda every ~10s for browser commands, executes them in the bound tab, posts results back, and surfaces handoff prompts in the side panel.

## Build

```bash
cd extension
npm install
npm run build          # produces ./dist
npm run watch          # rebuild on change
```

## Load in Chrome

1. `chrome://extensions` → toggle **Developer mode** on.
2. Click **Load unpacked** and select `extension/dist`.
3. Pin the extension, click its icon to open the side panel.

## Bind to a persona

1. Deploy the ClaudeClaw stack (`make deploy`) and note the Lambda Function URL.
2. Upload an operator persona: `npx tsx scripts/upload-project.ts --name my-op --dir ./projects/my-op --kind operator --profile ce`.
3. Open the persona page in the web UI (`https://<function-url>/personas/my-op`) and click **Mint extension token**. Copy it.
4. In the extension side panel, paste the Function URL and token, then click **Bind**.

The bound window now acts as the operator's browser. Queued sessions (started via web UI chat or via `operators_ask` from another persona) drain one at a time. A thin color bar appears at the top of every page: blue = agent working, yellow = needs your input (e.g. CAPTCHA, MFA), dark = idle.

## Scrapers

Bundled scrapers live in `src/scrapers/`. Each exports a `Scraper` with named actions that the worker can invoke via `browser_run_scraper(name, action, args)`.

- `generic`: textOf, countOf, attrOf, allText, waitFor, title, url.
- `linkedin`: searchPeople, getProfile, getFeed.
- `reddit`: getPost, getSubredditTop.
