<script lang="ts">
  import { tick } from "svelte";
  import type { ApiAuth } from "../../api.js";
  import { bindSessionBrowser, sendSessionMessage } from "../../api.js";
  import type { SessionDetailResponse } from "../../types.js";
  import { detailFingerprint } from "../lib/fingerprint.js";
  import MessageTurn from "./MessageTurn.svelte";

  interface Props {
    sessionId: string;
    auth: ApiAuth;
    detail: SessionDetailResponse | undefined;
    loading: boolean;
    draft: string;
    ondraftchange: (v: string) => void;
    onsent: () => void;
    onbound: () => void;
  }

  let { sessionId, auth, detail, loading, draft, ondraftchange, onsent, onbound }: Props =
    $props();

  let threadEl: HTMLDivElement | undefined = $state();
  let lastFp = $state("");
  let sending = $state(false);

  const canSend = $derived(detail?.canSend ?? false);
  const placeholder = $derived(
    canSend ? "Reply…" : "Agent working or session closed"
  );

  $effect(() => {
    if (!detail || !threadEl) return;
    const fp = detailFingerprint(detail);
    if (fp === lastFp) return;

    const el = threadEl;
    const prevTop = el.scrollTop;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;

    lastFp = fp;
    tick().then(() => {
      if (!threadEl) return;
      if (nearBottom) threadEl.scrollTop = threadEl.scrollHeight;
      else threadEl.scrollTop = prevTop;
    });
  });

  async function send(): Promise<void> {
    const prompt = draft.trim();
    if (!prompt || !canSend || sending) return;
    sending = true;
    try {
      await sendSessionMessage(auth, sessionId, prompt);
      ondraftchange("");
      onsent();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      sending = false;
    }
  }

  async function bindBrowser(): Promise<void> {
    try {
      const bound = await bindSessionBrowser(auth, sessionId);
      await chrome.runtime.sendMessage({
        type: "open_session",
        sid: bound.sid,
        token: bound.token,
        base: bound.base,
        inputUrl: bound.inputUrl,
      });
      onbound();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function openWeb(): void {
    chrome.tabs.create({
      url: `${auth.base.replace(/\/+$/, "")}/sessions/${sessionId}`,
    });
  }

  function onKeydown(ev: KeyboardEvent): void {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      ev.preventDefault();
      void send();
    }
  }
</script>

{#if loading}
  <p class="empty"><span class="spin"></span> Loading…</p>
{:else if !detail}
  <p class="empty">Could not load thread.</p>
{:else}
  <div class="thread" bind:this={threadEl}>
    {#if detail.messages.length === 0}
      <p class="empty">No messages.</p>
    {:else}
      {#each detail.messages as m (m.sk)}
        <MessageTurn message={m} />
      {/each}
    {/if}

    {#if detail.session.submitResult}
      <div class="turn">
        <span class="label">result</span>
        <p>{detail.session.submitResult}</p>
      </div>
    {/if}
  </div>

  <div class="composer">
    <textarea
      class="prompt"
      {placeholder}
      disabled={!canSend}
      value={draft}
      oninput={(e) => ondraftchange(e.currentTarget.value)}
      onkeydown={onKeydown}
    ></textarea>
    <div class="actions">
      <button type="button" class="primary" disabled={!canSend || sending} onclick={send}>
        Send
      </button>
      <button type="button" onclick={bindBrowser}>Drive browser</button>
      <button type="button" onclick={openWeb}>Web UI</button>
    </div>
  </div>
{/if}
