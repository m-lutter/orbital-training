<script lang="ts">
  import type {
    HeartRateTargetBand,
    HeartRateZoneProfile,
    WorkoutHeartRateContract,
  } from "$lib/fitness/contracts";
  import {
    heartRateChartModel,
    heartRatePoints,
    heartRateZoneForBpm,
    heartRateZones,
    type HeartRateChartModel,
  } from "$lib/fitness/workout-capture";

  let {
    telemetry,
    live = false,
    zoneProfile = null,
    targetBand = null,
  }: {
    telemetry: WorkoutHeartRateContract;
    live?: boolean;
    zoneProfile?: HeartRateZoneProfile | null;
    targetBand?: HeartRateTargetBand | null;
  } = $props();

  let points = $derived(heartRatePoints(telemetry));
  let zones = $derived(heartRateZones(zoneProfile));
  let chart = $derived(
    heartRateChartModel(points, 640, 220, 28, {
      startedAt: telemetry.startedAt,
      endedAt:
        telemetry.endedAt ?? telemetry.checkedAt ?? points.at(-1)?.recordedAt,
      minimumBpm: zones.at(0)?.minimumBpm,
      maximumBpm: zones.at(-1)?.maximumBpm,
    }),
  );
  let currentZone = $derived(heartRateZoneForBpm(zones, chart?.latestBpm));
  let zoneBands = $derived.by(() =>
    chart === undefined
      ? []
      : zones.flatMap((zone) => {
          const top = yForBpm(zone.maximumBpm, chart);
          const bottom = yForBpm(zone.minimumBpm, chart);
          if (bottom < 28 || top > 192) return [];
          return [
            {
              ...zone,
              y: Math.max(28, top),
              height: Math.max(0, Math.min(192, bottom) - Math.max(28, top)),
            },
          ];
        }),
  );
  let target = $derived.by(() => {
    if (chart === undefined || targetBand === null) return undefined;
    const top = yForBpm(targetBand.max, chart);
    const bottom = yForBpm(targetBand.min, chart);
    return {
      y: Math.max(28, top),
      height: Math.max(0, Math.min(192, bottom) - Math.max(28, top)),
    };
  });

  function yForBpm(bpm: number, model: HeartRateChartModel): number {
    const range = Math.max(1, model.plotMaximumBpm - model.plotMinimumBpm);
    return 28 + ((model.plotMaximumBpm - bpm) / range) * 164;
  }

  function timeLabel(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  }

  function providerLabel(
    provider: WorkoutHeartRateContract["provider"],
  ): string {
    if (provider === "google_health") return "Google Health";
    if (provider === "apple_health") return "Apple Health";
    if (provider === "health_connect") return "Health Connect";
    return "connected source";
  }
</script>

