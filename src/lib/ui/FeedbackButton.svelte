<script lang="ts">
  import { page } from "$app/state";
  import { APP_VERSION } from "$lib/app-meta";

  type FeedbackCategory = "bug" | "confusing" | "idea" | "other";

  let dialog: HTMLDialogElement;
  let category = $state<FeedbackCategory>("bug");
  let message = $state("");
  let blockedUser = $state(false);
  let mayContact = $state(true);
  let submitting = $state(false);
  let errorMessage = $state<string>();
  let reference = $state<string>();

  const visible = $derived(page.url.pathname !== "/login");

  function openFeedback(): void {
    errorMessage = undefined;
    reference = undefined;
    dialog.showModal();
  }

  function closeFeedback(): void {
    dialog.close();
  }

  async function submitFeedback(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    errorMessage = undefined;
    reference = undefined;
    submitting = true;

    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          message,
          blockedUser,
          mayContact,
          pagePath: page.url.pathname,
          programId: page.params.id,
          appVersion: APP_VERSION,
          website: String(formData.get("website") ?? ""),
          clientContext: {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            standalone:
              window.matchMedia("(display-mode: standalone)").matches ||
              ("standalone" in navigator &&
                (navigator as Navigator & { standalone?: boolean })
                  .standalone === true),
          },
        }),
      });
      const result = (await response.json()) as {
        reference?: string;
        message?: string;
      };
      if (!response.ok) {
        errorMessage =
          result.message ?? "Feedback could not be sent. Please try again.";
        return;
      }
      reference = result.reference;
      message = "";
      blockedUser = false;
    } catch {
      errorMessage =
        "Feedback could not be sent. Check your connection and try again.";
    } finally {
      submitting = false;
    }
  }
</script>

