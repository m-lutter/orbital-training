export type WeeklyHeartRateReviewStatus =
  "ready" | "awaiting_sync" | "not_connected" | "unavailable";

export interface WeeklyHeartRateBucket {
  bucketStart: string;
  averageBpm: number;
  minimumBpm?: number | null;
  maximumBpm?: number | null;
  sampleCount?: number | null;
}

export interface WeeklyHeartRateWorkout {
  id: string;
  label: string;
  startedAt: string;
  endedAt: string;
  provider?: string | null;
  averageBpm?: number | null;
  maximumBpm?: number | null;
  buckets: WeeklyHeartRateBucket[];
}

/**
 * Bounded, provider-neutral heart-rate data for one weekly review. The status
 * makes an empty provider response different from an account that is not
 * connected or a temporarily failed read.
 */
export interface WeeklyHeartRateReviewData {
  status: WeeklyHeartRateReviewStatus;
  lastSyncedAt?: string | null;
  workouts: WeeklyHeartRateWorkout[];
}

export interface WeeklyHeartRateDomain {
  minimumBpm: number;
  maximumBpm: number;
}

export type WeeklyHeartRateSeriesMarker = "dot" | "block" | "tick";

export interface WeeklyHeartRateSeriesStyle {
  /** Collision-resolved slot, stable for the same set of workout identities. */
  slot: number;
  colorIndex: 1 | 2 | 3 | 4 | 5 | 6;
  dashIndex: 1 | 2 | 3 | 4 | 5 | 6;
  marker: WeeklyHeartRateSeriesMarker;
}

export interface WeeklyHeartRateOverlaySegment {
  averagePoints: string;
  pointCount: number;
  endPoint: { x: number; y: number };
}

export interface WeeklyHeartRateSeriesModel {
  workout: WeeklyHeartRateWorkout;
  style: WeeklyHeartRateSeriesStyle;
  durationMinutes?: number;
  averageBpm?: number;
  maximumBpm?: number;
  minimumBpm?: number;
  bucketCount: number;
  sourceSampleCount: number;
  segments: WeeklyHeartRateOverlaySegment[];
}

export interface WeeklyHeartRateOverlayModel {
  domain: WeeklyHeartRateDomain;
  series: WeeklyHeartRateSeriesModel[];
  plottedWorkoutCount: number;
  totalBucketCount: number;
  sourceSampleCount: number;
}

interface NormalizedBucket {
  at: number;
  midpoint: number;
  averageBpm: number;
  minimumBpm: number;
  maximumBpm: number;
  sampleCount: number;
}

interface WorkoutWindow {
  start: number;
  end: number;
}

interface PreparedWorkout {
  workout: WeeklyHeartRateWorkout;
  window?: WorkoutWindow;
  allBuckets: NormalizedBucket[];
  plottedBuckets: NormalizedBucket[];
}

const MINIMUM_VALID_BPM = 20;
const MAXIMUM_VALID_BPM = 300;
const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const MAXIMUM_CONTIGUOUS_GAP_MS = 12 * 60 * 1_000;
const PLOT_INSET = 2;
const PLOT_SPAN = 100 - PLOT_INSET * 2;
const STYLE_SLOT_COUNT = 18;
const COLOR_INDEXES = [1, 2, 3, 4, 5, 6] as const;
const DASH_INDEXES = [1, 2, 3, 4, 5, 6] as const;
const MARKERS: WeeklyHeartRateSeriesMarker[] = ["dot", "block", "tick"];

function validBpm(value: number | null | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MINIMUM_VALID_BPM &&
    value <= MAXIMUM_VALID_BPM
  );
}

function workoutWindow(
  workout: WeeklyHeartRateWorkout,
): WorkoutWindow | undefined {
  const start = Date.parse(workout.startedAt);
  const end = Date.parse(workout.endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start, end }
    : undefined;
}

