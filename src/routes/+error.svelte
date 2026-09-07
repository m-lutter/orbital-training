<script lang="ts">
  import { page } from "$app/state";

  const message = $derived(
    page.error?.message ?? "The page could not be loaded.",
  );
</script>

<svelte:head>
  <title>{page.status} | Pretty Strong Training</title>
</svelte:head>

<main class="mission-page error-page">
  <section class="mission-panel" aria-labelledby="error-title">
    <p class="mission-kicker">Something went off plan</p>
    <h1 id="error-title">{page.status}</h1>
    <p>{message}</p>
    <a class="button-link secondary" href="/">Return to training</a>
  </section>
</main>

<style>
  .error-page {
    display: grid;
    min-height: calc(100vh - 3.75rem);
    place-items: center;
  }

  section {
    max-width: 34rem;
    padding: clamp(1.25rem, 5vw, 2rem);
    width: 100%;
  }

  h1 {
    margin: 0.25rem 0;
  }

  section > p:not(.mission-kicker) {
    color: var(--color-text-muted);
    margin-bottom: 1.5rem;
  }
</style>