{#if visible}
  <button
    class="feedback-trigger"
    type="button"
    aria-label="Open beta feedback"
    onclick={openFeedback}
  >
    <span class="orbital-only" aria-hidden="true">✦</span>
    <span class="cute-only" aria-hidden="true">♥</span>
    <span>Beta feedback</span>
  </button>
{/if}

<dialog
  bind:this={dialog}
  class="feedback-dialog"
  aria-labelledby="feedback-title"
>
  <div class="feedback-header">
    <div>
      <span class="eyebrow">Open beta</span>
      <h2 id="feedback-title">
        <span class="orbital-only">Help improve Orbital Training</span>
        <span class="cute-only">Help improve Pretty Strong Training</span>
      </h2>
    </div>
    <button
      class="dialog-close secondary"
      type="button"
      onclick={closeFeedback}
      aria-label="Close feedback form">×</button
    >
  </div>

  {#if reference}
    <div class="feedback-success" role="status">
      <strong>Feedback received—thank you.</strong>
      <span>Reference {reference}</span>
      <button type="button" onclick={closeFeedback}>Done</button>
    </div>
  {:else}
    <form onsubmit={submitFeedback}>
      <label>
        What would you like to share?
        <select bind:value={category}>
          <option value="bug">Something isn’t working</option>
          <option value="confusing">Something is confusing</option>
          <option value="idea">I have an idea</option>
          <option value="other">Other feedback</option>
        </select>
      </label>

      <label>
        Tell us what happened or what you would change
        <textarea
          bind:value={message}
          minlength="20"
          maxlength="4000"
          rows="6"
          required
          placeholder="Include what you were trying to do and what happened."
        ></textarea>
        <small>{message.length}/4000</small>
        {#if message.trim().length > 0 && message.trim().length < 20}
          <small class="minimum-note"
            >Add a little more detail ({20 - message.trim().length} characters remaining).</small
          >
        {/if}
      </label>

      {#if category === "bug"}
        <label class="check-row">
          <input type="checkbox" bind:checked={blockedUser} />
          This stopped me from continuing
        </label>
      {/if}

      <label class="check-row">
        <input type="checkbox" bind:checked={mayContact} />
        You may contact me about this report
      </label>

      <p class="diagnostic-note">
        This report includes the current page, app version, screen size, and a
        broad browser type. It does not include your password, workout answers,
        or complete program. Reports are deleted after 90 days. See the <a
          href="/privacy">privacy notice</a
        > for details.
      </p>

      <label class="feedback-honeypot" aria-hidden="true">
        Website
        <input name="website" tabindex="-1" autocomplete="off" />
      </label>

      {#if errorMessage}
        <p class="feedback-error" role="alert">{errorMessage}</p>
      {/if}

      <div class="feedback-actions">
        <button class="secondary" type="button" onclick={closeFeedback}>
          Cancel
        </button>
        <button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send feedback"}
        </button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  .feedback-trigger {
    align-items: center;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
    display: flex;
    gap: 0.45rem;
    padding-inline: 0.85rem !important;
    position: fixed;
    right: 1rem;
    z-index: 45;
  }
  .feedback-trigger span:first-child {
    color: #132334;
    font-size: 1.05rem;
  }
  .feedback-dialog {
    background:
      linear-gradient(145deg, rgb(28 55 84 / 88%), rgb(7 14 27 / 98%)), #07101e;
    border: 2px solid #6d9abd;
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 80px rgb(0 0 0 / 64%);
    color: var(--color-text);
    max-height: min(44rem, calc(100dvh - 2rem));
    max-width: 35rem;
    overflow: auto;
    padding: 1.2rem;
    width: calc(100% - 2rem);
  }
  .feedback-dialog::backdrop {
    background: rgb(1 5 12 / 78%);
    backdrop-filter: blur(3px);
  }
  .feedback-header {
    align-items: start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }
  .feedback-header h2 {
    font-size: clamp(1.35rem, 5vw, 1.85rem);
    margin: 0.25rem 0 1rem;
  }
  .feedback-header .eyebrow {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .dialog-close {
    font-size: 1.35rem;
    min-width: var(--touch-target);
    padding: 0.35rem !important;
  }
  form,
  label,
  .feedback-success {
    display: grid;
    gap: 0.5rem;
  }
  form {
    gap: 1rem;
  }
  select,
  textarea {
    min-height: var(--touch-target);
    padding: 0.7rem;
    width: 100%;
  }
  textarea {
    line-height: 1.45;
    resize: vertical;
  }
  label small {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    justify-self: end;
  }
  label small.minimum-note {
    color: var(--color-warning);
    justify-self: start;
  }
  .check-row {
    align-items: center;
    display: flex;
    gap: 0.65rem;
  }
  .check-row input {
    height: 1.15rem;
    width: 1.15rem;
  }
  .diagnostic-note {
    color: var(--color-text-muted);
    font-size: 0.82rem;
    line-height: 1.45;
    margin: 0;
  }
  .feedback-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    justify-content: flex-end;
  }
  .feedback-error {
    background: rgb(255 93 108 / 12%);
    border: 1px solid rgb(255 93 108 / 52%);
    color: #ffd8dd;
    margin: 0;
    padding: 0.75rem;
  }
  .feedback-success {
    justify-items: start;
  }
  .feedback-success span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }
  .feedback-honeypot {
    height: 1px;
    left: -10000px;
    overflow: hidden;
    position: absolute;
    width: 1px;
  }
  :global(html[data-theme="cute"]) .feedback-dialog {
    background: #fff;
    border-color: #5a1a36;
    box-shadow: 5px 6px 0 rgb(90 26 54 / 24%);
    color: #321523;
  }
  :global(html[data-theme="cute"]) .feedback-dialog::backdrop {
    background: rgb(50 21 35 / 58%);
  }
  :global(html[data-theme="cute"]) .feedback-dialog select,
  :global(html[data-theme="cute"]) .feedback-dialog textarea {
    background: white;
    border: 2px solid #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .feedback-dialog input[type="checkbox"] {
    accent-color: #a20e52;
  }
  :global(html[data-theme="cute"]) .feedback-dialog .minimum-note {
    color: #694052;
  }
  :global(html[data-theme="cute"]) .feedback-dialog .feedback-error {
    background: #fff0f3;
    border-color: #b4233c;
    color: #762035;
  }
  :global(html[data-theme="cute"]) .feedback-dialog button:not(.secondary) {
    background: #a20e52 !important;
    border-color: #5a1a36 !important;
    box-shadow: 0 3px 0 #5a1a36 !important;
    color: #fff !important;
  }
  @media (max-width: 520px) {
    .feedback-trigger span:last-child {
      display: none;
    }
    .feedback-trigger {
      aspect-ratio: 1;
      justify-content: center;
      padding: 0 !important;
      width: var(--touch-target);
    }
    .feedback-dialog {
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      margin: auto 0 0;
      max-height: min(46rem, calc(100dvh - 1rem));
      max-width: none;
      width: 100%;
    }
  }
</style>