<section class="heart-rate-card" aria-labelledby="heart-rate-chart-title">
  <div class="heart-rate-heading">
    <div>
      <p class="eyebrow">
        {live ? "Live workout data" : "Imported workout data"}
      </p>
      <h3 id="heart-rate-chart-title">Heart rate over time</h3>
    </div>
    <div class="heading-status">
      {#if chart}<strong>{chart.averageBpm} bpm average</strong>{/if}
      <span class:live class="chart-state">
        {live ? "Live · latest available" : "Capture ended"}
      </span>
    </div>
  </div>

  {#if chart}
    <div class="latest-heart-rate" aria-live="polite">
      <strong>{chart.latestBpm}<small> bpm</small></strong>
      <span>
        Latest at {timeLabel(chart.endedAt)}
        {#if currentZone}
          · {currentZone.label}{/if}
      </span>
    </div>
    <div class="heart-rate-stats" aria-label="Heart-rate summary">
      <span><b>{chart.minimumBpm}</b> minimum</span>
      <span><b>{chart.averageBpm}</b> average</span>
      <span><b>{chart.maximumBpm}</b> maximum</span>
    </div>
    <svg
      class="heart-rate-chart"
      viewBox="0 0 640 220"
      role="img"
      aria-label={`Heart rate from ${chart.minimumBpm} to ${chart.maximumBpm} beats per minute between ${timeLabel(chart.startedAt)} and ${timeLabel(chart.endedAt)}.`}
      preserveAspectRatio="none"
    >
      {#each zoneBands as band (band.key)}
        <rect
          x="28"
          y={band.y}
          width="584"
          height={band.height}
          class={`zone-band ${band.key}`}
        />
      {/each}
      {#if target && target.height > 0}
        <rect
          x="28"
          y={target.y}
          width="584"
          height={target.height}
          class="target-band"
        />
      {/if}
      <line x1="28" y1="28" x2="28" y2="192" class="axis" />
      <line x1="28" y1="192" x2="612" y2="192" class="axis" />
      {#each chart.polylines as polyline}
        {#if polyline.includes(" ")}
          <polyline points={polyline} class="heart-rate-line" />
        {/if}
      {/each}
      <circle
        cx={chart.latestX}
        cy={chart.latestY}
        r="6"
        class="latest-point"
        aria-hidden="true"
      />
    </svg>
    <div class="chart-time-range" aria-hidden="true">
      <span>{timeLabel(telemetry.startedAt ?? chart.startedAt)}</span>
      <span>{live ? "Now" : timeLabel(telemetry.endedAt ?? chart.endedAt)}</span
      >
    </div>
    {#if zones.length > 0}
      <div class="zone-legend" aria-label="Heart-rate zones">
        {#each zones as zone (zone.key)}
          <span class:current={currentZone?.key === zone.key}>
            <i class={zone.key}></i>
            {zone.label}
            {zone.minimumBpm}–{zone.maximumBpm}
          </span>
        {/each}
      </div>
      <p class="zone-note">
        Zones use your saved maximum heart rate{zoneProfile?.method ===
        "heart_rate_reserve"
          ? " and resting heart rate"
          : ""}.
        {#if targetBand}
          The outlined band is this workout's target.{/if}
      </p>
    {/if}
    <p class="chart-note">
      {chart.sampleCount.toLocaleString()} source sample{chart.sampleCount === 1
        ? ""
        : "s"} from {providerLabel(telemetry.provider)}. Gaps mean the device or
      health service had not supplied data for that interval.
    </p>
  {:else}
    <p class="empty-telemetry" role="status">
      {#if live}
        Waiting for the first heart-rate sample. Keep the wearable on and sync
        its health app if no data appears.
      {:else}
        The workout ended, but no heart-rate samples are available yet. The
        saved capture can still import data after the connected source syncs.
      {/if}
    </p>
  {/if}
</section>

<style>
  .heart-rate-card,
  .heart-rate-card * {
    box-sizing: border-box;
  }
  .heart-rate-card {
    background: rgb(5 15 28 / 62%);
    border: 1px solid #426985;
    border-radius: 0.7rem;
    color: var(--color-text);
    margin-top: 0.85rem;
    padding: 0.85rem;
  }
  .heart-rate-heading,
  .heart-rate-stats,
  .chart-time-range {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }
  .heart-rate-heading h3,
  .heart-rate-heading p {
    margin: 0.15rem 0;
  }
  .chart-state {
    border: 1px solid #688198;
    border-radius: 999px;
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 800;
    padding: 0.3rem 0.55rem;
    white-space: nowrap;
  }
  .heading-status {
    align-items: flex-end;
    display: grid;
    gap: 0.35rem;
    justify-items: end;
  }
  .heading-status > strong {
    color: var(--color-primary);
    font-size: 0.82rem;
    white-space: nowrap;
  }
  .chart-state.live {
    background: rgb(59 227 162 / 11%);
    border-color: #3be3a2;
    color: #baffdf;
  }
  .latest-heart-rate {
    align-items: baseline;
    display: flex;
    gap: 0.65rem;
    margin-top: 0.65rem;
  }
  .latest-heart-rate strong {
    color: var(--color-primary);
    font-size: 1.8rem;
    line-height: 1;
  }
  .latest-heart-rate small,
  .latest-heart-rate span {
    color: var(--color-text-muted);
    font-size: 0.78rem;
  }
  .heart-rate-stats {
    margin: 0.8rem 0 0.35rem;
  }
  .heart-rate-stats span {
    color: var(--color-text-muted);
    display: grid;
    font-size: 0.78rem;
    gap: 0.1rem;
  }
  .heart-rate-stats b {
    color: var(--color-text);
    font-size: 1rem;
  }
  .heart-rate-chart {
    display: block;
    height: 13rem;
    overflow: visible;
    width: 100%;
  }
  .axis {
    stroke: rgb(190 208 225 / 35%);
    stroke-width: 1;
  }
  .zone-band {
    opacity: 0.14;
  }
  .zone-band.z1,
  .zone-legend i.z1 {
    fill: #7dd3fc;
    background: #7dd3fc;
  }
  .zone-band.z2,
  .zone-legend i.z2 {
    fill: #5eead4;
    background: #5eead4;
  }
  .zone-band.z3,
  .zone-legend i.z3 {
    fill: #fde047;
    background: #fde047;
  }
  .zone-band.z4,
  .zone-legend i.z4 {
    fill: #fb923c;
    background: #fb923c;
  }
  .zone-band.z5,
  .zone-legend i.z5 {
    fill: #fb7185;
    background: #fb7185;
  }
  .target-band {
    fill: rgb(255 255 255 / 4%);
    stroke: rgb(255 255 255 / 72%);
    stroke-dasharray: 7 5;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .heart-rate-line {
    fill: none;
    filter: drop-shadow(0 0 5px rgb(78 219 255 / 42%));
    stroke: #58d8f5;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 4;
    vector-effect: non-scaling-stroke;
  }
  .latest-point {
    fill: #d9f9ff;
    stroke: #148ca8;
    stroke-width: 3;
    vector-effect: non-scaling-stroke;
  }
  .chart-time-range,
  .chart-note,
  .empty-telemetry,
  .zone-note {
    color: var(--color-text-muted);
    font-size: 0.78rem;
  }
  .zone-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.65rem;
  }
  .zone-legend span {
    align-items: center;
    border: 1px solid transparent;
    border-radius: 999px;
    color: var(--color-text-muted);
    display: inline-flex;
    font-size: 0.7rem;
    gap: 0.3rem;
    padding: 0.2rem 0.4rem;
  }
  .zone-legend span.current {
    border-color: var(--color-primary);
    color: var(--color-text);
    font-weight: 800;
  }
  .zone-legend i {
    border-radius: 50%;
    display: inline-block;
    height: 0.55rem;
    width: 0.55rem;
  }
  .zone-note,
  .chart-note {
    margin-bottom: 0;
  }
  .zone-note {
    margin-top: 0.45rem;
  }
  :global(html[data-theme="cute"]) .heart-rate-card {
    background: rgb(255 249 252 / 92%);
    border: 2px solid #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .latest-heart-rate strong,
  :global(html[data-theme="cute"]) .heading-status > strong,
  :global(html[data-theme="cute"]) .heart-rate-stats b {
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .chart-state.live {
    background: #ffe2ed;
    border-color: #a20e52;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .heart-rate-line {
    filter: none;
    stroke: #a20e52;
  }
  :global(html[data-theme="cute"]) .latest-point {
    fill: #fff;
    stroke: #a20e52;
  }
  :global(html[data-theme="cute"]) .axis {
    stroke: rgb(90 26 54 / 35%);
  }
  :global(html[data-theme="cute"]) .target-band {
    stroke: #5a1a36;
  }
  @media (max-width: 34rem) {
    .heart-rate-heading {
      align-items: start;
      display: grid;
    }
    .heading-status {
      grid-row: 1;
      justify-self: start;
      justify-items: start;
    }
    .heart-rate-chart {
      height: 10rem;
    }
  }
</style>
