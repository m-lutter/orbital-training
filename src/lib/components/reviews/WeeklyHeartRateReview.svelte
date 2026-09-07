<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import {
    weeklyHeartRateOverlayModel,
    type WeeklyHeartRateOverlayModel,
    type WeeklyHeartRateReviewData,
    type WeeklyHeartRateSeriesMarker,
    type WeeklyHeartRateSeriesModel,
    type WeeklyHeartRateSeriesStyle,
  } from "$lib/reviews/heart-rate";

  let {
    heartRate = undefined,
    refresh = invalidateAll,
  }: {
    heartRate?: WeeklyHeartRateReviewData | null;
    refresh?: () => Promise<void>;
  } = $props();

  let status = $derived(heartRate?.status ?? "unavailable");
  let connected = $derived(status === "ready" || status === "awaiting_sync");
  let checking = $state(false);
  let checkMessage = $state<string>();
  let hiddenWorkoutIds = $state<string[]>([]);
  let overlay = $derived(
    weeklyHeartRateOverlayModel(heartRate?.workouts ?? []),
  );
  let plottedSeries = $derived(
    overlay.series.filter((series) => series.segments.length > 0),
  );
  let visiblePlottedSeries = $derived(
    plottedSeries.filter(
      (series) => !hiddenWorkoutIds.includes(series.workout.id),
    ),
  );
  let visibleDrawSeries = $derived(
    [...visiblePlottedSeries].sort(
      (left, right) =>
        left.style.dashIndex - right.style.dashIndex ||
        left.style.slot - right.style.slot,
    ),
  );
  let visibleBucketCount = $derived(
    visiblePlottedSeries.reduce(
      (total, series) => total + series.bucketCount,
      0,
    ),
  );
  let visibleSourceSampleCount = $derived(
    visiblePlottedSeries.reduce(
      (total, series) => total + series.sourceSampleCount,
      0,
    ),
  );
  let midpointBpm = $derived(
    Math.round((overlay.domain.minimumBpm + overlay.domain.maximumBpm) / 2),
  );

  function dateLabel(value: string): string {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return "Workout date unavailable";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(parsed);
  }

  function syncLabel(value: string): string | undefined {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return undefined;
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
  }

  function durationLabel(minutes: number | undefined): string {
    if (!Number.isFinite(minutes) || minutes === undefined || minutes <= 0)
      return "Duration unavailable";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours} hr${hours === 1 ? "" : "s"}${remainder === 0 ? "" : ` ${remainder} min`}`;
  }

  function providerLabel(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    if (value === "google_health") return "Google Health";
    if (value === "apple_health") return "Apple Health";
    if (value === "health_connect") return "Health Connect";
    return value
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function seriesClass(style: WeeklyHeartRateSeriesStyle): string {
    return `series-color-${style.colorIndex} series-dash-${style.dashIndex}`;
  }

  function markerClass(style: WeeklyHeartRateSeriesStyle): string {
    return `series-color-${style.colorIndex} marker-${style.marker}`;
  }

  function markerStart(marker: WeeklyHeartRateSeriesMarker, y: number): number {
    return marker === "tick" ? y - 3 : y;
  }

  function markerEnd(marker: WeeklyHeartRateSeriesMarker, y: number): number {
    return marker === "tick" ? y + 3 : y + 0.01;
  }

  function bpmLabel(value: number | undefined): string {
    return value === undefined ? "—" : `${value} bpm`;
  }

  function chartLabel(
    model: WeeklyHeartRateOverlayModel,
    visibleCount: number,
  ): string {
    const visibility =
      visibleCount === 0
        ? "No workout traces are currently shown."
        : `${visibleCount} of ${model.plottedWorkoutCount} workout trace${visibleCount === 1 ? " is" : "s are"} shown.`;
    return `${visibility} The horizontal axis is percent of logged workout duration from 0 to 100. The vertical axis is heart rate from ${model.domain.minimumBpm} to ${model.domain.maximumBpm} beats per minute.`;
  }

  function isSeriesVisible(series: WeeklyHeartRateSeriesModel): boolean {
    return !hiddenWorkoutIds.includes(series.workout.id);
  }

  function toggleSeries(series: WeeklyHeartRateSeriesModel): void {
    hiddenWorkoutIds = isSeriesVisible(series)
      ? [...hiddenWorkoutIds, series.workout.id]
      : hiddenWorkoutIds.filter((id) => id !== series.workout.id);
  }

  function localDate(now = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function checkForSyncedData(): Promise<void> {
    if (checking || !connected) return;
    checking = true;
    checkMessage = undefined;
    try {
      const response = await fetch("/api/fitness/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          localDate: localDate(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          trigger: "manual",
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        configured?: boolean;
        failed?: number;
        succeeded?: number;
      };
      if (!response.ok) throw new Error("Health sync request failed.");

      try {
        await refresh();
      } catch {
        checkMessage =
          "Sync finished, but this review could not refresh. Reload it to check again.";
        return;
      }

      checkMessage =
        result.configured === false
          ? "Health sync is not configured on this server yet."
          : (result.failed ?? 0) > 0 && (result.succeeded ?? 0) === 0
            ? "The connected health source could not sync. Try again later."
            : (result.succeeded ?? 0) > 0
              ? "Sync finished. This review now shows the latest available data."
              : "Sync checked. No new workout heart-rate data is available yet.";
    } catch {
      checkMessage =
        "Could not check for synced heart-rate data. Try again in a moment.";
    } finally {
      checking = false;
    }
  }
</script>

<section
  class="weekly-heart-rate"
  aria-labelledby="weekly-heart-rate-title"
  data-sync-status={status}
>
  <div class="review-heading">
    <div>
      <p class="eyebrow">After your health app syncs</p>
      <h2 id="weekly-heart-rate-title">Heart rate from your workouts</h2>
      <p class="intro">
        Compare the shape of each workout on the same elapsed-duration scale.
        These are retrospective traces, not a live feed.
      </p>
    </div>
    {#if connected}
      <div class="sync-controls">
        {#if heartRate?.lastSyncedAt && syncLabel(heartRate.lastSyncedAt)}
          <p class="sync-time">
            Last health sync<br /><strong
              >{syncLabel(heartRate.lastSyncedAt)}</strong
            >
          </p>
        {/if}
        <button
          class="sync-button"
          type="button"
          disabled={checking}
          onclick={checkForSyncedData}
        >
          {checking ? "Checking for synced data…" : "Check for synced data"}
        </button>
      </div>
    {/if}
  </div>

  {#if checkMessage}
    <p class="check-message" role="status">{checkMessage}</p>
  {/if}

  {#if status === "ready" && overlay.series.length > 0}
    {#if plottedSeries.length > 0}
      <div class="plot-heading">
        <div>
          <h3>Workout traces by elapsed time</h3>
          <p>
            Every line is a five-minute average. Color, dash, marker, and the
            labeled list identify each workout.
          </p>
        </div>
      </div>
      <div class="plot-label-row" aria-hidden="true">
        <span>Heart rate (bpm)</span>
        <span>5-minute average</span>
      </div>
      <div class="plot-layout">
        <div class="y-axis" aria-hidden="true">
          <span>{overlay.domain.maximumBpm}</span>
          <span>{midpointBpm}</span>
          <span>{overlay.domain.minimumBpm}</span>
        </div>
        <div class="plot-column">
          <svg
            class="heart-rate-plot"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={chartLabel(overlay, visiblePlottedSeries.length)}
            aria-describedby="weekly-heart-rate-chart-description weekly-heart-rate-series"
          >
            <title>Workout heart-rate comparison by elapsed duration</title>
            <desc>
              Missing intervals are shown as breaks. Series details follow the
              chart.
            </desc>
            <line x1="2" y1="2" x2="98" y2="2" class="grid-line" />
            <line x1="2" y1="50" x2="98" y2="50" class="grid-line" />
            <line x1="2" y1="98" x2="98" y2="98" class="grid-line" />
            <line x1="2" y1="2" x2="2" y2="98" class="grid-line" />
            <line x1="50" y1="2" x2="50" y2="98" class="grid-line" />
            <line x1="98" y1="2" x2="98" y2="98" class="grid-line" />
            {#each visibleDrawSeries as series (series.workout.id)}
              <g
                data-workout-id={series.workout.id}
                data-style-slot={series.style.slot}
              >
                <title>
                  {series.workout.label}: {bpmLabel(series.averageBpm)} average,
                  {bpmLabel(series.maximumBpm)} peak
                </title>
                {#each series.segments as segment}
                  {#if segment.pointCount > 1}
                    <polyline
                      points={segment.averagePoints}
                      class={`series-line ${seriesClass(series.style)}`}
                      data-workout-id={series.workout.id}
                    />
                  {/if}
                  <line
                    x1={segment.endPoint.x}
                    y1={markerStart(series.style.marker, segment.endPoint.y)}
                    x2={segment.endPoint.x}
                    y2={markerEnd(series.style.marker, segment.endPoint.y)}
                    class={`endpoint-marker ${markerClass(series.style)}`}
                    data-workout-id={series.workout.id}
                  />
                {/each}
              </g>
            {/each}
          </svg>
          <div class="x-axis" aria-hidden="true">
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
          <p class="x-axis-title" aria-hidden="true">
            % of logged workout duration
          </p>
        </div>
      </div>
      {#if visiblePlottedSeries.length === 0}
        <p class="all-hidden-note" role="status">
          All workout traces are hidden. Use a workout’s “Show trace” control
          below to add it back to the comparison.
        </p>
      {/if}
      <p class="sample-note">
        {visibleBucketCount} visible synced five-minute point{visibleBucketCount ===
        1
          ? ""
          : "s"} across {visiblePlottedSeries.length} of {overlay.plottedWorkoutCount}
        workout{overlay.plottedWorkoutCount === 1
          ? ""
          : "s"}{visibleSourceSampleCount > 0
          ? ` · ${visibleSourceSampleCount.toLocaleString()} source samples`
          : ""}. Breaks mean the health source supplied no data for that part of
        a workout.
      </p>
      <p id="weekly-heart-rate-chart-description" class="sr-only">
        Each trace uses its own logged start and end time for the horizontal
        percentage scale. A shorter and longer workout align when their
        heart-rate points happened at the same relative progress.
      </p>
    {:else}
      <p class="summary-only" role="status">
        Workout summaries synced, but no five-minute points fit a valid logged
        workout duration yet. Another health-app sync may fill in the
        comparison.
      </p>
    {/if}

    <ul
      id="weekly-heart-rate-series"
      class="series-list"
      aria-label="Workout heart-rate series and summaries"
    >
      {#each overlay.series as series (series.workout.id)}
        {@const provider = providerLabel(series.workout.provider)}
        <li
          data-workout-id={series.workout.id}
          data-style-slot={series.style.slot}
          data-plotted={series.segments.length > 0}
        >
          {#if series.segments.length > 0}
            <button
              class="series-toggle"
              type="button"
              aria-pressed={isSeriesVisible(series)}
              aria-label={`${isSeriesVisible(series) ? "Hide" : "Show"} ${series.workout.label} heart-rate trace from ${dateLabel(series.workout.startedAt)}`}
              onclick={() => toggleSeries(series)}
            >
              <span class="series-identity">
                <svg
                  class="series-swatch"
                  viewBox="0 0 36 12"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line
                    x1="2"
                    y1="6"
                    x2="30"
                    y2="6"
                    class={`series-line ${seriesClass(series.style)}`}
                  />
                  <line
                    x1="31"
                    y1={markerStart(series.style.marker, 6)}
                    x2="31"
                    y2={markerEnd(series.style.marker, 6)}
                    class={`endpoint-marker ${markerClass(series.style)}`}
                  />
                </svg>
                <span class="series-copy">
                  <strong>{series.workout.label}</strong>
                  <span>
                    {dateLabel(series.workout.startedAt)} · {durationLabel(
                      series.durationMinutes,
                    )}{provider ? ` · ${provider}` : ""}
                  </span>
                  <small
                    >{isSeriesVisible(series)
                      ? "Hide trace"
                      : "Show trace"}</small
                  >
                </span>
              </span>
            </button>
          {:else}
            <div class="series-identity summary-identity">
              <svg
                class="series-swatch"
                viewBox="0 0 36 12"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <line
                  x1="2"
                  y1="6"
                  x2="30"
                  y2="6"
                  class={`series-line ${seriesClass(series.style)}`}
                />
                <line
                  x1="31"
                  y1={markerStart(series.style.marker, 6)}
                  x2="31"
                  y2={markerEnd(series.style.marker, 6)}
                  class={`endpoint-marker ${markerClass(series.style)}`}
                />
              </svg>
              <div>
                <strong>{series.workout.label}</strong>
                <span>
                  {dateLabel(series.workout.startedAt)} · {durationLabel(
                    series.durationMinutes,
                  )}{provider ? ` · ${provider}` : ""} · Summary only
                </span>
              </div>
            </div>
          {/if}
          <dl aria-label={`${series.workout.label} heart-rate summary`}>
            <div>
              <dt>Average</dt>
              <dd>{bpmLabel(series.averageBpm)}</dd>
            </div>
            <div>
              <dt>Peak</dt>
              <dd>{bpmLabel(series.maximumBpm)}</dd>
            </div>
          </dl>
        </li>
      {/each}
    </ul>
  {:else if status === "awaiting_sync"}
    <div class="data-state" role="status">
      <span class="state-icon" aria-hidden="true">♡</span>
      <div>
        <h3>Waiting for your next health sync</h3>
        <p>
          Your weekly review is ready. If you recorded these workouts on a
          wearable, sync its health app, then use “Check for synced data.” You
          do not need to keep this page open.
        </p>
      </div>
    </div>
  {:else if status === "not_connected"}
    <div class="data-state" role="status">
      <span class="state-icon" aria-hidden="true">♡</span>
      <div>
        <h3>No health source is connected</h3>
        <p>
          Your training review still works without one. Connect a supported
          health source from <a href="/account">Account</a> if you want future workout
          heart-rate plots here.
        </p>
      </div>
    </div>
  {:else if status === "ready"}
    <div class="data-state" role="status">
      <span class="state-icon" aria-hidden="true">♡</span>
      <div>
        <h3>No synced workout heart rate this week</h3>
        <p>
          The rest of this review is complete. If your wearable recorded a
          workout, sync its health app and check again; matching data will
          appear automatically.
        </p>
      </div>
    </div>
  {:else}
    <div class="data-state" role="status">
      <span class="state-icon" aria-hidden="true">♡</span>
      <div>
        <h3>Heart-rate history is temporarily unavailable</h3>
        <p>
          Your workout logs and weekly review are safe. Reopen this review after
          your next health sync to try again.
        </p>
      </div>
    </div>
  {/if}
</section>

<style>
  .weekly-heart-rate,
  .weekly-heart-rate * {
    box-sizing: border-box;
  }
  .weekly-heart-rate {
    --hr-series-1: #4edbff;
    --hr-series-2: #b69dff;
    --hr-series-3: #3be3a2;
    --hr-series-4: #ffc857;
    --hr-series-5: #ff7180;
    --hr-series-6: #ff9fd0;
    background:
      linear-gradient(115deg, rgb(255 255 255 / 3%), transparent 24%),
      linear-gradient(180deg, rgb(17 29 46 / 97%), rgb(9 17 30 / 97%));
    border: 1px solid #314b64;
    border-radius: 0.9rem;
    box-shadow: var(--shadow-card);
    color: var(--color-text);
    margin: 1rem 0;
    padding: 1.1rem;
  }
  .review-heading {
    align-items: start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  .review-heading h2,
  .review-heading p,
  .plot-heading h3,
  .plot-heading p {
    margin: 0;
  }
  .review-heading h2 {
    margin-top: 0.2rem;
  }
  .eyebrow {
    color: var(--color-primary);
    font-size: 0.78rem;
    font-weight: 850;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .intro {
    color: var(--color-text-muted);
    margin-top: 0.55rem !important;
    max-width: 46rem;
  }
  .sync-time {
    color: var(--color-text-muted);
    flex: 0 0 auto;
    font-size: 0.75rem;
    line-height: 1.45;
    margin: 0;
    text-align: right;
  }
  .sync-controls {
    align-items: end;
    display: grid;
    flex: 0 0 auto;
    gap: 0.45rem;
    justify-items: end;
  }
  .sync-time strong {
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }
  .sync-button {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 0.45rem;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 750;
    min-height: var(--touch-target);
    padding: 0.45rem 0.65rem;
  }
  .sync-button:disabled {
    cursor: wait;
    opacity: 0.66;
  }
  .check-message,
  .plot-heading p,
  .sample-note {
    color: var(--color-text-muted);
    font-size: 0.78rem;
  }
  .check-message {
    margin: 0.75rem 0 0;
  }
  .plot-heading {
    margin-top: 1.15rem;
  }
  .plot-heading p {
    margin-top: 0.28rem;
  }
  .plot-label-row {
    color: var(--color-text-muted);
    display: flex;
    font-size: 0.7rem;
    justify-content: space-between;
    margin: 0.85rem 0 0.25rem 2.8rem;
  }
  .plot-layout {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: max-content minmax(0, 1fr);
  }
  .y-axis {
    color: var(--color-text-muted);
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    height: 12rem;
    justify-content: space-between;
    text-align: right;
  }
  .plot-column {
    min-width: 0;
  }
  .heart-rate-plot {
    background: rgb(7 15 27 / 70%);
    border: 1px solid var(--color-border);
    border-radius: 0.45rem;
    display: block;
    height: 12rem;
    overflow: hidden;
    width: 100%;
  }
  .grid-line {
    stroke: rgb(167 184 204 / 25%);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .series-line {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2.5;
    vector-effect: non-scaling-stroke;
  }
  .series-color-1 {
    stroke: var(--hr-series-1);
  }
  .series-color-2 {
    stroke: var(--hr-series-2);
  }
  .series-color-3 {
    stroke: var(--hr-series-3);
  }
  .series-color-4 {
    stroke: var(--hr-series-4);
  }
  .series-color-5 {
    stroke: var(--hr-series-5);
  }
  .series-color-6 {
    stroke: var(--hr-series-6);
  }
  .series-dash-1 {
    stroke-dasharray: none;
  }
  .series-dash-2 {
    stroke-dasharray: 14 2;
  }
  .series-dash-3 {
    stroke-dasharray: 10 3;
  }
  .series-dash-4 {
    stroke-dasharray: 8 3 2 3;
  }
  .series-dash-5 {
    stroke-dasharray: 5 4;
  }
  .series-dash-6 {
    stroke-dasharray: 2 4;
  }
  .endpoint-marker {
    vector-effect: non-scaling-stroke;
  }
  .marker-dot {
    stroke-linecap: round;
    stroke-width: 6;
  }
  .marker-block {
    stroke-linecap: square;
    stroke-width: 6;
  }
  .marker-tick {
    stroke-linecap: square;
    stroke-width: 3;
  }
  .x-axis {
    color: var(--color-text-muted);
    display: flex;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    justify-content: space-between;
    margin-top: 0.28rem;
  }
  .x-axis-title {
    color: var(--color-text-muted);
    font-size: 0.72rem;
    margin: 0.12rem 0 0;
    text-align: center;
  }
  .sample-note {
    margin: 0.55rem 0 0 2.8rem;
  }
  .all-hidden-note {
    color: var(--color-text-muted);
    font-size: 0.78rem;
    font-weight: 750;
    margin: 0.65rem 0 0 2.8rem;
  }
  .series-list {
    display: grid;
    gap: 0 1rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
  }
  .series-list > li {
    align-items: center;
    border-top: 1px solid var(--color-border);
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    min-width: 0;
    padding: 0.75rem 0;
  }
  .series-identity {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    min-width: 0;
  }
  .series-toggle {
    align-items: center;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    display: flex;
    font: inherit;
    justify-content: start;
    min-height: var(--touch-target);
    min-width: 0;
    padding: 0;
    text-align: left;
  }
  .series-toggle[aria-pressed="false"] .series-swatch {
    opacity: 0.38;
  }
  .series-copy,
  .series-identity > div {
    display: grid;
    gap: 0.12rem;
    min-width: 0;
  }
  .series-identity strong,
  .series-identity span {
    overflow-wrap: anywhere;
  }
  .series-copy > span,
  .series-identity > div > span {
    color: var(--color-text-muted);
    font-size: 0.7rem;
  }
  .series-copy > strong,
  .series-identity > div > strong {
    font-size: 0.85rem;
  }
  .series-copy small {
    color: var(--color-primary);
    font-size: 0.68rem;
    font-weight: 750;
  }
  .series-swatch {
    flex: 0 0 auto;
    height: 0.85rem;
    overflow: visible;
    width: 2.5rem;
  }
  .series-list dl {
    display: flex;
    flex: 0 0 auto;
    gap: 0.65rem;
    margin: 0;
  }
  .series-list dl div {
    display: grid;
    gap: 0.08rem;
  }
  .series-list dt {
    color: var(--color-text-muted);
    font-size: 0.68rem;
    text-transform: uppercase;
  }
  .series-list dd {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    margin: 0;
    white-space: nowrap;
  }
  .summary-only,
  .data-state {
    background: rgb(7 15 27 / 70%);
    border: 1px dashed var(--color-border);
    border-radius: 0.65rem;
    color: var(--color-text-muted);
  }
  .summary-only {
    margin: 1rem 0 0;
    padding: 0.8rem;
  }
  .data-state {
    align-items: center;
    display: flex;
    gap: 0.8rem;
    margin-top: 1rem;
    padding: 0.9rem;
  }
  .data-state h3,
  .data-state p {
    margin: 0;
  }
  .data-state p {
    margin-top: 0.25rem;
  }
  .data-state a {
    color: var(--color-primary);
  }
  .state-icon {
    color: var(--color-primary);
    flex: 0 0 auto;
    font-size: 1.7rem;
    line-height: 1;
  }
  .sr-only {
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
  :global(html[data-theme="cute"]) .weekly-heart-rate {
    --hr-series-1: #a20e52;
    --hr-series-2: #6b4ba1;
    --hr-series-3: #146a94;
    --hr-series-4: #1e7a55;
    --hr-series-5: #946000;
    --hr-series-6: #b4233c;
    background: #fff9fc;
    border: 2px solid #5a1a36;
    box-shadow: 3px 4px 0 rgb(162 14 82 / 16%);
    color: #321523;
  }
  :global(html[data-theme="cute"]) .heart-rate-plot,
  :global(html[data-theme="cute"]) .summary-only,
  :global(html[data-theme="cute"]) .data-state {
    background: #fff;
    border-color: #c889a5;
  }
  :global(html[data-theme="cute"]) .sync-button {
    background: #ffe2ed;
    border-color: #5a1a36;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .series-toggle {
    background: transparent !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    color: #321523 !important;
    justify-content: start;
    min-width: 0;
    padding: 0;
  }
  :global(html[data-theme="cute"])
    .series-toggle:not(:disabled):is(:hover, :active) {
    background: #ffe2ed !important;
    box-shadow: none !important;
    transform: none;
  }
  :global(html[data-theme="cute"]) .grid-line {
    stroke: rgb(90 26 54 / 24%);
  }
  :global(html[data-theme="cute"]) .state-icon {
    color: #f36ca5;
  }
  @media (max-width: 46rem) {
    .series-list {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 38rem) {
    .review-heading {
      display: grid;
    }
    .sync-time {
      text-align: left;
    }
    .sync-controls {
      justify-items: start;
    }
    .sample-note {
      margin-left: 0;
    }
    .all-hidden-note {
      margin-left: 0;
    }
    .series-list > li {
      align-items: start;
      display: grid;
    }
  }
  @media (max-width: 25rem) {
    .weekly-heart-rate {
      padding: 0.85rem;
    }
    .data-state {
      align-items: start;
    }
    .heart-rate-plot,
    .y-axis {
      height: 10rem;
    }
    .plot-label-row {
      margin-left: 2.45rem;
    }
  }
</style>
