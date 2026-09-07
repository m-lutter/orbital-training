<script lang="ts">
  import type {
    HeartRateTargetBand,
    HeartRateZoneProfile,
    WorkoutCaptureController,
    WorkoutCaptureStartResponse,
    WorkoutHeartRateContract,
  } from "$lib/fitness/contracts";
  import {
    captureCacheFromContract,
    capturePhase,
    mergeWorkoutHeartRateContracts,
    parseWorkoutCaptureStart,
    parseWorkoutHeartRateContract,
    readWorkoutCaptureCache,
    WORKOUT_CAPTURE_POLL_MS,
    WORKOUT_PROVIDER_POLL_SECONDS,
    workoutCaptureStorageKey,
    workoutHeartRateImportMessage,
    writeWorkoutCaptureCache,
    type WorkoutCaptureCache,
  } from "$lib/fitness/workout-capture";
  import { onMount } from "svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";
  import HeartRateChart from "./HeartRateChart.svelte";

  let {
    programId,
    sessionId,
    disabled = false,
    zoneProfile = null,
    targetBand = null,
    oncapturechange,
    oncontrollerchange,
  }: {
    programId: string;
    sessionId: string;
    disabled?: boolean;
    zoneProfile?: HeartRateZoneProfile | null;
    targetBand?: HeartRateTargetBand | null;
    oncapturechange?: (capture: WorkoutCaptureCache | undefined) => void;
    oncontrollerchange?: (
      controller: WorkoutCaptureController | undefined,
    ) => void;
  } = $props();

  let workoutSessionId = $state<string>();
  let status = $state("idle");
  let startedAt = $state<string | null>(null);
  let endedAt = $state<string | null>(null);
  let telemetry = $state<WorkoutHeartRateContract>();
  let mobileDeepLink = $state<string>();
  let actionKind = $state<"start" | "end" | "reset">();
  let refreshBusy = $state(false);
  let errorMessage = $state<string>();
  let resetConfirmation = $state(false);
  let phase = $derived(capturePhase(status));
  let actionBusy = $derived(actionKind !== undefined);
  let busy = $derived(actionBusy || refreshBusy);
  let storageKey = $derived(workoutCaptureStorageKey(programId, sessionId));
  type RefreshOutcome = "found" | "missing" | "unconfigured" | "error";

  let refreshRequest: Promise<RefreshOutcome> | undefined;
  let refreshAbortController: AbortController | undefined;
  let activeAction: Promise<void> | undefined;
  let endRequest: Promise<boolean> | undefined;
  const captureRequestTimeoutMs = 12_000;

  function endpoint(action?: "start" | "end" | "reset"): string {
    const base = `/api/fitness/workouts/${encodeURIComponent(sessionId)}`;
    if (action !== undefined) return `${base}/${action}`;
    const query = new SvelteURLSearchParams({ programId });
    if (workoutSessionId !== undefined)
      query.set("workoutSessionId", workoutSessionId);
    const latestSample = telemetry?.samples.at(-1)?.recordedAt;
    if (telemetry?.checkedAt !== undefined && startedAt !== null) {
      const overlapCursor =
        latestSample === undefined
          ? startedAt
          : new Date(
              Math.max(
                Date.parse(startedAt),
                Date.parse(latestSample) - 60_000,
              ),
            ).toISOString();
      query.set("after", overlapCursor);
    }
    return `${base}?${query.toString()}`;
  }

  function applyCapture(
    value: WorkoutCaptureStartResponse | WorkoutHeartRateContract,
  ): void {
    const incoming: WorkoutHeartRateContract =
      "samples" in value
        ? value
        : {
            ...value,
            endedAt: null,
            samples: [],
            buckets: [],
          };
    const merged = mergeWorkoutHeartRateContracts(telemetry, incoming);
    workoutSessionId = merged.workoutSessionId;
    status = merged.status;
    startedAt = merged.startedAt;
    endedAt = merged.endedAt;
    telemetry = merged;
    mobileDeepLink = merged.mobileDeepLink ?? mobileDeepLink;
    const cache = captureCacheFromContract(merged);
    writeWorkoutCaptureCache(localStorage, storageKey, cache);
    oncapturechange?.(cache);
  }

  function applyCache(cache: WorkoutCaptureCache): void {
    workoutSessionId = cache.workoutSessionId;
    status = cache.status;
    startedAt = cache.startedAt;
    endedAt = cache.endedAt;
    oncapturechange?.(cache);
  }

  function clearCapture(): void {
    const hadCapture = workoutSessionId !== undefined;
    workoutSessionId = undefined;
    status = "idle";
    startedAt = null;
    endedAt = null;
    telemetry = undefined;
    mobileDeepLink = undefined;
    resetConfirmation = false;
    writeWorkoutCaptureCache(localStorage, storageKey, undefined);
    if (hadCapture) oncapturechange?.(undefined);
  }

  async function responseBody(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  async function captureRequest(
    input: Parameters<typeof window.fetch>[0],
    init?: Parameters<typeof window.fetch>[1],
    outerSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const abortFromOuter = () => controller.abort();
    outerSignal?.addEventListener("abort", abortFromOuter, { once: true });
    const timeout = window.setTimeout(
      () => controller.abort(),
      captureRequestTimeoutMs,
    );
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
      outerSignal?.removeEventListener("abort", abortFromOuter);
    }
  }

  function cancelRefresh(): void {
    refreshAbortController?.abort();
  }

  function errorFrom(value: unknown, fallback: string): string {
    if (typeof value !== "object" || value === null) return fallback;
    const message = (value as Record<string, unknown>).message;
    if (typeof message !== "string" || message.trim() === "") return fallback;
    const normalized = message.trim().toLowerCase();
    return normalized === "internal error" ||
      normalized === "internal server error"
      ? fallback
      : message;
  }

  function actionError(error: unknown, fallback: string): string {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      return `${fallback} The request timed out; its status was checked again automatically.`;
    }
    return error instanceof Error ? error.message : fallback;
  }

  function actionMayHaveReachedServer(error: unknown): boolean {
    return (
      error instanceof TypeError ||
      (error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError"))
    );
  }

  async function refresh({ quiet = false } = {}): Promise<RefreshOutcome> {
    if (refreshRequest !== undefined) return refreshRequest;
    const request = (async () => {
      const controller = new AbortController();
      refreshAbortController = controller;
      refreshBusy = true;
      if (!quiet) errorMessage = undefined;
      try {
        const response = await captureRequest(
          endpoint(),
          {
            headers: { accept: "application/json" },
            credentials: "same-origin",
          },
          controller.signal,
        );
        if (response.status === 404) {
          clearCapture();
          return "missing" as const;
        }
        if (response.status === 204) {
          clearCapture();
          return "unconfigured" as const;
        }
        const body = await responseBody(response);
        if (!response.ok)
          throw new Error(
            errorFrom(body, "Workout capture could not be checked."),
          );
        const parsed = parseWorkoutHeartRateContract(body);
        if (parsed === undefined)
          throw new Error("Workout capture returned an unreadable response.");
        errorMessage = undefined;
        applyCapture(parsed);
        return "found" as const;
      } catch (error) {
        if (!quiet)
          errorMessage =
            error instanceof Error
              ? error.message
              : "Workout capture could not be checked.";
        return "error" as const;
      } finally {
        if (refreshAbortController === controller)
          refreshAbortController = undefined;
        refreshBusy = false;
      }
    })();
    refreshRequest = request;
    try {
      return await request;
    } finally {
      if (refreshRequest === request) refreshRequest = undefined;
    }
  }

  async function startCapture(): Promise<void> {
    if (activeAction !== undefined || endRequest !== undefined || disabled)
      return;
    const request = (async () => {
      if (refreshRequest !== undefined) await refreshRequest;
      actionKind = "start";
      errorMessage = undefined;
      let ambiguousResponse = false;
      try {
        const response = await captureRequest(endpoint("start"), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            programId,
            ...(workoutSessionId === undefined ? {} : { workoutSessionId }),
          }),
        });
        const body = await responseBody(response);
        if (!response.ok) {
          ambiguousResponse = response.status >= 500;
          throw new Error(errorFrom(body, "Workout capture could not start."));
        }
        const parsed = parseWorkoutCaptureStart(body);
        if (parsed === undefined)
          throw new Error("Workout capture returned an unreadable response.");
        applyCapture(parsed);
      } catch (error) {
        const message = actionError(error, "Workout capture could not start.");
        if (ambiguousResponse || actionMayHaveReachedServer(error)) {
          const outcome = await refresh({ quiet: true });
          if (outcome === "found") return;
        }
        errorMessage = message;
      } finally {
        actionKind = undefined;
      }
    })();
    activeAction = request;
    try {
      await request;
    } finally {
      if (activeAction === request) activeAction = undefined;
    }
  }

  async function endCapture(): Promise<boolean> {
    if (endRequest !== undefined) return endRequest;
    const request = (async () => {
      // A very fast Finish click after Start still waits for Start to settle,
      // then ends the newly-created session instead of leaving it orphaned.
      if (activeAction !== undefined) await activeAction;
      if (refreshRequest !== undefined) {
        cancelRefresh();
        await refreshRequest;
      }
      if (
        disabled ||
        capturePhase(status) !== "active" ||
        workoutSessionId === undefined
      )
        return true;

      actionKind = "end";
      errorMessage = undefined;
      try {
        const response = await captureRequest(endpoint("end"), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({ programId, workoutSessionId }),
        });
        if (response.status === 404 || response.status === 204) {
          clearCapture();
          return true;
        }
        const body = await responseBody(response);
        if (!response.ok)
          throw new Error(errorFrom(body, "Workout capture could not end."));
        const parsed = parseWorkoutHeartRateContract(body);
        if (parsed === undefined)
          throw new Error("Workout capture returned an unreadable response.");
        applyCapture(parsed);
        return true;
      } catch (error) {
        const message = actionError(error, "Workout capture could not end.");
        const outcome = await refresh({ quiet: true });
        if (outcome === "found" && capturePhase(status) === "complete") {
          return true;
        }
        if (outcome === "missing" || outcome === "unconfigured") return true;
        errorMessage = message;
        return false;
      } finally {
        actionKind = undefined;
      }
    })();
    endRequest = request;
    try {
      return await request;
    } finally {
      if (endRequest === request) endRequest = undefined;
    }
  }

  async function resetCapture(): Promise<void> {
    if (
      activeAction !== undefined ||
      endRequest !== undefined ||
      disabled ||
      workoutSessionId === undefined
    )
      return;
    const request = (async () => {
      if (refreshRequest !== undefined) {
        cancelRefresh();
        await refreshRequest;
      }
      if (workoutSessionId === undefined) return;
      actionKind = "reset";
      errorMessage = undefined;
      try {
        const response = await captureRequest(endpoint("reset"), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({ programId, workoutSessionId }),
        });
        if (response.status === 404 || response.status === 204) {
          clearCapture();
          return;
        }
        const body = await responseBody(response);
        if (!response.ok)
          throw new Error(errorFrom(body, "Workout capture could not reset."));
        clearCapture();
      } catch (error) {
        const message = actionError(error, "Workout capture could not reset.");
        const outcome = await refresh({ quiet: true });
        if (outcome === "missing" || outcome === "unconfigured") return;
        errorMessage = message;
      } finally {
        actionKind = undefined;
      }
    })();
    activeAction = request;
    try {
      await request;
    } finally {
      if (activeAction === request) activeAction = undefined;
    }
  }

  onMount(() => {
    const controller: WorkoutCaptureController = { endCapture };
    oncontrollerchange?.(controller);
    const cached = readWorkoutCaptureCache(localStorage, storageKey);
    if (cached !== undefined) applyCache(cached);
    void refresh();

    const catchUp = (): void => {
      if (
        capturePhase(status) !== "active" ||
        actionBusy ||
        endRequest !== undefined ||
        document.visibilityState !== "visible" ||
        navigator.onLine === false
      )
        return;
      void refresh({ quiet: true });
    };
    const visibilityCatchUp = (): void => {
      if (document.visibilityState === "visible") catchUp();
    };
    const pollTimer = window.setInterval(catchUp, WORKOUT_CAPTURE_POLL_MS);
    window.addEventListener("online", catchUp);
    document.addEventListener("visibilitychange", visibilityCatchUp);

    return () => {
      cancelRefresh();
      window.clearInterval(pollTimer);
      window.removeEventListener("online", catchUp);
      document.removeEventListener("visibilitychange", visibilityCatchUp);
      oncontrollerchange?.(undefined);
    };
  });

  function timestamp(value: string | null): string {
    if (value === null) return "";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  }
