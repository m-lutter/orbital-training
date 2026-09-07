<script lang="ts">
  import {
    createCardioModalityVariant,
    type CardioModality,
    type CardioPrescription,
  } from "$lib/domain";
  import type { LoggedCardio } from "$lib/workouts";

  type Surface = NonNullable<LoggedCardio["surface"]> | "";
  type Source = NonNullable<LoggedCardio["source"]>;

  let {
    cardio: originalCardio,
    availableModalities = [],
    runningEvent = false,
    selectedModality = $bindable<CardioModality | undefined>(),
    distanceUnit,
    elevationUnit,
    hasHeartRateDevice,
    completedMinutes = $bindable<number | undefined>(),
    movingMinutes = $bindable<number | undefined>(),
    sessionRpe = $bindable<number | undefined>(),
    distance = $bindable<number | undefined>(),
    steps = $bindable<number | undefined>(),
    completedIntervals = $bindable<number | undefined>(),
    averageHeartRate = $bindable<number | undefined>(),
    maxHeartRate = $bindable<number | undefined>(),
    elevationGain = $bindable<number | undefined>(),
    surface = $bindable<Surface>(""),
    source = $bindable<Source>("manual"),
    oncompletedminutesinput,
  }: {
    cardio: CardioPrescription;
    availableModalities?: CardioModality[];
    runningEvent?: boolean;
    selectedModality?: CardioModality;
    distanceUnit: "mi" | "km";
    elevationUnit: "ft" | "m";
    hasHeartRateDevice: boolean;
    completedMinutes?: number;
    movingMinutes?: number;
    sessionRpe?: number;
    distance?: number;
    steps?: number;
    completedIntervals?: number;
    averageHeartRate?: number;
    maxHeartRate?: number;
    elevationGain?: number;
    surface?: Surface;
    source?: Source;
    oncompletedminutesinput?: () => void;
  } = $props();

  const cardio = $derived(
    createCardioModalityVariant(
      originalCardio,
      selectedModality ?? originalCardio.modality,
    ),
  );
  const modalityOptions = $derived([
    ...new Set([
      originalCardio.modality,
      ...availableModalities,
      ...(selectedModality === undefined ? [] : [selectedModality]),
    ]),
  ]);

  function changeModality(event: Event): void {
    selectedModality = (event.currentTarget as HTMLSelectElement)
      .value as CardioModality;
    // Measurements from one activity cannot silently become another's result.
    distance = undefined;
    steps = undefined;
    averageHeartRate = undefined;
    maxHeartRate = undefined;
    elevationGain = undefined;
    surface = "";
    source = "manual";
  }

  function titleCase(value: string): string {
    return value
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function pointTarget(min: number, max: number): number {
    return Math.round(((min + max) / 2) * 2) / 2;
  }

  function formatPace(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
  }
</script>

<section class="cardio-card">
  <label class="modality-selector">
    Cardio activity for this workout
    <select
      name="cardio.modality"
      value={selectedModality ?? originalCardio.modality}
      onchange={changeModality}
    >
      {#each modalityOptions as modality}
        <option value={modality}
          >{titleCase(modality)}{modality === originalCardio.modality
            ? " (prescribed)"
            : !availableModalities.includes(modality)
              ? " (previously saved)"
              : ""}</option
        >
      {/each}
    </select>
  </label>
  <p class="cardio-switch-note">
    Choose another available activity if needed. This changes only this workout;
    keep the prescribed minutes, effort, and interval timing.
  </p>
  {#if cardio.modality !== originalCardio.modality}
    <p class="cardio-switch-note">
      Activity changed. Original pace, distance, and heart-rate targets do not
      transfer. Enter any activity-specific measurements again.
    </p>
  {/if}
  {#if runningEvent && cardio.modality !== "running"}
    <p class="cardio-switch-warning" role="status">
      This alternative maintains aerobic work but does not replace
      running-specific preparation for your event.
    </p>
  {/if}
  <h2>
    {cardio.role
      ? `${titleCase(cardio.role)} ${titleCase(cardio.modality)}`
      : `${titleCase(cardio.modality)} cardio`}
  </h2>
  <p>
    {cardio.minutes} minutes · {titleCase(cardio.intensity)} · target RPE
    {pointTarget(cardio.sessionRpe.min, cardio.sessionRpe.max)}
  </p>
  {#if cardio.eventPhase}
    <p class="cardio-role-note">Event phase: {titleCase(cardio.eventPhase)}</p>
  {/if}
  {#if cardio.targetDistance}
    <p>
      Distance target:
      <strong>{cardio.targetDistance.value} {cardio.targetDistance.unit}</strong
      >
    </p>
  {/if}
  {#if cardio.paceTarget}
    <p>
      Optional pace guide:
      <strong>
        {formatPace(cardio.paceTarget.minSecondsPerUnit)}–{formatPace(
          cardio.paceTarget.maxSecondsPerUnit,
        )} per {cardio.paceTarget.unit}
      </strong>. Use the effort guide instead when hills, heat, wind, or fatigue
      make that pace inappropriate.
    </p>
  {/if}
  {#if cardio.intervals}
    <p class="interval-summary">
      {cardio.intervals.repeats} × {cardio.intervals.workSeconds}-second work
      intervals, with {cardio.intervals.recoverySeconds} seconds easy between them.
    </p>
  {/if}
  {#if cardio.segments && cardio.segments.length > 0}
    <ol class="cardio-segments" aria-label="Workout steps">
      {#each cardio.segments as segment}
        <li>
          <strong>{segment.label}</strong>
          {#if segment.minutes}
            <span>{segment.minutes} min</span>
          {:else if segment.repeats}
            <span>{segment.repeats} rounds</span>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
  <p class="effort-guidance">{cardio.talkTest}</p>
  {#if cardio.heartRateBpm}
    <p>
      Optional heart-rate guide: {cardio.heartRateBpm.min}–{cardio.heartRateBpm
        .max} bpm. Your breathing and effort rating matter more if the numbers do
      not match how you feel.
    </p>
  {/if}
  <div class="cardio-inputs">
    <label>
      Minutes completed
      <input
        name="cardio.completedMinutes"
        type="number"
        min="0"
        max="1440"
        bind:value={completedMinutes}
        oninput={oncompletedminutesinput}
      />
    </label>
    <label>
      Moving time (minutes, optional)
      <input
        name="cardio.movingMinutes"
        type="number"
        min="0"
        max="1440"
        step="0.1"
        bind:value={movingMinutes}
      />
    </label>
    {#if cardio.intervals}
      <label>
        Work intervals completed
        <input
          name="cardio.completedIntervals"
          type="number"
          min="0"
          max="1000"
          step="1"
          bind:value={completedIntervals}
        />
        <small>Planned: {cardio.intervals.repeats}</small>
      </label>
    {/if}
    <label>
      How hard did the whole cardio session feel? (RPE 1–10)
      <input
        name="cardio.sessionRpe"
        type="number"
        min="1"
        max="10"
        step="0.5"
        bind:value={sessionRpe}
      />
    </label>
    <label>
      Distance ({distanceUnit}, optional)
      <input
        name="cardio.distance"
        type="number"
        min="0"
        max="1000"
        step="0.01"
        bind:value={distance}
      />
    </label>
    <label>
      Steps during this session (optional)
      <input
        name="cardio.steps"
        type="number"
        min="0"
        max="250000"
        step="1"
        bind:value={steps}
      />
    </label>
    {#if hasHeartRateDevice}
      <label>
        Average heart rate (optional)
        <input
          name="cardio.averageHeartRate"
          type="number"
          min="25"
          max="240"
          step="1"
          bind:value={averageHeartRate}
        />
      </label>
      <label>
        Maximum heart rate (optional)
        <input
          name="cardio.maxHeartRate"
          type="number"
          min="25"
          max="250"
          step="1"
          bind:value={maxHeartRate}
        />
      </label>
    {/if}
    {#if ["running", "walking", "rucking"].includes(cardio.modality)}
      <label>
        Elevation gained ({elevationUnit}, optional)
        <input
          name="cardio.elevationGain"
          type="number"
          min="0"
          max="100000"
          step="1"
          bind:value={elevationGain}
        />
      </label>
      <label>
        Surface (optional)
        <select name="cardio.surface" bind:value={surface}>
          <option value="">Not recorded</option>
          <option value="road">Road</option>
          <option value="track">Track</option>
          <option value="trail">Trail</option>
          <option value="treadmill">Treadmill</option>
          <option value="mixed">Mixed</option>
          <option value="other">Other</option>
        </select>
      </label>
    {/if}
    <label>
      Where did these numbers come from?
      <select name="cardio.source" bind:value={source}>
        <option value="manual">Entered by me</option>
        <option value="watch">Watch / fitness tracker</option>
        <option value="treadmill">Treadmill</option>
        <option value="bike">Bike computer</option>
        <option value="other">Other device</option>
      </select>
    </label>
  </div>
</section>

<style>
  .cardio-card,
  .cardio-card * {
    box-sizing: border-box;
  }

  .cardio-card {
    background:
      linear-gradient(115deg, rgb(255 255 255 / 3%), transparent 25%),
      linear-gradient(180deg, rgb(17 29 46 / 98%), rgb(9 17 30 / 98%));
    border: 1px solid #314b64;
    border-radius: 0.8rem;
    box-shadow: var(--shadow-card);
    margin: 1rem 0;
    max-width: 100%;
    min-width: 0;
    overflow-wrap: anywhere;
    padding: 1rem;
    width: 100%;
  }

  .cardio-role-note {
    color: var(--color-primary);
    font-weight: 750;
  }

  .modality-selector {
    display: grid;
    gap: 0.35rem;
    font-weight: 650;
  }

  .modality-selector select {
    background: #07101e;
    border: 1px solid #3a526e;
    color: var(--color-text);
    min-height: var(--touch-target);
    padding: 0.65rem;
    width: 100%;
  }

  .cardio-switch-note {
    color: var(--color-text-muted);
  }
  .cardio-switch-warning {
    border-left: 3px solid #f0c36d;
    padding-left: 0.75rem;
  }

  .effort-guidance {
    font-weight: 650;
  }

  .cardio-segments {
    display: grid;
    gap: 0.55rem;
    list-style-position: inside;
    padding: 0;
  }

  .cardio-segments li {
    align-items: center;
    background: rgb(78 219 255 / 7%);
    border: 1px solid var(--color-border);
    border-radius: 0.45rem;
    display: flex;
    gap: 0.7rem;
    justify-content: space-between;
    min-width: 0;
    padding: 0.65rem 0.75rem;
  }

  .cardio-segments span {
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .cardio-inputs {
    display: grid;
    gap: 0.8rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cardio-inputs label {
    display: grid;
    font-weight: 650;
    gap: 0.35rem;
    min-width: 0;
  }

  .cardio-inputs input,
  .cardio-inputs select {
    background: #07101e;
    border: 1px solid #3a526e;
    color: var(--color-text);
    min-height: var(--touch-target);
    padding: 0.65rem;
    width: 100%;
  }

  .cardio-inputs small {
    color: var(--color-text-muted);
    font-weight: 400;
  }

  @media (max-width: 680px) {
    .cardio-inputs {
      grid-template-columns: 1fr;
    }

    .cardio-inputs input,
    .cardio-inputs select {
      font-size: 16px;
    }
  }
</style>
