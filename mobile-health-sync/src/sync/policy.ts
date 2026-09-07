import type {
  HealthCursor,
  HealthReadWindow,
  SyncTrigger,
} from "../health/types";

const DAY_MS = 86_400_000;
const OVERLAP_MS = 36 * 60 * 60_000;
const ACTIVE_WORKOUT_OVERLAP_MS = 2 * 60_000;

function localDay(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
}

function completeLocalDayStart(input: {
  desiredStartMs: number;
  absoluteEarliestMs: number;
}): number {
  const aligned = new Date(input.desiredStartMs);
  aligned.setHours(0, 0, 0, 0);
  if (aligned.getTime() >= input.absoluteEarliestMs) return aligned.getTime();

  // Do not exceed the absolute history limit just to include a partial oldest
  // day. Start at the next local midnight instead.
  const earliest = new Date(input.absoluteEarliestMs);
  earliest.setHours(0, 0, 0, 0);
  if (earliest.getTime() < input.absoluteEarliestMs)
    earliest.setDate(earliest.getDate() + 1);
  return earliest.getTime();
}

export function shouldRunSync(input: {
  trigger: SyncTrigger;
  now: Date;
  lastSuccessAt?: string | null;
  catchUpNeededAt?: string | null;
}): boolean {
  if (
    input.trigger === "manual" ||
    input.trigger === "workout_started" ||
    input.trigger === "workout_stopped"
  )
    return true;

  if (input.lastSuccessAt === undefined || input.lastSuccessAt === null)
    return true;

  const last = new Date(input.lastSuccessAt);
  if (!Number.isFinite(last.getTime())) return true;

  if (input.catchUpNeededAt) return true;
  return localDay(last) !== localDay(input.now);
}

export function buildReadWindow(input: {
  now: Date;
  cursor?: HealthCursor;
  allowHistoryOlderThan30Days: boolean;
}): HealthReadWindow {
  const nowMs = input.now.getTime();
  const defaultLookback = input.allowHistoryOlderThan30Days
    ? 90 * DAY_MS
    : 7 * DAY_MS;
  const absoluteLimit = input.allowHistoryOlderThan30Days
    ? 365 * DAY_MS
    : 30 * DAY_MS;
  const lastEnd = input.cursor?.lastWindowEndAt
    ? new Date(input.cursor.lastWindowEndAt).getTime()
    : Number.NaN;
  const desiredStart = Number.isFinite(lastEnd)
    ? lastEnd - OVERLAP_MS
    : nowMs - defaultLookback;
  const absoluteEarliestMs = nowMs - absoluteLimit;
  const boundedDesiredStart = Math.max(
    Math.min(desiredStart, nowMs),
    absoluteEarliestMs,
  );
  const start = completeLocalDayStart({
    desiredStartMs: boundedDesiredStart,
    absoluteEarliestMs,
  });

  return {
    startAt: new Date(start).toISOString(),
    endAt: input.now.toISOString(),
  };
}

/**
 * Uses the last successful boundary to catch samples emitted a little late,
 * while never requesting data from before this workout began.
 */
export function buildActiveWorkoutReadWindow(input: {
  now: Date;
  startedAt: string;
  cursor?: HealthCursor;
}): HealthReadWindow {
  const nowMs = input.now.getTime();
  const startedAt = new Date(input.startedAt).getTime();
  if (!Number.isFinite(startedAt) || startedAt > nowMs)
    throw new Error("The active workout start time is invalid.");
  const lastWindowEnd = input.cursor?.lastWindowEndAt
    ? new Date(input.cursor.lastWindowEndAt).getTime()
    : Number.NaN;
  const incrementalStart = Number.isFinite(lastWindowEnd)
    ? Math.min(nowMs, lastWindowEnd - ACTIVE_WORKOUT_OVERLAP_MS)
    : startedAt;
  return {
    startAt: new Date(Math.max(startedAt, incrementalStart)).toISOString(),
    endAt: input.now.toISOString(),
  };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0)
    throw new Error("Chunk size must be a positive integer.");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}