</script>

<section
  class="capture-panel"
  aria-labelledby="capture-title"
  data-phase={phase}
>
  <div class="capture-heading">
    <div>
      <p class="eyebrow">Connected workout data</p>
      <h2 id="capture-title">Workout capture</h2>
      <p>
        Start and end capture explicitly so a connected source can match
        heart-rate samples to this workout. While this page is open, active
        capture checks for newly stored data every five seconds and catches up
        when you return.
      </p>
    </div>
    <span
      class:active={phase === "active"}
      class:complete={phase === "complete"}
    >
      {phase === "active"
        ? "Recording"
        : phase === "complete"
          ? "Capture ended"
          : "Not started"}
    </span>
  </div>

  <div class="capture-actions">
    {#if phase === "idle"}
      <button type="button" disabled={busy || disabled} onclick={startCapture}>
        {actionKind === "start"
          ? "Starting…"
          : refreshBusy
            ? "Checking…"
            : "Start workout capture"}
      </button>
    {:else if phase === "active"}
      <button
        class="end-capture"
        type="button"
        disabled={actionBusy || disabled}
        onclick={endCapture}
      >
        {actionKind === "end" ? "Ending…" : "End workout capture"}
      </button>
      {#if startedAt}<small>Started at {timestamp(startedAt)}</small>{/if}
      {#if mobileDeepLink}
        <a class="companion-link" href={mobileDeepLink}
          >Open Health Sync companion</a
        >
      {/if}
    {:else}
      <button
        class="secondary"
        type="button"
        disabled={busy}
        onclick={() => void refresh()}
      >
        {refreshBusy ? "Refreshing…" : "Refresh imported data"}
      </button>
      {#if endedAt}<small>Ended at {timestamp(endedAt)}</small>{/if}
    {/if}
    {#if phase !== "idle" && !resetConfirmation}
      <button
        class="reset-capture secondary"
        type="button"
        disabled={actionBusy || disabled}
        onclick={() => (resetConfirmation = true)}>Reset capture</button
      >
    {/if}
  </div>

  {#if resetConfirmation}
    <div class="reset-confirmation" role="group" aria-label="Reset capture">
      <p>
        Resetting discards this capture and its imported heart-rate data. You
        can then start a new capture for this workout.
      </p>
      <div>
        <button
          class="confirm-reset"
          type="button"
          disabled={actionBusy || disabled}
          onclick={resetCapture}
          >{actionKind === "reset" ? "Resetting…" : "Reset and discard"}</button
        >
        <button
          class="secondary"
          type="button"
          disabled={actionBusy}
          onclick={() => (resetConfirmation = false)}>Cancel</button
        >
      </div>
    </div>
  {/if}

  {#if errorMessage}
    <p class="capture-error" role="alert">{errorMessage}</p>
  {/if}
  {#if telemetry && (phase === "active" || phase === "complete")}
    <HeartRateChart
      {telemetry}
      live={phase === "active"}
      {zoneProfile}
      {targetBand}
    />
    {#if phase === "active"}
      <p class="live-cadence" role="status">
        This page checks stored samples every
        {WORKOUT_CAPTURE_POLL_MS / 1000} seconds while visible. Connected cloud data
        is requested no more than about {WORKOUT_PROVIDER_POLL_SECONDS}
        seconds apart and can arrive later if the wearable has not synced yet.
      </p>
    {/if}
    {#if telemetry.importStatus && telemetry.importStatus !== "synced"}
      <p class="import-message" role="status">
        {workoutHeartRateImportMessage(telemetry.importStatus)}
      </p>
    {/if}
  {/if}
</section>

<style>
  .capture-panel,
  .capture-panel * {
    box-sizing: border-box;
  }
  .capture-panel {
    background:
      radial-gradient(circle at 95% 0%, rgb(78 219 255 / 12%), transparent 34%),
      rgb(8 21 38 / 88%);
    border: 1px solid #3d6b90;
    border-radius: 0.75rem;
    color: var(--color-text);
    margin: 1rem 0;
    padding: 1rem;
  }
  .capture-heading,
  .capture-actions {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }
  .capture-heading h2,
  .capture-heading p {
    margin: 0.15rem 0;
  }
  .capture-heading > div > p:last-child {
    color: var(--color-text-muted);
    line-height: 1.45;
    max-width: 40rem;
  }
  .capture-heading > span {
    background: rgb(255 255 255 / 7%);
    border: 1px solid #59728c;
    border-radius: 999px;
    flex: 0 0 auto;
    font-size: 0.78rem;
    font-weight: 800;
    padding: 0.35rem 0.6rem;
  }
  .capture-heading > span.active {
    background: rgb(59 227 162 / 12%);
    border-color: #3be3a2;
    color: #baffdf;
  }
  .capture-heading > span.complete {
    background: rgb(78 219 255 / 12%);
    border-color: #4edbff;
    color: #c9f5ff;
  }
  .capture-actions {
    justify-content: flex-start;
    margin-top: 0.85rem;
  }
  .capture-actions button {
    min-height: var(--touch-target);
  }
  .companion-link {
    align-items: center;
    border: 1px solid #4edbff;
    border-radius: 0.5rem;
    color: #c9f5ff;
    display: inline-flex;
    font-weight: 800;
    min-height: var(--touch-target);
    padding: 0.5rem 0.75rem;
    text-decoration: none;
  }
  .capture-actions .end-capture {
    background: linear-gradient(180deg, #8e3347, #642235);
    border-color: #ef8fa0;
    color: #fff;
  }
  .capture-actions small {
    color: var(--color-text-muted);
  }
  .reset-capture {
    margin-left: auto;
  }
  .reset-confirmation {
    background: rgb(166 44 61 / 12%);
    border: 1px solid #a95366;
    border-radius: 0.6rem;
    margin-top: 0.85rem;
    padding: 0.75rem;
  }
  .reset-confirmation p {
    margin: 0 0 0.65rem;
  }
  .reset-confirmation > div {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }
  .reset-confirmation .confirm-reset {
    background: linear-gradient(180deg, #8e3347, #642235);
    border-color: #ef8fa0;
    color: #fff;
  }
  .capture-error {
    background: rgb(166 44 61 / 17%);
    border-left: 3px solid #ef8fa0;
    color: #ffd6dd;
    padding: 0.65rem;
  }
  .import-message {
    color: var(--color-text-muted);
    margin: 0.75rem 0 0;
  }
  .live-cadence {
    color: var(--color-text-muted);
    font-size: 0.76rem;
    line-height: 1.45;
    margin: 0.65rem 0 0;
  }
  :global(html[data-theme="cute"]) .capture-panel {
    background: #fff9fc;
    border: 2px solid #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .capture-heading > span {
    background: #fff;
    border-color: #a20e52;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .capture-heading > span.active,
  :global(html[data-theme="cute"]) .capture-heading > span.complete {
    background: #ffe2ed;
    border-color: #a20e52;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .reset-confirmation {
    background: #fff0f3;
    border: 2px solid #b4233c;
    color: #5a1a36;
  }
  @media (max-width: 34rem) {
    .capture-heading {
      align-items: start;
      display: grid;
    }
    .capture-heading > span {
      grid-row: 1;
      justify-self: start;
    }
    .capture-actions {
      align-items: stretch;
      display: grid;
    }
  }
</style>
