<script lang="ts">
  import type {
    HeartRateZoneProfile,
    WorkoutHeartRateContract,
  } from "$lib/fitness/contracts";
  import {
    heartRatePoints,
    mergeWorkoutHeartRateContracts,
    parseWorkoutHeartRateContract,
    workoutHeartRateImportMessage,
  } from "$lib/fitness/workout-capture";
  import { onMount, untrack } from "svelte";
  import HeartRateChart from "./HeartRateChart.svelte";

  let {
    initialTelemetry,
    statusUrl,
    zoneProfile = null,
    retryDelaysMs = [0, 1_500, 3_500, 7_000, 10_000],
  }: {
    initialTelemetry: WorkoutHeartRateContract | null;
    statusUrl: string | null;
    zoneProfile?: HeartRateZoneProfile | null;
    retryDelaysMs?: number[];
  } = $props();

  let telemetry = $state(untrack(() => initialTelemetry));
  let checking = $state(false);
  let checkMessage = $state<string>();
  let checkRequest: Promise<void> | undefined;
  let disposed = false;

  function hasHeartRate(value: WorkoutHeartRateContract | null): boolean {
    return value !== null && heartRatePoints(value).length > 0;
  }

  async function wait(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return;
    await new Promise<void>((resolve) =>
      window.setTimeout(resolve, milliseconds),
    );
  }

  async function requestTelemetry(): Promise<WorkoutHeartRateContract | null> {
    if (statusUrl === null) return null;
    const response = await fetch(statusUrl, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error("Workout capture status request failed.");
    }
    const body: unknown = await response.json().catch(() => undefined);
    return parseWorkoutHeartRateContract(body) ?? null;
  }

  async function checkForHeartRate(): Promise<void> {
    if (checkRequest !== undefined) return checkRequest;
    const request = (async () => {
      checking = true;
      checkMessage =
        "Checking your connected source for the final heart-rate samples…";
      try {
        for (const delay of retryDelaysMs) {
          await wait(delay);
          if (disposed) return;
          const imported = await requestTelemetry();
          if (imported !== null)
            telemetry = mergeWorkoutHeartRateContracts(
              telemetry ?? undefined,
              imported,
            );
          if (hasHeartRate(telemetry)) {
            checkMessage = "Heart-rate samples imported.";
            return;
          }
          if (
            telemetry?.importStatus === "reconnect_required" ||
            telemetry?.importStatus === "temporarily_unavailable"
          ) {
            checkMessage = workoutHeartRateImportMessage(
              telemetry.importStatus,
            );
            return;
          }
        }
        checkMessage =
          workoutHeartRateImportMessage(telemetry?.importStatus) ??
          "No samples are available yet. Sync your connected health app or device, then check again.";
      } catch {
        checkMessage =
          "Heart-rate data could not be checked. Your workout is still saved.";
      } finally {
        checking = false;
      }
    })();
    checkRequest = request;
    try {
      await request;
    } finally {
      if (checkRequest === request) checkRequest = undefined;
    }
  }

  onMount(() => {
    if (statusUrl !== null && !hasHeartRate(telemetry)) {
      void checkForHeartRate();
    }
    return () => {
      disposed = true;
    };
  });
</script>

{#if telemetry}
  <HeartRateChart {telemetry} {zoneProfile} />
{:else}
  <p>
    Your workout was saved. No wearable heart-rate samples are available for
    this session yet.
  </p>
{/if}

{#if statusUrl !== null}
  <div class="import-status">
    {#if checkMessage}
      <p role="status">{checkMessage}</p>
    {/if}
    <button
      class="secondary"
      type="button"
      disabled={checking}
      onclick={checkForHeartRate}
      >{checking ? "Checking for heart-rate data…" : "Check again"}</button
    >
  </div>
{/if}

<style>
  .import-status {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    justify-content: space-between;
    margin-top: 0.75rem;
  }
  .import-status p {
    color: var(--color-text-muted);
    flex: 1 1 22rem;
    margin: 0;
  }
  .import-status button {
    min-height: var(--touch-target);
  }
  :global(html[data-theme="cute"]) .import-status p {
    color: #694052;
  }
</style>
