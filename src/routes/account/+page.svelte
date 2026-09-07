<script lang="ts">
  import ThemeToggle from "$lib/ui/ThemeToggle.svelte";
  import { page } from "$app/state";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
  let syncingFitness = $state(false);
  let fitnessSyncMessage = $state<string>();

  let providerDetails = $derived([
    {
      id: "google_health",
      name: "Google Health / Fitbit",
      description:
        "Fitbit and Google wearable steps, sleep, workouts, and heart rate through Google Health API v4.",
      cloud: true,
      configured: data.fitness.configuration.googleHealthConfigured,
    },
    {
      id: "apple_health",
      name: "Apple Health",
      description:
        "Steps, sleep, workouts, and heart rate through the iPhone companion.",
      cloud: false,
      configured: true,
    },
    {
      id: "health_connect",
      name: "Health Connect",
      description:
        "Android health data through the mobile companion, including compatible Fitbit and Pixel Watch data shared with Health Connect.",
      cloud: false,
      configured: true,
    },
  ] as const);

  function connection(provider: string) {
    return data.fitness.connections.find(
      (candidate) => candidate.provider === provider,
    );
  }

  function localDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  async function syncFitnessNow(): Promise<void> {
    if (syncingFitness) return;
    syncingFitness = true;
    fitnessSyncMessage = undefined;
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
        attempted?: number;
        configured?: boolean;
        failed?: number;
        succeeded?: number;
      };
      if (!response.ok) throw new Error("Sync could not be started.");
      fitnessSyncMessage =
        result.configured === false
          ? "Server credentials still need to be configured."
          : (result.succeeded ?? 0) > 0
            ? "Connected fitness data is up to date. Delayed workout heart-rate data will appear in weekly reviews."
            : (result.failed ?? 0) > 0
              ? "A provider could not sync. Reconnect it or try again later."
              : "No provider was due for another sync yet.";
    } catch (caught) {
      fitnessSyncMessage =
        caught instanceof Error ? caught.message : "Sync could not be started.";
    } finally {
      syncingFitness = false;
    }
  }
</script>

<svelte:head>
  <title>Account | Powerlifting App</title>
</svelte:head>

