<script lang="ts">
  import { enhance } from "$app/forms";
  import type { WearableDay } from "$lib/fitness/contracts";
  import {
    importedStepsMeetingGoal,
    wearableSourceLabel,
  } from "$lib/fitness/movement";
  import { untrack } from "svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
  type WearablePageData = PageData & { wearableDay?: WearableDay };
  const wearableDay = untrack(() => (data as WearablePageData).wearableDay);
  const importedSteps = untrack(() =>
    importedStepsMeetingGoal(wearableDay, data.target),
  );
  let answer = $state(
    untrack(() =>
      importedSteps !== undefined
        ? "yes"
        : data.existing?.met === true
          ? "yes"
          : data.existing?.met === false
            ? "no"
            : data.existing
              ? "untracked"
              : "",
    ),
  );
  let actual = $state(
    untrack(
      () =>
        importedSteps ??
        data.existing?.actualSteps ??
        data.existing?.actualWalkingMinutes,
    ),
  );
  let saved = $state(untrack(() => data.existing !== undefined));
</script>

<svelte:head><title>Daily movement | {data.program.name}</title></svelte:head>

<main class="mission-page movement-page">
  <a class="overview-button" href={`/programs/${data.program.id}`}
    >{data.program.name} · Overview</a
  >
  <section>
    <p class="mission-kicker">Week {data.weekNumber} · daily movement</p>
    <h1>{data.date}</h1>
    <p>
      Did you reach today’s <strong
        >{data.target.steps !== undefined
          ? `${data.target.steps.toLocaleString()}-step`
          : `${data.target.walkingMinutes}-minute walking`}</strong
      > target?
    </p>
    <form
      method="POST"
      action="?/save"
      use:enhance={() =>
        async ({ result, update }) => {
          saved = result.type === "success";
          await update({ reset: false, invalidateAll: false });
        }}
      oninput={() => (saved = false)}
    >
      {#if importedSteps !== undefined}
        <input name="answer" type="hidden" value="yes" />
        <input name="actual" type="hidden" value={importedSteps} />
        <div class="imported-movement" role="status">
          <strong>{importedSteps.toLocaleString()} steps imported</strong>
          <span>
            {wearableSourceLabel(wearableDay?.source ?? null)} reports that the movement
            goal was reached. Manual step entry is not needed.
          </span>
        </div>
      {:else}
        <div class="answer-grid">
          <label
            ><input
              type="radio"
              name="answer"
              value="yes"
              bind:group={answer}
              required
            />Yes</label
          >
          <label
            ><input
              type="radio"
              name="answer"
              value="no"
              bind:group={answer}
              required
            />Not today</label
          >
          <label
            ><input
              type="radio"
              name="answer"
              value="untracked"
              bind:group={answer}
              required
            />I couldn’t track it</label
          >
        </div>
        <label class="actual">
          {data.target.steps !== undefined
            ? "Steps today (optional)"
            : "Walking minutes today (optional)"}
          <input
            name="actual"
            type="number"
            min="0"
            max={data.target.steps !== undefined ? 250000 : 1440}
            step="1"
            bind:value={actual}
          />
        </label>
      {/if}
      <p class="help">
        One missed or untracked day will not reduce your workouts. A pattern
        over several days can guide a small future adjustment.
      </p>
      {#if form?.message}<p class:success={saved} class="message" role="status">
          {form.message}
        </p>{/if}
      <button type="submit" disabled={saved || answer === ""}
        >{saved ? "Movement saved" : "Save check-in"}</button
      >
    </form>
  </section>
</main>

<style>
  main {
    margin: 0 auto;
    padding: 1.25rem 0 5rem;
    width: min(42rem, calc(100% - 1rem));
  }
  .overview-button {
    display: inline-block;
    margin-bottom: 1rem;
  }
  section {
    padding: clamp(1rem, 4vw, 1.6rem);
  }
  h1 {
    margin: 0.2rem 0;
  }
  .answer-grid {
    display: grid;
    gap: 0.65rem;
    margin: 1rem 0;
  }
  .answer-grid label {
    align-items: center;
    background: rgb(7 15 27 / 62%);
    border: 1px solid #3b5872;
    display: flex;
    gap: 0.65rem;
    min-height: var(--touch-target);
    padding: 0.65rem;
  }
  .answer-grid input {
    height: 1.2rem;
    width: 1.2rem;
  }
  .actual {
    display: grid;
    gap: 0.4rem;
  }
  .actual input {
    font-size: 16px;
    min-height: var(--touch-target);
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
  }
  .help {
    color: var(--color-text-muted);
    line-height: 1.45;
  }
  .message {
    color: #ffd6da;
  }
  .message.success {
    color: #baffdf;
  }
  button {
    min-height: var(--touch-target);
    width: 100%;
  }
  :global(html[data-theme="cute"]) .movement-page .overview-button {
    background: #fff;
    border: 2px solid #a20e52;
    border-radius: 999px;
    box-shadow: 0 3px 0 #5a1a36;
    color: #7a093d;
    font-weight: 800;
    padding: 0.55rem 0.8rem;
    text-decoration: none;
  }
  :global(html[data-theme="cute"]) .movement-page .answer-grid label {
    background: #fff;
    border: 2px solid #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"])
    .movement-page
    .answer-grid
    label:has(input:checked) {
    background: #ffe2ed;
    border-color: #a20e52;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 5px #68183d;
  }
  :global(html[data-theme="cute"]) .movement-page .message {
    color: #74243c;
  }
  :global(html[data-theme="cute"]) .movement-page .message.success {
    color: #4f765f;
  }
  :global(html[data-theme="cute"]) .movement-page .imported-movement {
    background: #f1fff7;
    border-color: #4f765f;
  }
</style>
