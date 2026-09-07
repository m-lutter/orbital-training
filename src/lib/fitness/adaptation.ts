import type { WearableAdaptationContext } from "$lib/domain";
import { addIsoDateDays } from "$lib/program-dates";

export interface WearableMetricRow {
  connectionId: string;
  heartRateVariabilityMs: number | null;
  metricDate: string;
  provider: string;
  restingHeartRateBpm: number | null;
  sleepMinutes: number | null;
}

function average(values: number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}

function providerLabel(value: string): string {
  const labels: Record<string, string> = {
    apple_health: "Apple Health",
    google_health: "Google Health / Fitbit",
    health_connect: "Health Connect",
    whoop: "WHOOP",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export function summarizeWearableAdaptation(input: {
  rows: WearableMetricRow[];
  weekEnd: string;
  weekStart: string;
}): WearableAdaptationContext | undefined {
  const baselineStart = addIsoDateDays(input.weekStart, -14);
  const baselineEnd = addIsoDateDays(input.weekStart, -1);
  const byConnection = new Map<string, WearableMetricRow[]>();
  for (const row of input.rows) {
    if (row.metricDate < baselineStart || row.metricDate > input.weekEnd)
      continue;
    const rows = byConnection.get(row.connectionId) ?? [];
    rows.push(row);
    byConnection.set(row.connectionId, rows);
  }

  const candidates = [...byConnection.values()]
    .map((rows) => {
      const current = rows.filter(
        (row) =>
          row.metricDate >= input.weekStart && row.metricDate <= input.weekEnd,
      );
      const baseline = rows.filter(
        (row) =>
          row.metricDate >= baselineStart && row.metricDate <= baselineEnd,
      );
      const measured = (row: WearableMetricRow) =>
        row.sleepMinutes !== null ||
        row.restingHeartRateBpm !== null ||
        row.heartRateVariabilityMs !== null;
      return {
        provider: rows[0]?.provider ?? "connected wearable",
        current: current.filter(measured),
        baseline: baseline.filter(measured),
      };
    })
    .filter((candidate) => candidate.current.length > 0)
    .sort(
      (left, right) =>
        right.current.length +
        right.baseline.length -
        (left.current.length + left.baseline.length),
    );
  const selected = candidates[0];
  if (selected === undefined) return undefined;

  const values = (
    rows: WearableMetricRow[],
    key: "sleepMinutes" | "restingHeartRateBpm" | "heartRateVariabilityMs",
  ) => rows.flatMap((row) => (row[key] === null ? [] : [row[key]]));
  const currentSleepValues = values(selected.current, "sleepMinutes");
  const baselineSleepValues = values(selected.baseline, "sleepMinutes");
  const currentRestingValues = values(selected.current, "restingHeartRateBpm");
  const baselineRestingValues = values(
    selected.baseline,
    "restingHeartRateBpm",
  );
  const currentHrvValues = values(selected.current, "heartRateVariabilityMs");
  const baselineHrvValues = values(selected.baseline, "heartRateVariabilityMs");
  const currentSleep = average(currentSleepValues);
  const baselineSleep = average(baselineSleepValues);
  const currentResting = average(currentRestingValues);
  const baselineResting = average(baselineRestingValues);
  const currentHrv = average(currentHrvValues);
  const baselineHrv = average(baselineHrvValues);
  const reasons: string[] = [];

  if (
    currentSleep !== undefined &&
    baselineSleep !== undefined &&
    currentSleepValues.length >= 3 &&
    baselineSleepValues.length >= 5 &&
    baselineSleep - currentSleep >= 45 &&
    currentSleep <= baselineSleep * 0.85
  ) {
    reasons.push(
      `Average sleep was ${Math.round(baselineSleep - currentSleep)} minutes below the recent baseline.`,
    );
  }
  if (
    currentResting !== undefined &&
    baselineResting !== undefined &&
    currentRestingValues.length >= 3 &&
    baselineRestingValues.length >= 5 &&
    currentResting - baselineResting >= 5 &&
    currentResting >= baselineResting * 1.08
  ) {
    reasons.push(
      `Average resting heart rate was ${Math.round(currentResting - baselineResting)} bpm above the recent baseline.`,
    );
  }
  if (
    currentHrv !== undefined &&
    baselineHrv !== undefined &&
    currentHrvValues.length >= 3 &&
    baselineHrvValues.length >= 5 &&
    baselineHrv - currentHrv >= 10 &&
    currentHrv <= baselineHrv * 0.8
  ) {
    reasons.push(
      `Average heart-rate variability was ${Math.round(baselineHrv - currentHrv)} ms below the recent baseline.`,
    );
  }

  return {
    source: providerLabel(selected.provider),
    currentDays: selected.current.length,
    baselineDays: selected.baseline.length,
    caution: reasons.length > 0,
    reasons,
    ...(currentSleep === undefined
      ? {}
      : { averageSleepMinutes: rounded(currentSleep) }),
    ...(baselineSleep === undefined
      ? {}
      : { baselineSleepMinutes: rounded(baselineSleep) }),
    ...(currentResting === undefined
      ? {}
      : { averageRestingHeartRateBpm: rounded(currentResting) }),
    ...(baselineResting === undefined
      ? {}
      : { baselineRestingHeartRateBpm: rounded(baselineResting) }),
    ...(currentHrv === undefined
      ? {}
      : { averageHeartRateVariabilityMs: rounded(currentHrv) }),
    ...(baselineHrv === undefined
      ? {}
      : { baselineHeartRateVariabilityMs: rounded(baselineHrv) }),
  };
}
