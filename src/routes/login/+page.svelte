<script lang="ts">
  import QuoteCard from "$lib/ui/QuoteCard.svelte";
  import TurnstileChallenge from "$lib/ui/TurnstileChallenge.svelte";
  import { freshAppQuote, type AppQuote } from "$lib/ui/quotes";
  import { afterNavigate } from "$app/navigation";
  import { onMount } from "svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let quote = $state<AppQuote>();
  let showIosInstall = $state(false);
  let showPassword = $state(false);
  // Keep the user's live value in component state. Binding the input directly
  // to action data caused unrelated rerenders (including the password toggle)
  // to restore the last server value and clear a newly typed email address.
  // svelte-ignore state_referenced_locally -- action data seeds this form instance.
  let email = $state(form?.email ?? "");
  afterNavigate(() => {
    quote = freshAppQuote("login");
  });
  onMount(() => {
    const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const alreadyInstalled =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        (navigator as Navigator & { standalone?: boolean }).standalone ===
          true);
    showIosInstall = iosDevice && !alreadyInstalled;
  });
</script>

<svelte:head>
  <title>Login | Powerlifting App</title>
</svelte:head>

<main class="mission-page login-page">
  <section class="login-shell mission-panel">
    <div class="welcome-panel">
      <h1 class="orbital-only">Welcome to your training mission.</h1>
      <h1 class="cute-only">Welcome to training made for you.</h1>
      <p>
        Sign in to create your personalized training plan or continue with your
        current program.
      </p>
      <QuoteCard {quote} showIn="orbital" />
    </div>

    <form method="POST" class="identity-form">
      {#if data.accountDeleted}
        <p class="account-deleted" role="status">
          Your account and training data were permanently deleted.
        </p>
      {/if}

      {#if data.emailConfirmed}
        <div class="confirmation-notice confirmed" role="status">
          <strong>Email confirmed</strong>
          <span>You can now log in to continue to your program.</span>
        </div>
      {/if}

      {#if form?.signupPending}
        <div class="confirmation-notice" role="status" aria-live="polite">
          <strong>Check your email to finish creating your account</strong>
          <span>
            Supabase sent a confirmation link to {form.email}. Open that link,
            then return here and log in. You cannot proceed until the address is
            confirmed.
          </span>
        </div>
      {/if}

      <label for="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autocomplete="email"
        bind:value={email}
        required
      />

      <label for="password">Password</label>
      <div class="password-field">
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autocomplete="current-password"
          minlength="8"
          required
        />
        <button
          class="password-toggle"
          type="button"
          aria-controls="password"
          aria-pressed={showPassword}
          onclick={() => (showPassword = !showPassword)}
          >{showPassword ? "Hide" : "Show"}</button
        >
      </div>

      {#if data.turnstileSiteKey}
        <TurnstileChallenge siteKey={data.turnstileSiteKey} />
      {/if}

      <div class="form-actions">
        <button type="submit" formaction="?/login">Log in</button>
        <button class="secondary" type="submit" formaction="?/signup"
          >Create account</button
        >
      </div>

      <p class="signup-help">
        New accounts require email confirmation. After selecting Create account,
        open the verification link Supabase sends before logging in.
      </p>

      {#if form?.message && !form.signupPending}
        <p class="login-message" role="alert">{form.message}</p>
      {/if}

      {#if showIosInstall}
        <details class="ios-install">
          <summary>
            Add <span class="orbital-only">Orbital Training</span><span
              class="cute-only">Pretty Strong Training</span
            > to your Home Screen
          </summary>
          <ol>
            <li>Open this page in Safari.</li>
            <li>Tap the Share button.</li>
            <li>Choose <strong>Add to Home Screen</strong>, then tap Add.</li>
          </ol>
        </details>
      {/if}
    </form>
  </section>
</main>

<style>
  .login-page {
    display: grid;
    min-height: calc(100vh - 3.75rem);
    place-items: center;
  }
  .login-shell {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(19rem, 0.95fr);
    max-width: 62rem;
    overflow: hidden;
    padding: 0;
    width: 100%;
  }
  .welcome-panel,
  .identity-form {
    padding: clamp(1.35rem, 5vw, 3.25rem);
  }
  .welcome-panel {
    background:
      radial-gradient(circle at 80% 5%, rgb(78 219 255 / 16%), transparent 34%),
      linear-gradient(145deg, rgb(22 54 92 / 58%), transparent 62%);
  }
  .welcome-panel h1 {
    margin: 0.7rem 0 1rem;
  }
  .welcome-panel > p:last-of-type {
    color: var(--color-text-muted);
    line-height: 1.6;
  }
  .identity-form {
    background:
      repeating-linear-gradient(
        90deg,
        rgb(255 255 255 / 1.5%) 0 1px,
        transparent 1px 5px
      ),
      rgb(8 17 30 / 88%);
    border-left: 1px solid #35536e;
    display: grid;
    gap: 0.55rem;
  }
  input {
    min-height: 3rem;
    padding: 0.7rem;
  }
  .password-field {
    align-items: stretch;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .password-field input {
    border-bottom-right-radius: 0;
    border-top-right-radius: 0;
    min-width: 0;
  }
  .password-toggle {
    border-bottom-left-radius: 0;
    border-left: 0;
    border-top-left-radius: 0;
    min-width: 4.5rem;
    padding-inline: 0.9rem;
  }
  .form-actions {
    display: grid;
    gap: 0.7rem;
    grid-template-columns: 1fr 1fr;
    margin-top: 1rem;
  }
  .login-message {
    border-radius: 0.35rem;
    margin-bottom: 0;
    padding: 0.75rem;
  }
  .confirmation-notice {
    background: rgb(255 200 87 / 11%);
    border: 1px solid rgb(255 200 87 / 62%);
    border-radius: var(--radius-md);
    display: grid;
    gap: 0.35rem;
    margin-bottom: 0.65rem;
    padding: 0.85rem;
  }
  .confirmation-notice strong {
    color: #ffe3a0;
  }
  .confirmation-notice span,
  .signup-help {
    color: var(--color-text-muted);
    line-height: 1.45;
  }
  .confirmation-notice.confirmed {
    background: rgb(59 227 162 / 10%);
    border-color: rgb(59 227 162 / 52%);
  }
  .confirmation-notice.confirmed strong {
    color: #baffdf;
  }
  .signup-help {
    font-size: 0.8rem;
    margin: 0.25rem 0 0;
  }
  .account-deleted {
    background: rgb(35 105 79 / 48%);
    border: 1px solid #5bc99d;
    border-radius: var(--radius-sm);
    color: #ddfff1;
    margin: 0 0 0.6rem;
    padding: 0.75rem;
  }
  .ios-install {
    background: rgb(18 40 65 / 66%);
    border: 1px solid #416887;
    border-radius: var(--radius-md);
    margin-top: 0.65rem;
    padding: 0.75rem;
  }
  .ios-install summary {
    color: var(--color-primary);
    cursor: pointer;
    font-weight: 750;
  }
  .ios-install ol {
    color: var(--color-text-muted);
    line-height: 1.55;
    margin: 0.75rem 0 0;
    padding-left: 1.25rem;
  }
  @media (max-width: 700px) {
    .login-shell {
      grid-template-columns: 1fr;
    }
    .identity-form {
      border-left: 0;
      border-top: 1px solid #35536e;
    }
  }
  @media (max-width: 420px) {
    .form-actions {
      grid-template-columns: 1fr;
    }
  }
  :global(html[data-theme="cute"]) .confirmation-notice {
    background: #fff3d1;
    border-color: #946000;
  }
  :global(html[data-theme="cute"]) .confirmation-notice strong {
    color: #674300;
  }
  :global(html[data-theme="cute"]) .confirmation-notice.confirmed {
    background: #e5f5ed;
    border-color: #1e7a55;
  }
  :global(html[data-theme="cute"]) .confirmation-notice.confirmed strong {
    color: #15563c;
  }
</style>
