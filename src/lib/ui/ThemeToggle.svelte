<script lang="ts">
  import { onMount } from "svelte";
  import {
    APP_THEME_STORAGE_KEY,
    parseAppTheme,
    themeCookie,
    type AppTheme,
  } from "./theme";

  let theme = $state<AppTheme>("orbital");

  function apply(next: AppTheme, persist = true): void {
    theme = next;
    document.documentElement.dataset.theme = next;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "cute" ? "#ffb1d0" : "#0b1c30");
    if (!persist) return;
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, next);
    } catch {
      // The cookie still preserves the preference when storage is unavailable.
    }
    document.cookie = themeCookie(next, location.protocol === "https:");
  }

  onMount(() => {
    apply(
      parseAppTheme(document.documentElement.dataset.theme) ?? "orbital",
      false,
    );
  });
</script>

<button
  class="theme-toggle"
  type="button"
  aria-label={`Switch to ${theme === "cute" ? "Space" : "Cute"} appearance`}
  aria-pressed={theme === "cute"}
  onclick={() => apply(theme === "cute" ? "orbital" : "cute")}
>
  <span aria-hidden="true">{theme === "cute" ? "✦" : "♡"}</span>
  <span class="theme-toggle-label">{theme === "cute" ? "Space" : "Cute"}</span>
</button>

<style>
  .theme-toggle {
    align-items: center;
    display: inline-flex;
    font-size: 0.75rem !important;
    gap: 0.35rem;
    min-height: 2.75rem !important;
    padding: 0.35rem 0.65rem !important;
    white-space: nowrap;
  }
</style>
