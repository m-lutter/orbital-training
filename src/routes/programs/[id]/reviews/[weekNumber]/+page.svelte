<script lang="ts">
  import QuoteCard from "$lib/ui/QuoteCard.svelte";
  import {
    cuteReviewQuotePlacement,
    freshCuteQuote,
    freshReviewQuote,
    type AppQuote,
  } from "$lib/ui/quotes";
  import { afterNavigate } from "$app/navigation";
  import { weeklyReviewShareFile } from "$lib/reviews/share-card";
  import WeeklyHeartRateReview from "$lib/components/reviews/WeeklyHeartRateReview.svelte";
  import { formatProgramDateRange } from "$lib/program-dates";
  import {
    reviewDayMarks,
    type ReviewChart,
    type ReviewDayBreakdown,
    type ReviewItemStatus,
  } from "$lib/reviews";
  import type { PageData } from "./$types";

  let { data, form }: { data: PageData; form: { message?: string } | null } =
    $props();

  let reviewDays = $derived(data.days);
  let reviewPeriod = $derived(reviewDateRange(reviewDays));
  let review = $derived(data.existing?.result ?? data.proposal);
  let heartRateReview = $derived(data.heartRateReview);
  let orbitalQuote = $state<AppQuote>();
  let cuteQuote = $state<AppQuote>();
  let sharing = $state(false);
  let shareMessage = $state<string>();
  afterNavigate(() => {
    const safetyConcern =
      (review?.safetySignals?.length ?? 0) > 0 ||
      data.messages?.headline.tone === "safety";
    orbitalQuote = freshReviewQuote({ safetyConcern });
    cuteQuote = freshCuteQuote(
      cuteReviewQuotePlacement({
        state: review?.state ?? "insufficient_data",
        safetyConcern,
        hasLoggedWork:
          data.metrics.completedSets + data.metrics.completedCardioMinutes > 0,
      }),
    );
  });

  function titleCase(value: string): string {
    return value
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  function percent(completed: number, planned: number): string {
    return planned === 0 ? "—" : `${Math.round((completed / planned) * 100)}%`;
  }
  function statusLabel(status: ReviewItemStatus): string {
    const labels: Record<ReviewItemStatus, string> = {
      completed: "completed",
      overperformed: "completed above the prescription",
      partial: "partially completed",
      skipped: "skipped",
      pain: "stopped because of pain",
      not_planned: "nothing planned",
    };
    return labels[status];
  }
  function chartMax(chart: ReviewChart): number {
    return Math.max(1, ...chart.series.flatMap((series) => series.values));
  }
  function reviewDateRange(days: ReviewDayBreakdown[]): string | undefined {
    const first = days.find((day) => day.isoDate !== undefined)?.isoDate;
    const last = [...days]
      .reverse()
      .find((day) => day.isoDate !== undefined)?.isoDate;
    return first === undefined || last === undefined
      ? undefined
      : formatProgramDateRange(first, last);
  }
  function reviewDayLabel(day: ReviewDayBreakdown): string {
    if (day.isoDate === undefined) return day.label;
    const date = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${day.isoDate}T00:00:00Z`));
    return `${day.label}, ${date}`;
  }
  function shortDay(day: ReviewDayBreakdown, index: number): string {
    if (String(day.key).startsWith("day-")) return `D${index + 1}`;
    const labels: Record<string, string> = {
      sunday: "S",
      monday: "M",
      tuesday: "T",
      wednesday: "W",
      thursday: "R",
      friday: "F",
      saturday: "S",
    };
    return labels[day.key] ?? day.label.slice(0, 1);
  }
  function shortDate(day: ReviewDayBreakdown): string | undefined {
    if (day.isoDate === undefined) return undefined;
    return String(Number(day.isoDate.slice(-2)));
  }
  function barWidth(weekCount: number, seriesCount: number): number {
    const groupWidth = 472 / Math.max(1, weekCount);
    return Math.min(34, Math.max(4, (groupWidth - 10) / seriesCount - 3));
  }
  function barX(
    weekIndex: number,
    weekCount: number,
    seriesIndex: number,
    seriesCount: number,
  ): number {
    const groupWidth = 472 / Math.max(1, weekCount);
    const width = barWidth(weekCount, seriesCount);
    const gap = 3;
    const totalWidth = width * seriesCount + gap * (seriesCount - 1);
    return (
      34 +
      groupWidth * weekIndex +
      (groupWidth - totalWidth) / 2 +
      seriesIndex * (width + gap)
    );
  }
  function barHeight(value: number, maximum: number): number {
    return (value / maximum) * 140;
  }
  function barY(value: number, maximum: number): number {
    return 170 - barHeight(value, maximum);
  }
  function weekX(index: number, count: number): number {
    const groupWidth = 472 / Math.max(1, count);
    return 34 + groupWidth * index + groupWidth / 2;
  }
  function formatValue(value: number): string {
    return Intl.NumberFormat("en", {
      maximumFractionDigits: value >= 1000 ? 1 : 2,
    }).format(value);
  }

  async function shareReview(): Promise<void> {
    if (!data.messages || sharing) return;
    sharing = true;
    shareMessage = undefined;
    try {
      const file = await weeklyReviewShareFile({
        programName: data.program.name,
        weekNumber: data.weekNumber,
        headline: data.messages.headline.title,
        takeaway: data.messages.headline.body,
        metrics: data.metrics,
        charts: data.charts,
      });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `${data.program.name} · Week ${data.weekNumber}`,
          text: data.messages.headline.title,
          files: [file],
        });
        shareMessage = "Review shared.";
      } else {
        const href = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = href;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
        shareMessage = "Image downloaded—share it from your photos or files.";
      }
    } catch (caughtError) {
      if (
        caughtError instanceof DOMException &&
        caughtError.name === "AbortError"
      )
        return;
      shareMessage = "The share image could not be created. Try again.";
    } finally {
      sharing = false;
    }
  }
</script>

<svelte:head>
  <title>Week {data.weekNumber} review | {data.program.name}</title>
</svelte:head>

<main class="mission-page review-page">
  <p><a href={`/programs/${data.program.id}`}>← Program overview</a></p>
  <header>
    <div>
      <p class="eyebrow">Weekly review</p>
      <h1>Week {data.weekNumber}</h1>
      {#if reviewPeriod}
        <p class="review-period">Seven-day training block · {reviewPeriod}</p>
      {/if}
      <p>
        Here is what you completed, what the app learned, and what happens next.
      </p>
    </div>
    {#if data.messages}
      <button
        class="share-review"
        type="button"
        disabled={sharing}
        onclick={shareReview}
      >
        {sharing ? "Building image…" : "Share review"}
      </button>
    {/if}
  </header>
  {#if shareMessage}<p class="share-message" role="status">
      {shareMessage}
    </p>{/if}

  {#if !data.adaptationReady}
    <section class="setup-callout">
      <h2>Weekly adaptation needs one database update</h2>
      <p>
        Apply Supabase migration <code
          >20260814090000_weekly_feedback_and_adaptation</code
        >, then reload. Detected status:
        <code>{data.adaptationErrorCode}</code>.
      </p>
    </section>
  {:else}
    {#if form?.message}<p class="message">{form.message}</p>{/if}

    {#if review && data.messages}
      <section class="takeaway">
        <div class="takeaway-head {data.messages.headline.tone}">
          <div>
            <p class="eyebrow">Overall takeaway</p>
            <h2>{data.messages.headline.title}</h2>
            <p>{data.messages.headline.body}</p>
          </div>
          {#if data.existing}<span class="saved">Saved</span>{/if}
        </div>
        {#if data.messages.notes.length > 0}
          <div class="review-notes">
            {#each data.messages.notes as note}
              <article class={note.tone}>
                <h3>{note.title}</h3>
                <p>{note.body}</p>
              </article>
            {/each}
          </div>
        {/if}
        <QuoteCard quote={orbitalQuote} compact showIn="orbital" />
        <QuoteCard quote={cuteQuote} compact showIn="cute" />
      </section>
    {/if}

    <section class="week-map">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Your week</p>
          <h2>One result for every movement and cardio session</h2>
        </div>
        <div class="legends">
          <div class="legend" aria-label="Status colors">
            <span><i class="status legend-status completed"></i> Done</span>
            <span><i class="status legend-status partial"></i> Partial</span>
            <span><i class="status legend-status skipped"></i> Skipped</span>
            <span><i class="status legend-status pain"></i> Stopped</span>
          </div>
        </div>
      </div>
      <p class="week-map-intro">
        Each symbol is one main exercise, accessory exercise, or cardio session.
      </p>
      <table
        class="week-status-table"
        aria-label="Completion status for each exercise and cardio session by day"
      >
        <thead>
          <tr>
            {#each reviewDays as day, index}
              {@const date = shortDate(day)}
              <th scope="col" title={reviewDayLabel(day)}>
                <span>{shortDay(day, index)}</span>
                {#if date}<small>{date}</small>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          <tr>
            {#each reviewDays as day}
              {@const marks = reviewDayMarks(day)}
              <td>
                {#if marks.length === 0}
                  <span
                    class="rest-mark"
                    aria-label={`${reviewDayLabel(day)}: rest day`}>—</span
                  >
                {:else}
                  <div class="mark-stack">
                    {#each marks as mark (mark.id)}
                      <i
                        class="status {mark.status} role-{mark.role}"
                        aria-label={`${mark.label}; ${statusLabel(mark.status)}`}
                        title={`${mark.label} — ${statusLabel(mark.status)}`}
                      ></i>
                    {/each}
                  </div>
                {/if}
              </td>
            {/each}
          </tr>
        </tbody>
      </table>
      <div class="week-map-footer">
        <p class="week-map-help">
          The fill shows what happened. The outline shows the type of work.
        </p>
        <div
          class="role-legend"
          aria-label="Exercise and cardio outline legend"
        >
          <span><i class="role-swatch role-primary"></i> Main</span>
          <span><i class="role-swatch role-secondary"></i> Accessory</span>
          <span><i class="role-swatch role-cardio"></i> Cardio</span>
        </div>
      </div>
      <div class="week-totals">
        <h3>Week totals</h3>
        <div class="metrics">
          <div>
            <strong>Workouts</strong><span
              >{data.metrics.completedSessions} complete · {data.metrics
                .partialSessions} partial · {data.metrics.skippedSessions} skipped</span
            >
          </div>
          {#if data.metrics.requiredPlannedSets > 0}
            <div>
              <strong>Main work</strong><span
                >{data.metrics.requiredCompletedSets} of {data.metrics
                  .requiredPlannedSets} sets · {percent(
                  data.metrics.requiredCompletedSets,
                  data.metrics.requiredPlannedSets,
                )}</span
              >
            </div>
          {/if}
          {#if data.metrics.accessoryPlannedSets > 0}
            <div>
              <strong>Accessory work</strong><span
                >{data.metrics.accessoryCompletedSets} of {data.metrics
                  .accessoryPlannedSets} sets · {percent(
                  data.metrics.accessoryCompletedSets,
                  data.metrics.accessoryPlannedSets,
                )}</span
              >
            </div>
          {/if}
          {#if data.metrics.plannedCardioMinutes > 0}
            <div>
              <strong>Cardio</strong><span
                >{data.metrics.completedCardioMinutes} of {data.metrics
                  .plannedCardioMinutes} min · {percent(
                  data.metrics.completedCardioMinutes,
                  data.metrics.plannedCardioMinutes,
                )}</span
              >
              {#if data.metrics.cardioDistance > 0 || data.metrics.cardioSteps > 0}
                <small
                  >{data.metrics.cardioDistance > 0
                    ? `${formatValue(data.metrics.cardioDistance)} ${data.metrics.cardioDistanceUnit}`
                    : ""}{data.metrics.cardioDistance > 0 &&
                  data.metrics.cardioSteps > 0
                    ? " · "
                    : ""}{data.metrics.cardioSteps > 0
                    ? `${data.metrics.cardioSteps.toLocaleString()} steps`
                    : ""}</small
                >
              {/if}
              {#if (data.metrics.plannedCardioIntervals ?? 0) > 0}
                <small
                  >{data.metrics.completedCardioIntervals ?? 0} of {data.metrics
                    .plannedCardioIntervals ?? 0} work intervals completed</small
                >
              {/if}
              {#if (data.metrics.cardioMovingMinutes ?? 0) > 0}
                <small>{data.metrics.cardioMovingMinutes} moving minutes</small>
              {/if}
            </div>
          {/if}
          {#if data.metrics.wearable}
            <div class:wearable-caution={data.metrics.wearable.caution}>
              <strong>Connected recovery</strong>
              <span
                >{data.metrics.wearable.source} · {data.metrics.wearable
                  .currentDays} current days vs {data.metrics.wearable
                  .baselineDays} baseline days</span
              >
              {#if data.metrics.wearable.averageSleepMinutes !== undefined}
                <small
                  >Sleep: {Math.round(
                    data.metrics.wearable.averageSleepMinutes,
                  )} min average{data.metrics.wearable.baselineSleepMinutes ===
                  undefined
                    ? ""
                    : ` · ${Math.round(data.metrics.wearable.baselineSleepMinutes)} min baseline`}</small
                >
              {/if}
              {#if data.metrics.wearable.averageRestingHeartRateBpm !== undefined}
                <small
                  >Resting HR: {Math.round(
                    data.metrics.wearable.averageRestingHeartRateBpm,
                  )} bpm{data.metrics.wearable.baselineRestingHeartRateBpm ===
                  undefined
                    ? ""
                    : ` · ${Math.round(data.metrics.wearable.baselineRestingHeartRateBpm)} bpm baseline`}</small
                >
              {/if}
              {#each data.metrics.wearable.reasons as reason}
                <small>{reason}</small>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </section>

    <WeeklyHeartRateReview heartRate={heartRateReview} />

    {#if data.charts.length > 0}
      <section>
        <p class="eyebrow">Progress</p>
        <h2>
          {data.weekNumber === 1 ? "Week 1 totals" : "Your training trends"}
        </h2>
        <p class="section-intro">
          {data.weekNumber === 1
            ? "This is your starting point. Future reviews will compare each week with clear bars."
            : "Each bar uses what you logged—not estimates of work you did not record."}
        </p>
        <div class="charts">
          {#each data.charts as chart}
            {@const maximum = chartMax(chart)}
            <article class:week-one={data.weekNumber === 1} class="chart-card">
              <div class="chart-heading">
                <h3>{chart.title}</h3>
                <span>{chart.unit}</span>
              </div>
              {#if data.weekNumber === 1}
                <div class="week-one-values">
                  {#each chart.series as series}
                    <div>
                      <svg
                        class="series-marker"
                        viewBox="0 0 32 5"
                        aria-hidden="true"
                        ><rect
                          width="32"
                          height="5"
                          rx="2.5"
                          fill={series.color}
                        ></rect></svg
                      >
                      <strong>{formatValue(series.values[0] ?? 0)}</strong>
                      <span>{series.label}</span>
                    </div>
                  {/each}
                </div>
              {:else}
                <svg
                  viewBox="0 0 540 205"
                  role="img"
                  aria-label={`${chart.title} through week ${data.weekNumber}`}
                >
                  <line x1="34" y1="30" x2="34" y2="170"></line><line
                    x1="34"
                    y1="170"
                    x2="506"
                    y2="170"
                  ></line>
                  <text x="30" y="27" text-anchor="end"
                    >{formatValue(maximum)}</text
                  ><text x="30" y="174" text-anchor="end">0</text>
                  {#each chart.series as series, seriesIndex}
                    {#each series.values as value, weekIndex}
                      <rect
                        x={barX(
                          weekIndex,
                          chart.weeks.length,
                          seriesIndex,
                          chart.series.length,
                        )}
                        y={barY(value, maximum)}
                        width={barWidth(
                          chart.weeks.length,
                          chart.series.length,
                        )}
                        height={barHeight(value, maximum)}
                        rx="2"
                        fill={series.color}
                        ><title
                          >{series.label}, week {chart.weeks[weekIndex]}:
                          {formatValue(value)}
                          {chart.unit}</title
                        ></rect
                      >
                    {/each}
                  {/each}
                  {#each chart.weeks as week, index}<text
                      x={weekX(index, chart.weeks.length)}
                      y="193"
                      text-anchor="middle">W{week}</text
                    >{/each}
                </svg>
                <div class="chart-legend">
                  {#each chart.series as series}<span
                      ><svg
                        class="legend-marker"
                        viewBox="0 0 10 10"
                        aria-hidden="true"
                        ><circle cx="5" cy="5" r="5" fill={series.color}
                        ></circle></svg
                      >{series.label}</span
                    >{/each}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      </section>
    {/if}

    {#if review}
      <section class="next-steps">
        <p class="eyebrow">Your next step</p>
        <h2>What happens next</h2>
        <div class="changes">
          {#each review.changes as change}
            <article>
              <strong>{titleCase(change.target)}</strong>
              {#if change.before || change.after}<p class="change-line">
                  {change.before ?? "Current plan"} → {change.after ??
                    "Updated plan"}
                </p>{/if}
              <p>{change.reason}</p>
            </article>
          {/each}
        </div>
        {#if review.warnings.length > 0}<div class="warning">
            {#each review.warnings as warning}<p>{warning.message}</p>{/each}
          </div>{/if}
        {#if data.existing}
          <p class="saved-result">
            {data.existing.decision === "applied"
              ? `Future workouts now use program version ${data.existing.resultProgramVersion}.`
              : data.existing.decision === "kept"
                ? "You kept the existing future plan."
                : "No extra change was needed."}
          </p>
          <a
            class="primary-button"
            href={`/programs/${data.program.id}/workout`}
            >Continue to your next workout</a
          >
        {:else}
          {@const actionable = review.changes.some(
            (change) => change.type !== "hold",
          )}
          <div class="actions">
            <form method="POST" action="?/apply">
              <button class="primary" type="submit"
                >{actionable
                  ? data.mode === "automatic"
                    ? "Apply review and continue"
                    : "Apply these changes"
                  : "Confirm review and continue"}</button
              >
            </form>
            {#if actionable && data.mode === "ask_first"}<form
                method="POST"
                action="?/keep"
              >
                <button type="submit">Keep the current plan</button>
              </form>{/if}
          </div>
          <small
            >Completed workouts will not change. Any adjustment starts after
            week {data.weekNumber}.</small
          >
        {/if}
      </section>
    {/if}
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f3f5f8;
    color: var(--color-text);
    font-family: var(--font-sans);
  }
  main {
    width: min(1120px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 2rem 0 5rem;
  }
  a {
    color: #3158a6;
  }
  header h1 {
    margin: 0.1rem 0;
  }
  header {
    align-items: end;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  header > div > p:last-child,
  .section-intro {
    color: #5d687c;
  }
  .review-period {
    color: var(--color-primary) !important;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 800;
    margin: 0.35rem 0;
  }
  .share-review {
    flex: 0 0 auto;
    min-height: var(--touch-target);
  }
  .share-message {
    background: rgb(78 219 255 / 9%);
    border: 1px solid rgb(78 219 255 / 35%);
    color: #d7f7ff;
    padding: 0.7rem;
  }
  .eyebrow {
    color: #3158a6;
    font-size: 0.78rem;
    font-weight: 850;
    letter-spacing: 0.06em;
    margin: 0;
    text-transform: uppercase;
  }
  section {
    background: white;
    border: 1px solid #dce1e9;
    border-radius: 0.9rem;
    margin: 1rem 0;
    padding: 1.1rem;
  }
  .setup-callout {
    border-left: 5px solid #3158a6;
  }
  .message,
  .warning {
    background: #fff2f0;
    border-radius: 0.55rem;
    color: #7b332d;
    padding: 0.75rem;
  }
  .section-heading,
  .takeaway-head,
  .chart-heading {
    align-items: start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  .section-heading h2,
  .takeaway-head h2 {
    margin: 0.2rem 0;
  }
  .legends {
    display: grid;
    gap: 0.55rem;
    justify-items: end;
  }
  .legend,
  .role-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }
  .legend > span,
  .role-legend > span {
    align-items: center;
    display: flex;
    font-size: 0.78rem;
    gap: 0.3rem;
  }
  .week-status-table {
    border-collapse: separate;
    border-spacing: 0.35rem;
    table-layout: fixed;
    margin-top: 1rem;
    width: 100%;
  }
  .week-status-table th {
    color: #48566d;
    font-size: 0.86rem;
    padding-bottom: 0.35rem;
    text-align: center;
  }
  .week-status-table th small {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.63rem;
    font-weight: 600;
    margin-top: 0.12rem;
  }
  .week-status-table td {
    background: #f7f9fc;
    border: 1px solid #e1e6ee;
    border-radius: 0.6rem;
    height: 3.2rem;
    padding: 0.65rem 0.2rem;
    text-align: center;
    vertical-align: top;
  }
  .mark-stack {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .rest-mark {
    color: #a0a8b5;
    display: inline-block;
    font-size: 1.15rem;
    padding-top: 0.25rem;
  }
  .week-map-help {
    color: #667286;
    font-size: 0.78rem;
    margin: 0.65rem 0 0;
  }
  .week-map-intro {
    color: #667286;
    margin: 0.6rem 0 0;
  }
  .week-map-footer {
    align-items: end;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  .role-swatch {
    background: white;
    border: 3px solid var(--role-color);
    border-radius: 50%;
    box-sizing: border-box;
    display: inline-block;
    height: 1rem;
    width: 1rem;
  }
  .role-primary {
    --role-color: #3158a6;
  }
  .role-secondary {
    --role-color: #8a5fb1;
  }
  .role-cardio {
    --role-color: #087f76;
  }
  .status {
    align-items: center;
    background: #111820;
    border: 3px solid var(--role-color, transparent);
    border-radius: 50%;
    box-sizing: border-box;
    display: inline-flex;
    flex: 0 0 auto;
    font-style: normal;
    height: 1.85rem;
    justify-content: center;
    position: relative;
    width: 1.85rem;
  }
  .status::before,
  .status::after {
    box-sizing: border-box;
    content: "";
    position: absolute;
  }
  .status.legend-status {
    border-color: #73859a;
    border-width: 2px;
    height: 1.25rem;
    width: 1.25rem;
  }
  .status.completed::before,
  .status.overperformed::before {
    border-bottom: 0.16rem solid white;
    border-left: 0.16rem solid white;
    height: 0.38rem;
    transform: translateY(-0.08rem) rotate(-45deg);
    width: 0.72rem;
  }
  .status.overperformed {
    background: #075e37;
  }
  .status.partial {
    background: #d39b13;
  }
  .status.partial::before {
    background: white;
    border-radius: 50%;
    box-shadow:
      -0.36rem 0 white,
      0.36rem 0 white;
    height: 0.22rem;
    width: 0.22rem;
  }
  .status.skipped {
    background: white;
  }
  .status.skipped::before {
    border: 0.13rem solid #101820;
    border-radius: 50%;
    height: 0.78rem;
    width: 0.78rem;
  }
  .status.skipped::after {
    background: #101820;
    border-radius: 999px;
    height: 0.14rem;
    transform: rotate(-45deg);
    width: 0.9rem;
  }
  .status.pain {
    background: #b42f2a;
    border-radius: 0;
    clip-path: polygon(
      30% 0,
      70% 0,
      100% 30%,
      100% 70%,
      70% 100%,
      30% 100%,
      0 70%,
      0 30%
    );
  }
  .status.pain::before {
    background: white;
    border-radius: 999px;
    height: 0.62rem;
    transform: translateY(-0.13rem);
    width: 0.16rem;
  }
  .status.pain::after {
    background: white;
    border-radius: 50%;
    height: 0.18rem;
    transform: translateY(0.42rem);
    width: 0.18rem;
  }
  .status.not_planned::before {
    background: #c0cad5;
    height: 0.12rem;
    width: 0.62rem;
  }
  .week-totals {
    border-top: 1px solid #dfe4eb;
    margin-top: 1rem;
    padding-top: 0.85rem;
  }
  .week-totals h3 {
    margin-top: 0;
  }
  .metrics {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  }
  .metrics div {
    background: #f4f6fa;
    border-radius: 0.6rem;
    display: grid;
    gap: 0.25rem;
    padding: 0.75rem;
  }
  .metrics span,
  .metrics small {
    color: #4f5b70;
  }
  .metrics .wearable-caution {
    border: 1px solid #d99a34;
  }
  .takeaway {
    border-top: 5px solid #3158a6;
  }
  .takeaway-head {
    border-radius: 0.65rem;
    padding: 0.9rem;
  }
  .takeaway-head.celebration {
    background: #e9f7ef;
  }
  .takeaway-head.encouragement {
    background: #eef3fc;
  }
  .takeaway-head.safety {
    background: #fff0ee;
  }
  .takeaway-head p:last-child {
    margin-bottom: 0;
  }
  .saved {
    background: white;
    border-radius: 2rem;
    color: #226343;
    font-weight: 750;
    padding: 0.35rem 0.65rem;
  }
  .review-notes {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    margin: 0.8rem 0;
  }
  .review-notes article {
    border-left: 4px solid #3158a6;
    border-radius: 0.45rem;
    padding: 0.75rem;
  }
  .review-notes article.celebration {
    background: #f0faf4;
    border-color: #218653;
  }
  .review-notes article.safety {
    background: #fff4f2;
    border-color: #b42f2a;
  }
  .review-notes h3,
  .review-notes p {
    margin: 0;
  }
  .review-notes p {
    color: #4f5b70;
    margin-top: 0.3rem;
  }
  .changes {
    border-top: 1px solid #dfe4eb;
    margin-top: 1rem;
    padding-top: 0.8rem;
  }
  .changes > article {
    background: #f7f9fc;
    border-radius: 0.55rem;
    margin: 0.55rem 0;
    padding: 0.75rem;
  }
  .changes p {
    margin: 0.35rem 0 0;
  }
  .change-line {
    color: #3158a6;
    font-weight: 700;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin: 1rem 0 0.7rem;
  }
  button,
  .primary-button {
    background: white;
    border: 2px solid #3158a6;
    border-radius: 0.5rem;
    box-sizing: border-box;
    color: #3158a6;
    cursor: pointer;
    display: inline-block;
    font: inherit;
    font-weight: 750;
    padding: 0.7rem 0.9rem;
    text-decoration: none;
  }
  button.primary,
  .primary-button {
    background: #3158a6;
    color: white;
  }
  .charts {
    display: grid;
    gap: 0.8rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .chart-card {
    border: 1px solid #e0e4ea;
    border-radius: 0.7rem;
    min-width: 0;
    padding: 0.8rem;
  }
  .chart-heading h3 {
    margin: 0;
  }
  .chart-heading span {
    color: #657083;
    font-size: 0.78rem;
  }
  .week-one-values {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    margin-top: 1rem;
  }
  .week-one-values div {
    background: #f4f6fa;
    border-radius: 0.6rem;
    display: grid;
    gap: 0.2rem;
    padding: 0.85rem;
  }
  .series-marker {
    height: 0.3rem;
    width: 2rem;
  }
  .week-one-values strong {
    font-size: 1.65rem;
    font-variant-numeric: tabular-nums;
  }
  .week-one-values span {
    color: #5c687b;
    font-size: 0.8rem;
  }
  svg {
    display: block;
    height: auto;
    overflow: visible;
    width: 100%;
  }
  svg line {
    stroke: #cbd2dd;
    stroke-width: 1;
  }
  svg text {
    fill: #687386;
    font-size: 11px;
  }
  .chart-legend {
    display: flex;
    flex-wrap: wrap;
    font-size: 0.75rem;
    gap: 0.6rem;
  }
  .chart-legend span {
    align-items: center;
    display: flex;
    gap: 0.3rem;
  }
  .legend-marker {
    flex: 0 0 auto;
    height: 0.65rem;
    width: 0.65rem;
  }
  .saved-result,
  small {
    color: #5d687c;
  }
  code {
    overflow-wrap: anywhere;
  }
  .review-page header > div > p:last-child,
  .review-page .section-intro,
  .review-page .week-map-intro,
  .review-page .week-map-help,
  .review-page .saved-result,
  .review-page small,
  .review-page .metrics span,
  .review-page .metrics small,
  .review-page .review-notes p,
  .review-page .chart-heading span,
  .review-page .week-one-values span {
    color: var(--color-text-muted);
  }
  .review-page .eyebrow {
    color: var(--color-primary);
  }
  .review-page section {
    background:
      linear-gradient(115deg, rgb(255 255 255 / 3%), transparent 24%),
      linear-gradient(180deg, rgb(17 29 46 / 97%), rgb(9 17 30 / 97%));
    border-color: #314b64;
    box-shadow: var(--shadow-card);
  }
  .review-page .week-status-table th {
    background: transparent;
    color: #c6d6e6;
  }
  .review-page .week-status-table td {
    background: rgb(7 15 27 / 70%);
    border-color: #29425f;
  }
  .review-page .role-swatch {
    background: #091321;
  }
  .review-page .role-primary {
    --role-color: #4edbff;
  }
  .review-page .role-secondary {
    --role-color: #9a7cff;
  }
  .review-page .role-cardio {
    --role-color: #3be3a2;
  }
  .review-page .status {
    background: #090d13;
  }
  .review-page .status.overperformed {
    background: #0c633f;
  }
  .review-page .status.partial {
    background: #c58c10;
  }
  .review-page .status.skipped {
    background: #fff;
  }
  .review-page .status.pain {
    background: #c43e49;
  }
  .review-page .metrics div,
  .review-page .week-one-values div,
  .review-page .changes > article,
  .review-page .chart-card {
    background: rgb(7 15 27 / 70%);
    border: 1px solid #29425f;
  }
  .review-page .takeaway-head.celebration,
  .review-page .review-notes article.celebration {
    background: rgb(59 227 162 / 10%);
    border-color: var(--color-positive);
  }
  .review-page .takeaway-head.encouragement {
    background: rgb(78 219 255 / 9%);
  }
  .review-page .takeaway-head.safety,
  .review-page .review-notes article.safety,
  .review-page .message,
  .review-page .warning {
    background: rgb(255 93 108 / 10%);
    border-color: var(--color-danger);
    color: #ffd8dc;
  }
  .review-page .review-notes article {
    background: rgb(78 219 255 / 7%);
    border-color: var(--color-primary);
  }
  .review-page .saved {
    background: rgb(59 227 162 / 13%);
    color: #baffdf;
  }
  .review-page .changes,
  .review-page .week-totals,
  .review-page svg line {
    border-color: #29425f;
    stroke: #44617c;
  }
  .review-page svg text {
    fill: #a7b8cc;
  }
  .review-page button,
  .review-page .primary-button {
    background: #152a43;
    border-color: #47749a;
    color: var(--color-text);
  }
  .review-page button.primary,
  .review-page .primary-button {
    background: linear-gradient(180deg, #66e2ff, #32b9dc);
    border-color: #94edff;
    color: #04131d;
  }
  :global(html[data-theme="cute"]) .review-page section {
    background: #fff9fc;
    border-color: #5a1a36;
    box-shadow: 3px 4px 0 rgb(162 14 82 / 16%);
    color: #321523;
  }
  :global(html[data-theme="cute"]) .review-page .week-status-table th {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .review-page .week-status-table td,
  :global(html[data-theme="cute"]) .review-page .metrics div,
  :global(html[data-theme="cute"]) .review-page .week-one-values div,
  :global(html[data-theme="cute"]) .review-page .changes > article,
  :global(html[data-theme="cute"]) .review-page .chart-card {
    background: #fff;
    border-color: #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .review-page .role-swatch {
    background: #fff;
  }
  :global(html[data-theme="cute"]) .review-page .role-primary {
    --role-color: #146a94;
  }
  :global(html[data-theme="cute"]) .review-page .role-secondary {
    --role-color: #6b4ba1;
  }
  :global(html[data-theme="cute"]) .review-page .role-cardio {
    --role-color: #1e7a55;
  }
  :global(html[data-theme="cute"]) .review-page .status.completed {
    background: #1e7a55;
  }
  :global(html[data-theme="cute"]) .review-page .status.overperformed {
    background: #1e7a55;
  }
  :global(html[data-theme="cute"]) .review-page .status.partial {
    background: #946000;
  }
  :global(html[data-theme="cute"]) .review-page .status.skipped {
    background: #6f5c68;
  }
  :global(html[data-theme="cute"]) .review-page .status.pain {
    background: #b4233c;
  }
  :global(html[data-theme="cute"]) .review-page .takeaway-head.celebration,
  :global(html[data-theme="cute"])
    .review-page
    .review-notes
    article.celebration {
    background: #e5f5ed;
    border-color: #1e7a55;
  }
  :global(html[data-theme="cute"]) .review-page .takeaway-head.encouragement,
  :global(html[data-theme="cute"]) .review-page .review-notes article {
    background: #ffe2ed;
    border-color: #a20e52;
  }
  :global(html[data-theme="cute"]) .review-page .takeaway-head.safety,
  :global(html[data-theme="cute"]) .review-page .review-notes article.safety,
  :global(html[data-theme="cute"]) .review-page .message,
  :global(html[data-theme="cute"]) .review-page .warning {
    background: #fff0f3;
    border-color: #b4233c;
    color: #762035;
  }
  :global(html[data-theme="cute"]) .review-page .saved {
    background: #e5f5ed;
    color: #15563c;
  }
  :global(html[data-theme="cute"]) .review-page .share-message {
    background: #ffe2ed;
    border-color: #a20e52;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .review-page .changes,
  :global(html[data-theme="cute"]) .review-page .week-totals {
    border-color: #5a1a36;
  }
  :global(html[data-theme="cute"]) .review-page .change-line {
    color: #a20e52;
  }
  :global(html[data-theme="cute"]) .review-page svg line {
    stroke: #c8a5b5;
  }
  :global(html[data-theme="cute"]) .review-page svg text {
    fill: #694052;
  }
  :global(html[data-theme="cute"]) .review-page button,
  :global(html[data-theme="cute"]) .review-page .primary-button {
    background: #a20e52 !important;
    border-color: #5a1a36 !important;
    box-shadow: 0 3px 0 #5a1a36 !important;
    color: #fff !important;
  }
  @media (max-width: 700px) {
    main {
      width: min(100% - 1rem, 1120px);
    }
    header {
      align-items: stretch;
      display: grid;
    }
    .section-heading,
    .takeaway-head,
    .chart-heading {
      display: grid;
    }
    .legends {
      justify-items: start;
    }
    .week-map-footer {
      align-items: start;
      display: grid;
    }
    .week-status-table {
      border-spacing: 0.18rem;
    }
    .week-status-table td {
      padding-inline: 0.1rem;
    }
    .status {
      border-width: 2px;
      height: 1.55rem;
      width: 1.55rem;
    }
    .charts {
      grid-template-columns: 1fr;
    }
    .actions {
      display: grid;
    }
    button,
    .primary-button {
      width: 100%;
    }
  }
</style>
