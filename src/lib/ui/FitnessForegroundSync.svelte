<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";

  let { userId }: { userId: string | null } = $props();
  let inFlight = false;
  let controller: AbortController | undefined;

  function localDate(now = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function storageKey(id: string): string {
    return `orbital-fitness-sync-day-v2:${id}`;
  }

  async function synchronizeIfDue(): Promise<void> {
    if (!userId || page.url.pathname === "/login" || inFlight) return;
    const today = localDate();
    const key = storageKey(userId);
    const forceAfterConnection =
      page.url.searchParams.get("fitness") === "connected";
    try {
      if (!forceAfterConnection && localStorage.getItem(key) === today) return;
    } catch {
      // Storage is optional; the server lease remains the authoritative guard.
    }

    inFlight = true;
    controller = new AbortController();
    try {
      const response = await fetch("/api/fitness/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          localDate: today,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        const outcome = (await response.json().catch(() => ({}))) as {
          failed?: number;
        };
        if ((outcome.failed ?? 0) === 0) {
          try {
            localStorage.setItem(key, today);
          } catch {
            // A later server lease still prevents expensive duplicate work.
          }
        }
        await invalidateAll();
      }
    } catch {
      // Opportunistic only. A later open/resume or manual logging can retry.
    } finally {
      inFlight = false;
      controller = undefined;
    }
  }

  onMount(() => {
    const timer = window.setTimeout(() => void synchronizeIfDue(), 500);
    const resume = (): void => {
      if (document.visibilityState === "visible") void synchronizeIfDue();
    };
    const pageHide = (): void => controller?.abort();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", pageHide);
    };
  });
</script>
