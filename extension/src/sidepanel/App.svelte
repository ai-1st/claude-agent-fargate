<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { ApiAuth } from "../api.js";
  import { getSessionDetail, listSessions } from "../api.js";
  import type { OverlayState, SessionDetailResponse, SessionSummary } from "../types.js";
  import { onStateChanged, readState, writeState } from "../state.js";
  import { detailFingerprint, sessionsFingerprint } from "./lib/fingerprint.js";
  import SessionList from "./components/SessionList.svelte";

  const POLL_MS = 5000;

  let base = $state("");
  let apiPassword = $state("");
  let boundSid = $state<string | undefined>();
  let overlayState = $state<OverlayState>("idle");
  let sessions = $state<SessionSummary[]>([]);
  let expanded = $state<Set<string>>(new Set());
  let details = $state<Record<string, SessionDetailResponse>>({});
  let loadingIds = $state<Set<string>>(new Set());
  let drafts = $state<Record<string, string>>({});
  let listError = $state("");
  let saving = $state(false);

  let sessionsFp = "";
  const detailFps = new Map<string, string>();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let unsubStorage: (() => void) | undefined = undefined;

  const auth = $derived.by((): ApiAuth | undefined => {
    const b = base.trim().replace(/\/+$/, "");
    if (!b || !apiPassword) return undefined;
    return { base: b, password: apiPassword };
  });

  const headerSub = $derived.by(() => {
    if (!auth) return "Configure API URL and password.";
    if (boundSid) return `Browser bound · ${boundSid.slice(0, 8)}`;
    return `Connected · ${auth.base}`;
  });

  const statusDotClass = $derived(
    `dot ${boundSid ? overlayState : "idle"}`
  );

  onMount(() => {
    void bootstrap();
    unsubStorage = onStateChanged(() => {
      void syncFromStorage();
    });
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    unsubStorage?.();
  });

  async function bootstrap(): Promise<void> {
    await syncFromStorage();
    if (auth) {
      await pollOnce();
      pollTimer = setInterval(() => void pollOnce(), POLL_MS);
    }
  }

  async function syncFromStorage(): Promise<void> {
    const st = await readState();
    if (st.base) base = st.base;
    if (st.apiPassword) apiPassword = st.apiPassword;
    boundSid = st.sid;
    overlayState = (st.state ?? "idle") as OverlayState;
  }

  async function saveSettings(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    const b = base.trim().replace(/\/+$/, "");
    if (!b || !apiPassword) return;
    saving = true;
    try {
      await writeState({ base: b, apiPassword });
      base = b;
      sessionsFp = "";
      detailFps.clear();
      await pollOnce();
      if (!pollTimer) {
        pollTimer = setInterval(() => void pollOnce(), POLL_MS);
      }
    } finally {
      saving = false;
    }
  }

  async function pollOnce(): Promise<void> {
    const a = auth;
    if (!a) {
      sessions = [];
      listError = "";
      return;
    }
    try {
      const list = await listSessions(a);
      const fp = sessionsFingerprint(list);
      if (fp !== sessionsFp) {
        sessionsFp = fp;
        sessions = list;
      }
      listError = "";

      await Promise.all([...expanded].map((id) => refreshDetail(a, id, false)));
    } catch (e) {
      listError = (e as Error).message;
    }
  }

  async function refreshDetail(
    a: ApiAuth,
    id: string,
    force: boolean
  ): Promise<void> {
    if (!expanded.has(id)) return;
    try {
      const d = await getSessionDetail(a, id);
      const fp = detailFingerprint(d);
      if (!force && fp === detailFps.get(id)) return;
      detailFps.set(id, fp);
      details = { ...details, [id]: d };
    } catch (e) {
      listError = (e as Error).message;
    } finally {
      if (loadingIds.has(id)) {
        const next = new Set(loadingIds);
        next.delete(id);
        loadingIds = next;
      }
    }
  }

  function onToggle(id: string, open: boolean): void {
    const next = new Set(expanded);
    if (open) {
      next.add(id);
      expanded = next;
      loadingIds = new Set(loadingIds).add(id);
      const a = auth;
      if (a) void refreshDetail(a, id, true);
    } else {
      next.delete(id);
      expanded = next;
      detailFps.delete(id);
      const { [id]: _, ...rest } = details;
      details = rest;
    }
  }

  function onDraftChange(id: string, v: string): void {
    drafts = { ...drafts, [id]: v };
  }

  async function onSent(id: string): Promise<void> {
    detailFps.delete(id);
    const a = auth;
    if (a) await refreshDetail(a, id, true);
    await pollOnce();
  }
</script>

<header>
  <h1><span class={statusDotClass}></span> CloudClaw</h1>
  <div class="sub">{headerSub}</div>
</header>

<details class="settings" open>
  <summary>API settings</summary>
  <form onsubmit={saveSettings}>
    <input type="url" bind:value={base} placeholder="https://….lambda-url….on.aws/" required />
    <input
      type="password"
      bind:value={apiPassword}
      placeholder="App password"
      required
      autocomplete="current-password"
    />
    <button type="submit" class="primary" disabled={saving}>
      {saving ? "Saving…" : "Save & refresh"}
    </button>
  </form>
</details>

<div class="session-list">
  <SessionList
    {sessions}
    {boundSid}
    {auth}
    {expanded}
    {details}
    {loadingIds}
    {drafts}
    error={listError}
    ontoggle={onToggle}
    ondraftchange={onDraftChange}
    onsent={onSent}
    onbound={() => void syncFromStorage()}
  />
</div>
