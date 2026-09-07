<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label = "More information",
    children,
    open = $bindable(false),
  }: { label?: string; children: Snippet; open?: boolean } = $props();
</script>

<span class="info-control">
  <button
    class="info-trigger"
    type="button"
    aria-label={label}
    aria-expanded={open}
    onclick={() => (open = !open)}>i</button
  >
  {#if open}
    <span class="info-panel" role="note">
      {@render children()}
    </span>
  {/if}
</span>

<style>
  .info-control {
    display: inline-flex;
    position: relative;
  }
  .info-trigger {
    align-items: center;
    background: #10233a !important;
    border: 1px solid var(--color-primary) !important;
    border-radius: 50% !important;
    box-shadow: 0 0 10px rgb(78 219 255 / 16%) !important;
    clip-path: none !important;
    color: var(--color-primary) !important;
    display: inline-flex;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: 0.88rem !important;
    font-weight: 800;
    height: 1.7rem;
    justify-content: center;
    min-height: 1.7rem !important;
    padding: 0 !important;
    width: 1.7rem;
  }
  .info-panel {
    background: #0a1627;
    border: 1px solid #3b6a8c;
    border-radius: 0.4rem;
    box-shadow: 0 14px 32px rgb(0 0 0 / 42%);
    color: var(--color-text);
    font-size: 0.88rem;
    font-weight: 450;
    left: 2.1rem;
    line-height: 1.45;
    max-width: min(24rem, 75vw);
    padding: 0.8rem;
    position: absolute;
    top: -0.35rem;
    width: max-content;
    z-index: 20;
  }
  :global(html[data-theme="cute"]) .info-trigger {
    background: #fff !important;
    border: 2px solid #a20e52 !important;
    box-shadow: 0 3px 0 #5a1a36 !important;
    color: #7a093d !important;
  }
  :global(html[data-theme="cute"]) .info-panel {
    background: #fff;
    border: 2px solid #5a1a36;
    box-shadow: 3px 4px 0 rgb(162 14 82 / 16%);
    color: #321523;
  }
  @media (max-width: 520px) {
    .info-panel {
      left: auto;
      right: 0;
      top: 2rem;
      width: min(19rem, 82vw);
    }
  }
</style>