function normalizedBuckets(
  workout: WeeklyHeartRateWorkout,
): NormalizedBucket[] {
  return workout.buckets
    .flatMap((bucket) => {
      const at = Date.parse(bucket.bucketStart);
      if (!Number.isFinite(at) || !validBpm(bucket.averageBpm)) return [];
      const minimum = validBpm(bucket.minimumBpm)
        ? bucket.minimumBpm
        : bucket.averageBpm;
      const maximum = validBpm(bucket.maximumBpm)
        ? bucket.maximumBpm
        : bucket.averageBpm;
      return [
        {
          at,
          midpoint: at + FIVE_MINUTES_MS / 2,
          averageBpm: bucket.averageBpm,
          minimumBpm: Math.min(minimum, bucket.averageBpm),
          maximumBpm: Math.max(maximum, bucket.averageBpm),
          sampleCount:
            typeof bucket.sampleCount === "number" &&
            Number.isFinite(bucket.sampleCount) &&
            bucket.sampleCount > 0
              ? Math.floor(bucket.sampleCount)
              : 0,
        },
      ];
    })
    .sort((left, right) => left.at - right.at);
}

function prepareWorkout(workout: WeeklyHeartRateWorkout): PreparedWorkout {
  const window = workoutWindow(workout);
  const allBuckets = normalizedBuckets(workout);
  return {
    workout,
    window,
    allBuckets,
    plottedBuckets:
      window === undefined
        ? []
        : allBuckets.filter(
            (bucket) =>
              bucket.at < window.end &&
              bucket.at + FIVE_MINUTES_MS > window.start,
          ),
  };
}

function roundedDomain(
  minimum: number,
  maximum: number,
): WeeklyHeartRateDomain {
  let minimumBpm = Math.max(
    MINIMUM_VALID_BPM,
    Math.floor((minimum - 5) / 10) * 10,
  );
  let maximumBpm = Math.min(
    MAXIMUM_VALID_BPM,
    Math.ceil((maximum + 5) / 10) * 10,
  );
  if (maximumBpm - minimumBpm < 20) {
    minimumBpm = Math.max(MINIMUM_VALID_BPM, minimumBpm - 10);
    maximumBpm = Math.min(MAXIMUM_VALID_BPM, maximumBpm + 10);
  }
  if (maximumBpm <= minimumBpm) {
    maximumBpm = Math.min(MAXIMUM_VALID_BPM, minimumBpm + 20);
    minimumBpm = Math.max(MINIMUM_VALID_BPM, maximumBpm - 20);
  }
  return { minimumBpm, maximumBpm };
}

function heartRateDomain(prepared: PreparedWorkout[]): WeeklyHeartRateDomain {
  const plottedValues = prepared.flatMap((item) =>
    item.plottedBuckets.map((bucket) => bucket.averageBpm),
  );
  return plottedValues.length === 0
    ? { minimumBpm: 60, maximumBpm: 180 }
    : roundedDomain(Math.min(...plottedValues), Math.max(...plottedValues));
}

/** The shared y-domain includes plotted buckets, not summary-only values. */
export function weeklyHeartRateDomain(
  workouts: WeeklyHeartRateWorkout[],
): WeeklyHeartRateDomain {
  return heartRateDomain(workouts.map(prepareWorkout));
}

function chartX(midpoint: number, window: WorkoutWindow): number {
  const clamped = Math.min(window.end, Math.max(window.start, midpoint));
  return (
    PLOT_INSET +
    ((clamped - window.start) / (window.end - window.start)) * PLOT_SPAN
  );
}

function chartY(bpm: number, domain: WeeklyHeartRateDomain): number {
  const range = Math.max(1, domain.maximumBpm - domain.minimumBpm);
  const ratio = (domain.maximumBpm - bpm) / range;
  return PLOT_INSET + Math.min(1, Math.max(0, ratio)) * PLOT_SPAN;
}

function point(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

function weightedAverage(buckets: NormalizedBucket[]): number | undefined {
  if (buckets.length === 0) return undefined;
  const weighted = buckets.reduce(
    (total, bucket) =>
      total + bucket.averageBpm * Math.max(1, bucket.sampleCount),
    0,
  );
  const count = buckets.reduce(
    (total, bucket) => total + Math.max(1, bucket.sampleCount),
    0,
  );
  return Math.round(weighted / Math.max(1, count));
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619) >>> 0;
  }
  return hash;
}

