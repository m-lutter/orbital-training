import type {
  WorkoutCaptureStartResponse,
  WorkoutHeartRateBucket,
  WorkoutHeartRateContract,
  WorkoutHeartRateSample,
  HeartRateZoneProfile,
} from "./contracts";

export type CapturePhase = "idle" | "active" | "complete";

export const WORKOUT_CAPTURE_POLL_MS = 5_000;
export const WORKOUT_PROVIDER_POLL_SECONDS = 20;

export interface WorkoutCaptureCache {
  schemaVersion: 1;
  workoutSessionId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalDate(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function sample(value: unknown): WorkoutHeartRateSample | undefined {
  const item = record(value);
  const bpm = finiteNumber(item?.bpm);
  const recordedAt = optionalDate(item?.recordedAt);
  return bpm === undefined || bpm < 20 || bpm > 300 || recordedAt === null
    ? undefined
    : { recordedAt, bpm };
}

function bucket(value: unknown): WorkoutHeartRateBucket | undefined {
  const item = record(value);
  const bucketStart = optionalDate(item?.bucketStart);
  const avgBpm = finiteNumber(item?.avgBpm);
  const minBpm = finiteNumber(item?.minBpm);
  const maxBpm = finiteNumber(item?.maxBpm);
  const sampleCount = finiteNumber(item?.sampleCount);
  if (
    bucketStart === null ||
    avgBpm === undefined ||
    minBpm === undefined ||
    maxBpm === undefined ||
    sampleCount === undefined ||
    sampleCount < 1 ||
    minBpm < 20 ||
    maxBpm > 300 ||
    minBpm > avgBpm ||
    avgBpm > maxBpm
  )
    return undefined;
  return {
    bucketStart,
    avgBpm,
    minBpm,
    maxBpm,
    sampleCount: Math.round(sampleCount),
  };
}

export function capturePhase(status: string | null | undefined): CapturePhase {
  const normalized = status?.trim().toLowerCase();
  if (
    ["active", "recording", "started", "in_progress"].includes(normalized ?? "")
  )
    return "active";
  if (["complete", "completed", "ended", "stopped"].includes(normalized ?? ""))
    return "complete";
  return "idle";
}

export function workoutCaptureStorageKey(
  programId: string,
  sessionId: string,
): string {
  return `orbital-workout-capture-v1:${programId}:${sessionId}`;
}

export function readWorkoutCaptureCache(
  storage: StorageLike,
  key: string,
): WorkoutCaptureCache | undefined {
  try {
    const value = record(JSON.parse(storage.getItem(key) ?? "null"));
    if (
      value?.schemaVersion !== 1 ||
      typeof value.workoutSessionId !== "string" ||
      value.workoutSessionId === "" ||
      typeof value.status !== "string"
    )
      return undefined;
    return {
      schemaVersion: 1,
      workoutSessionId: value.workoutSessionId,
      status: value.status,
      startedAt: optionalDate(value.startedAt),
      endedAt: optionalDate(value.endedAt),
    };
  } catch {
    return undefined;
  }
}

export function writeWorkoutCaptureCache(
  storage: StorageLike,
  key: string,
  value: WorkoutCaptureCache | undefined,
): void {
  try {
    if (value === undefined) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing. Server reconciliation
    // still makes capture usable for the current page.
  }
}

export function parseWorkoutCaptureStart(
  value: unknown,
): WorkoutCaptureStartResponse | undefined {
  const item = record(value);
  if (
    typeof item?.workoutSessionId !== "string" ||
    item.workoutSessionId === "" ||
    typeof item.status !== "string"
  )
    return undefined;
  const mobileDeepLink =
    typeof item.mobileDeepLink === "string" &&
    item.mobileDeepLink.length <= 2048 &&
    item.mobileDeepLink.startsWith("orbitalhealth://workout")
      ? item.mobileDeepLink
      : undefined;
  const provider = ["apple_health", "google_health", "health_connect"].includes(
    String(item.provider),
  )
    ? (item.provider as WorkoutCaptureStartResponse["provider"])
    : undefined;
  return {
    workoutSessionId: item.workoutSessionId,
    status: item.status,
    startedAt: optionalDate(item.startedAt),
    ...(mobileDeepLink === undefined ? {} : { mobileDeepLink }),
    ...(provider === undefined ? {} : { provider }),
  };
}

export function parseWorkoutHeartRateContract(
  value: unknown,
): WorkoutHeartRateContract | undefined {
  const item = record(value);
  const start = parseWorkoutCaptureStart(item);
  if (start === undefined) return undefined;
  const importStatus = [
    "checking",
    "no_provider_samples",
    "reconnect_required",
    "synced",
    "temporarily_unavailable",
  ].includes(String(item?.importStatus))
    ? (item?.importStatus as WorkoutHeartRateContract["importStatus"])
    : undefined;
  const checkedAt = optionalDate(item?.checkedAt);
  return {
    ...start,
    ...(importStatus === undefined ? {} : { importStatus }),
    ...(checkedAt === null ? {} : { checkedAt }),
    ...(item?.isDelta === true ? { isDelta: true } : {}),
    ...(item?.hasMore === true ? { hasMore: true } : {}),
    endedAt: optionalDate(item?.endedAt),
    samples: Array.isArray(item?.samples)
      ? item.samples.map(sample).filter((entry) => entry !== undefined)
      : [],
    buckets: Array.isArray(item?.buckets)
      ? item.buckets.map(bucket).filter((entry) => entry !== undefined)
      : [],
  };
}

function deduplicateSamples(
  samples: WorkoutHeartRateSample[],
): WorkoutHeartRateSample[] {
  const byInstant = new Map<string, WorkoutHeartRateSample>();
  for (const entry of samples) byInstant.set(entry.recordedAt, entry);
  const sorted = [...byInstant.values()].sort(
    (left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt),
  );
  if (sorted.length <= 5000) return sorted;
  return Array.from({ length: 5000 }, (_, index) => {
    const sourceIndex = Math.round((index * (sorted.length - 1)) / 4999);
    return sorted[sourceIndex];
  });
}

function deduplicateBuckets(
  buckets: WorkoutHeartRateBucket[],
): WorkoutHeartRateBucket[] {
  const byInstant = new Map<string, WorkoutHeartRateBucket>();
  for (const entry of buckets) byInstant.set(entry.bucketStart, entry);
  return [...byInstant.values()].sort(
    (left, right) =>
      Date.parse(left.bucketStart) - Date.parse(right.bucketStart),
  );
}

/**
 * Merge a bounded telemetry delta without allowing a late active response to
 * regress an already-completed capture. Raw health data remains in memory and
 * is never copied into localStorage.
 */
export function mergeWorkoutHeartRateContracts(
  current: WorkoutHeartRateContract | undefined,
  incoming: WorkoutHeartRateContract,
): WorkoutHeartRateContract {
  if (
    current === undefined ||
    current.workoutSessionId !== incoming.workoutSessionId
  ) {
    return {
      ...incoming,
      samples: deduplicateSamples(incoming.samples),
      buckets: deduplicateBuckets(incoming.buckets),
    };
  }
  const currentPhase = capturePhase(current.status);
  const incomingPhase = capturePhase(incoming.status);
  const keepCompletedState =
    currentPhase === "complete" && incomingPhase !== "complete";
  const samples = deduplicateSamples([
    ...(incoming.isDelta || incoming.samples.length === 0
      ? current.samples
      : []),
    ...incoming.samples,
  ]);
  const buckets = deduplicateBuckets([
    ...(incoming.isDelta || incoming.buckets.length === 0
      ? current.buckets
      : []),
    ...incoming.buckets,
  ]);
  return {
    ...current,
    ...incoming,
    ...(keepCompletedState
      ? {
          status: current.status,
          endedAt: current.endedAt,
        }
      : {}),
    samples,
    buckets,
  };
}

export function captureCacheFromContract(
  value: WorkoutHeartRateContract | WorkoutCaptureStartResponse,
): WorkoutCaptureCache {
  return {
    schemaVersion: 1,
    workoutSessionId: value.workoutSessionId,
    status: value.status,
    startedAt: value.startedAt,
    endedAt: "endedAt" in value ? value.endedAt : null,
  };
}

export interface HeartRatePoint {
  recordedAt: string;
  bpm: number;
  minBpm: number;
  maxBpm: number;
  sampleCount: number;
}

export interface HeartRateZone {
  key: "z1" | "z2" | "z3" | "z4" | "z5";
  label: string;
  minimumBpm: number;
  maximumBpm: number;
  percentageLabel: string;
}

export function heartRateZones(
  profile: HeartRateZoneProfile | null | undefined,
): HeartRateZone[] {
  if (
    profile === null ||
    profile === undefined ||
    !Number.isFinite(profile.maximumHeartRateBpm) ||
    profile.maximumHeartRateBpm < 80 ||
    profile.maximumHeartRateBpm > 240
  )
    return [];
  const maximum = Math.round(profile.maximumHeartRateBpm);
  const resting =
    profile.method === "heart_rate_reserve" &&
    profile.restingHeartRateBpm !== undefined &&
    Number.isFinite(profile.restingHeartRateBpm) &&
    profile.restingHeartRateBpm >= 25 &&
    profile.restingHeartRateBpm < maximum
      ? Math.round(profile.restingHeartRateBpm)
      : 0;
  const reserve = maximum - resting;
  const boundaries = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((fraction) =>
    Math.round(resting + reserve * fraction),
  );
  const labels = [
    ["z1", "Zone 1", "50–59%"],
    ["z2", "Zone 2", "60–69%"],
    ["z3", "Zone 3", "70–79%"],
    ["z4", "Zone 4", "80–89%"],
    ["z5", "Zone 5", "90–100%"],
  ] as const;
  return labels.map(([key, label, percentageLabel], index) => ({
    key,
    label,
    percentageLabel,
    minimumBpm: boundaries[index],
    maximumBpm:
      index === labels.length - 1
        ? maximum
        : Math.max(boundaries[index], boundaries[index + 1] - 1),
  }));
}

export function heartRateZoneForBpm(
  zones: HeartRateZone[],
  bpm: number | undefined,
): HeartRateZone | undefined {
  if (bpm === undefined || !Number.isFinite(bpm)) return undefined;
  return zones.find((zone) => bpm >= zone.minimumBpm && bpm <= zone.maximumBpm);
}

export function heartRatePoints(
  value: Pick<WorkoutHeartRateContract, "samples" | "buckets">,
): HeartRatePoint[] {
  const points =
    value.samples.length > 0
      ? value.samples.map((entry) => ({
          recordedAt: entry.recordedAt,
          bpm: entry.bpm,
          minBpm: entry.bpm,
          maxBpm: entry.bpm,
          sampleCount: 1,
        }))
      : value.buckets.map((entry) => ({
          recordedAt: entry.bucketStart,
          bpm: entry.avgBpm,
          minBpm: entry.minBpm,
          maxBpm: entry.maxBpm,
          sampleCount: entry.sampleCount,
        }));
  return [...points].sort(
    (left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt),
  );
}

export function workoutHeartRateImportMessage(
  status: WorkoutHeartRateContract["importStatus"],
): string | undefined {
  switch (status) {
    case "checking":
      return "The connected source is still being checked for heart-rate samples.";
    case "no_provider_samples":
      return "The connected source responded successfully, but it has not made heart-rate samples available for this workout yet. Open or sync its health app, then check again.";
    case "reconnect_required":
      return "The connected health account needs to be reconnected before heart-rate data can be imported.";
    case "temporarily_unavailable":
      return "The connected health source could not be reached. Your workout is saved; try checking again shortly.";
    case "synced":
      return "Heart-rate samples imported.";
    default:
      return undefined;
  }
}

export interface HeartRateChartModel {
  polyline: string;
  polylines: string[];
  minimumBpm: number;
  maximumBpm: number;
  averageBpm: number;
  sampleCount: number;
  startedAt: string;
  endedAt: string;
  latestBpm: number;
  latestX: number;
  latestY: number;
  plotMinimumBpm: number;
  plotMaximumBpm: number;
}

export interface HeartRateChartOptions {
  endedAt?: string | null;
  maximumBpm?: number;
  minimumBpm?: number;
  startedAt?: string | null;
}

export function heartRateChartModel(
  points: HeartRatePoint[],
  width = 640,
  height = 220,
  padding = 28,
  options: HeartRateChartOptions = {},
): HeartRateChartModel | undefined {
  if (points.length === 0) return undefined;
  const firstPointAt = Date.parse(points[0].recordedAt);
  const lastPointAt = Date.parse(
    points.at(-1)?.recordedAt ?? points[0].recordedAt,
  );
  const requestedStart = Date.parse(options.startedAt ?? "");
  const requestedEnd = Date.parse(options.endedAt ?? "");
  const start = Number.isFinite(requestedStart)
    ? Math.min(requestedStart, firstPointAt)
    : firstPointAt;
  const end = Math.max(
    start,
    Number.isFinite(requestedEnd) ? requestedEnd : lastPointAt,
    lastPointAt,
  );
  const minimumBpm = Math.min(...points.map((point) => point.minBpm));
  const maximumBpm = Math.max(...points.map((point) => point.maxBpm));
  const sampleCount = points.reduce((sum, point) => sum + point.sampleCount, 0);
  const weightedTotal = points.reduce(
    (sum, point) => sum + point.bpm * point.sampleCount,
    0,
  );
  const averageBpm = Math.round(weightedTotal / Math.max(1, sampleCount));
  const requestedLow = finiteNumber(options.minimumBpm);
  const requestedHigh = finiteNumber(options.maximumBpm);
  const low = Math.max(
    20,
    Math.floor(
      (Math.min(minimumBpm - 10, requestedLow ?? minimumBpm - 10) / 10) * 10,
    ),
  );
  const high = Math.min(
    310,
    Math.max(
      low + 20,
      Math.ceil(
        Math.max(maximumBpm + 10, requestedHigh ?? maximumBpm + 10) / 10,
      ) * 10,
    ),
  );
  const horizontalRange = Math.max(1, end - start);
  const verticalRange = Math.max(1, high - low);
  const chartWidth = Math.max(1, width - padding * 2);
  const chartHeight = Math.max(1, height - padding * 2);
  const coordinates = points.map((point) => {
    const x =
      padding +
      ((Date.parse(point.recordedAt) - start) / horizontalRange) * chartWidth;
    const y = padding + ((high - point.bpm) / verticalRange) * chartHeight;
    return { at: Date.parse(point.recordedAt), x, y };
  });
  const positiveGaps = coordinates
    .slice(1)
    .map((point, index) => point.at - coordinates[index].at)
    .filter((gap) => gap > 0)
    .sort((left, right) => left - right);
  const medianGap =
    positiveGaps.length === 0
      ? 0
      : positiveGaps[Math.floor((positiveGaps.length - 1) / 2)];
  const gapThreshold = Math.max(120_000, medianGap * 4);
  const groups: (typeof coordinates)[] = [];
  for (const point of coordinates) {
    const group = groups.at(-1);
    if (
      group === undefined ||
      (group.at(-1) !== undefined && point.at - group.at(-1)!.at > gapThreshold)
    )
      groups.push([point]);
    else group.push(point);
  }
  const polylines = groups.map((group) =>
    group
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(" "),
  );
  const latest = coordinates.at(-1)!;
  const polyline = coordinates
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  return {
    polyline,
    polylines,
    minimumBpm: Math.round(minimumBpm),
    maximumBpm: Math.round(maximumBpm),
    averageBpm,
    sampleCount,
    startedAt: points[0].recordedAt,
    endedAt: points.at(-1)?.recordedAt ?? points[0].recordedAt,
    latestBpm: Math.round(points.at(-1)!.bpm),
    latestX: latest.x,
    latestY: latest.y,
    plotMinimumBpm: low,
    plotMaximumBpm: high,
  };
}
