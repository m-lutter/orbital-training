import { estimateSessionMinutes } from "./duration.js";
import { getExercise } from "./exercises.js";
import { POLICY } from "./policy.js";
import type {
  Muscle,
  Phase,
  ProgramWeek,
  QuestionnaireInput,
  TrainingSession,
} from "./types.js";

const MUSCLES: Muscle[] = [
  "chest",
  "upper_chest",
  "lats",
  "upper_back",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "biceps",
  "triceps",
  "front_delts",
  "side_delts",
  "rear_delts",
  "trunk",
];

/** Refresh delivered dose without reinterpreting the original version's targets. */
export function refreshWeekDoseLedger(week: ProgramWeek): void {
  week.hardSetBudget = week.sessions
    .flatMap((session) => session.exercises)
    .filter((item) => item.targetRir.min <= 4)
    .reduce((sum, item) => sum + item.sets, 0);
  if (!week.doseLedger) return;
  week.doseLedger = week.doseLedger.map((target) => {
    const delivered = muscleSets(week.sessions, target.muscle);
    return {
      ...target,
      ...delivered,
      status:
        delivered.effectiveSets < target.targetMin
          ? "below_target"
          : delivered.effectiveSets > target.targetMax
            ? "above_target"
            : "within_target",
    };
  });
}

export function muscleSets(
  sessions: TrainingSession[],
  muscle: Muscle,
): { directSets: number; indirectSets: number; effectiveSets: number } {
  let directSets = 0;
  let indirectSets = 0;
  for (const session of sessions)
    for (const item of session.exercises) {
      // Technique-only/easy work is not claimed as hypertrophy-equivalent hard dose.
      if (item.targetRir.min > 4) continue;
      const definition = getExercise(item.exerciseId);
      if (definition?.primaryMuscles.includes(muscle)) directSets += item.sets;
      else if (definition?.secondaryMuscles.includes(muscle))
        indirectSets += item.sets * 0.5;
    }
  return { directSets, indirectSets, effectiveSets: directSets + indirectSets };
}

export function buildDoseLedger(
  sessions: TrainingSession[],
  input: QuestionnaireInput,
  phase: Phase,
): NonNullable<ProgramWeek["doseLedger"]> {
  const hypertrophy =
    input.goals.primary === "hypertrophy" ||
    input.goals.secondary === "hypertrophy";
  return MUSCLES.map((muscle) => {
    const delivered = muscleSets(sessions, muscle);
    const priority =
      input.hypertrophy?.balance === "prioritized"
        ? input.hypertrophy.musclePriorities.find(
            (item) => item.muscle === muscle,
          )?.rank
        : undefined;
    const recent = input.history.recentHardSetsPerMuscle?.[muscle];
    const active = hypertrophy || delivered.effectiveSets > 0;
    const base =
      hypertrophy &&
      ["chest", "lats", "upper_back", "quads", "hamstrings", "glutes"].includes(
        muscle,
      )
        ? input.history.resistanceTrainingYears >= 1
          ? 10
          : 6
        : POLICY.training.maintenanceSetsPerMuscle;
    const bonus =
      priority === 1
        ? POLICY.training.highestPrioritySetBonus
        : priority === 2
          ? POLICY.training.secondPrioritySetBonus
          : 0;
    const phaseFactor = ["taper", "review"].includes(phase)
      ? 0.5
      : phase === "reentry"
        ? 0.7
        : 1;
    // A reported low baseline constrains the initial target, not unrelated muscles.
    const baselineBound =
      recent === undefined
        ? base + bonus
        : Math.min(base + bonus, Math.max(2, recent + 2));
    const targetMin = active
      ? Math.max(1, Math.round(baselineBound * phaseFactor))
      : 0;
    const targetMax = active ? targetMin + 6 : 0;
    return {
      muscle,
      ...delivered,
      targetMin,
      targetMax,
      status:
        delivered.effectiveSets < targetMin
          ? ("below_target" as const)
          : delivered.effectiveSets > targetMax
            ? ("above_target" as const)
            : ("within_target" as const),
    };
  });
}