<main class="mission-page account-page">
  <header class="account-header">
    <div>
      <p class="mission-kicker orbital-only">Crew record</p>
      <p class="mission-kicker cute-only">Your account</p>
      <h1>Account and training data</h1>
      <p>Signed in as {data.email}</p>
    </div>
    <a class="button-link secondary" href="/dashboard">Back to dashboard</a>
  </header>

  <section class="mission-panel appearance-panel">
    <div>
      <p class="mission-kicker">Appearance</p>
      <h2>Choose your training style</h2>
      <p>Switch between the space and Cute looks whenever you like.</p>
    </div>
    <ThemeToggle />
  </section>

  <section class="mission-panel fitness-panel" aria-labelledby="fitness-title">
    <div class="fitness-heading">
      <div>
        <p class="mission-kicker">Connected health</p>
        <h2 id="fitness-title">Wearables and phone health data</h2>
        <p>
          Sync imports delayed movement, sleep, and heart-rate data. Five-minute
          heart-rate history is matched to completed workouts and appears in
          weekly reviews. Manual entries remain available and take precedence.
        </p>
      </div>
      {#if data.fitness.connections.some((item) => item.status === "active")}
        <button
          class="secondary"
          type="button"
          disabled={syncingFitness}
          onclick={syncFitnessNow}
        >
          {syncingFitness ? "Syncing…" : "Sync now"}
        </button>
      {/if}
    </div>

    {#if page.url.searchParams.get("fitness") === "connected"}
      <p class="fitness-message" role="status">
        Connection saved. The first sync is starting in the background.
      </p>
    {:else if page.url.searchParams.get("fitness") === "denied"}
      <p class="fitness-message" role="status">
        Nothing was connected because access was not granted.
      </p>
    {:else if page.url.searchParams.get("fitness") === "error"}
      <p class="fitness-error" role="alert">
        The provider could not be connected. Check its callback URL and try
        again.
      </p>
    {/if}
    {#if fitnessSyncMessage}
      <p class="fitness-message" role="status">{fitnessSyncMessage}</p>
    {/if}

    {#if !data.fitness.schemaReady}
      <p class="fitness-error" role="alert">
        Apply the fitness data migrations before connecting a provider.
      </p>
    {:else if !data.fitness.configuration.baseConfigured}
      <p class="fitness-error" role="alert">
        Fitness storage is installed, but the Worker’s server-only service and
        token-encryption secrets have not been configured yet.
      </p>
    {/if}

    <div class="provider-list">
      {#each providerDetails as provider}
        {@const saved = connection(provider.id)}
        <article class="provider-card">
          <div>
            <h3>{provider.name}</h3>
            <p>{provider.description}</p>
            {#if saved?.status === "active"}
              <small>
                Connected{saved.last_synced_at
                  ? ` · last synced ${new Date(saved.last_synced_at).toLocaleString()}`
                  : " · waiting for first sync"}
              </small>
              {#if saved.last_error_code}
                <small class="provider-error">
                  Latest sync needs attention ({saved.last_error_code}).
                </small>
              {/if}
            {:else if saved?.status === "disconnected"}
              <small>Disconnected</small>
              <small>
                Reconnecting starts a fresh provider generation and clears its
                retained imports before syncing again.
              </small>
            {/if}
          </div>
          <div class="provider-actions">
            {#if saved?.status === "active"}
              <details>
                <summary>Disconnect</summary>
                <form
                  method="POST"
                  action={`/api/fitness/connections/${provider.id}/disconnect`}
                >
                  <label class="delete-imported-data">
                    <input
                      type="checkbox"
                      name="deleteHealthData"
                      value="true"
                    />
                    Also delete imported health data
                  </label>
                  <button class="secondary" type="submit">Disconnect</button>
                </form>
              </details>
            {:else if provider.cloud}
              {#if data.fitness.schemaReady && data.fitness.configuration.baseConfigured && provider.configured}
                <a
                  class="button-link"
                  href={`/api/fitness/connections/${provider.id}/start`}
                  >Connect</a
                >
              {:else if !provider.configured}
                <small>Provider credentials not configured</small>
              {/if}
            {:else}
              <small
                >Connect from the Orbital Health Sync mobile companion</small
              >
            {/if}
          </div>
        </article>
      {/each}
    </div>
    <p class="fitness-privacy">
      Five-minute heart-rate buckets and summaries are kept for training
      history. Orbital does not use wearable data for live workout feedback. <a
        href="/privacy">Review the privacy notice</a
      >.
    </p>
  </section>

  <section class="mission-panel data-panel">
    <div>
      <p class="mission-kicker">Your data</p>
      <h2>Download a copy</h2>
      <p>
        Export your profile, programs, questionnaire history, workout logs,
        weekly reviews, normalized connected-fitness history, consent records,
        and feedback as one JSON file.
      </p>
    </div>
    <form class="export-form" method="POST" action="/account/export">
      <button type="submit">Download my data</button>
    </form>
  </section>

  <section class="mission-panel legal-panel">
    <div>
      <p class="mission-kicker">Privacy and terms</p>
      <h2>How your data is handled</h2>
      <p>
        Review what the app stores, why it is used, its service providers, and
        your export and deletion controls.
      </p>
    </div>
    <div class="legal-links">
      <a href="/privacy">Privacy notice</a>
      <a href="/terms">Terms of use</a>
    </div>
  </section>

  <section class="mission-panel danger-panel">
    <p class="mission-kicker">Permanent action</p>
    <h2>Delete account</h2>
    <p>
      This permanently removes your account and all associated programs, program
      versions, questionnaire responses, workout logs, weekly reviews, and
      feedback. This cannot be undone.
    </p>

    <details>
      <summary>Delete my account and training data</summary>
      <form method="POST" action="?/delete">
        <label for="delete-password">Current password</label>
        <input
          id="delete-password"
          name="password"
          type="password"
          autocomplete="current-password"
          minlength="8"
          required
        />

        <label for="delete-confirmation">Type DELETE to confirm</label>
        <input
          id="delete-confirmation"
          name="confirmation"
          type="text"
          autocomplete="off"
          pattern="DELETE"
          required
        />

        {#if form?.message}
          <p class="account-error" role="alert">{form.message}</p>
        {/if}

        <button class="delete-button" type="submit">
          Permanently delete account
        </button>
      </form>
    </details>
  </section>
</main>

<style>
  .account-page {
    max-width: 58rem;
  }
  .account-header,
  .data-panel,
  .appearance-panel,
  .legal-panel {
    align-items: center;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  .account-header {
    margin-bottom: 1rem;
  }
  .account-header h1,
  .account-header p,
  .data-panel h2,
  .data-panel p,
  .appearance-panel h2,
  .appearance-panel p,
  .legal-panel h2,
  .legal-panel p {
    margin: 0.25rem 0;
  }
  .account-header > div > p:last-child,
  .data-panel > div > p:last-child,
  .appearance-panel > div > p:last-child,
  .legal-panel > div > p:last-child,
  .danger-panel > p:not(.mission-kicker) {
    color: var(--color-text-muted);
    line-height: 1.55;
  }
  .data-panel,
  .appearance-panel,
  .legal-panel,
  .fitness-panel,
  .danger-panel {
    padding: clamp(1rem, 4vw, 1.5rem);
  }
  .fitness-panel {
    display: grid;
    gap: 1rem;
  }
  .fitness-heading {
    align-items: center;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  .fitness-heading h2,
  .fitness-heading p,
  .provider-card h3,
  .provider-card p {
    margin: 0.25rem 0;
  }
  .fitness-heading > div > p:last-child,
  .provider-card p,
  .fitness-privacy {
    color: var(--color-text-muted);
    line-height: 1.5;
  }
  .provider-list {
    display: grid;
    gap: 0.75rem;
  }
  .provider-card {
    align-items: center;
    background: rgb(6 19 36 / 55%);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    padding: 0.85rem;
  }
  .provider-card small {
    color: var(--color-text-muted);
    display: block;
    margin-top: 0.25rem;
  }
  .provider-card .provider-error,
  .fitness-error {
    color: #ffd6dd;
  }
  .provider-actions {
    flex: 0 0 auto;
    max-width: 18rem;
    text-align: right;
  }
  .provider-actions details {
    margin: 0;
  }
  .provider-actions form {
    margin: 0.65rem 0 0;
    min-width: min(18rem, 70vw);
    text-align: left;
  }
  .delete-imported-data {
    align-items: center;
    display: flex;
    gap: 0.5rem;
  }
  .delete-imported-data input {
    min-height: auto;
    width: auto;
  }
  .fitness-message,
  .fitness-error {
    border-left: 3px solid var(--color-primary);
    margin: 0;
    padding: 0.65rem 0.8rem;
  }
  .fitness-error {
    background: rgb(166 44 61 / 17%);
    border-color: #ef8fa0;
  }
  :global(html[data-theme="cute"]) .provider-card {
    background: #fff9fc;
    border: 2px solid #5a1a36;
  }
  :global(html[data-theme="cute"]) .fitness-error,
  :global(html[data-theme="cute"]) .provider-card .provider-error {
    color: #762035;
  }
  .data-panel .export-form {
    flex: 0 0 auto;
    margin: 0;
  }
  .appearance-panel :global(.theme-toggle) {
    flex: 0 0 auto;
  }
  .legal-links {
    display: grid;
    flex: 0 0 auto;
    gap: 0.45rem;
    text-align: right;
  }
  .danger-panel {
    border-color: #9b4c5a;
  }
  .danger-panel h2 {
    margin: 0.25rem 0 0.5rem;
  }
  details {
    background: rgb(57 19 29 / 46%);
    border: 1px solid #9b4c5a;
    border-radius: var(--radius-md);
    margin-top: 1rem;
    padding: 0.85rem;
  }
  summary {
    color: #ffdce1;
    cursor: pointer;
    font-weight: 800;
  }
  form {
    display: grid;
    gap: 0.55rem;
    margin-top: 1rem;
    max-width: 30rem;
  }
  input {
    min-height: 3rem;
  }
  .delete-button {
    background: #a73845 !important;
    border-color: #ff8995 !important;
    color: white !important;
    margin-top: 0.5rem;
  }
  .account-error {
    background: rgb(103 30 43 / 55%);
    border: 1px solid #d36c79;
    border-radius: var(--radius-sm);
    padding: 0.7rem;
  }
  :global(html[data-theme="cute"]) .danger-panel details {
    background: #fff0f3;
    border-color: #b4233c;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .danger-panel summary {
    color: #762035;
  }
  :global(html[data-theme="cute"]) .account-error {
    background: #fff0f3;
    border-color: #b4233c;
    color: #762035;
  }
  @media (max-width: 640px) {
    .account-header,
    .data-panel,
    .appearance-panel,
    .legal-panel,
    .fitness-heading,
    .provider-card {
      align-items: stretch;
      display: grid;
    }
    .account-header .button-link,
    .data-panel .export-form button,
    .appearance-panel :global(.theme-toggle) {
      justify-content: center;
    }
    .legal-links {
      text-align: left;
    }
    .provider-actions {
      max-width: none;
      text-align: left;
    }
  }
</style>
