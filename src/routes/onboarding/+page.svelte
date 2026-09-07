<svelte:head>
  <title>Start Your Program</title>
</svelte:head>

<main class="mission-page onboarding-page">
  <p><a href="/">← Home</a></p>
  <header>
    <p class="mission-kicker orbital-only">Preflight briefing</p>
    <p class="mission-kicker cute-only">Before we begin</p>
    <h1>Here’s what you’ll need.</h1>
    <p>
      Most people can finish the setup in a few minutes. You can leave advanced
      choices at their recommended defaults.
    </p>
  </header>
  <section class="briefing-grid">
    <article>
      <span>01</span>
      <h2>Your goals</h2>
      <p>What you want to improve and how often you can train.</p>
    </article>
    <article>
      <span>02</span>
      <h2>Your experience</h2>
      <p>A simple training history helps us choose a safe starting point.</p>
    </article>
    <article>
      <span>03</span>
      <h2>Your equipment</h2>
      <p>We only prescribe movements you can actually perform.</p>
    </article>
  </section>
  <a class="button-link" href="/programs/new">Start program setup</a>
</main>

<style>
  main {
    max-width: 62rem;
  }
  header {
    margin: clamp(2rem, 7vw, 5rem) 0 2rem;
    max-width: 45rem;
  }
  header h1 {
    margin: 0.5rem 0 1rem;
  }
  header > p:last-child,
  article p {
    color: var(--color-text-muted);
    line-height: 1.55;
  }
  .briefing-grid {
    display: grid;
    gap: 0.8rem;
    grid-template-columns: repeat(3, 1fr);
    margin-bottom: 1.5rem;
    padding: 1rem;
  }
  article {
    background: rgb(7 15 27 / 66%);
    border-top: 2px solid var(--color-primary);
    padding: 1rem;
  }
  article span {
    color: var(--color-primary);
    font-family: var(--font-mono);
  }
  article h2 {
    font-size: 1.1rem;
  }
  @media (max-width: 650px) {
    .briefing-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
