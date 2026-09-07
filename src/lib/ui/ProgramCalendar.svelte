<script lang="ts">
  import type { IsoDate } from "$lib/domain";
  import type { WorkoutStatus } from "$lib/workouts";
  import {
    calendarDayHref,
    calendarDayIsFinished,
    calendarDateRange,
    calendarLeadingBlanks,
    highlightedCalendarDate,
    type ProgramCalendarDay,
  } from "./program-calendar";

  let {
    days,
    programId,
    startDate,
    flexible = false,
    view = "month",
    enabled = true,
    sessionStatuses = {},
    nextSessionId,
  }: {
    days: ProgramCalendarDay[];
    programId: string;
    startDate: IsoDate;
    flexible?: boolean;
    view?: "month" | "week";
    enabled?: boolean;
    sessionStatuses?: Record<string, WorkoutStatus | undefined>;
    nextSessionId?: string;
  } = $props();

  const leadingBlanks = $derived(
    view === "month"
      ? calendarLeadingBlanks(days[0]?.isoDate ?? startDate)
      : [],
  );
  const range = $derived(calendarDateRange(days));
  const highlightedDate = $derived(
    highlightedCalendarDate(days, sessionStatuses, nextSessionId),
  );
  const compactDayLabels: Record<ProgramCalendarDay["day"], string> = {
    sunday: "Sun",
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
  };
  const dayLabels = $derived(
    view === "week"
      ? days.slice(0, 7).map((day) => compactDayLabels[day.day])
      : ["S", "M", "T", "W", "T", "F", "S"],
  );
  function isFinished(day: (typeof days)[number]): boolean {
    return calendarDayIsFinished(day, sessionStatuses);
  }

  function isHighlighted(day: (typeof days)[number]): boolean {
    return enabled && highlightedDate === day.isoDate;
  }

  function hrefFor(day: (typeof days)[number]): string | undefined {
    return calendarDayHref(day, programId, nextSessionId);
  }

  function markerLabel(day: (typeof days)[number]): string {
    return day.isoDate === days[0]?.isoDate ? "Start" : "Next";
  }

  function dateLabel(day: (typeof days)[number]): string {
    return `${compactDayLabels[day.day]} ${day.dateNumber}`;
  }
</script>

