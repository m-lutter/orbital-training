<script lang="ts">
  import { onMount } from "svelte";

  let { siteKey }: { siteKey: string } = $props();
  let container: HTMLDivElement;
  let token = $state("");
  let unavailable = $state(false);

  type TurnstileApi = {
    render(
      container: HTMLElement,
      options: {
        sitekey: string;
        callback(token: string): void;
        "expired-callback"(): void;
        "error-callback"(): void;
      },
    ): string;
    remove(widgetId: string): void;
  };

  function loadTurnstile(): Promise<TurnstileApi> {
    const current = (window as Window & { turnstile?: TurnstileApi }).turnstile;
    if (current !== undefined) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-orbital-turnstile="true"]',
      );
      const script = existing ?? document.createElement("script");
      script.addEventListener("load", () => {
        const api = (window as Window & { turnstile?: TurnstileApi }).turnstile;
        if (api === undefined) reject(new Error("Turnstile did not load."));
        else resolve(api);
      });
      script.addEventListener("error", () =>
        reject(new Error("Turnstile could not load.")),
      );
      if (existing === null) {
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.orbitalTurnstile = "true";
        document.head.appendChild(script);
      }
    });
  }

  onMount(() => {
    let widgetId: string | undefined;
    let disposed = false;
    void loadTurnstile()
      .then((api) => {
        if (disposed) return;
        widgetId = api.render(container, {
          sitekey: siteKey,
          callback: (value) => {
            token = value;
            unavailable = false;
          },
          "expired-callback": () => (token = ""),
          "error-callback": () => {
            token = "";
            unavailable = true;
          },
        });
      })
      .catch(() => (unavailable = true));
    return () => {
      disposed = true;
      const api = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (widgetId !== undefined) api?.remove(widgetId);
    };
  });
</script>

<div class="challenge">
  <div bind:this={container}></div>
  <input type="hidden" name="captchaToken" value={token} />
  {#if unavailable}
    <p role="alert">
      The security check could not load. Check your connection or content
      blocker, then reload this page.
    </p>
  {/if}
</div>

<style>
  .challenge {
    min-height: 4rem;
    overflow: hidden;
  }
  p {
    color: var(--color-warning);
    font-size: 0.8rem;
    line-height: 1.4;
    margin: 0;
  }
</style>
