<script lang="ts">
  let {
    cardioOnly,
    predictedMinutes,
    cardioMinutes = 0,
    workoutSeconds,
    workoutRunning,
    restSeconds,
    restRunning,
    ontoggleworkout,
    onresetworkout,
    ontogglerest,
    onclearrest,
  }: {
    cardioOnly: boolean;
    predictedMinutes: number;
    cardioMinutes?: number;
    workoutSeconds: number;
    workoutRunning: boolean;
    restSeconds: number;
    restRunning: boolean;
    ontoggleworkout: () => void;
    onresetworkout: () => void;
    ontogglerest: () => void;
    onclearrest: () => void;
  } = $props();

  function formatTimer(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
</script>

<aside class="timer-bar" aria-label="Workout timers">
  <div>
    <span class="timer-label">
      <b>Workout</b>
      <small>~{predictedMinutes} min</small>
    </span>
    <strong>
      {#if cardioOnly}
        {formatTimer(workoutSeconds)} elapsed · {formatTimer(
          Math.max(0, cardioMinutes * 60 - workoutSeconds),
        )} left
      {:else}
        {formatTimer(workoutSeconds)}
      {/if}
    </strong>
    <button type="button" onclick={ontoggleworkout}>
      {workoutRunning ? "Pause" : workoutSeconds > 0 ? "Resume" : "Start"}
    </button>
    {#if workoutSeconds > 0}
      <button class="quiet" type="button" onclick={onresetworkout}>Reset</button
      >
    {/if}
  </div>
  {#if !cardioOnly}
    <div>
      <span class="timer-label"><b>Rest</b></span>
      <strong>{formatTimer(restSeconds)}</strong>
      <button type="button" disabled={restSeconds === 0} onclick={ontogglerest}>
        {restRunning ? "Pause" : "Resume"}
      </button>
      {#if restSeconds > 0}
        <button class="quiet" type="button" onclick={onclearrest}>Clear</button>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .timer-bar {
    background:
      repeating-linear-gradient(
        90deg,
        rgb(255 255 255 / 2%) 0 1px,
        transparent 1px 5px
      ),
      linear-gradient(145deg, #17395f, #0a1c31);
    border: 1px solid #3d6b90;
    border-radius: 0.75rem;
    box-shadow: 0 10px 25px rgb(0 0 0 / 35%);
    color: white;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    margin: 1rem 0;
    padding: 0.65rem;
    position: sticky;
    top: 4.25rem;
    z-index: 10;
  }

  .timer-bar > div {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    min-width: 0;
  }

  .timer-label {
    display: grid;
    line-height: 1.15;
    min-width: 4.5rem;
  }

  .timer-label b {
    color: white;
  }

  .timer-label small {
    color: #c7d2e6;
    font-size: 0.75rem;
  }

  .timer-bar strong {
    font-variant-numeric: tabular-nums;
    min-width: 3.1rem;
  }

  .timer-bar button {
    background: #152a43;
    border-color: #47749a;
    color: var(--color-text);
    padding: 0.42rem 0.6rem;
  }

  .timer-bar > div > button:first-of-type {
    background: linear-gradient(180deg, #66e2ff, #32b9dc);
    border-color: #94edff;
    color: #04131d;
  }

  .timer-bar button.quiet {
    background: transparent;
    color: #dbe5f6;
    padding-inline: 0.25rem;
  }

  :global(html[data-theme="cute"]) .timer-bar {
    background: #fff;
    border: 2px solid #5a1a36;
    box-shadow: 3px 4px 0 rgb(162 14 82 / 16%);
    color: #321523;
  }

  :global(html[data-theme="cute"]) .timer-label b {
    color: #321523;
  }

  :global(html[data-theme="cute"]) .timer-label small {
    color: #694052;
  }

  :global(html[data-theme="cute"]) .timer-bar button {
    background: #fff;
    border-color: #a20e52;
    color: #7a093d;
  }

  :global(html[data-theme="cute"]) .timer-bar > div > button:first-of-type {
    background: #a20e52;
    border-color: #5a1a36;
    color: #fff;
  }

  :global(html[data-theme="cute"]) .timer-bar button.quiet {
    background: #fff;
    color: #7a093d;
  }

  @media (max-width: 680px) {
    .timer-bar {
      align-items: stretch;
      display: grid;
      grid-template-columns: 1fr;
    }

    .timer-bar > div {
      display: grid;
      grid-template-columns: minmax(72px, auto) minmax(0, 1fr) auto auto;
    }
  }

  @media (max-width: 390px) {
    .timer-bar > div {
      grid-template-columns: minmax(62px, auto) minmax(0, 1fr) auto;
    }

    .timer-bar .quiet {
      display: none;
    }

    .timer-bar strong {
      font-size: 0.9rem;
      min-width: 0;
      overflow-wrap: anywhere;
    }
  }
</style>