<section class="program-calendar" aria-labelledby="calendar-title">
  <div class="calendar-heading">
    <div>
      <p class="mission-kicker">
        {view === "week"
          ? `Program week ${days[0]?.weekNumber ?? 1}`
          : "First month"}
      </p>
      <h2 id="calendar-title">
        {view === "week" ? "This week’s plan" : "Training calendar"}
      </h2>
    </div>
    <span>{range}</span>
  </div>
  {#if flexible}
    <p class="calendar-note">
      These are suggested dates. You can move a workout while keeping the same
      order and recovery pattern.
    </p>
  {/if}
  <div class="calendar-legend" aria-label="Calendar color legend">
    <span><i class="lift"></i>Lift</span>
    <span><i class="cardio"></i>Cardio</span>
    <span><i class="combined"></i>Lift + cardio</span>
    <span><i class="rest"></i>Recovery</span>
  </div>
  <div
    class="calendar-grid"
    class:week-view={view === "week"}
    role="grid"
    aria-label={view === "week"
      ? "Seven-day training plan"
      : "First four weeks of training"}
  >
    {#each dayLabels as label, index (`heading-${index}`)}
      <div class="weekday" role="columnheader">{label}</div>
    {/each}
    {#each leadingBlanks as blank (`blank-${blank}`)}
      <div class="blank" aria-hidden="true"></div>
    {/each}
    {#each days as day (day.isoDate)}
      {@const dayHref = hrefFor(day)}
      {#if dayHref && enabled}
        <a
          class="calendar-day"
          class:lift={day.kind === "lifting"}
          class:cardio={day.kind === "cardio"}
          class:combined={day.kind === "combined"}
          class:rest={day.kind === "rest"}
          class:finished={isFinished(day)}
          class:highlighted={isHighlighted(day)}
          href={dayHref}
          aria-label={`${day.isoDate}: ${day.title}`}
        >
          <span class="day-name">{dateLabel(day)}</span>
          <span class="date-number">{day.dateNumber}</span>
          <span class="calendar-item">{day.title}</span>
          {#if isHighlighted(day)}<span class="next-marker"
              >{markerLabel(day)}</span
            >{/if}
        </a>
      {:else}
        <div
          class="calendar-day"
          class:lift={day.kind === "lifting"}
          class:cardio={day.kind === "cardio"}
          class:combined={day.kind === "combined"}
          class:rest={day.kind === "rest"}
          class:finished={isFinished(day)}
          class:highlighted={isHighlighted(day)}
          aria-label={`${day.isoDate}: ${day.title}`}
        >
          <span class="day-name">{dateLabel(day)}</span>
          <span class="date-number">{day.dateNumber}</span>
          <span class="calendar-item">{day.title}</span>
          {#if isHighlighted(day)}<span class="next-marker"
              >{markerLabel(day)}</span
            >{/if}
        </div>
      {/if}
    {/each}
  </div>
</section>

<style>
  .program-calendar {
    overflow: hidden;
    padding: clamp(0.75rem, 2vw, 1.2rem);
  }
  .calendar-heading {
    align-items: end;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  .calendar-heading h2,
  .calendar-heading p {
    margin: 0;
  }
  .calendar-heading > span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }
  .calendar-note {
    color: var(--color-text-muted);
    margin-bottom: 0.65rem;
  }
  .calendar-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem 1rem;
    justify-content: flex-end;
    margin: 0.65rem 0;
  }
  .calendar-legend span {
    align-items: center;
    color: var(--color-text-muted);
    display: inline-flex;
    font-size: 0.75rem;
    gap: 0.35rem;
  }
  .calendar-legend i {
    border-radius: 50%;
    display: block;
    height: 0.55rem;
    width: 0.55rem;
  }
  .calendar-grid {
    display: grid;
    gap: 0.35rem;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
  .weekday {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 0.2rem;
    text-align: center;
  }
  .calendar-day,
  .blank {
    min-height: 4.6rem;
  }
  .calendar-day {
    background: rgb(18 30 46 / 84%);
    border: 1px solid #2c4259;
    border-radius: 0.25rem;
    color: var(--color-text);
    display: grid;
    gap: 0.35rem;
    grid-template-rows: auto 1fr;
    overflow: hidden;
    padding: 0.38rem;
    text-decoration: none;
    transition:
      border-color 120ms ease,
      opacity 120ms ease,
      box-shadow 120ms ease;
  }
  .day-name {
    display: none;
  }
  a.calendar-day:hover {
    border-color: var(--color-primary);
    box-shadow: 0 0 16px rgb(78 219 255 / 13%);
  }
  .date-number {
    color: #c7d7e8;
    font-family: var(--font-mono);
    font-size: 0.7rem;
  }
  .calendar-item {
    align-self: end;
    font-size: 0.72rem;
    font-weight: 750;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .calendar-day.finished {
    filter: saturate(0.45);
    opacity: 0.38;
  }
  .calendar-day.highlighted {
    border-color: #dff9ff;
    box-shadow:
      0 0 0 2px rgb(78 219 255 / 35%),
      0 0 24px rgb(78 219 255 / 32%);
    filter: none;
    opacity: 1;
  }
  .next-marker {
    background: #dff9ff;
    border-radius: 999px;
    color: #061522;
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 900;
    justify-self: start;
    letter-spacing: 0.08em;
    padding: 0.14rem 0.3rem;
    text-transform: uppercase;
  }
  .calendar-day.lift,
  .calendar-legend .lift {
    background-color: rgb(78 219 255 / 16%);
    border-color: rgb(78 219 255 / 58%);
  }
  .calendar-day.cardio,
  .calendar-legend .cardio {
    background-color: rgb(154 124 255 / 17%);
    border-color: rgb(154 124 255 / 62%);
  }
  .calendar-day.combined,
  .calendar-legend .combined {
    background-color: rgb(59 227 162 / 15%);
    border-color: rgb(59 227 162 / 58%);
  }
  .calendar-day.rest,
  .calendar-legend .rest {
    background-color: rgb(167 184 204 / 7%);
    border-color: rgb(167 184 204 / 19%);
  }
  :global(html[data-theme="cute"]) .program-calendar {
    background: #fff;
    border-color: #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .calendar-day {
    box-shadow: none;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .calendar-day.lift,
  :global(html[data-theme="cute"]) .calendar-legend .lift {
    background-color: #e6f4fb;
    border-color: #146a94;
  }
  :global(html[data-theme="cute"]) .calendar-day.cardio,
  :global(html[data-theme="cute"]) .calendar-legend .cardio {
    background-color: #f0eafb;
    border-color: #6b4ba1;
  }
  :global(html[data-theme="cute"]) .calendar-day.combined,
  :global(html[data-theme="cute"]) .calendar-legend .combined {
    background-color: #e5f5ed;
    border-color: #1e7a55;
  }
  :global(html[data-theme="cute"]) .calendar-day.rest,
  :global(html[data-theme="cute"]) .calendar-legend .rest {
    background-color: #f5edf1;
    border-color: #9e7c8c;
  }
  :global(html[data-theme="cute"]) .date-number {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .calendar-day.highlighted {
    border-color: #a20e52;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 5px #68183d;
  }
  :global(html[data-theme="cute"]) .next-marker {
    background: #a20e52;
    color: white;
  }
  @media (max-width: 520px) {
    .calendar-heading {
      align-items: start;
      display: grid;
    }
    .calendar-legend {
      justify-content: flex-start;
    }
    .calendar-grid {
      gap: 0.22rem;
    }
    .calendar-day,
    .blank {
      min-height: 3.2rem;
    }
    .calendar-day {
      align-items: center;
      justify-items: center;
      padding: 0.25rem;
    }
    .next-marker {
      font-size: 0;
      height: 0.35rem;
      justify-self: center;
      padding: 0;
      width: 0.35rem;
    }
    .calendar-item {
      background: currentColor;
      border-radius: 50%;
      color: transparent;
      font-size: 0;
      height: 0.55rem;
      width: 0.55rem;
    }
    .calendar-day.rest .calendar-item {
      opacity: 0.28;
    }
    .calendar-grid.week-view {
      grid-template-columns: 1fr;
    }
    .calendar-grid.week-view > .weekday {
      display: none;
    }
    .calendar-grid.week-view .calendar-day {
      align-items: center;
      display: grid;
      gap: 0.65rem;
      grid-template-columns: 4.2rem minmax(0, 1fr) auto;
      justify-items: start;
      min-height: 2.9rem;
      padding: 0.55rem 0.65rem;
    }
    .calendar-grid.week-view .day-name {
      display: inline;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      font-weight: 800;
    }
    .calendar-grid.week-view .date-number {
      display: none;
    }
    .calendar-grid.week-view .calendar-item {
      align-self: center;
      background: transparent;
      border-radius: 0;
      color: inherit;
      font-size: 0.8rem;
      height: auto;
      width: auto;
    }
    .calendar-grid.week-view .next-marker {
      font-size: 0.55rem;
      height: auto;
      justify-self: end;
      padding: 0.16rem 0.34rem;
      width: auto;
    }
  }
</style>
