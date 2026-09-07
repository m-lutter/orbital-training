<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import ProgramIcon from "$lib/ui/ProgramIcon.svelte";
  import QuoteCard from "$lib/ui/QuoteCard.svelte";
  import { freshCuteQuote, type AppQuote } from "$lib/ui/quotes";
  import type { WorkoutStatus } from "$lib/workouts";
  import {
    PROGRAM_OVERVIEW_VISITS_COOKIE,
    PROGRAM_OVERVIEW_VISITS_MAX_AGE_SECONDS,
    programOverviewVisit,
  } from "$lib/program-overview-visit";
  import { onMount } from "svelte";
  import type { PageData } from "./$types";

  type Overview = NonNullable<PageData["overview"]>;

  let { data }: { data: PageData } = $props();
  let cuteQuote = $state<AppQuote>();

  afterNavigate(() => {
    cuteQuote =
      Object.keys(data.sessionStatuses).length === 0
        ? freshCuteQuote("program_overview_before_starting")
        : undefined;
  });

  onMount(() => {
    if (!data.firstOverviewVisit) return;
    const existing = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${PROGRAM_OVERVIEW_VISITS_COOKIE}=`))
      ?.slice(PROGRAM_OVERVIEW_VISITS_COOKIE.length + 1);
    const visit = programOverviewVisit(existing, data.program.id);
    document.cookie = `${PROGRAM_OVERVIEW_VISITS_COOKIE}=${visit.cookieValue}; Path=/; Max-Age=${PROGRAM_OVERVIEW_VISITS_MAX_AGE_SECONDS}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  });

  function titleCase(value: string): string {
    return value
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function sessionStatus(id: string): WorkoutStatus | undefined {
    return (data.sessionStatuses as Record<string, WorkoutStatus>)[id];
  }

  function weeklyReview(weekNumber: number) {
    return data.weeklyReviews?.[weekNumber];
  }

  function workoutHref(sessionId: string): string {
    return `/programs/${data.program.id}/workouts/${encodeURIComponent(sessionId)}`;
  }

  const terminalStatuses = new Set<WorkoutStatus>([
    "completed",
    "partial",
    "skipped",
  ]);

  function formatDate(value: string): string {
    const [year, month, day] = value.split("-").map(Number);
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    if (!year || !month || !day || monthNames[month - 1] === undefined)
      return value;
    return `${monthNames[month - 1]} ${day}, ${year}`;
  }

  function loggedSessionCount(sessions: Array<{ id: string }>): number {
    return sessions.filter((session) => {
      const status = sessionStatus(session.id);
      return status !== undefined && terminalStatuses.has(status);
    }).length;
  }

  function focusedWeek(
    weekNumber: number,
    sessions: Array<{ id: string }>,
  ): boolean {
    if (data.reviewDue !== undefined) return data.reviewDue === weekNumber;
    if (data.nextSession !== undefined)
      return sessions.some((session) => session.id === data.nextSession?.id);
    const inProgress = sessions.some(
      (session) => sessionStatus(session.id) === "in_progress",
    );
    return inProgress || weekNumber === 1;
  }

  function weekState(sessions: Array<{ id: string }>): string {
    const logged = loggedSessionCount(sessions);
    if (logged === sessions.length && sessions.length > 0) return "Complete";
    if (
      logged > 0 ||
      sessions.some((session) => sessionStatus(session.id) === "in_progress")
    )
      return "In progress";
    return "Upcoming";
  }

  function focusedSession(sessionId: string): boolean {
    return (
      data.nextSession?.id === sessionId ||
      sessionStatus(sessionId) === "in_progress"
    );
  }
</script>

<svelte:head><title>{data.program.name} | Powerlifting App</title></svelte:head>

{#snippet planAtGlance(program: Overview, expanded: boolean)}
  <details class="plan-summary overview-info-block" open={expanded}>
    <summary class="overview-info-toggle">
      <span class="overview-info-heading">
        <span class="mission-kicker orbital-only">Flight plan</span>
        <span class="mission-kicker cute-only">Plan at a glance</span>
        <strong role="heading" aria-level="2">How your training is built</strong
        >
        <span
          >The essentials of your block, without the setup questionnaire.</span
        >
      </span>
    </summary>

    <div class="overview-info-body">
      <div class="plan-stats">
        <article>
          <span>Training block</span>
          <strong>{program.horizonWeeks} weeks</strong>
          <small
            >{program.rolling ? "Updated week by week" : "Fixed block"}</small
          >
        </article>
        <article>
          <span>Typical week</span>
          <strong>{program.typicalWeek}</strong>
          <small>Balanced around your goals</small>
        </article>
        <article>
          <span>Session target</span>
          <strong>{program.targetLiftMinutes} minutes</strong>
          <small>For each lifting workout</small>
        </article>
      </div>

      <div class="plan-context">
        <div>
          <span>Starts</span>
          <strong>{formatDate(program.startDate)}</strong>
        </div>
        <div>
          <span>Training structure</span>
          <strong
            >{program.selectedSplit
              ? `${program.selectedSplit} split`
              : "Personalized full-week plan"}</strong
          >
        </div>
        <div class="scheduling-note">
          <span>Scheduling</span>
          <strong>{program.schedulingDescription}</strong>
        </div>
        <div class="scheduling-note">
          <span>Progression</span>
          <strong
            >Completed work and effort guide small updates to future weeks.</strong
          >
        </div>
      </div>
    </div>
  </details>
{/snippet}

{#snippet startingPoint(program: Overview, expanded: boolean)}
  {#if program.baselines.length > 0}
    <details class="baseline-section overview-info-block" open={expanded}>
      <summary class="overview-info-toggle">
        <span class="overview-info-heading">
          <span class="mission-kicker">Starting point</span>
          <strong role="heading" aria-level="2"
            >Current strength estimates</strong
          >
          <span>Reference numbers used to shape your initial loading.</span>
        </span>
      </summary>
      <div class="overview-info-body">
        <div class="baseline-grid">
          {#each program.baselines as baseline}
            <div>
              <span>{baseline.lift}</span>
              <strong>{baseline.estimate}</strong>
            </div>
          {/each}
        </div>
      </div>
    </details>
  {/if}
{/snippet}

<main class="mission-page overview-page">
  <nav class="overview-nav" aria-label="Program navigation">
    <a class="dashboard-button" href="/dashboard">← Back to dashboard</a>
  </nav>

  <header class="program-hero">
    <div class="program-title">
      {#if data.overview}
        <span class="program-badge" aria-hidden="true">
          <ProgramIcon name={data.overview.icon} />
        </span>
      {/if}
      <div class="program-title-copy">
        <p class="mission-kicker orbital-only">Mission overview</p>
        <p class="mission-kicker cute-only">Your training plan</p>
        <h1>{data.program.name}</h1>
        <p>{data.overview?.goalSummary ?? "Legacy program"}</p>
      </div>
    </div>
    <div class="header-actions">
      {#if data.overview && data.loggingReady}
        {#if data.reviewDue !== undefined && data.adaptationReady}
          <a
            class="primary-action"
            href={`/programs/${data.program.id}/reviews/${data.reviewDue}`}
            >Review week {data.reviewDue}</a
          >
        {:else if data.reviewDue !== undefined}
          <span class="setup-needed">Weekly review setup required</span>
        {:else if data.nextSession}
          <a class="primary-action" href={workoutHref(data.nextSession.id)}
            >{data.nextSession.status === "in_progress"
              ? "Continue workout"
              : "Start next workout"}</a
          >
        {:else}
          <span class="complete">✓ Program complete</span>
        {/if}
      {/if}
      {#if data.overview}
        <a
          class="secondary-action"
          href={`/programs/new?edit=${data.program.id}`}>Edit plan setup</a
        >
      {/if}
    </div>
  </header>

  <QuoteCard quote={cuteQuote} showIn="cute" />

  {#if data.overview}
    {@const program = data.overview}
    {#if data.firstOverviewVisit}
      {@render planAtGlance(program, true)}
    {/if}

    {#if !data.adaptationReady}
      <section class="callout setup-callout">
        <h2>Weekly adaptation needs one database update</h2>
        <p>
          Apply Supabase migration
          <code>20260814090000_weekly_feedback_and_adaptation</code> before
          finishing the current week. Detected status:
          <code>{data.adaptationErrorCode}</code>.
        </p>
      </section>
    {/if}

    {#if !data.loggingReady}
      <section class="callout setup-callout">
        <h2>Workout logging needs one database update</h2>
        <p>
          Apply Supabase migrations through
          <code>20260818194500_beta_feedback_and_movement</code> before starting
          a workout. Your program is saved and can still be reviewed here.
          Detected status: <code>{data.loggingErrorCode}</code>.
        </p>
      </section>
    {/if}

    {#if program.warnings.length > 0}
      <details class="callout warning-callout">
        <summary>Warnings and limits ({program.warnings.length})</summary>
        <ul>
          {#each program.warnings as warning}
            <li>{warning}</li>
          {/each}
        </ul>
      </details>
    {/if}

    {#if program.unresolvedChoices.length > 0}
      <section class="callout choice-callout">
        <h2>Choices still needed</h2>
        <ul>
          {#each program.unresolvedChoices as choice}<li>{choice}</li>{/each}
        </ul>
      </section>
    {/if}

    {#if data.firstOverviewVisit}
      {@render startingPoint(program, true)}
    {/if}

    <section class="training-block" aria-labelledby="training-block-heading">
      <div class="section-heading block-heading">
        <div>
          <p class="mission-kicker orbital-only">Training manifest</p>
          <p class="mission-kicker cute-only">Your workouts</p>
          <h2 id="training-block-heading">The full training block</h2>
          <p>
            Open a week to review its goal, workouts, and exercise
            prescriptions.
          </p>
        </div>
        <span class="week-count">{program.horizonWeeks} weeks</span>
      </div>

      <div class="week-list">
        {#each program.weeks as week}
          {@const loggedCount = loggedSessionCount(week.sessions)}
          <details
            class="week"
            open={focusedWeek(week.weekNumber, week.sessions)}
          >
            <summary class="week-toggle">
              <span class="week-number">Week {week.weekNumber}</span>
              <span class="week-phase">{week.phase}</span>
              <span class="week-state">{weekState(week.sessions)}</span>
              <span class="week-progress-copy">
                {loggedCount} of {week.workoutCount} logged
              </span>
              <progress
                value={loggedCount}
                max={week.workoutCount}
                aria-label={`Week ${week.weekNumber}: ${loggedCount} of ${week.workoutCount} workouts logged`}
              ></progress>
              {#if weeklyReview(week.weekNumber)}
                <span class="reviewed-badge">Reviewed</span>
              {/if}
            </summary>

            <div class="week-body">
              <p class="week-summary">{week.progressionSummary}</p>

              {#if weeklyReview(week.weekNumber)}
                {@const review = weeklyReview(week.weekNumber)}
                <p class="review-line">
                  <strong>{titleCase(review?.state ?? "reviewed")}.</strong>
                  {review?.decision === "applied"
                    ? ` Future workouts were updated in version ${review.resultProgramVersion}.`
                    : review?.decision === "kept"
                      ? " You kept the existing plan."
                      : " No extra change was needed."}
                  <a
                    href={`/programs/${data.program.id}/reviews/${week.weekNumber}`}
                    >View review</a
                  >
                </p>
              {:else if data.reviewDue === week.weekNumber && data.adaptationReady}
                <p class="review-line due">
                  This week is ready to review.
                  <a
                    href={`/programs/${data.program.id}/reviews/${week.weekNumber}`}
                    >Review and set the next week</a
                  >
                </p>
              {/if}

              <div class="session-list">
                {#each week.sessions as session, sessionIndex (session.id)}
                  <details
                    class="session-card"
                    open={focusedSession(session.id)}
                  >
                    <summary class="session-card-header">
                      <div class="session-title-copy">
                        <p>Workout {sessionIndex + 1}</p>
                        <h3>{session.label}</h3>
                        <div class="session-meta">
                          <span>{session.predictedMinutes} min</span>
                          {#if session.suggestedDay}
                            <span>Suggested {session.suggestedDay}</span>
                          {/if}
                          {#if sessionStatus(session.id) !== undefined}
                            <span
                              class={`session-status status-${sessionStatus(session.id)}`}
                              >{titleCase(
                                sessionStatus(session.id) ?? "",
                              )}</span
                            >
                          {/if}
                        </div>
                      </div>
                    </summary>

                    <div class="session-card-body">
                      {#if data.loggingReady}
                        <div class="session-body-actions">
                          <a
                            class="session-open-action"
                            href={workoutHref(session.id)}>Open workout</a
                          >
                        </div>
                      {/if}

                      {#if session.exercises.length > 0}
                        <div
                          class="exercise-list"
                          aria-label={`${session.label} exercises`}
                        >
                          {#each session.exercises as exercise (exercise.id)}
                            <div class="exercise-row">
                              <div class="exercise-identity">
                                <div>
                                  {#if exercise.supersetLabel}
                                    <span class="superset-label"
                                      >{exercise.supersetLabel}</span
                                    >
                                  {/if}
                                  {#if exercise.optional}
                                    <span class="accessory-label"
                                      >Accessory</span
                                    >
                                  {/if}
                                </div>
                                <strong>{exercise.name}</strong>
                              </div>
                              <dl class="exercise-prescription">
                                <div>
                                  <dt>Sets × reps</dt>
                                  <dd>{exercise.sets} × {exercise.reps}</dd>
                                </div>
                                <div>
                                  <dt>Effort</dt>
                                  <dd>{exercise.effort}</dd>
                                </div>
                                <div class="load-prescription">
                                  <dt>Load</dt>
                                  <dd>{exercise.weight || "Set in workout"}</dd>
                                </div>
                              </dl>
                            </div>
                          {/each}
                        </div>
                      {/if}

                      {#if session.cardio}
                        <p class="cardio-line">
                          <strong>Cardio</strong>
                          <span>{session.cardio}</span>
                        </p>
                      {/if}
                    </div>
                  </details>
                {/each}
              </div>

              {#if week.movement}
                <p class="movement-line">
                  <strong>Daily movement</strong>
                  <span>{week.movement.replace("Daily movement: ", "")}</span>
                </p>
              {/if}
            </div>
          </details>
        {/each}
      </div>
    </section>

    {#if !data.firstOverviewVisit}
      {@render planAtGlance(program, false)}
      {@render startingPoint(program, false)}
    {/if}

    <details class="technical program-details">
      <summary>A few things to know about your plan</summary>
      <p class="details-intro">
        The short version of how this plan reflects your answers.
      </p>
      <div class="details-grid">
        {#each program.details as detail}
          <article>
            <strong>{detail.title}</strong>
            <span>{detail.description}</span>
          </article>
        {/each}
      </div>
    </details>
  {:else}
    <section class="legacy-program">
      <h2>Legacy program</h2>
      <p>
        This saved program uses an earlier format. Create a new program to use
        the daily workout and logging features.
      </p>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--color-canvas);
    color: var(--color-text);
    font-family: var(--font-sans);
  }
  main {
    width: min(1100px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 2rem 0 5rem;
  }
  a {
    color: var(--color-primary);
  }
  .dashboard-button {
    align-items: center;
    background: linear-gradient(180deg, #233e5d, #142b47);
    border: 2px solid #78a9d0;
    border-radius: var(--radius-sm);
    box-shadow: inset 0 1px rgb(255 255 255 / 18%);
    color: var(--color-text);
    display: inline-flex;
    font-weight: 800;
    min-height: 2.6rem;
    padding: 0.5rem 0.75rem;
    text-decoration: none;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
  }
  header h1 {
    margin: 0 0 0.3rem;
  }
  header p {
    margin: 0;
    color: #5d687c;
  }
  .primary-action {
    background: #3158a6;
    border-radius: 0.55rem;
    color: white;
    font-weight: 750;
    padding: 0.75rem 1rem;
    text-decoration: none;
    white-space: nowrap;
  }
  .secondary-action {
    background: linear-gradient(180deg, #233e5d, #142b47);
    border: 2px solid #78a9d0;
    border-radius: 0.55rem;
    box-shadow:
      0 0 14px rgb(78 219 255 / 12%),
      inset 0 1px rgb(255 255 255 / 18%);
    color: #e8f5ff;
    font-weight: 800;
    padding: 0.7rem 0.9rem;
    text-decoration: none;
    white-space: nowrap;
  }
  .header-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    justify-content: flex-end;
  }
  .program-title {
    align-items: center;
    display: flex;
    gap: 0.9rem;
    min-width: 0;
  }
  .program-title h1,
  .program-title p {
    margin: 0.15rem 0;
  }
  .program-badge {
    background: rgb(5 15 28 / 72%);
    border: 2px solid #6da7cf;
    border-radius: 0.7rem;
    box-shadow: inset 0 1px rgb(255 255 255 / 14%);
    flex: 0 0 4.5rem;
    height: 4.5rem;
    padding: 0.4rem;
  }
  .complete {
    color: #28734e;
    font-weight: 750;
  }
  .setup-needed {
    color: #8a5b18;
    font-weight: 750;
  }
  section,
  details.week,
  details.technical,
  details.callout,
  details.overview-info-block {
    background: white;
    border: 1px solid #dce1e9;
    border-radius: 0.8rem;
    padding: 1rem;
    margin: 1rem 0;
  }
  .baseline-grid div {
    display: grid;
    gap: 0.25rem;
  }
  .baseline-grid span {
    color: #4f5b70;
  }
  .callout {
    border-left-width: 5px !important;
  }
  .setup-callout {
    border-left-color: #3158a6;
    background: #f4f7fd;
  }
  .warning-callout {
    border-left-color: #d08a24;
    background: #fffaf1;
  }
  .choice-callout {
    border-left-color: #5376be;
    background: #f4f7fd;
  }
  .baseline-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.8rem;
  }
  .baseline-grid div {
    background: #f4f6fa;
    border-radius: 0.6rem;
    padding: 0.8rem;
  }
  summary {
    cursor: pointer;
    font-weight: 750;
  }
  .week > summary {
    font-size: 1.05rem;
  }
  .week-summary {
    color: #4f5b70;
    line-height: 1.5;
  }
  .review-line {
    background: #eef6f2;
    border-radius: 0.55rem;
    color: #315f4b;
    padding: 0.7rem;
  }
  .review-line.due {
    background: #f1f5fc;
    color: #3158a6;
  }
  .review-line a {
    margin-left: 0.35rem;
  }
  .cardio-line,
  .movement-line {
    background: #f1f7f5;
    border-radius: 0.6rem;
    padding: 0.8rem;
  }
  .details-intro {
    color: var(--color-text-muted);
    margin-bottom: 0.8rem;
  }
  .details-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  }
  .details-grid article {
    background: rgb(7 15 27 / 48%);
    border: 1px solid #31506b;
    border-radius: 0.6rem;
    display: grid;
    gap: 0.3rem;
    padding: 0.75rem;
  }
  .details-grid span {
    color: var(--color-text-muted);
    line-height: 1.45;
  }
  code {
    overflow-wrap: anywhere;
  }
  .overview-page header p,
  .overview-page .baseline-grid span,
  .overview-page .week-summary {
    color: var(--color-text-muted);
  }
  .overview-page section,
  .overview-page details.week,
  .overview-page details.technical,
  .overview-page details.callout,
  .overview-page details.overview-info-block {
    background:
      linear-gradient(115deg, rgb(255 255 255 / 3%), transparent 24%),
      linear-gradient(180deg, rgb(17 29 46 / 96%), rgb(10 18 32 / 96%));
    border-color: #314b64;
    box-shadow: var(--shadow-card);
  }
  .overview-page .baseline-grid div {
    background: rgb(7 15 27 / 68%);
    border: 1px solid #29425f;
  }
  .overview-page .setup-callout,
  .overview-page .choice-callout {
    background: rgb(78 219 255 / 8%);
    border-left-color: var(--color-primary);
  }
  .overview-page .warning-callout {
    background: rgb(255 200 87 / 8%);
    border-left-color: var(--color-warning);
  }
  .overview-page .review-line {
    background: rgb(59 227 162 / 9%);
    color: #baffdf;
  }
  .overview-page .review-line.due {
    background: rgb(78 219 255 / 9%);
    color: #c7f4ff;
  }
  .overview-page .cardio-line,
  .overview-page .movement-line {
    background: rgb(154 124 255 / 10%);
    border: 1px solid rgb(154 124 255 / 26%);
  }
  :global(html[data-theme="cute"]) .overview-page section,
  :global(html[data-theme="cute"]) .overview-page details.week,
  :global(html[data-theme="cute"]) .overview-page details.technical,
  :global(html[data-theme="cute"]) .overview-page details.callout,
  :global(html[data-theme="cute"]) .overview-page details.overview-info-block {
    background: #fff9fc;
    border-color: #5a1a36;
    box-shadow: 3px 4px 0 rgb(162 14 82 / 16%);
    color: #321523;
  }
  :global(html[data-theme="cute"]) .overview-page .dashboard-button {
    background: #fff;
    border-color: #a20e52;
    box-shadow: 0 3px 0 #5a1a36;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .overview-page .program-badge {
    background: #ffe2ed;
    border-color: #5a1a36;
    box-shadow: none;
    overflow: hidden;
    padding: 0;
  }
  :global(html[data-theme="cute"]) .overview-page .baseline-grid div {
    background: #fff;
    border: 2px solid #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .overview-page .details-grid article {
    background: #fff;
    border-color: #5a1a36;
  }
  :global(html[data-theme="cute"]) .overview-page .setup-callout,
  :global(html[data-theme="cute"]) .overview-page .choice-callout {
    background: #ffe2ed;
    border-left-color: #a20e52;
  }
  :global(html[data-theme="cute"]) .overview-page .warning-callout {
    background: #fff3d1;
    border-left-color: #946000;
  }
  :global(html[data-theme="cute"]) .overview-page .setup-needed {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .overview-page .review-line {
    background: #f3e6dd;
    color: #704936;
  }
  :global(html[data-theme="cute"]) .overview-page .review-line.due {
    background: #f6e3ed;
    color: #7c1e52;
  }
  :global(html[data-theme="cute"]) .overview-page .cardio-line,
  :global(html[data-theme="cute"]) .overview-page .movement-line {
    background: #f0eafb;
    border-color: #6b4ba1;
    color: #4d3674;
  }
  :global(html[data-theme="cute"]) .overview-page .superset-label {
    background: #a20e52;
  }
  /* Program overview redesign: vertical, readable, and overflow-safe. */
  .overview-page {
    max-width: 70rem;
    overflow-x: clip;
  }
  .overview-page :is(section, article, div, details, summary, dl) {
    min-width: 0;
  }
  .overview-nav {
    margin-bottom: 0.9rem;
  }
  .program-hero {
    align-items: center;
    background: rgb(8 20 36 / 82%);
    border: 1px solid #3b607e;
    border-radius: 1rem;
    box-shadow: var(--shadow-card);
    display: flex;
    gap: 1.5rem;
    justify-content: space-between;
    padding: clamp(1rem, 3vw, 1.5rem);
  }
  .program-title-copy {
    min-width: 0;
  }
  .program-title-copy h1 {
    font-size: clamp(1.75rem, 5vw, 2.5rem);
    line-height: 1.05;
    margin: 0.2rem 0 0.45rem;
    overflow-wrap: anywhere;
  }
  .program-title-copy > p:last-child {
    color: var(--color-text-muted);
    line-height: 1.45;
    margin: 0;
  }
  .program-badge {
    flex-basis: clamp(3.8rem, 9vw, 5rem);
    height: clamp(3.8rem, 9vw, 5rem);
  }
  .header-actions {
    flex: 0 0 auto;
    max-width: 22rem;
  }
  .primary-action,
  .secondary-action,
  .session-open-action {
    align-items: center;
    display: inline-flex;
    justify-content: center;
    min-height: 2.75rem;
    text-align: center;
  }
  .complete,
  .setup-needed {
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0.55rem 0.75rem;
  }
  .complete {
    color: #79e8b8;
  }
  .setup-needed {
    color: #ffd891;
  }
  .plan-summary,
  .baseline-section,
  .training-block,
  .program-details,
  .legacy-program {
    padding: clamp(1rem, 3vw, 1.5rem) !important;
  }
  .overview-info-toggle {
    list-style: none;
    padding-right: 3rem;
    position: relative;
  }
  .overview-info-toggle::-webkit-details-marker {
    display: none;
  }
  .overview-info-toggle::after {
    align-items: center;
    border: 1px solid #456884;
    border-radius: 50%;
    content: "+";
    display: flex;
    font-size: 1.2rem;
    height: 1.85rem;
    justify-content: center;
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 1.85rem;
  }
  details[open] > .overview-info-toggle::after {
    content: "−";
  }
  .overview-info-heading {
    display: grid;
    gap: 0.2rem;
  }
  .overview-info-heading > strong {
    font-size: 1.35rem;
    line-height: 1.25;
  }
  .overview-info-heading > span:last-child {
    color: var(--color-text-muted);
    font-weight: 400;
    line-height: 1.5;
  }
  .overview-info-body {
    border-top: 1px solid #29465f;
    margin-top: 1rem;
    padding-top: 1rem;
  }
  .section-heading {
    margin-bottom: 1rem;
  }
  .section-heading h2,
  .section-heading p {
    margin: 0.2rem 0;
  }
  .block-heading > div > p:last-child {
    color: var(--color-text-muted);
    line-height: 1.5;
  }
  .section-heading.compact {
    margin-bottom: 0.8rem;
  }
  .plan-stats {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
  }
  .plan-stats article {
    background: rgb(7 18 32 / 72%);
    border: 1px solid #335674;
    border-radius: 0.75rem;
    display: grid;
    gap: 0.3rem;
    padding: 0.9rem;
  }
  .plan-stats span,
  .plan-context span,
  .baseline-grid span {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .plan-stats strong {
    font-size: 1.08rem;
    line-height: 1.35;
  }
  .plan-stats small {
    color: var(--color-text-muted);
    line-height: 1.35;
  }
  .plan-context {
    border: 1px solid #29465f;
    border-radius: 0.75rem;
    display: grid;
    gap: 0;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 0.75rem;
    overflow: hidden;
  }
  .plan-context > div {
    display: grid;
    gap: 0.3rem;
    padding: 0.85rem 0.9rem;
  }
  .plan-context > div:nth-child(even) {
    border-left: 1px solid #29465f;
  }
  .plan-context > div:nth-child(n + 3) {
    border-top: 1px solid #29465f;
  }
  .plan-context strong {
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .baseline-section {
    display: grid;
    gap: 0.3rem;
  }
  .baseline-grid {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
  }
  .baseline-grid div {
    border: 1px solid #335674;
    padding: 0.85rem;
  }
  .baseline-grid strong {
    font-size: 0.98rem;
    line-height: 1.4;
  }
  .block-heading {
    align-items: end;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  .block-heading > div {
    min-width: 0;
  }
  .week-count {
    background: rgb(78 219 255 / 10%);
    border: 1px solid rgb(78 219 255 / 32%);
    border-radius: 999px;
    color: #c7f4ff;
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 800;
    padding: 0.4rem 0.65rem;
    text-transform: uppercase;
  }
  .week-list {
    display: grid;
    gap: 0.75rem;
  }
  .overview-page details.week {
    background: rgb(5 15 28 / 68%);
    border: 1px solid #355773;
    border-radius: 0.8rem;
    margin: 0;
    overflow: hidden;
    padding: 0;
  }
  .week-toggle {
    display: grid;
    gap: 0.35rem 0.7rem;
    grid-template-areas:
      "number phase state"
      "copy bar reviewed";
    grid-template-columns: auto minmax(0, 1fr) auto;
    list-style: none;
    padding: 0.9rem 3.5rem 0.9rem 1rem;
    position: relative;
  }
  .week-toggle::-webkit-details-marker {
    display: none;
  }
  .week-toggle::after {
    align-items: center;
    border: 1px solid #456884;
    border-radius: 50%;
    content: "+";
    display: flex;
    font-size: 1.2rem;
    height: 1.8rem;
    justify-content: center;
    position: absolute;
    right: 0.9rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.8rem;
  }
  details[open] > .week-toggle::after {
    content: "−";
  }
  .week-number {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    grid-area: number;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .week-phase {
    font-size: 1rem;
    grid-area: phase;
    overflow-wrap: anywhere;
  }
  .week-state,
  .reviewed-badge {
    align-self: start;
    border: 1px solid #456884;
    border-radius: 999px;
    font-size: 0.68rem;
    padding: 0.22rem 0.45rem;
    text-transform: uppercase;
  }
  .week-state {
    grid-area: state;
  }
  .reviewed-badge {
    color: #aef3d1;
    grid-area: reviewed;
  }
  .week-progress-copy {
    color: var(--color-text-muted);
    font-size: 0.72rem;
    font-weight: 600;
    grid-area: copy;
  }
  .week-toggle progress {
    align-self: center;
    appearance: none;
    background: #162b40;
    border: 0;
    border-radius: 999px;
    grid-area: bar;
    height: 0.42rem;
    max-width: 15rem;
    overflow: hidden;
    width: 100%;
  }
  .week-toggle progress::-webkit-progress-bar {
    background: #162b40;
  }
  .week-toggle progress::-webkit-progress-value {
    background: var(--color-primary);
  }
  .week-toggle progress::-moz-progress-bar {
    background: var(--color-primary);
  }
  .week-body {
    border-top: 1px solid #29465f;
    padding: clamp(0.8rem, 3vw, 1.15rem);
  }
  .week-summary {
    background: rgb(78 219 255 / 7%);
    border-left: 3px solid var(--color-primary);
    border-radius: 0 0.55rem 0.55rem 0;
    color: var(--color-text-muted);
    line-height: 1.55;
    margin: 0 0 1rem;
    padding: 0.75rem 0.85rem;
  }
  .session-list {
    display: grid;
    gap: 0.85rem;
  }
  .session-card {
    background: rgb(10 25 43 / 82%);
    border: 1px solid #31516d;
    border-radius: 0.75rem;
    overflow: hidden;
  }
  .session-card-header {
    align-items: center;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    list-style: none;
    padding: 0.9rem 3.6rem 0.9rem 0.9rem;
    position: relative;
  }
  .session-card-header::-webkit-details-marker {
    display: none;
  }
  .session-card-header::after {
    align-items: center;
    border: 1px solid #456884;
    border-radius: 50%;
    content: "+";
    display: flex;
    font-size: 1.1rem;
    height: 1.75rem;
    justify-content: center;
    position: absolute;
    right: 0.9rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.75rem;
  }
  .session-card[open] > .session-card-header::after {
    content: "−";
  }
  .session-card-body {
    border-top: 1px solid #29465f;
  }
  .session-body-actions {
    display: flex;
    justify-content: flex-end;
    padding: 0.7rem 0.9rem;
  }
  .session-title-copy > p {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    margin: 0 0 0.2rem;
    text-transform: uppercase;
  }
  .session-title-copy h3 {
    font-size: 1.05rem;
    line-height: 1.3;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .session-meta {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.6rem;
    margin-top: 0.45rem;
  }
  .session-meta > span {
    color: var(--color-text-muted);
    font-size: 0.76rem;
  }
  .session-meta .session-status {
    border: 1px solid #456884;
    border-radius: 999px;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 0.64rem;
    padding: 0.2rem 0.4rem;
    text-transform: uppercase;
  }
  .session-meta .status-completed {
    border-color: #3b9e73;
    color: #aef3d1;
  }
  .session-meta .status-in_progress {
    border-color: var(--color-primary);
    color: #c7f4ff;
  }
  .session-open-action {
    background: rgb(78 219 255 / 12%);
    border: 1px solid rgb(78 219 255 / 46%);
    border-radius: 0.55rem;
    color: #d7f8ff;
    flex: 0 0 auto;
    font-size: 0.8rem;
    font-weight: 800;
    padding: 0.55rem 0.7rem;
    text-decoration: none;
  }
  .session-open-action:hover {
    background: rgb(78 219 255 / 20%);
    border-color: var(--color-primary);
  }
  .exercise-list {
    border-top: 1px solid #29465f;
    display: grid;
  }
  .exercise-row {
    align-items: stretch;
    display: grid;
    grid-template-columns: minmax(10rem, 1.15fr) minmax(19rem, 1fr);
  }
  .exercise-row + .exercise-row {
    border-top: 1px solid #29465f;
  }
  .exercise-identity {
    display: grid;
    gap: 0.45rem;
    padding: 0.8rem 0.9rem;
  }
  .exercise-identity > div {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    min-height: 1.2rem;
  }
  .exercise-identity > strong {
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .superset-label,
  .accessory-label {
    border-radius: 0.3rem;
    display: inline-flex;
    font-size: 0.65rem;
    font-weight: 800;
    padding: 0.2rem 0.38rem;
    text-transform: uppercase;
  }
  .superset-label {
    background: #3158a6;
    color: white;
  }
  .accessory-label {
    background: rgb(167 184 204 / 12%);
    border: 1px solid rgb(167 184 204 / 25%);
    color: var(--color-text-muted);
  }
  .exercise-prescription {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 0;
  }
  .exercise-prescription > div {
    border-left: 1px solid #29465f;
    display: grid;
    gap: 0.25rem;
    padding: 0.8rem;
  }
  .exercise-prescription dt {
    color: var(--color-text-muted);
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .exercise-prescription dd {
    font-size: 0.82rem;
    font-weight: 700;
    line-height: 1.35;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .cardio-line,
  .movement-line {
    display: grid;
    gap: 0.25rem;
    line-height: 1.45;
    margin: 0;
  }
  .cardio-line {
    border-radius: 0;
    border-width: 1px 0 0;
    padding: 0.8rem 0.9rem;
  }
  .movement-line {
    margin-top: 0.85rem;
  }
  .cardio-line span,
  .movement-line span {
    color: var(--color-text-muted);
  }
  .review-line {
    line-height: 1.5;
    margin: 0 0 0.85rem;
  }
  .details-grid {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
  }
  .details-grid article {
    min-width: 0;
  }

  :global(html[data-theme="cute"]) .overview-page .program-hero {
    background: #fff9fc;
    border: 2px solid #5a1a36;
    box-shadow: 4px 5px 0 rgb(162 14 82 / 18%);
    color: #321523;
  }
  :global(html[data-theme="cute"]) .overview-page .program-title-copy h1 {
    color: #5a1a36;
  }
  :global(html[data-theme="cute"])
    .overview-page
    .program-title-copy
    > p:last-child {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .overview-page .primary-action {
    background: #a20e52;
    border: 2px solid #5a1a36;
    box-shadow: 0 3px 0 #5a1a36;
    color: #fff;
  }
  :global(html[data-theme="cute"]) .overview-page .secondary-action {
    background: #fff;
    border-color: #5a1a36;
    box-shadow: 0 3px 0 #5a1a36;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .overview-page .complete {
    color: #276346;
  }
  :global(html[data-theme="cute"])
    .overview-page
    :is(.overview-info-toggle, .session-card-header)::after {
    border-color: #5a1a36;
    color: #7a093d;
  }
  :global(html[data-theme="cute"])
    .overview-page
    .overview-info-heading
    > span:last-child {
    color: #694052;
  }
  :global(html[data-theme="cute"])
    .overview-page
    :is(.overview-info-body, .session-card-body) {
    border-color: #c98ba5;
  }
  :global(html[data-theme="cute"])
    .overview-page
    :is(.plan-stats article, .plan-context, .baseline-grid div) {
    background: #fff;
    border-color: #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"])
    .overview-page
    :is(.plan-stats span, .plan-context span, .baseline-grid span) {
    color: #7a3657;
  }
  :global(html[data-theme="cute"]) .overview-page .plan-stats small {
    color: #694052;
  }
  :global(html[data-theme="cute"])
    .overview-page
    .plan-context
    > div:nth-child(even) {
    border-left-color: #c98ba5;
  }
  :global(html[data-theme="cute"])
    .overview-page
    .plan-context
    > div:nth-child(n + 3) {
    border-top-color: #c98ba5;
  }
  :global(html[data-theme="cute"]) .overview-page .week-count {
    background: #ffe2ed;
    border-color: #5a1a36;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .overview-page details.week {
    background: #fff;
    border: 2px solid #5a1a36;
    box-shadow: 2px 3px 0 rgb(162 14 82 / 13%);
    color: #321523;
  }
  :global(html[data-theme="cute"]) .overview-page .week-toggle {
    background: #fff9fc;
  }
  :global(html[data-theme="cute"]) .overview-page .week-toggle::after {
    border-color: #5a1a36;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .overview-page .week-number {
    color: #a20e52;
  }
  :global(html[data-theme="cute"])
    .overview-page
    :is(.week-state, .reviewed-badge) {
    border-color: #9e7c8c;
    color: #694052;
  }
  :global(html[data-theme="cute"]) .overview-page .week-progress-copy {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .overview-page .week-toggle progress,
  :global(html[data-theme="cute"])
    .overview-page
    .week-toggle
    progress::-webkit-progress-bar {
    background: #eadde3;
  }
  :global(html[data-theme="cute"])
    .overview-page
    .week-toggle
    progress::-webkit-progress-value {
    background: #d92377;
  }
  :global(html[data-theme="cute"])
    .overview-page
    .week-toggle
    progress::-moz-progress-bar {
    background: #d92377;
  }
  :global(html[data-theme="cute"]) .overview-page .week-body {
    background: #fff;
    border-top-color: #c98ba5;
  }
  :global(html[data-theme="cute"]) .overview-page .week-summary {
    background: #fff0f6;
    border-left-color: #d92377;
    color: #694052;
  }
  :global(html[data-theme="cute"]) .overview-page .session-card {
    background: #fff9fc;
    border: 2px solid #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .overview-page .session-title-copy > p {
    color: #a20e52;
  }
  :global(html[data-theme="cute"]) .overview-page .session-meta > span {
    color: #694052;
  }
  :global(html[data-theme="cute"])
    .overview-page
    .session-meta
    .session-status {
    border-color: #9e7c8c;
    color: #5a1a36;
  }
  :global(html[data-theme="cute"]) .overview-page .session-open-action {
    background: #a20e52;
    border: 2px solid #5a1a36;
    box-shadow: 0 2px 0 #5a1a36;
    color: #fff;
  }
  :global(html[data-theme="cute"])
    .overview-page
    :is(.exercise-list, .exercise-row + .exercise-row) {
    border-color: #c98ba5;
  }
  :global(html[data-theme="cute"]) .overview-page .exercise-prescription > div {
    background: #fff;
    border-color: #c98ba5;
  }
  :global(html[data-theme="cute"]) .overview-page .exercise-prescription dt {
    color: #7a3657;
  }
  :global(html[data-theme="cute"]) .overview-page .accessory-label {
    background: #f5edf1;
    border-color: #9e7c8c;
    color: #694052;
  }
  :global(html[data-theme="cute"]) .overview-page .superset-label {
    background: #d92377;
    border: 1px solid #5a1a36;
  }
  :global(html[data-theme="cute"])
    .overview-page
    :is(.cardio-line, .movement-line) {
    background: #f0eafb;
    border-color: #6b4ba1;
    color: #4d3674;
  }
  :global(html[data-theme="cute"])
    .overview-page
    :is(.cardio-line, .movement-line)
    span {
    color: #5f4a7e;
  }

  @media (max-width: 760px) {
    .program-hero,
    .session-card-header {
      align-items: stretch;
      display: grid;
    }
    .header-actions {
      display: grid;
      max-width: none;
      width: 100%;
    }
    .header-actions :is(a, span),
    .session-open-action {
      width: 100%;
    }
    .plan-context {
      grid-template-columns: 1fr;
    }
    .plan-context > div:nth-child(even) {
      border-left: 0;
    }
    .plan-context > div + div,
    .plan-context > div:nth-child(n + 3) {
      border-top: 1px solid #29465f;
    }
    :global(html[data-theme="cute"])
      .overview-page
      .plan-context
      > div:nth-child(even) {
      border-left: 0;
    }
    :global(html[data-theme="cute"]) .overview-page .plan-context > div + div {
      border-top-color: #c98ba5;
    }
    .block-heading {
      align-items: start;
    }
    .exercise-row {
      grid-template-columns: 1fr;
    }
    .exercise-prescription {
      border-top: 1px solid #29465f;
    }
    .exercise-prescription > div:first-child {
      border-left: 0;
    }
    :global(html[data-theme="cute"]) .overview-page .exercise-prescription {
      border-top-color: #c98ba5;
    }
  }

  @media (max-width: 520px) {
    main {
      width: min(100% - 1rem, 70rem);
      padding-top: 1rem;
    }
    .program-title {
      align-items: start;
    }
    .program-badge {
      flex-basis: 3.4rem;
      height: 3.4rem;
    }
    .block-heading {
      display: grid;
    }
    .week-count {
      justify-self: start;
    }
    .week-toggle {
      grid-template-areas:
        "number state"
        "phase phase"
        "copy reviewed"
        "bar bar";
      grid-template-columns: minmax(0, 1fr) auto;
      padding-right: 3.25rem;
    }
    .week-state,
    .reviewed-badge {
      justify-self: end;
    }
    .week-toggle progress {
      max-width: none;
    }
    .exercise-prescription {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .exercise-prescription > div:nth-child(3) {
      border-left: 0;
      border-top: 1px solid #29465f;
      grid-column: 1 / -1;
    }
    :global(html[data-theme="cute"])
      .overview-page
      .exercise-prescription
      > div:nth-child(3) {
      border-top-color: #c98ba5;
    }
  }
</style>