function seriesStyles(
  workouts: WeeklyHeartRateWorkout[],
): Map<string, WeeklyHeartRateSeriesStyle> {
  const styles = new Map<string, WeeklyHeartRateSeriesStyle>();
  const usedSlots = new Set<number>();
  const identities = [...new Set(workouts.map((workout) => workout.id))].sort();
  for (const identity of identities) {
    const initialSlot = stableHash(identity) % STYLE_SLOT_COUNT;
    let slot = initialSlot;
    for (let offset = 0; offset < STYLE_SLOT_COUNT; offset += 1) {
      const candidate = (initialSlot + offset) % STYLE_SLOT_COUNT;
      if (!usedSlots.has(candidate)) {
        slot = candidate;
        break;
      }
    }
    usedSlots.add(slot);
    const group = Math.floor(slot / COLOR_INDEXES.length);
    styles.set(identity, {
      slot,
      colorIndex: COLOR_INDEXES[(slot + group * 2) % COLOR_INDEXES.length],
      dashIndex: DASH_INDEXES[slot % DASH_INDEXES.length],
      marker: MARKERS[group % MARKERS.length],
    });
  }
  return styles;
}

function overlaySegments(
  buckets: NormalizedBucket[],
  window: WorkoutWindow | undefined,
  domain: WeeklyHeartRateDomain,
): WeeklyHeartRateOverlaySegment[] {
  if (window === undefined || buckets.length === 0) return [];
  const bucketSegments: NormalizedBucket[][] = [];
  for (const bucket of buckets) {
    const current = bucketSegments.at(-1);
    const previous = current?.at(-1);
    if (
      current === undefined ||
      previous === undefined ||
      bucket.at - previous.at > MAXIMUM_CONTIGUOUS_GAP_MS
    ) {
      bucketSegments.push([bucket]);
    } else {
      current.push(bucket);
    }
  }

  return bucketSegments.map((segment) => {
    const positions = segment.map((bucket) => ({
      x: chartX(bucket.midpoint, window),
      y: chartY(bucket.averageBpm, domain),
    }));
    const endPoint = positions.at(-1) ?? { x: PLOT_INSET, y: PLOT_INSET };
    return {
      averagePoints: positions
        .map((position) => point(position.x, position.y))
        .join(" "),
      pointCount: positions.length,
      endPoint,
    };
  });
}

/**
 * Builds one normalized overlay. X positions use the five-minute bucket
 * midpoint against the authoritative logged workout duration; overlapping edge
 * buckets clamp to 0/100% and never expand that duration.
 */
export function weeklyHeartRateOverlayModel(
  workouts: WeeklyHeartRateWorkout[],
): WeeklyHeartRateOverlayModel {
  const prepared = workouts.map(prepareWorkout);
  const domain = heartRateDomain(prepared);
  const styles = seriesStyles(workouts);
  const series = prepared.map((item): WeeklyHeartRateSeriesModel => {
    const calculatedAverage = weightedAverage(item.allBuckets);
    const calculatedMaximum =
      item.allBuckets.length === 0
        ? undefined
        : Math.round(
            Math.max(...item.allBuckets.map((bucket) => bucket.maximumBpm)),
          );
    const calculatedMinimum =
      item.allBuckets.length === 0
        ? undefined
        : Math.round(
            Math.min(...item.allBuckets.map((bucket) => bucket.minimumBpm)),
          );
    return {
      workout: item.workout,
      style:
        styles.get(item.workout.id) ??
        ({
          slot: 0,
          colorIndex: 1,
          dashIndex: 1,
          marker: "dot",
        } satisfies WeeklyHeartRateSeriesStyle),
      ...(item.window === undefined
        ? {}
        : {
            durationMinutes: Math.round(
              (item.window.end - item.window.start) / 60_000,
            ),
          }),
      ...(validBpm(item.workout.averageBpm)
        ? { averageBpm: Math.round(item.workout.averageBpm) }
        : calculatedAverage === undefined
          ? {}
          : { averageBpm: calculatedAverage }),
      ...(validBpm(item.workout.maximumBpm)
        ? { maximumBpm: Math.round(item.workout.maximumBpm) }
        : calculatedMaximum === undefined
          ? {}
          : { maximumBpm: calculatedMaximum }),
      ...(calculatedMinimum === undefined
        ? {}
        : { minimumBpm: calculatedMinimum }),
      bucketCount: item.plottedBuckets.length,
      sourceSampleCount: item.plottedBuckets.reduce(
        (total, bucket) => total + bucket.sampleCount,
        0,
      ),
      segments: overlaySegments(item.plottedBuckets, item.window, domain),
    };
  });
  return {
    domain,
    series,
    plottedWorkoutCount: series.filter((item) => item.segments.length > 0)
      .length,
    totalBucketCount: series.reduce(
      (total, item) => total + item.bucketCount,
      0,
    ),
    sourceSampleCount: series.reduce(
      (total, item) => total + item.sourceSampleCount,
      0,
    ),
  };
}
