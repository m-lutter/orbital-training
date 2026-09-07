<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Workout complete · Orbital Training</title></svelte:head>

<main class="summary-page">
  <section class="summary-card">
    <p class="eyebrow">Workout complete</p>
    <h1>Your workout was saved</h1>
    <p>
      Connected health data will be collected after it syncs and included in
      your weekly review when available.
    </p>
    <a class="primary" href={data.nextHref}>Continue to next workout</a>
  </section>
</main>

<style>
  .summary-page {
    margin: 0 auto;
    max-width: 52rem;
    padding: 1rem;
  }
  .summary-card {
    background: rgb(8 21 38 / 88%);
    border: 1px solid #3d6b90;
    border-radius: 0.8rem;
    padding: clamp(1rem, 3vw, 2rem);
  }
  .summary-card h1 {
    margin-top: 0.25rem;
  }
  .primary {
    align-items: center;
    background: var(--color-primary);
    border-radius: 0.55rem;
    color: var(--color-on-primary);
    display: inline-flex;
    font-weight: 800;
    margin-top: 1rem;
    min-height: var(--touch-target);
    padding: 0.6rem 1rem;
    text-decoration: none;
  }
  :global(html[data-theme="cute"]) .summary-card {
    background: #fff9fc;
    border: 2px solid #5a1a36;
    color: #321523;
  }
</style>
