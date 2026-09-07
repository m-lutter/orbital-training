<svelte:head>
  <title>Powerlifting App</title>
  <meta
    name="description"
    content="Adaptive training for powerlifting, hypertrophy, cardio and general fitness."
  />
</svelte:head>

<main class="mission-page landing-page">
  <section class="hero mission-panel">
    <div class="hero-copy">
      <p class="eyebrow orbital-only">ADAPTIVE TRAINING · MISSION READY</p>
      <p class="eyebrow cute-only">PERSONALIZED · CLEAR · ADAPTABLE</p>
      <h1 class="orbital-only">Your training plan, built around your orbit.</h1>
      <h1 class="cute-only">A training plan that feels like yours.</h1>
      <p class="description">
        Create a clear, flexible program for strength, muscle growth, cardio
        performance, or general health—and adjust it as you train.
      </p>
      <div class="hero-actions">
        <a class="button-link" href="/onboarding">Plan my training</a>
        <a class="text-link" href="/login">I already have an account</a>
      </div>
    </div>
    <div class="trajectory-panel" aria-label="Training system capabilities">
      <p class="orbital-only">FLIGHT PLAN CAPABILITIES</p>
      <p class="cute-only">WHAT YOU GET</p>
      <ol>
        <li>
          <span>01</span><strong class="orbital-only"
            >Choose your mission</strong
          ><strong class="cute-only">Choose your goal</strong><small
            >Strength, muscle, cardio, or health</small
          >
        </li>
        <li>
          <span>02</span><strong>Get a specific plan</strong><small
            >Exercises, reps, effort, and schedule</small
          >
        </li>
        <li>
          <span>03</span><strong>Log the work</strong><small
            >Your results guide future weeks</small
          >
        </li>
      </ol>
    </div>
  </section>
</main>

<style>
  main {
    min-height: calc(100vh - 3.75rem);
    display: grid;
    place-items: center;
  }
  .hero {
    display: grid;
    gap: clamp(2rem, 7vw, 5rem);
    grid-template-columns: minmax(0, 1.25fr) minmax(17rem, 0.75fr);
    overflow: hidden;
    padding: clamp(1.4rem, 5vw, 4rem);
    position: relative;
    width: 100%;
  }
  .hero::after {
    border: 1px solid rgb(78 219 255 / 18%);
    border-radius: 50%;
    content: "";
    height: 30rem;
    position: absolute;
    right: -14rem;
    top: -13rem;
    width: 30rem;
  }
  h1 {
    max-width: 48rem;
    margin: 0.8rem 0 1.2rem;
  }
  .description {
    color: var(--color-text-muted);
    font-size: 1.1rem;
    line-height: 1.6;
    max-width: 42rem;
    margin: 0 0 2rem;
  }
  .hero-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .text-link {
    color: var(--color-text-muted);
    font-weight: 700;
  }
  .trajectory-panel {
    align-self: center;
    background:
      repeating-linear-gradient(
        90deg,
        rgb(255 255 255 / 2%) 0 1px,
        transparent 1px 5px
      ),
      linear-gradient(145deg, rgb(22 54 92 / 92%), rgb(9 22 39 / 94%));
    border: 1px solid #3b709c;
    box-shadow:
      inset 0 1px rgb(255 255 255 / 9%),
      0 20px 50px rgb(0 0 0 / 35%);
    padding: 1rem;
    position: relative;
    z-index: 1;
  }
  .trajectory-panel > p {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
  }
  ol {
    display: grid;
    gap: 0.8rem;
    list-style: none;
    padding: 0;
  }
  li {
    background: rgb(6 15 27 / 58%);
    border-left: 3px solid var(--color-primary);
    display: grid;
    gap: 0.1rem 0.65rem;
    grid-template-columns: auto 1fr;
    padding: 0.7rem;
  }
  li span {
    color: var(--color-primary);
    font-family: var(--font-mono);
    grid-row: 1 / 3;
  }
  li small {
    color: var(--color-text-muted);
  }
  @media (max-width: 760px) {
    .hero {
      grid-template-columns: 1fr;
    }
  }
</style>
