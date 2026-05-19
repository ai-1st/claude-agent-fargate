<script lang="ts">
  import type { ApiAuth } from "../../api.js";
  import type { SessionDetailResponse, SessionSummary } from "../../types.js";
  import SessionItem from "./SessionItem.svelte";

  interface Props {
    sessions: SessionSummary[];
    boundSid: string | undefined;
    auth: ApiAuth | undefined;
    expanded: Set<string>;
    details: Record<string, SessionDetailResponse>;
    loadingIds: Set<string>;
    drafts: Record<string, string>;
    error: string;
    ontoggle: (id: string, open: boolean) => void;
    ondraftchange: (id: string, v: string) => void;
    onsent: (id: string) => void;
    onbound: () => void;
  }

  let {
    sessions,
    boundSid,
    auth,
    expanded,
    details,
    loadingIds,
    drafts,
    error,
    ontoggle,
    ondraftchange,
    onsent,
    onbound,
  }: Props = $props();
</script>

{#if error}
  <p class="err">{error}</p>
{:else if !auth}
  <p class="empty">Save API settings to load sessions.</p>
{:else if sessions.length === 0}
  <p class="empty">No sessions yet. Start one in the web UI.</p>
{:else}
  {#each sessions as session (session.id)}
    <SessionItem
      {session}
      open={expanded.has(session.id)}
      bound={boundSid === session.id}
      {auth}
      detail={details[session.id]}
      loading={loadingIds.has(session.id)}
      draft={drafts[session.id] ?? ""}
      ontoggle={(open) => ontoggle(session.id, open)}
      ondraftchange={(v) => ondraftchange(session.id, v)}
      onsent={() => onsent(session.id)}
      {onbound}
    />
  {/each}
{/if}
