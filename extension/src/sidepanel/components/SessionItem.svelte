<script lang="ts">
  import type { ApiAuth } from "../../api.js";
  import type { SessionDetailResponse, SessionSummary } from "../../types.js";
  import MessageThread from "./MessageThread.svelte";

  interface Props {
    session: SessionSummary;
    open: boolean;
    bound: boolean;
    auth: ApiAuth;
    detail: SessionDetailResponse | undefined;
    loading: boolean;
    draft: string;
    ontoggle: (open: boolean) => void;
    ondraftchange: (value: string) => void;
    onsent: () => void;
    onbound: () => void;
  }

  let {
    session,
    open,
    bound,
    auth,
    detail,
    loading,
    draft,
    ontoggle,
    ondraftchange,
    onsent,
    onbound,
  }: Props = $props();

  const created = $derived((session.createdAt ?? "").replace("T", " ").slice(0, 16));
  const displayName = $derived(session.name ?? session.id.slice(0, 8));

  function onToggle(ev: Event): void {
    const el = ev.currentTarget as HTMLDetailsElement;
    ontoggle(el.open);
  }
</script>

<details class="session" class:bound open={open} ontoggle={onToggle}>
  <summary>
    <div class="row">
      <span class="name">{displayName}</span>
      <span class="badge {session.status}">{session.status}</span>
    </div>
    <div class="meta">{session.persona} · {created}</div>
  </summary>

  <MessageThread
    sessionId={session.id}
    {auth}
    {detail}
    {loading}
    {draft}
    {ondraftchange}
    {onsent}
    {onbound}
  />
</details>
