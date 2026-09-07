<script lang="ts">
  import type { AppQuote } from "./quotes";

  let {
    quote,
    compact = false,
    showIn = "all",
  }: {
    quote?: AppQuote;
    compact?: boolean;
    showIn?: "all" | "orbital" | "cute";
  } = $props();
</script>

{#if quote}
  <figure
    class="quote-card"
    class:compact
    class:orbital-quote={showIn === "orbital"}
    class:cute-quote={showIn === "cute"}
    data-quote-placement={quote.placement}
  >
    <blockquote>“{quote.text}”</blockquote>
    <figcaption>
      — {quote.author},
      {#if quote.sourceUrl}
        <cite
          ><a href={quote.sourceUrl} rel="noreferrer">{quote.source}</a></cite
        >
      {:else}
        <cite>{quote.source}</cite>
      {/if}
    </figcaption>
  </figure>
{/if}

<style>
  .quote-card {
    background: linear-gradient(100deg, rgb(78 219 255 / 8%), transparent 75%);
    border-left: 3px solid rgb(78 219 255 / 65%);
    margin: 1rem 0 0;
    padding: 0.75rem 0.9rem;
  }
  blockquote {
    color: #eaf6ff;
    font-size: 0.95rem;
    font-style: italic;
    line-height: 1.45;
    margin: 0;
  }
  figcaption {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    margin-top: 0.4rem;
  }
  .compact {
    margin-top: 0.7rem;
    padding-block: 0.55rem;
  }
  .compact blockquote {
    font-size: 0.86rem;
  }
  :global(html[data-theme="cute"]) .orbital-quote,
  :global(html:not([data-theme="cute"])) .cute-quote {
    display: none;
  }
  :global(html[data-theme="cute"]) .quote-card {
    background: #fff9fc;
    border: 2px solid #5a1a36;
    border-left: 4px solid #a20e52;
    border-radius: 1.0625rem;
    box-shadow: 3px 4px 0 rgb(162 14 82 / 16%);
    color: #321523;
  }
  :global(html[data-theme="cute"]) blockquote {
    color: #321523;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  :global(html[data-theme="cute"]) figcaption {
    color: #694052;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  :global(html[data-theme="cute"]) figcaption a {
    color: #7a093d;
  }
</style>
