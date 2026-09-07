<script lang="ts">
  import type { TrainingSession, UnitSystem } from "$lib/domain";
  import { prescribedRepTarget } from "$lib/workouts";

  let {
    session,
    units,
    exerciseNames = {},
    loadTargets = {},
  }: {
    session: TrainingSession;
    units: UnitSystem;
    exerciseNames?: Record<string, string>;
    loadTargets?: Record<string, number | undefined>;
  } = $props();

  const alternative = $derived(session.durationAlternative);
  const rows = $derived.by(() => {
    if (!alternative) return [];
    const prescriptions = new Map(
      session.exercises.map((item) => [item.id, item]),
    );
    const proposed = new Map(
      alternative.prescriptions.map((item) => [item.prescriptionId, item.sets]),
    );
    // Never present an obsolete or malformed proposal as permission to omit
    // mandatory work. The full prescription remains authoritative.
    if (
      proposed.size !== alternative.prescriptions.length ||
      alternative.prescriptions.some((item) => {
        const original = prescriptions.get(item.prescriptionId);
        return (
          !original ||
          !Number.isInteger(item.sets) ||
          item.sets < 1 ||
          item.sets > original.sets
        );
      }) ||
      session.exercises.some(
        (item) => !item.optional && proposed.get(item.id) !== item.sets,
      )
    )
      return [];
    return session.exercises.map((item) => ({
      id: item.id,
      name: exerciseNames[item.id] ?? item.name,
      sets: proposed.get(item.id) ?? 0,
      omittedSets: item.sets - (proposed.get(item.id) ?? 0),
      reps: prescribedRepTarget(item),
      rir: Math.round(((item.targetRir.min + item.targetRir.max) / 2) * 2) / 2,
      restSeconds: item.restSeconds,
      load: Object.hasOwn(loadTargets, item.id)
        ? loadTargets[item.id]
        : item.load,
    }));
  });
</script>

{#if alternative && rows.length > 0}
  <details class="shorter-option">
    <summary
      >Optional shorter lifting plan · about {alternative.predictedMinutes} minutes</summary
    >
    <p>
      Lifting estimate: {alternative.predictedMinutes} minutes · time guideline: {alternative.targetMinutes}
      minutes.
    </p>
    {#if alternative.predictedMinutes > alternative.targetMinutes}
      <p class="time-warning">
        Required work still exceeds your time guideline. This is not a promise
        that the workout fits.
      </p>
    {/if}
    <p>
      This is an optional plan for today. Opening it does not change your
      workout, future prescriptions, or saved history.
    </p>
    <ol aria-label="Exact shorter-plan prescriptions">
      {#each rows as row (row.id)}
        <li>
          <strong>{row.name}</strong>
          {#if row.sets === 0}
            <span>0 sets today · skip this optional exercise for time.</span>
          {:else}
            <span
              >{row.sets}
              {row.sets === 1 ? "set" : "sets"} × {row.reps} reps · stop at {row.rir}
              RIR · rest {row.restSeconds} seconds.</span
            >
            <span
              >{row.load === undefined
                ? "Calibrate the load using the exact reps and effort above."
                : `Load: ${row.load} ${units}.`}</span
            >
            {#if row.omittedSets > 0}<span
                >Skip the remaining {row.omittedSets} optional {row.omittedSets ===
                1
                  ? "set"
                  : "sets"} for time.</span
              >{/if}
          {/if}
        </li>
      {/each}
    </ol>
    <p>
      Use the existing workout form to log only the sets you perform. Leave
      omitted optional sets incomplete and mark the exercise as skipped for
      time. Do not mark omitted sets completed. There is no catch-up debt: do
      not add them to a later workout.
    </p>
    {#if session.cardio}<p>
        Keep the cardio prescription unchanged. Its {session.cardio.minutes} minutes
        are additional to the lifting estimate.
      </p>{/if}
  </details>
{/if}

<style>
  .shorter-option {
    border: 1px solid var(--color-border);
    border-radius: 0.8rem;
    margin: 1rem 0;
    padding: 1rem;
    overflow-wrap: anywhere;
  }
  summary {
    cursor: pointer;
    font-weight: 750;
  }
  ol {
    display: grid;
    gap: 0.8rem;
    padding-left: 1.4rem;
  }
  li strong,
  li span {
    display: block;
  }
  li span {
    margin-top: 0.2rem;
  }
  .time-warning {
    border-left: 3px solid #f0c36d;
    padding-left: 0.75rem;
  }
</style>
