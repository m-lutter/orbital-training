<script lang="ts">
  import type { UnitSystem } from "$lib/domain";
  import {
    calculatePlatePlan,
    isBarbellExercise,
    layoutPlateGeometry,
    type PlateDisplayMode,
  } from "./barbell-plates";

  interface Props {
    exerciseId: string;
    targetLoad?: number;
    units: UnitSystem;
    label: string;
  }

  let { exerciseId, targetLoad, units, label }: Props = $props();

  const modes: PlateDisplayMode[] = ["iron", "colored", "metric"];
  let modeIndex = $state(0);
  const mode = $derived(modes[modeIndex] ?? "iron");
  const plan = $derived(calculatePlatePlan(targetLoad ?? 0, units, mode));
  const visible = $derived(
    isBarbellExercise(exerciseId) &&
      targetLoad !== undefined &&
      targetLoad >= (units === "kg" ? 20 : 45),
  );
  const renderedPlates = $derived(
    layoutPlateGeometry(plan.plates.slice(0, 14), plan.unit, 6, 90),
  );
  const plateStackEnd = $derived.by(() => {
    const last = renderedPlates.at(-1);
    return (last?.x ?? 6) + (last?.width ?? 0);
  });
  const drawingWidth = $derived(Math.max(28, plateStackEnd + 6));

  function cycleMode(): void {
    modeIndex = (modeIndex + 1) % modes.length;
  }

  function modeName(): string {
    if (mode === "iron") return "iron plates";
    if (mode === "colored") return `color-coded ${units} plates`;
    return "color-coded kilogram plates";
  }
</script>

{#if visible}
  <button
    class="plate-display"
    type="button"
    onclick={cycleMode}
    aria-label={`${label}: ${plan.displayedTotal} ${plan.unit} shown with ${modeName()}. Select to change plate style.`}
  >
    <svg viewBox={`0 0 ${drawingWidth} 180`} role="img" aria-hidden="true">
      <defs>
        <linearGradient id="iron-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#343d46" />
          <stop offset="0.35" stop-color="#68737d" />
          <stop offset="0.52" stop-color="#a7afb6" />
          <stop offset="0.67" stop-color="#555f69" />
          <stop offset="1" stop-color="#202830" />
        </linearGradient>
        <linearGradient id="pink-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9c315f" />
          <stop offset=".34" stop-color="#d96f9f" />
          <stop offset=".52" stop-color="#f7bad4" />
          <stop offset=".68" stop-color="#c75287" />
          <stop offset="1" stop-color="#7e234c" />
        </linearGradient>
        <linearGradient id="plate-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="white" stop-opacity=".05" />
          <stop offset=".42" stop-color="white" stop-opacity=".08" />
          <stop offset=".55" stop-color="white" stop-opacity=".42" />
          <stop offset=".7" stop-color="white" stop-opacity=".04" />
          <stop offset="1" stop-color="#02070c" stop-opacity=".28" />
        </linearGradient>
      </defs>

      {#each renderedPlates as plate, index (`${plate.value}-${index}`)}
        <g>
          <rect
            x={plate.x}
            y={plate.y}
            width={plate.width}
            height={plate.height}
            rx="3"
            class:default-plate={mode === "iron"}
            fill={mode === "iron" ? "url(#iron-plate)" : plate.color}
            stroke={mode === "iron" ? "#88939d" : "rgb(255 255 255 / 58%)"}
            stroke-width="2"
          />
          <rect
            x={plate.x + 2}
            y={plate.y + 2}
            width={Math.max(1, plate.width - 4)}
            height={plate.height - 4}
            rx="2"
            fill="url(#plate-shine)"
          />
          <line
            x1={plate.x + 2.5}
            x2={plate.x + 2.5}
            y1={plate.y + 5}
            y2={plate.y + plate.height - 5}
            stroke="white"
            opacity=".25"
          />
          <line
            x1={plate.x + plate.width - 2}
            x2={plate.x + plate.width - 2}
            y1={plate.y + 4}
            y2={plate.y + plate.height - 4}
            stroke="#03070b"
            opacity=".38"
          />
        </g>
      {/each}
    </svg>
    <span class="plate-list" aria-hidden="true">
      <b>Per side</b>
      {#if plan.plates.length === 0}
        <span>No plates per side</span>
      {/if}
      {#each plan.plates as plate, index (`label-${plate.value}-${index}`)}
        <span>{plate.value}{plan.unit}</span>
      {/each}
    </span>
  </button>
{/if}

<style>
  .plate-display {
    background:
      linear-gradient(105deg, rgb(255 255 255 / 7%), transparent 40%), #091321 !important;
    border: 2px solid #4a718f !important;
    clip-path: none !important;
    color: var(--color-text) !important;
    display: block;
    margin-top: 0.75rem;
    max-width: 15rem;
    overflow: hidden;
    padding: 0.45rem 0.65rem !important;
    width: 100%;
  }
  .plate-display:hover {
    border-color: var(--color-primary) !important;
    box-shadow: 0 0 18px rgb(78 219 255 / 16%);
  }
  svg {
    display: block;
    height: 5rem;
    max-width: 100%;
    width: 100%;
  }
  .plate-list {
    align-items: center;
    color: var(--color-text-muted);
    display: flex;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    gap: 0.3rem;
    justify-content: center;
    margin-top: 0.25rem;
  }
  .plate-list b {
    color: var(--color-text);
    margin-right: 0.2rem;
  }
  .plate-list span + span::before {
    color: #6f859b;
    content: "·";
    margin-right: 0.3rem;
  }
  :global(html[data-theme="cute"]) .plate-display {
    background: #fff !important;
    border-color: #5a1a36 !important;
    box-shadow: none;
    color: #321523 !important;
  }
  :global(html[data-theme="cute"]) .plate-display:hover {
    border-color: #a20e52 !important;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 5px #68183d;
  }
  :global(html[data-theme="cute"]) .default-plate {
    fill: url(#pink-plate);
    stroke: #5a1a36;
  }
  :global(html[data-theme="cute"]) .plate-list,
  :global(html[data-theme="cute"]) .plate-list b {
    color: #694052;
  }
  @media (max-width: 520px) {
    svg {
      height: 4.5rem;
    }
  }
</style>
