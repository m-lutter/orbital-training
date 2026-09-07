<script lang="ts">
  import type { WearableDay } from "$lib/fitness/contracts";
  import {
    importedStepsMeetingGoal,
    wearableSourceLabel,
  } from "$lib/fitness/movement";

  type MovementTarget = {
    steps?: number;
    walkingMinutes?: number;
    explanation: string;
  };

  let {
    target,
    answer = $bindable<"" | "yes" | "no" | "untracked">(""),
    actual = $bindable<number | undefined>(),
    wearableDay,
    oncontinue,
  }: {
    target: MovementTarget;
    answer?: "" | "yes" | "no" | "untracked";
    actual?: number;
    wearableDay?: WearableDay;
    oncontinue: () => void;
  } = $props();

  let importedSteps = $derived(importedStepsMeetingGoal(wearableDay, target));

  $effect(() => {
    if (importedSteps === undefined) return;
    answer = "yes";
    actual = importedSteps;
  });

  $effect(() => {
    if (importedSteps === undefined) return;
    answer = "yes";
    actual = importedSteps;
  });

  function selectAnswer(next: "yes" | "no" | "untracked"): void {
    answer = next;
    oncontinue();
  }
</script>

<div class="movement-checkin-backdrop" role="presentation">
  <div
    class="movement-checkin"
    role="dialog"
    aria-modal="true"
    aria-labelledby="movement-checkin-title"
    data-answer={answer || undefined}
  >
    <p class="eyebrow">Previous day check-in</p>
    <h2 id="movement-checkin-title">Yesterday’s movement</h2>
    <p>
      This question refers to the calendar day before today’s workout. Did you
      reach yesterday’s
      <strong>
        {target.steps !== undefined
          ? `${target.steps.toLocaleString()}-step`
          : `${target.walkingMinutes}-minute walking`}
      </strong>
      target?
    </p>
    {#if importedSteps !== undefined}
      <div class="imported-movement" role="status">
        <strong>{importedSteps.toLocaleString()} steps imported</strong>
        <span>
          {wearableSourceLabel(wearableDay?.source ?? null)} reports that the goal
          was reached{wearableDay?.date ? ` on ${wearableDay.date}` : ""}. You
          do not need to enter steps again.
        </span>
      </div>
      <button class="continue-imported" type="button" onclick={oncontinue}
        >Continue</button
      >
    {:else}
      <label>
        {target.steps !== undefined
          ? "Yesterday’s steps (optional)"
          : "Yesterday’s walking minutes (optional)"}
        <input
          type="number"
          min="0"
          max={target.steps !== undefined ? 250000 : 1440}
          step="1"
          bind:value={actual}
        />
      </label>
      <div class="movement-answer-grid">
        <button type="button" onclick={() => selectAnswer("yes")}>Yes</button>
        <button type="button" onclick={() => selectAnswer("no")}
          >Not yesterday</button
        >
        <button
          type="button"
          class="quiet"
          onclick={() => selectAnswer("untracked")}
        >
          I couldn’t track it
        </button>
      </div>
    {/if}
    <p class="help">
      This guides the daily target over time. One missed or untracked day will
      not reduce your workouts.
    </p>
  </div>
</div>

<style>
  .movement-checkin-backdrop,
  .movement-checkin,
  .movement-checkin * {
    box-sizing: border-box;
  }

  .movement-checkin-backdrop {
    background: rgb(2 5 14 / 78%);
    backdrop-filter: blur(5px);
    display: grid;
    inset: 0;
    padding: 1rem;
    place-items: center;
    position: fixed;
    z-index: 90;
  }

  .movement-checkin {
    background: linear-gradient(
      145deg,
      rgb(25 38 61 / 98%),
      rgb(6 12 26 / 98%)
    );
    border: 2px solid rgb(153 191 229 / 78%);
    border-radius: 1rem;
    box-shadow:
      0 1.5rem 5rem rgb(0 0 0 / 55%),
      inset 0 1px 0 rgb(255 255 255 / 20%);
    color: var(--color-text);
    max-width: 100%;
    min-width: 0;
    padding: clamp(1.1rem, 4vw, 1.75rem);
    width: min(34rem, 100%);
  }

  .movement-checkin h2 {
    margin-top: 0.2rem;
  }

  .movement-checkin label {
    display: grid;
    gap: 0.4rem;
  }

  .movement-checkin input {
    min-height: var(--touch-target);
    padding: 0.65rem;
    width: 100%;
  }
  .imported-movement {
    background: rgb(59 227 162 / 10%);
    border: 1px solid rgb(59 227 162 / 55%);
    border-radius: 0.65rem;
    display: grid;
    gap: 0.3rem;
    margin: 1rem 0;
    padding: 0.8rem;
  }
  .imported-movement span {
    color: var(--color-text-muted);
    line-height: 1.45;
  }
  .continue-imported {
    min-height: var(--touch-target);
    width: 100%;
  }
  :global(html[data-theme="cute"]) .movement-checkin-backdrop {
    background: rgb(50 21 35 / 58%);
  }
  :global(html[data-theme="cute"]) .movement-checkin {
    background: #fff;
    border-color: #5a1a36;
    box-shadow: 5px 6px 0 rgb(90 26 54 / 24%);
    color: #321523;
  }
  :global(html[data-theme="cute"]) .imported-movement {
    background: #f1fff7;
    border-color: #4f765f;
  }
  :global(html[data-theme="cute"]) .imported-movement span {
    color: #4f765f;
  }

  .eyebrow {
    color: var(--color-primary);
    font-weight: 750;
    text-transform: uppercase;
  }

  .help {
    color: var(--color-text-muted);
    line-height: 1.45;
  }

  .movement-answer-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 1rem 0;
    min-width: 0;
  }

  .movement-answer-grid button {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .movement-answer-grid .quiet {
    grid-column: 1 / -1;
  }

  @media (max-width: 34rem) {
    .movement-checkin-backdrop {
      padding: 0;
      place-items: end center;
    }

    .movement-checkin {
      border-radius: 1rem 1rem 0 0;
      max-height: 92dvh;
      overflow-y: auto;
    }
  }
</style>
