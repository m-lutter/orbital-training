<script lang="ts">
  import ProgramCalendar from "$lib/ui/ProgramCalendar.svelte";
  import ProgramIcon from "$lib/ui/ProgramIcon.svelte";
  import QuoteCard from "$lib/ui/QuoteCard.svelte";
  import { freshAppQuote, type AppQuote } from "$lib/ui/quotes";
  import { afterNavigate } from "$app/navigation";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
  let quote = $state<AppQuote>();
  afterNavigate(() => {
    quote = freshAppQuote("dashboard");
  });
</script>

<svelte:head>
  <title>Mission Control | Powerlifting App</title>
</svelte:head>

<main class="mission-page dashboard-page">
  <header class="dashboard-header">
    <div>
      <p class="mission-kicker orbital-only">Mission control</p>
      <p class="mission-kicker cute-only">Training home</p>
      <h1 class="orbital-only">Training command center</h1>
      <h1 class="cute-only">Your training, all together</h1>
      <p class="account-line">Signed in as {data.email}</p>
    </div>

    <div class="account-actions">
      <a class="button-link secondary" href="/account">Account</a>
      <form method="POST" action="/logout">
        <button class="secondary" type="submit">Log out</button>
      </form>
    </div>
  </header>

  {#if data.recentProgram}
    {@const recent = data.recentProgram}
    {@const summary = recent.summary}
    <section class="current-mission" aria-labelledby="current-program-title">
      <div class="current-heading">
        <div class="current-identity">
          <span class="current-icon">
            <ProgramIcon name={summary.icon} />
          </span>
          <div>
            <p class="mission-kicker orbital-only">Current mission</p>
            <p class="mission-kicker cute-only">Current program</p>
            <h2 id="current-program-title">{recent.name}</h2>
            <div class="goal-row" aria-label="Program goals">
              <span
                >{summary.primaryGoal}{summary.secondaryGoal
                  ? ` · ${summary.primaryWeight}%`
                  : ""}</span
              >
              {#if summary.secondaryGoal}
                <span
                  >{summary.secondaryGoal} · {100 -
                    summary.primaryWeight}%</span
                >
              {/if}
            </div>
          </div>
        </div>
        <a class="button-link secondary" href={`/programs/${recent.id}`}
          >Review program</a
        >
      </div>

      <div class="mission-progress">
        <div>
          <strong>{summary.progressPercent}% complete</strong>
          <span
            >{summary.completedDays} of {summary.totalDays} training days ·
            {summary.horizonWeeks} weeks</span
          >
        </div>
        <progress
          max={Math.max(1, summary.totalDays)}
          value={summary.completedDays}
          aria-label={`${summary.completedDays} of ${summary.totalDays} training days complete`}
        ></progress>
      </div>

      {#if summary.movementTarget}
        <aside class="movement-target" aria-label="Daily movement target">
          <div>
            <p class="mission-kicker">Daily movement</p>
            <strong>{summary.movementTarget.headline}</strong>
          </div>
          <span>{summary.movementTarget.detail}</span>
        </aside>
      {/if}

      <div class="current-grid">
        <ProgramCalendar
          days={summary.calendarDays}
          programId={recent.id}
          startDate={summary.startDate}
          flexible={summary.flexible}
          view="week"
          sessionStatuses={summary.sessionStatuses}
          nextSessionId={summary.highlightSessionId}
          enabled={summary.calendarEnabled}
        />

        <div class="next-window">
          <p class="mission-kicker">{summary.nextAction.label}</p>
          {#if summary.nextAction.kind === "complete"}
            <div class="next-action complete">
              <strong>{summary.nextAction.title}</strong>
              <span>{summary.nextAction.detail}</span>
            </div>
          {:else}
            <a class="next-action" href={summary.nextAction.href}>
              <span class="next-signal" aria-hidden="true"></span>
              <strong>{summary.nextAction.title}</strong>
              <span>{summary.nextAction.detail}</span>
              <b
                >{summary.nextAction.kind === "review"
                  ? "Open review"
                  : "Open workout"} →</b
              >
            </a>
          {/if}
        </div>
      </div>
      <QuoteCard {quote} compact showIn="orbital" />
    </section>
  {/if}

  <section class="launch-panel anodized-panel">
    <div>
      <p class="mission-kicker orbital-only">New flight plan</p>
      <p class="mission-kicker cute-only">New program</p>
      <h2>Ready for your next training block?</h2>
      <p>Answer a focused setup and get a specific, adaptable program.</p>
    </div>
    <a class="button-link" href="/programs/new"
      >Create your personalized program</a
    >
  </section>

  {#if !data.recentProgram}
    <QuoteCard {quote} showIn="orbital" />
  {/if}

  {#if form?.message}
    <p class:success={form.deletedId !== undefined} class="message">
      {form.message}
    </p>
  {/if}

  <section class="saved-programs mission-panel">
    <div class="section-heading">
      <div>
        <p class="mission-kicker">Program archive</p>
        <h2>All training programs</h2>
      </div>
      <span
        >{data.programArchiveTruncated
          ? `${data.programs.length}+ recent`
          : `${data.programs.length} total`}</span
      >
    </div>

    {#if data.programs.length === 0}
      <div class="empty-state">
        <strong>No programs yet.</strong><span
          >Create your first plan when you are ready to begin.</span
        >
      </div>
    {:else}
      <ul class="program-list">
        {#each data.programs as program (program.id)}
          <li class="program-card">
            <div class="program-identity">
              <a
                class="program-icon-button"
                href={`/programs/${program.id}`}
                aria-label={`Open ${program.name}`}
              >
                <ProgramIcon name={program.icon} />
              </a>
              <div>
                <strong>{program.name}</strong><small
                  >Created {program.created_at.slice(0, 10)}</small
                >
              </div>
            </div>
            <div class="program-actions">
              <a
                class="button-link compact"
                href={`/programs/${program.id}/workout`}>Go to workout</a
              >
              <a
                class="button-link secondary compact"
                href={`/programs/${program.id}`}>Program Overview</a
              >
              <details>
                <summary class="delete-trigger">Delete</summary>
                <form method="POST" action="?/delete">
                  <input type="hidden" name="programId" value={program.id} />
                  <p>
                    This permanently deletes the program, its questionnaire
                    history, saved versions, and workout logs.
                  </p>
                  <button class="delete-button" type="submit"
                    >Delete permanently</button
                  >
                </form>
              </details>
            </div>
          </li>
        {/each}
      </ul>
      {#if data.programArchiveTruncated}
        <p class="archive-limit-note">
          Showing the 100 most recent programs. Older programs remain saved and
          are included in account exports.
        </p>
      {/if}
    {/if}
  </section>
</main>

<style>
  .dashboard-header {
    align-items: end;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    margin-bottom: 1.2rem;
  }
  .dashboard-header h1,
  .dashboard-header p {
    margin: 0;
  }
  .dashboard-header h1 {
    margin-top: 0.4rem;
  }
  .account-actions {
    align-items: center;
    display: flex;
    gap: 0.65rem;
  }
  .account-actions form {
    margin: 0;
  }
  .account-line {
    color: var(--color-text-muted);
    margin-top: 0.55rem !important;
  }
  .current-mission {
    background:
      linear-gradient(112deg, rgb(255 255 255 / 11%), transparent 20%),
      radial-gradient(circle at 85% 0%, rgb(78 219 255 / 18%), transparent 34%),
      repeating-linear-gradient(
        90deg,
        rgb(255 255 255 / 2%) 0 1px,
        transparent 1px 5px
      ),
      linear-gradient(145deg, #173c63, #0a1b31 66%) !important;
    border: 2px solid #6fb8e3 !important;
    box-shadow:
      0 20px 55px rgb(0 0 0 / 45%),
      0 0 28px rgb(78 219 255 / 14%),
      inset 0 1px rgb(255 255 255 / 23%) !important;
    overflow: hidden;
    padding: clamp(1rem, 3vw, 1.6rem);
  }
  .current-heading,
  .current-identity {
    align-items: center;
    display: flex;
    gap: 1rem;
  }
  .current-heading {
    justify-content: space-between;
  }
  .current-heading h2,
  .current-heading p {
    margin: 0.2rem 0;
  }
  .current-icon {
    background: rgb(5 15 28 / 66%);
    border: 1px solid #5da4ce;
    border-radius: 0.55rem;
    box-shadow: inset 0 1px rgb(255 255 255 / 12%);
    display: block;
    flex: 0 0 4rem;
    height: 4rem;
    padding: 0.45rem;
  }
  .goal-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .goal-row span {
    background: rgb(3 13 25 / 58%);
    border: 1px solid #426985;
    border-radius: 999px;
    color: #d7eafb;
    font-size: 0.75rem;
    padding: 0.25rem 0.55rem;
  }
  .mission-progress {
    display: grid;
    gap: 0.45rem;
    margin: 1.1rem 0;
  }
  .mission-progress > div {
    align-items: baseline;
    display: flex;
    gap: 0.7rem;
    justify-content: space-between;
  }
  .mission-progress span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 0.72rem;
  }
  progress {
    appearance: none;
    background: #07111f;
    border: 1px solid #466a88;
    border-radius: 999px;
    height: 0.78rem;
    overflow: hidden;
    width: 100%;
  }
  progress::-webkit-progress-bar {
    background: #07111f;
  }
  progress::-webkit-progress-value,
  progress::-moz-progress-bar {
    background: linear-gradient(90deg, #44bddc, #67e0bd);
    box-shadow: 0 0 12px rgb(78 219 255 / 55%);
  }
  .current-grid {
    align-items: start;
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1.65fr) minmax(15rem, 0.75fr);
  }
  .movement-target {
    align-items: center;
    background: rgb(4 12 24 / 48%);
    border: 1px solid #3f627f;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    margin: 0 0 1rem;
    padding: 0.75rem 0.85rem;
  }
  .movement-target p,
  .movement-target strong {
    margin: 0;
  }
  .movement-target > div {
    display: grid;
    flex: 0 0 auto;
    gap: 0.18rem;
  }
  .movement-target > span {
    color: var(--color-text-muted);
    font-size: 0.82rem;
    line-height: 1.4;
    max-width: 40rem;
    text-align: right;
  }
  .current-grid :global(.program-calendar) {
    background: rgb(4 12 24 / 48%);
    border: 1px solid #3f627f;
  }
  .next-window {
    background: rgb(4 12 24 / 55%);
    border: 1px solid #3f627f;
    padding: 0.85rem;
  }
  .next-window > p {
    margin: 0 0 0.55rem;
  }
  .next-action {
    background: linear-gradient(
      145deg,
      rgb(31 78 119 / 92%),
      rgb(13 34 59 / 94%)
    );
    border: 2px solid #79c7e9;
    box-shadow: inset 0 1px rgb(255 255 255 / 17%);
    color: var(--color-text) !important;
    display: grid;
    gap: 0.55rem;
    min-height: 9rem;
    padding: 1rem;
    text-decoration: none;
  }
  a.next-action:hover {
    box-shadow:
      inset 0 1px rgb(255 255 255 / 21%),
      0 0 24px rgb(78 219 255 / 24%);
  }
  .next-action > span:not(.next-signal) {
    color: #c5d7e8;
    line-height: 1.45;
  }
  .next-action b {
    align-self: end;
    color: var(--color-primary);
  }
  .next-signal {
    background: var(--color-positive);
    border-radius: 50%;
    box-shadow: 0 0 12px rgb(59 227 162 / 70%);
    height: 0.55rem;
    width: 0.55rem;
  }
  .launch-panel {
    align-items: center;
    display: flex;
    gap: 1.5rem;
    justify-content: space-between;
    padding: clamp(1rem, 3vw, 1.6rem);
  }
  .launch-panel h2,
  .launch-panel p {
    margin: 0.2rem 0;
  }
  .launch-panel > div > p:last-child {
    color: #bed0e1;
  }
  .launch-panel .button-link {
    flex: 0 0 auto;
  }
  .saved-programs {
    padding: 1rem;
  }
  .section-heading {
    align-items: end;
    display: flex;
    justify-content: space-between;
  }
  .section-heading h2,
  .section-heading p {
    margin: 0.2rem 0;
  }
  .section-heading > span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  .program-list {
    display: grid;
    gap: 0.75rem;
    list-style: none;
    padding: 0;
  }
  .archive-limit-note {
    color: var(--color-text-muted);
    font-size: 0.82rem;
    margin: 0.85rem 0 0;
  }
  .program-list li {
    align-items: center;
    background: rgb(7 15 27 / 62%);
    border: 1px solid #385774;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    padding: 0.85rem;
  }
  .program-identity {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    min-width: 0;
  }
  .program-identity > div {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  .program-identity small {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }
  .program-icon-button {
    background: #0b1c30;
    border: 2px solid #5488ad;
    border-radius: 0.4rem;
    box-shadow: inset 0 1px rgb(255 255 255 / 11%);
    flex: 0 0 3rem;
    height: 3rem;
    overflow: hidden;
    padding: 0.28rem;
    display: block;
  }
  .program-icon-button:hover {
    border-color: var(--color-primary);
  }
  .program-actions {
    align-items: center;
    display: flex;
    gap: 0.55rem;
  }
  .button-link.compact,
  .delete-trigger {
    font-size: 0.82rem;
    min-height: 2.5rem;
    padding: 0.5rem 0.7rem;
  }
  .program-actions details {
    position: relative;
  }
  .delete-trigger {
    align-items: center;
    background: linear-gradient(180deg, #552b37, #301a24);
    border: 2px solid #b76570;
    border-radius: var(--radius-sm);
    color: #ffdfe3;
    cursor: pointer;
    display: inline-flex;
    font-weight: 850;
    list-style: none;
  }
  .delete-trigger::-webkit-details-marker {
    display: none;
  }
  .program-actions form {
    background: #0c1728;
    border: 2px solid #bd5662;
    border-radius: 0.55rem;
    box-shadow: 0 12px 32px rgb(0 0 0 / 48%);
    padding: 0.8rem;
    position: absolute;
    right: 0;
    width: min(310px, 75vw);
    z-index: 2;
  }
  .program-actions form p {
    margin-top: 0;
  }
  .delete-button {
    background: #a73845 !important;
    border-color: #ff8894 !important;
    color: white !important;
  }
  .message {
    border-radius: 0.5rem;
    padding: 0.7rem;
  }
  .empty-state {
    color: var(--color-text-muted);
    display: grid;
    gap: 0.35rem;
    padding: 2.5rem 1rem;
    text-align: center;
  }
  :global(html[data-theme="cute"]) .current-mission {
    background: #fff9fc !important;
    border-color: #5a1a36 !important;
    box-shadow: 4px 5px 0 rgb(162 14 82 / 18%) !important;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .current-icon,
  :global(html[data-theme="cute"]) .program-icon-button {
    background: #ffe2ed;
    border-color: #5a1a36;
    box-shadow: none;
    overflow: hidden;
    padding: 0;
  }
  :global(html[data-theme="cute"]) .goal-row span {
    background: #ffe2ed;
    border-color: #a20e52;
    color: #321523;
  }
  :global(html[data-theme="cute"]) progress,
  :global(html[data-theme="cute"]) progress::-webkit-progress-bar {
    background: #ead6df;
    border-color: #5a1a36;
  }
  :global(html[data-theme="cute"]) progress::-webkit-progress-value,
  :global(html[data-theme="cute"]) progress::-moz-progress-bar {
    background: #a20e52;
    box-shadow: none;
  }
  :global(html[data-theme="cute"]) .current-grid :global(.program-calendar),
  :global(html[data-theme="cute"]) .movement-target,
  :global(html[data-theme="cute"]) .next-window {
    background: #fff;
    border-color: #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .movement-target > span {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .movement-target .mission-kicker {
    color: #a20e52;
  }
  :global(html[data-theme="cute"]) .next-action {
    background: #fff;
    border-color: #a20e52;
    box-shadow: 3px 4px 0 rgb(162 14 82 / 16%);
    color: #321523 !important;
  }
  :global(html[data-theme="cute"]) .next-action > span:not(.next-signal) {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .next-signal {
    background: #1e7a55;
    box-shadow: 0 0 0 3px rgb(30 122 85 / 18%);
  }
  :global(html[data-theme="cute"]) .launch-panel > div > p:last-child {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .program-list li,
  :global(html[data-theme="cute"]) .program-actions form {
    background: #fff;
    border-color: #5a1a36;
    box-shadow: none;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .delete-trigger {
    background: #fff;
    border-color: #a20e52;
    color: #7a093d;
  }
  @media (max-width: 850px) {
    .current-grid {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 700px) {
    .dashboard-header,
    .launch-panel,
    .current-heading {
      align-items: stretch;
      display: grid;
    }
    .account-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .account-actions .button-link,
    .account-actions button {
      justify-content: center;
      width: 100%;
    }
    .mission-progress > div,
    .movement-target,
    .program-list li,
    .program-actions {
      align-items: start;
      display: grid;
    }
    .movement-target > span {
      text-align: left;
    }
    .program-actions {
      grid-template-columns: 1fr 1fr;
      padding-left: 3.75rem;
    }
    .program-actions details {
      grid-column: 1 / -1;
    }
    .program-actions form {
      left: 0;
      right: auto;
    }
  }
  @media (max-width: 430px) {
    .current-identity {
      align-items: start;
    }
    .current-icon {
      flex-basis: 3rem;
      height: 3rem;
    }
    .program-actions {
      grid-template-columns: 1fr;
    }
    .program-actions details {
      grid-column: auto;
    }
  }
</style>
