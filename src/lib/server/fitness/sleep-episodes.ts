export interface SleepIntervalInput {
  endAt: string;
  stage: string;
  startAt: string;
}

export interface SleepEpisode {
  endAt: string;
  sleepMinutes: number;
  stages: Record<string, number>;
  startAt: string;
}

const MAX_EPISODE_GAP_MS = 4 * 60 * 60 * 1000;

function normalizedStage(
  stage: string,
): "awake" | "deep" | "light" | "rem" | "unknown" {
  const value = stage.toLowerCase();
  if (value.includes("deep")) return "deep";
  if (value.includes("rem")) return "rem";
  if (value.includes("core") || value.includes("unspecified")) return "light";
  if (value.includes("awake")) return "awake";
  return "unknown";
}

const STAGE_PRIORITY = {
  unknown: 0,
  awake: 1,
  light: 2,
  rem: 3,
  deep: 4,
} as const;

/**
 * Reconciles overlapping provider/source stages into non-overlapping sleep
 * episodes. The complete episode can then be attributed to its wake date,
 * rather than splitting a normal overnight sleep at midnight.
 */
export function reconcileSleepEpisodes(
  input: readonly SleepIntervalInput[],
): SleepEpisode[] {
  const intervals = input
    .map((value) => ({
      ...value,
      startMs: Date.parse(value.startAt),
      endMs: Date.parse(value.endAt),
      normalizedStage: normalizedStage(value.stage),
    }))
    .filter(
      (value) =>
        Number.isFinite(value.startMs) &&
        Number.isFinite(value.endMs) &&
        value.endMs > value.startMs,
    )
    .sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    );

  const groups: (typeof intervals)[] = [];
  for (const interval of intervals) {
    const current = groups.at(-1);
    const currentEnd = current?.reduce(
      (maximum, value) => Math.max(maximum, value.endMs),
      Number.NEGATIVE_INFINITY,
    );
    if (
      current === undefined ||
      currentEnd === undefined ||
      interval.startMs > currentEnd + MAX_EPISODE_GAP_MS
    ) {
      groups.push([interval]);
    } else {
      current.push(interval);
    }
  }

  return groups.map((group) => {
    const boundaries = [
      ...new Set(group.flatMap((value) => [value.startMs, value.endMs])),
    ].sort((left, right) => left - right);
    const stages: Record<string, number> = {};
    let sleepMinutes = 0;
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (start === undefined || end === undefined || end <= start) continue;
      const covering = group.filter(
        (value) => value.startMs < end && value.endMs > start,
      );
      if (covering.length === 0) continue;
      const stage = covering.reduce(
        (best, value) =>
          STAGE_PRIORITY[value.normalizedStage] > STAGE_PRIORITY[best]
            ? value.normalizedStage
            : best,
        "unknown" as keyof typeof STAGE_PRIORITY,
      );
      const minutes = (end - start) / 60_000;
      stages[stage] = (stages[stage] ?? 0) + minutes;
      if (stage === "deep" || stage === "rem" || stage === "light")
        sleepMinutes += minutes;
    }
    return {
      startAt: new Date(
        Math.min(...group.map((value) => value.startMs)),
      ).toISOString(),
      endAt: new Date(
        Math.max(...group.map((value) => value.endMs)),
      ).toISOString(),
      sleepMinutes,
      stages,
    };
  });
}
