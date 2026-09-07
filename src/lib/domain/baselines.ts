import type {
  BaselineEstimate,
  Lift,
  PerformanceObservation,
  QuestionnaireInput,
} from "./types.js";

export function estimateE1rm(
  observation: PerformanceObservation,
): number | undefined {
  if (!observation.completed || !observation.stableTechnique) return undefined;
  if (!Number.isFinite(observation.load) || observation.load <= 0)
    return undefined;
  if (
    !Number.isInteger(observation.reps) ||
    observation.reps < 1 ||
    observation.reps > 10
  )
    return undefined;
  const rir =
    observation.rir ??
    (observation.rpe === undefined ? undefined : 10 - observation.rpe);
  if (rir === undefined || !Number.isFinite(rir) || rir < 0 || rir > 4)
    return undefined;
  if (
    observation.rir !== undefined &&
    observation.rpe !== undefined &&
    (!Number.isFinite(observation.rpe) ||
      Math.abs(observation.rir - (10 - observation.rpe)) > 1)
  )
    return undefined;
  const estimate = observation.load * (1 + (observation.reps + rir) / 30);
  return Number.isFinite(estimate) ? estimate : undefined;
}

function weightedMedian(values: { value: number; weight: number }[]): number {
  const sorted = [...values].sort((left, right) => left.value - right.value);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let running = 0;
  for (const item of sorted) {
    running += item.weight;
    if (running >= total / 2) return item.value;
  }
  return sorted.at(-1)?.value ?? 0;
}

export function baselineForLift(
  lift: Lift,
  observations: PerformanceObservation[] | undefined,
  asOfDate: string = new Date().toISOString().slice(0, 10),
): BaselineEstimate {
  const parseDate = (date: string): number | undefined => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
    const value = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(value) &&
      new Date(value).toISOString().slice(0, 10) === date
      ? value
      : undefined;
  };
  const asOf = parseDate(asOfDate);
  // Conservative engineering window, not a claim that fitness expires on day 91.
  const maximumAgeDays = 90;
  const valid = (observations ?? [])
    .filter((observation) => {
      const date = parseDate(observation.date);
      return (
        asOf !== undefined &&
        date !== undefined &&
        date <= asOf &&
        (asOf - date) / 86_400_000 <= maximumAgeDays
      );
    })
    .map((observation) => ({
      observation,
      estimate: estimateE1rm(observation),
    }))
    .filter(
      (
        item,
      ): item is { observation: PerformanceObservation; estimate: number } =>
        item.estimate !== undefined,
    )
    .sort((left, right) =>
      right.observation.date.localeCompare(left.observation.date),
    )
    .slice(0, 3);

  if (valid.length === 0) {
    return {
      lift,
      confidence: "low",
      source: "calibration_required",
      observationCount: 0,
    };
  }

  const center = weightedMedian(
    valid.map((item) => ({ value: item.estimate, weight: 1 })),
  );
  const agreeing = valid.filter(
    (item) => Math.abs(item.estimate / center - 1) <= 0.1,
  );
  const disagreement = agreeing.length !== valid.length;
  // A lone recent outlier must not override agreement among other observations.
  const supported = agreeing.length >= 2 ? agreeing : valid;
  const weighted = supported.map((item, index) => ({
    value: item.estimate,
    weight: supported.length - index,
  }));
  const anyLowQuality = supported.some(
    (item) =>
      item.observation.reps > 8 ||
      (item.observation.rir ?? 10 - (item.observation.rpe ?? 10)) > 3,
  );
  const newestAge =
    ((asOf ?? 0) - (parseDate(supported[0]?.observation.date ?? "") ?? 0)) /
    86_400_000;
  const confidence =
    disagreement && agreeing.length < 2
      ? "low"
      : supported.length >= 2 &&
          new Set(supported.map((item) => item.observation.date)).size >= 2 &&
          !anyLowQuality &&
          !disagreement &&
          newestAge <= 30
        ? "high"
        : valid.length >= 1
          ? "moderate"
          : "low";
  return {
    lift,
    e1rm:
      Math.round(
        (disagreement && agreeing.length < 2
          ? Math.min(...supported.map((item) => item.estimate))
          : weightedMedian(weighted)) * 10,
      ) / 10,
    confidence,
    source: "observations",
    observationCount: supported.length,
  };
}

export function calculateBaselines(
  input: QuestionnaireInput,
): BaselineEstimate[] {
  const observations = input.powerlifting?.observations;
  return (["squat", "bench", "deadlift"] as Lift[]).map((lift) =>
    baselineForLift(lift, observations?.[lift], input.asOfDate),
  );
}