/** Bounded initial allocation. Never invent exercises, exceed a session soft cap,
 * or force a dose floor through time/equipment/phase constraints. */
export function enforceDoseBounds(
  sessions: TrainingSession[],
  input: QuestionnaireInput,
  phase: Phase,
): void {
  const cap = POLICY.training.perSessionMuscleSetSoftCap;
  for (const session of sessions) {
    for (const item of [...session.exercises].sort(
      (a, b) =>
        Number(b.optional) - Number(a.optional) || b.priority - a.priority,
    )) {
      const muscles = getExercise(item.exerciseId)?.primaryMuscles ?? [];
      const floor = item.optional || item.contextRole === "general" ? 1 : 2;
      while (
        item.sets > floor &&
        muscles.some(
          (muscle) => muscleSets([session], muscle).effectiveSets > cap,
        )
      )
        item.sets -= 1;
    }
  }
  if (
    input.goals.primary !== "hypertrophy" ||
    ["taper", "review", "reentry"].includes(phase)
  )
    return;
  const targets = buildDoseLedger(sessions, input, phase);
  // Remove avoidable excess before filling deficits. Required specificity and
  // minimum viable sets win when constraints cannot all be satisfied together.
  for (const target of targets) {
    if (target.status !== "above_target") continue;
    const candidates = sessions
      .flatMap((session) => session.exercises)
      .filter((item) => {
        const definition = getExercise(item.exerciseId);
        return (
          item.targetRir.min <= 4 &&
          (definition?.primaryMuscles.includes(target.muscle) ||
            definition?.secondaryMuscles.includes(target.muscle))
        );
      })
      .sort(
        (a, b) =>
          Number(b.optional) - Number(a.optional) || b.priority - a.priority,
      );
    for (const item of candidates) {
      const floor = item.optional || item.contextRole === "general" ? 1 : 2;
      while (
        item.sets > floor &&
        muscleSets(sessions, target.muscle).effectiveSets > target.targetMax
      )
        item.sets -= 1;
    }
  }
  const policy =
    input.schedule.advanced?.durationPolicy ?? input.adaptation.durationPolicy;
  for (const target of buildDoseLedger(sessions, input, phase).sort((a, b) => {
    const rank = (muscle: Muscle) =>
      input.hypertrophy?.musclePriorities.find((item) => item.muscle === muscle)
        ?.rank ?? 99;
    return rank(a.muscle) - rank(b.muscle);
  })) {
    const candidates = sessions.flatMap((session) =>
      session.exercises
        .filter(
          (item) =>
            item.targetRir.min <= 4 &&
            getExercise(item.exerciseId)?.primaryMuscles.includes(
              target.muscle,
            ),
        )
        .map((item) => ({ session, item, initialSets: item.sets })),
    );
    for (const { session, item, initialSets } of candidates) {
      while (
        muscleSets(sessions, target.muscle).effectiveSets < target.targetMin &&
        item.sets < Math.min(4, initialSets + 2)
      ) {
        item.sets += 1;
        const definition = getExercise(item.exerciseId);
        const overCap = [
          ...(definition?.primaryMuscles ?? []),
          ...(definition?.secondaryMuscles ?? []),
        ].some((muscle) => muscleSets([session], muscle).effectiveSets > cap);
        const overWeeklyCap = targets.some(
          (target) =>
            ((definition?.primaryMuscles ?? []).includes(target.muscle) ||
              (definition?.secondaryMuscles ?? []).includes(target.muscle)) &&
            muscleSets(sessions, target.muscle).effectiveSets >
              target.targetMax,
        );
        const overTime =
          policy === "trim_low_priority" &&
          estimateSessionMinutes(session.exercises) > session.targetMinutes;
        if (overCap || overWeeklyCap || overTime) {
          item.sets -= 1;
          break;
        }
      }
    }
  }
}
