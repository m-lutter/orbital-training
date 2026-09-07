import { getExercise } from "./exercises.js";
import { POLICY } from "./policy.js";
import type {
  CardioPrescription,
  ExercisePrescription,
  SetBlock,
  TrainingSession,
} from "./types.js";

/** Shared, deterministic duration model for generation and future-only edits. */
export function estimateSessionMinutes(
  exercises: ExercisePrescription[],
  cardioMinutes = 0,
  setBlocks?: SetBlock[],
): number {
  if (exercises.length === 0) return Math.ceil(cardioMinutes);
  const work = exercises.reduce((sum, item) => {
    const definition = getExercise(item.exerciseId);
    const floor =
      definition?.exerciseClass === "competition"
        ? POLICY.duration.competitionSetMinutes
        : definition?.exerciseClass === "compound"
          ? POLICY.duration.compoundSetMinutes
          : definition?.exerciseClass === "stable_compound"
            ? POLICY.duration.stableCompoundSetMinutes
            : definition?.exerciseClass === "trunk"
              ? POLICY.duration.trunkSetMinutes
              : POLICY.duration.isolationSetMinutes;
    // Reps/rest remain concrete user instructions; duration uses their actual values.
    const execution =
      (item.reps.min * 3 * (definition?.unilateral ? 2 : 1)) / 60;
    const perSet = Math.max(floor, execution + item.restSeconds / 60);
    return sum + item.sets * perSet;
  }, 0);
  const savings = (setBlocks ?? []).reduce(
    (sum, block) => sum + block.estimatedTimeSavedMinutes,
    0,
  );
  const raw =
    POLICY.duration.warmupMinutes +
    work +
    Math.max(0, exercises.length - 1) * POLICY.duration.transitionMinutes -
    savings;
  // Cardio already includes its warm-up/recovery and is not buffered a second time.
  return Math.ceil(
    raw +
      Math.max(
        POLICY.duration.minimumBufferMinutes,
        raw * POLICY.duration.bufferFraction,
      ) +
      cardioMinutes,
  );
}

export function cardioSegmentMinutes(
  cardio: CardioPrescription,
): number | undefined {
  if (
    !cardio.segments?.length ||
    cardio.segments.some((segment) => segment.minutes === undefined)
  )
    return undefined;
  return cardio.segments.reduce(
    (sum, segment) => sum + (segment.minutes ?? 0) * (segment.repeats ?? 1),
    0,
  );
}

/** Timed segments are authoritative. Intervals carry per-repeat work/recovery. */
export function synchronizeCardioDuration(cardio: CardioPrescription): void {
  if (cardio.intervals && cardio.segments) {
    for (const segment of cardio.segments) {
      if (segment.kind === "work") {
        segment.minutes = cardio.intervals.workSeconds / 60;
        segment.repeats = cardio.intervals.repeats;
        segment.label = `${cardio.intervals.repeats} work intervals`;
      } else if (segment.kind === "recovery") {
        segment.minutes = cardio.intervals.recoverySeconds / 60;
        segment.repeats = Math.max(0, cardio.intervals.repeats - 1);
      }
    }
  }
  const total = cardioSegmentMinutes(cardio);
  if (total !== undefined) cardio.minutes = Math.round(total * 1000) / 1000;
}

export function recalculateSessionDuration(session: TrainingSession): void {
  if (session.cardio) synchronizeCardioDuration(session.cardio);
  session.predictedMinutes = estimateSessionMinutes(
    session.exercises,
    session.cardio?.minutes ?? 0,
    session.setBlocks,
  );
  if (session.kind === "movement") session.predictedMinutes = 0;
  // A hard infeasibility must never disappear merely because metadata was refreshed.
  if (session.durationStatus !== "infeasible") {
    session.durationStatus =
      session.predictedMinutes <= session.targetMinutes
        ? "fits"
        : "guideline_exceeded";
  }
}
