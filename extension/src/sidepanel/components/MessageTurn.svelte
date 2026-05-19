<script lang="ts">
  import type { ChatMessage } from "../../types.js";

  let { message }: { message: ChatMessage } = $props();

  const kind = $derived(message.kind ?? "user");
  const isAssistantOnly = $derived(kind === "assistant");
  const prompt = $derived((message.prompt ?? "").trim());
  const reply = $derived(isAssistantOnly ? prompt : (message.result ?? "").trim());
  const running = $derived(message.status === "RUNNING");
</script>

{#if !isAssistantOnly && prompt}
  <div class="turn">
    <span class="label">you</span>
    <p>{prompt}</p>
  </div>
{/if}
{#if running}
  <p class="empty"><span class="spin"></span> agent working…</p>
{:else if reply}
  <div class="turn">
    <span class="label">agent</span>
    <p>{reply}</p>
  </div>
{/if}
{#if message.error}
  <p class="err">{message.error}</p>
{/if}
