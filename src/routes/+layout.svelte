<script lang="ts">
  import { page } from "$app/state";
  import { OPEN_BETA } from "$lib/app-meta";
  import "$lib/styles/tokens.css";
  import "$lib/styles/orbital.css";
  import "$lib/styles/cute.css";
  import type { Component } from "svelte";
  import FitnessForegroundSync from "$lib/ui/FitnessForegroundSync.svelte";

  let { children } = $props();
  let FeedbackButton = $state<Component>();

  $effect(() => {
    if (page.url.pathname === "/login" || FeedbackButton !== undefined) return;
    void import("$lib/ui/FeedbackButton.svelte").then((module) => {
      FeedbackButton = module.default;
    });
  });

  const routeLabel = $derived.by(() => {
    const path = page.url.pathname;
    if (path === "/login") return "Ready for Lift-off";
    if (path === "/dashboard") return "Mission control";
    if (path.startsWith("/account")) return "Crew record";
    if (path === "/programs/new") return "Program builder";
    if (path.includes("/reviews/")) return "Weekly debrief";
    if (path.includes("/workouts/")) return "Active training";
    if (path.startsWith("/programs/")) return "Flight plan";
    return "Adaptive training";
  });
  const cuteRouteLabel = $derived.by(() => {
    const path = page.url.pathname;
    if (path === "/login") return "Welcome";
    if (path === "/dashboard") return "Training home";
    if (path.startsWith("/account")) return "Your account";
    if (path === "/programs/new") return "Program builder";
    if (path.includes("/reviews/")) return "Weekly check-in";
    if (path.includes("/workouts/")) return "Today’s training";
    if (path.startsWith("/programs/")) return "Training plan";
    return "Personalized training";
  });
</script>

<svelte:head>
  <link rel="icon" type="image/png" href="/icon-192.png" />
</svelte:head>

<div class="orbital-app orbital-theme">
  <FitnessForegroundSync userId={page.data.fitnessSyncUserId ?? null} />
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="flight-masthead">
    <a
      class="flight-brand"
      href="/dashboard"
      aria-label="Powerlifting App dashboard"
    >
      <img class="flight-mark" src="/icon-192.png" alt="" aria-hidden="true" />
      <span class="cute-mark cute-only" aria-hidden="true">♥</span>
      <span class="flight-brand-text">
        <strong class="orbital-only">Orbital Training</strong>
        <strong class="cute-only">Pretty Strong Training</strong>
        <small>
          <span class="orbital-only">Adaptive performance system</span>
          <span class="cute-only">Your personalized training studio</span>
          {#if OPEN_BETA}<span class="beta-label">Open beta</span>{/if}
        </small>
      </span>
    </a>
    <div class="masthead-controls">
      <div class="masthead-context" aria-label={`Current area: ${routeLabel}`}>
        <span class="orbital-only">{routeLabel}</span>
        <span class="cute-only">{cuteRouteLabel}</span>
      </div>
    </div>
  </header>
  <div class="orbital-content" id="main-content">
    {@render children()}
  </div>
  <footer class="site-footer">
    <span>Orbital Training</span>
    <nav aria-label="Legal and support">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  </footer>
  {#if FeedbackButton}<FeedbackButton />{/if}
</div>

<style>
  .masthead-controls {
    align-items: center;
    display: flex;
    gap: 0.75rem;
  }
  .cute-mark {
    align-items: center;
    background: #ffe2ed;
    border: 2px solid #5a1a36;
    border-radius: 0.7rem;
    color: #a20e52;
    display: inline-flex;
    flex: 0 0 auto;
    height: 2rem;
    justify-content: center;
    width: 2rem;
  }
  :global(html[data-theme="cute"]) .flight-mark {
    display: none;
  }
  .site-footer {
    align-items: center;
    color: var(--color-text-muted);
    display: flex;
    font-size: 0.78rem;
    gap: 1rem;
    justify-content: center;
    padding: 1.25rem 5rem 1.5rem 1rem;
  }
  .site-footer nav {
    display: flex;
    gap: 0.85rem;
  }
  .site-footer a {
    color: inherit;
  }
</style>
