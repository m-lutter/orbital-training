import { calculateBaselines } from "./baselines.js";
import { availableCardioModalities } from "./cardio-substitutions.js";
import {
  estimateSessionMinutes,
  synchronizeCardioDuration,
} from "./duration.js";
import {
  addScheduleDays,
  effectiveScheduleStart,
  hardCardioDayIsCompatible,
  weekdayOffset,
} from "./schedule.js";
import { buildDoseLedger, enforceDoseBounds } from "./dose.js";
import { validateGeneratedProgram } from "./generation-invariants.js";
import {
  buildLiftingTemplates,
  eligibleHypertrophySplits,
  resolveHorizonWeeks,
  resolvePhaseMap,
  selectHypertrophySplit,
  type LiftingTemplate,
  type ProgramSlot,
} from "./design.js";
import {
  choiceCandidates,
  getExercise,
  isExerciseEligible,
  rankExercises,
} from "./exercises.js";
import {
  defaultDumbbellIncrement,
  totalBarbellIncrementFromInput,
} from "./load-policy.js";
import { ENGINE_VERSION, POLICY, POLICY_VERSION } from "./policy.js";
import { resolveQuestionEffects } from "./question-effects.js";
import { buildSetBlocks } from "./set-blocks.js";
import type {
  BaselineEstimate,
  CardioModality,
  CardioPrescription,
  DayOfWeek,
  EngineWarning,
  ExerciseDefinition,
  ExercisePrescription,
  GenerationResult,
  Phase,
  ProgramWeek,
  QuestionnaireInput,
  SetBlock,
  TrainingProgram,
  TrainingSession,
} from "./types.js";
import {
  DAYS,
  clamp,
  fingerprint,
  roundToIncrement,
  stableStringify,
  unique,
} from "./utils.js";
import { validateQuestionnaire } from "./validation.js";

interface GenerationContext {
  input: QuestionnaireInput;
  baselines: BaselineEstimate[];
  warnings: EngineWarning[];
  unresolvedChoices: string[];
  triggeredRuleIds: string[];
  exerciseCache: Map<
    string,
    { exercise?: ExerciseDefinition; ranked: ExerciseDefinition[] }
  >;
  recoveryFactor: number;
}

const phaseLoading: Record<
  Phase,
  { heavy: number; volume: number; setFactor: number }
> = {
  reentry: { heavy: 0.7, volume: 0.6, setFactor: 0.7 },
  base: { heavy: 0.8, volume: 0.68, setFactor: 1 },
  hypertrophy: { heavy: 0.75, volume: 0.67, setFactor: 1 },
  work_capacity: { heavy: 0.75, volume: 0.65, setFactor: 1 },
  strength: { heavy: 0.84, volume: 0.72, setFactor: 1 },
  specificity: { heavy: 0.87, volume: 0.75, setFactor: 0.9 },
  peak: { heavy: 0.9, volume: 0.77, setFactor: 0.75 },
  taper: { heavy: 0.82, volume: 0.7, setFactor: 0.5 },
  aerobic_base: { heavy: 0.72, volume: 0.62, setFactor: 0.8 },
  cardio_build: { heavy: 0.72, volume: 0.62, setFactor: 0.75 },
  review: { heavy: 0.72, volume: 0.62, setFactor: 0.7 },
};

function addWarning(context: GenerationContext, warning: EngineWarning): void {
  if (
    !context.warnings.some(
      (item) => item.code === warning.code && item.message === warning.message,
    )
  ) {
    context.warnings.push(warning);
  }
  context.triggeredRuleIds.push(...warning.ruleIds);
}

function recoverySetFactor(input: QuestionnaireInput): number {
  let factor = 1;
  if (input.history.recentConsistency === "none") factor -= 0.25;
  else if (input.history.recentConsistency === "sporadic") factor -= 0.15;
  if (
    input.recovery.typicalSleepHours === "<6" ||
    input.recovery.nightsBelowSixPerWeek >= 4
  )
    factor -= 0.1;
  if (input.recovery.workActivity === "heavy") factor -= 0.1;
  if (input.recovery.rotatingOrNightShifts) factor -= 0.05;
  if ((input.recovery.sportHoursPerWeek ?? 0) >= 5) factor -= 0.1;
  if (input.history.resistanceTrainingYears < 1) factor -= 0.1;
  if (
    input.history.recentSessionsPerWeek !== undefined &&
    input.schedule.liftingDaysPerWeek > input.history.recentSessionsPerWeek + 1
  )
    factor -= 0.1;
  const recentSetValues = Object.values(
    input.history.recentHardSetsPerMuscle ?? {},
  ).filter((value): value is number => value !== undefined);
  if (
    recentSetValues.length > 0 &&
    recentSetValues.reduce((sum, value) => sum + value, 0) /
      recentSetValues.length <
      4
  )
    factor -= 0.05;
  return clamp(factor, 0.6, 1);
}

function performanceSeriesId(
  definition: ExerciseDefinition,
  input: QuestionnaireInput,
): string {
  if (definition.id === "competition_squat")
    return `${definition.id}:${input.powerlifting?.squatStyle ?? "unspecified"}:${input.powerlifting?.competitionStyle ?? "raw_sleeves"}`;
  if (definition.id === "competition_bench")
    return `${definition.id}:${input.powerlifting?.benchStyle ?? "standard"}:${input.powerlifting?.competitionStyle ?? "raw_sleeves"}`;
  if (definition.id === "competition_deadlift")
    return `${definition.id}:${input.powerlifting?.deadliftStyle ?? "conventional"}:${input.powerlifting?.competitionStyle ?? "raw_sleeves"}`;
  return definition.id;
}

function displayExerciseName(
  definition: ExerciseDefinition,
  input: QuestionnaireInput,
): string {
  if (definition.id === "competition_squat")
    return `Competition ${input.powerlifting?.squatStyle.replace("_", "-") ?? "standard"} squat`;
  if (definition.id === "competition_bench")
    return `Competition ${input.powerlifting?.benchStyle.replace("_", "-") ?? "standard"} bench press`;
  if (definition.id === "competition_deadlift")
    return `Competition ${input.powerlifting?.deadliftStyle ?? "conventional"} deadlift`;
  return definition.name;
}

function resolveExercise(
  slot: ProgramSlot,
  context: GenerationContext,
): { exercise?: ExerciseDefinition; ranked: ExerciseDefinition[] } {
  // Emit provenance independently of cached selection. The date-planning preview
  // shares the candidate cache but deliberately discards its warning collection.
  const exact =
    slot.exactExerciseId === undefined
      ? undefined
      : getExercise(slot.exactExerciseId);
  if (exact !== undefined && !isExerciseEligible(exact, context.input)) {
    addWarning(context, {
      code: `specificity-unavailable-${slot.lift ?? slot.key}`,
      severity: "warning",
      message: `${exact.name} is unavailable or excluded. Any listed replacement maintains a training purpose but not competition specificity or load history.`,
      ruleIds: ["EX-1", "EX-2", "EX-3"],
    });
  }
  const cacheKey = stableStringify(slot);
  const cached = context.exerciseCache.get(cacheKey);
  if (cached) return cached;
  const resolved = resolveExerciseUncached(slot, context);
  context.exerciseCache.set(cacheKey, resolved);
  return resolved;
}

function resolveExerciseUncached(
  slot: ProgramSlot,
  context: GenerationContext,
): { exercise?: ExerciseDefinition; ranked: ExerciseDefinition[] } {
  const { input } = context;
  const exact =
    slot.exactExerciseId === undefined
      ? undefined
      : getExercise(slot.exactExerciseId);
  if (exact !== undefined && isExerciseEligible(exact, input))
    return { exercise: exact, ranked: [exact] };

  const ranked = rankExercises(input, {
    purpose:
      slot.exactExerciseId === undefined
        ? slot.purpose
        : slot.loading.includes("competition")
          ? "strength"
          : slot.purpose,
    patterns: slot.patterns,
    ...(slot.muscles.length === 0 ? {} : { muscles: slot.muscles }),
    ...(slot.maximumFatigue === undefined
      ? {}
      : { maximumFatigue: slot.maximumFatigue }),
    ...(slot.exactExerciseId === undefined || slot.lift === undefined
      ? {}
      : { requireLift: slot.lift }),
    requireCompetitionSpecificity: slot.exactExerciseId !== undefined,
  });
  return ranked[0] === undefined ? { ranked } : { exercise: ranked[0], ranked };
}

function baselineFor(
  slot: ProgramSlot,
  baselines: BaselineEstimate[],
): BaselineEstimate | undefined {
  return slot.lift === undefined
    ? undefined
    : baselines.find((item) => item.lift === slot.lift);
}

function phaseLoadProgression(phase: Phase, phaseOccurrence: number): number {
  if (["reentry", "taper", "review"].includes(phase)) return 0;
  const step = ["strength", "specificity", "peak"].includes(phase)
    ? 0.01
    : 0.005;
  return Math.min(0.03, Math.max(0, phaseOccurrence - 1) * step);
}

function singleRepTarget(range: { min: number; max: number }): number {
  if (range.min === range.max) return range.min;
  const midpoint = (range.min + range.max) / 2;
  const commonTargets = [1, 2, 3, 5, 6, 8, 10, 12, 15, 20, 25, 30].filter(
    (target) => target >= range.min && target <= range.max,
  );
  return (
    commonTargets.sort(
      (left, right) =>
        Math.abs(left - midpoint) - Math.abs(right - midpoint) || right - left,
    )[0] ?? Math.round(midpoint)
  );
}

function specificRirTarget(
  range: { min: number; max: number },
  phase: Phase,
): { min: number; max: number } {
  const target =
    phase === "reentry"
      ? range.max
      : Math.round(((range.min + range.max) / 2) * 2) / 2;
  return { min: target, max: target };
}

function calibrationInstruction(reps: number, targetRir: number): string {
  return `Calibration procedure: use the lowest practical load for ${reps} reps at ${targetRir} RIR. If at least ${targetRir + 1} reps remain, add one available increment for the next set; if at least 1 rep harder than target, remove one increment. Rest for the prescribed rest period. Make at most two calibration attempts, counting them toward today's prescribed sets, then keep the lighter successful load. Do not add extra work sets or test your maximum.`;
}

function prescriptionForSlot(
  slot: ProgramSlot,
  phase: Phase,
  phaseOccurrence: number,
  weekNumber: number,
  sessionSequence: number,
  slotIndex: number,
  context: GenerationContext,
): ExercisePrescription | undefined {
  const result = resolveExercise(slot, context);
  const definition = result.exercise;
  if (definition === undefined) {
    addWarning(context, {
      code: `no-exercise-${slot.key}`,
      severity: slot.optional ? "warning" : "blocking",
      message: `No eligible exercise can fill the required “${slot.title}” slot with the current equipment and exclusions.`,
      ruleIds: ["SAFE-1", "EX-1"],
    });
    if (!slot.optional)
      context.unresolvedChoices.push(
        `Resolve equipment or exclusions for ${slot.title}.`,
      );
    return undefined;
  }

  const recoveryFactor = context.recoveryFactor;
  const phaseFactor = phaseLoading[phase].setFactor;
  const rawSets = slot.sets * recoveryFactor * phaseFactor;
  const minimumSets = slot.optional || slot.loading === "general" ? 1 : 2;
  const sets = Math.max(minimumSets, Math.round(rawSets));
  const initialRepTarget = singleRepTarget(slot.reps);
  let reps = { min: initialRepTarget, max: initialRepTarget };
  let targetRir = { ...slot.targetRir };
  let percentE1rm: number | undefined;
  let load: number | undefined;
  const baseline = baselineFor(slot, context.baselines);

  if (slot.loading === "heavy_competition") {
    percentE1rm = Math.min(
      0.92,
      phaseLoading[phase].heavy + phaseLoadProgression(phase, phaseOccurrence),
    );
    const targetReps = phase === "peak" || phase === "taper" ? 1 : 3;
    reps = { min: targetReps, max: targetReps };
    targetRir =
      phase === "peak"
        ? { min: 1, max: 2 }
        : phase === "taper"
          ? { min: 2, max: 3 }
          : { min: 1, max: 3 };
  } else if (slot.loading === "competition_volume") {
    percentE1rm = Math.min(
      0.82,
      phaseLoading[phase].volume + phaseLoadProgression(phase, phaseOccurrence),
    );
    const targetReps = phase === "peak" || phase === "taper" ? 3 : 5;
    reps = { min: targetReps, max: targetReps };
    targetRir = { min: 2, max: 4 };
  }
  targetRir = specificRirTarget(targetRir, phase);
  if (
    percentE1rm !== undefined &&
    baseline?.e1rm !== undefined &&
    definition.lift === slot.lift
  ) {
    const trainingMaxPercent = clamp(
      (context.input.powerlifting?.advanced?.trainingMaxPercent ?? 100) / 100,
      0.8,
      1,
    );
    const increment = totalBarbellIncrementFromInput(context.input);
    load = roundToIncrement(
      baseline.e1rm * trainingMaxPercent * percentE1rm,
      increment,
    );
  } else if (slot.loading.includes("competition")) {
    context.triggeredRuleIds.push("BASE-2");
  }

  const restSeconds =
    definition.exerciseClass === "competition"
      ? 240
      : definition.exerciseClass === "compound"
        ? 180
        : definition.exerciseClass === "stable_compound"
          ? 150
          : 90;
  const alternatives = choiceCandidates(
    result.ranked.filter((item) => item.id !== definition.id),
  );
  const selectionMode = context.input.hypertrophy?.exerciseSelection;
  const exposedAlternatives =
    context.input.goals.primary === "hypertrophy" &&
    selectionMode === "engine_decide"
      ? []
      : alternatives;
  const effortTarget = targetRir.min;
  const skipRule = slot.optional
    ? "Complete this only after all required work. Skip it if a required set is unfinished, you must end the session now, or the movement would require training through pain. Do not make it up later."
    : undefined;
  const loadText =
    load === undefined
      ? slot.loading.includes("competition")
        ? `Calibrate the load today with the prescribed ${effortTarget} RIR target; do not test your maximum.`
        : `Calibrate the load today for ${reps.min} reps at ${effortTarget} RIR.`
      : `Use ${load} ${context.input.units} for work set 1. If that set is at least 1 RIR harder than the ${effortTarget} RIR target, remove one available increment for the remaining sets. If it is easier, keep the same load today and let the next recommendation make the increase.`;
  const progression = slot.loading.includes("competition")
    ? baseline?.e1rm === undefined
      ? {
          method: "calibration" as const,
          instruction: calibrationInstruction(reps.min, effortTarget),
        }
      : {
          method: "percentage_wave" as const,
          instruction: `Complete ${reps.min} reps per set at ${effortTarget} RIR. After work set 1, remove one available increment if the set is at least 1 RIR harder than target; otherwise keep the load for every set today.`,
        }
    : {
        method: "double_progression" as const,
        repFloor: slot.reps.min,
        repCeiling: slot.reps.max,
        requiredSuccessfulExposures: POLICY.training.comparableObservations,
        instruction:
          load === undefined
            ? calibrationInstruction(reps.min, effortTarget)
            : `Complete ${reps.min} clean reps per set at ${effortTarget} RIR. After work set 1, remove one available increment if the set is at least 1 RIR harder than target; otherwise keep the load for every set today.`,
      };
  const amrapPolicy = context.input.adaptation.amrapPolicy;
  const baseAmrapEligible =
    slot.priority === 1 &&
    sessionSequence === 1 &&
    slotIndex === 0 &&
    !["reentry", "taper"].includes(phase);
  let amrapStopRir: number | undefined;
  if (
    amrapPolicy === "controlled" &&
    baseAmrapEligible &&
    definition.exerciseClass !== "competition"
  ) {
    amrapStopRir = 1;
  } else if (amrapPolicy === "max_effort" && baseAmrapEligible) {
    const horizon = resolveHorizonWeeks(context.input);
    const phaseMap = resolvePhaseMap(context.input, horizon.weeks);
    const finalPeakWeek = phaseMap.lastIndexOf("peak") + 1;
    const plannedTestWeek =
      context.input.powerlifting?.goal === "peak_or_test" && finalPeakWeek > 0
        ? finalPeakWeek
        : horizon.rolling
          ? undefined
          : horizon.weeks;
    const exerciseIsAppropriate =
      definition.exerciseClass !== "competition" ||
      context.input.powerlifting?.goal === "peak_or_test";
    if (weekNumber === plannedTestWeek && exerciseIsAppropriate)
      amrapStopRir = 0;
  }
  const amrapText =
    amrapStopRir === undefined
      ? ""
      : amrapStopRir === 0
        ? " The final set is a planned maximum-effort set. Continue only while your technique remains safe and consistent."
        : ` On the final set, stop at ${amrapStopRir} RIR.`;
  context.triggeredRuleIds.push(
    slot.loading.includes("competition")
      ? "INT-1"
      : definition.exerciseClass === "isolation"
        ? "INT-2"
        : "EX-1",
  );

  return {
    id: `w${weekNumber}-s${sessionSequence}-${slot.key}`,
    exerciseId: definition.id,
    performanceSeriesId: performanceSeriesId(definition, context.input),
    contextRole: slot.loading,
    phase,
    name: displayExerciseName(definition, context.input),
    purpose: slot.purpose,
    sets,
    reps,
    targetRir,
    ...(percentE1rm === undefined ? {} : { percentE1rm }),
    ...(load === undefined ? {} : { load }),
    restSeconds,
    priority: slot.priority,
    optional: slot.optional,
    ...(skipRule === undefined ? {} : { skipRule }),
    ...(amrapStopRir === undefined ? {} : { amrapStopRir }),
    progression,
    alternativeChoices: exposedAlternatives,
    explanation: `${loadText}${amrapText}`,
    ruleIds: unique([
      slot.loading.includes("competition") ? "INT-1" : "INT-2",
      "EX-1",
      ...(amrapStopRir === undefined ? [] : ["INT-3"]),
      "ACTION-1",
      ...(slot.exactExerciseId === undefined ? [] : ["EX-2"]),
    ]),
  };
}

// Keep the public export compatible while all mutation paths share one calculator.
export { estimateSessionMinutes } from "./duration.js";

function fitDuration(
  exercises: ExercisePrescription[],
  targetMinutes: number,
  durationPolicy: QuestionnaireInput["adaptation"]["durationPolicy"],
  sessionId: string,
  input: QuestionnaireInput,
): {
  exercises: ExercisePrescription[];
  setBlocks: SetBlock[];
  minutes: number;
  status: TrainingSession["durationStatus"];
  alternative?: TrainingSession["durationAlternative"];
} {
  const result = exercises.map((item) => ({ ...item }));
  let setBlocks = buildSetBlocks(result, sessionId, input);
  let minutes = estimateSessionMinutes(result, 0, setBlocks);
  if (minutes <= targetMinutes)
    return { exercises: result, setBlocks, minutes, status: "fits" };

  if (durationPolicy === "allow_exceed") {
    return {
      exercises: result,
      setBlocks,
      minutes,
      status: "guideline_exceeded",
    };
  }
  if (durationPolicy === "offer_shorter") {
    const shorter = fitDuration(
      exercises,
      targetMinutes,
      "trim_low_priority",
      sessionId,
      input,
    );
    return {
      exercises: result,
      setBlocks,
      minutes,
      status: "guideline_exceeded",
      alternative: {
        targetMinutes,
        predictedMinutes: shorter.minutes,
        exerciseIds: shorter.exercises.map((item) => item.id),
        prescriptions: shorter.exercises.map((item) => ({
          prescriptionId: item.id,
          sets: item.sets,
        })),
        explanation:
          shorter.status === "fits"
            ? `A ${shorter.minutes}-minute alternative is available by removing low-priority optional sets. The full prescription remains unchanged until you choose it.`
            : `Required work still takes ${shorter.minutes} minutes after optional work is removed. Increase the time guideline or reduce requested training scope.`,
      },
    };
  }

  const optional = result
    .filter((item) => item.optional)
    .sort(
      (left, right) => right.priority - left.priority || right.sets - left.sets,
    );
  for (const item of optional) {
    while (minutes > targetMinutes && item.sets > 1) {
      item.sets -= 1;
      setBlocks = buildSetBlocks(result, sessionId, input);
      minutes = estimateSessionMinutes(result, 0, setBlocks);
    }
  }
  {
    for (const item of optional) {
      if (minutes <= targetMinutes) break;
      const index = result.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) result.splice(index, 1);
      setBlocks = buildSetBlocks(result, sessionId, input);
      minutes = estimateSessionMinutes(result, 0, setBlocks);
    }
  }
  if (minutes <= targetMinutes)
    return { exercises: result, setBlocks, minutes, status: "fits" };
  return {
    exercises: result,
    setBlocks,
    minutes,
    status: "infeasible",
  };
}

const IDEAL_DAY_PATTERNS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

function combinations<T>(values: T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (values.length < count) return [];
  return values.flatMap((value, index) =>
    combinations(values.slice(index + 1), count - 1).map((rest) => [
      value,
      ...rest,
    ]),
  );
}

function longestCircularStreak(indices: number[]): number {
  if (indices.length === 0) return 0;
  if (indices.length === DAYS.length) return DAYS.length;
  const selected = new Set(indices);
  let longest = 0;
  for (const start of indices) {
    if (selected.has((start + DAYS.length - 1) % DAYS.length)) continue;
    let streak = 0;
    while (selected.has((start + streak) % DAYS.length)) streak += 1;
    longest = Math.max(longest, streak);
  }
  return longest;
}

function idealPatternDistance(indices: number[]): number {
  const ideal = IDEAL_DAY_PATTERNS[indices.length] ?? indices;
  return Math.min(
    ...DAYS.map((_, rotation) => {
      const rotated = new Set(
        ideal.map((index) => (index + rotation) % DAYS.length),
      );
      return indices.filter((index) => !rotated.has(index)).length;
    }),
  );
}

function liftDayScore(
  indices: number[],
  input: QuestionnaireInput,
  templates: LiftingTemplate[],
): number {
  const preferred = new Set(
    input.schedule.preferredTrainingDays.map((day) => DAYS.indexOf(day)),
  );
  const consecutiveLimit = input.goals.primary === "powerlifting" ? 2 : 3;
  const excessConsecutive = Math.max(
    0,
    longestCircularStreak(indices) - consecutiveLimit,
  );
  const nonPreferred = indices.filter((index) => !preferred.has(index)).length;
  const adjacentHighStress = templates.reduce((total, template, index) => {
    if (template.lowerBodyStress !== "high") return total;
    return (
      total +
      templates.slice(index + 1).filter((candidate, laterOffset) => {
        if (candidate.lowerBodyStress !== "high") return false;
        const laterIndex = index + laterOffset + 1;
        const distance = Math.abs(
          (indices[laterIndex] ?? 0) - (indices[index] ?? 0),
        );
        return distance === 1 || distance === DAYS.length - 1;
      }).length
    );
  }, 0);
  return (
    excessConsecutive * 10_000 +
    adjacentHighStress * 2_000 +
    nonPreferred * 1_000 +
    idealPatternDistance(indices) * 100 +
    indices.reduce((sum, index) => sum + index, 0) / 100
  );
}

function assignedLiftDays(
  input: QuestionnaireInput,
  templates: LiftingTemplate[],
): (DayOfWeek | undefined)[] {
  const count = templates.length;
  const availableIndices = DAYS.map((_, index) => index)
    .filter(
      (index) =>
        !input.schedule.unavailableDays.includes(DAYS[index] as DayOfWeek),
    )
    .filter((index) =>
      input.schedule.preferredTrainingDays.includes(DAYS[index] as DayOfWeek),
    );
  const selected = combinations(availableIndices, count).sort(
    (left, right) =>
      liftDayScore(left, input, templates) -
        liftDayScore(right, input, templates) ||
      left.join(",").localeCompare(right.join(",")),
  )[0];
  if (selected === undefined)
    return Array.from({ length: count }, () => undefined);
  return selected.map((index) => DAYS[index]);
}

function liftingSessionsForWeek(
  template: LiftingTemplate[],
  phase: Phase,
  phaseOccurrence: number,
  weekNumber: number,
  context: GenerationContext,
): TrainingSession[] {
  const days = assignedLiftDays(context.input, template);
  const sessions: TrainingSession[] = template.map((item, index) => {
    const sequence = index + 1;
    const sessionId = `w${weekNumber}-lift-${sequence}`;
    const prescriptions = item.slots
      .map((programSlot, slotIndex) =>
        prescriptionForSlot(
          programSlot,
          phase,
          phaseOccurrence,
          weekNumber,
          sequence,
          slotIndex,
          context,
        ),
      )
      .filter(
        (prescription): prescription is ExercisePrescription =>
          prescription !== undefined,
      );
    const durationPolicy =
      context.input.schedule.advanced?.durationPolicy ??
      context.input.adaptation.durationPolicy;
    const fitted = fitDuration(
      prescriptions,
      context.input.schedule.targetLiftMinutes,
      durationPolicy,
      sessionId,
      context.input,
    );
    return {
      id: sessionId,
      weekNumber,
      sequence,
      ...(days[index] === undefined ? {} : { day: days[index] }),
      kind: "lifting",
      title: item.title,
      objective: item.objective,
      exercises: fitted.exercises,
      setBlocks: fitted.setBlocks,
      predictedMinutes: fitted.minutes,
      targetMinutes: context.input.schedule.targetLiftMinutes,
      durationStatus: fitted.status,
      ...(fitted.alternative === undefined
        ? {}
        : { durationAlternative: fitted.alternative }),
      explanation: `Exercises are ordered by program priority. Estimated duration includes warm-up, work/rest, transitions, and buffer.`,
    };
  });
  enforceDoseBounds(sessions, context.input, phase);
  for (const session of sessions) {
    const durationPolicy =
      context.input.schedule.advanced?.durationPolicy ??
      context.input.adaptation.durationPolicy;
    const fitted = fitDuration(
      session.exercises,
      session.targetMinutes,
      durationPolicy,
      session.id,
      context.input,
    );
    session.exercises = fitted.exercises;
    session.setBlocks = fitted.setBlocks;
    session.predictedMinutes = fitted.minutes;
    session.durationStatus = fitted.status;
    if (fitted.alternative) session.durationAlternative = fitted.alternative;
    if (fitted.status !== "fits")
      addWarning(context, {
        code: `duration-template-${session.sequence}-${session.title}`,
        severity: fitted.status === "infeasible" ? "blocking" : "info",
        message: `${session.title} is estimated at ${fitted.minutes} minutes versus the ${session.targetMinutes}-minute guideline (${durationPolicy.replaceAll("_", " ")}).${fitted.status === "infeasible" ? " Required work cannot fit; increase available time or reduce training scope." : ""}`,
        ruleIds: ["TIME-1"],
      });
  }
  return sessions;
}

function cardioModalityForSession(
  input: QuestionnaireInput,
  weekNumber: number,
  index: number,
  total: number,
  intensity: CardioPrescription["intensity"],
): CardioModality {
  const modalities = availableCardioModalities(input);
  const primary = modalities[0] ?? "walking";
  if (modalities.length === 1 || intensity === "hard") return primary;

  const variety = input.cardio.varietyPreference ?? "regular_variety";
  if (variety === "mostly_primary") return primary;

  // With only two weekly sessions, alternating one session every other week
  // keeps the primary modality in a clear majority across a two-week cycle.
  if (total <= 2) {
    if (weekNumber % 2 === 0 && index === total - 1) {
      return (
        modalities[
          1 + ((Math.floor(weekNumber / 2) - 1) % (modalities.length - 1))
        ] ?? primary
      );
    }
    return primary;
  }

  const alternateCount =
    variety === "broad_mix"
      ? Math.max(1, total - (Math.floor(total / 2) + 1))
      : Math.max(1, Math.floor(total / 3));
  const firstAlternate = total - alternateCount;
  if (index < firstAlternate) return primary;
  const alternateIndex =
    (weekNumber + index - firstAlternate - 1) % (modalities.length - 1);
  return modalities[alternateIndex + 1] ?? primary;
}

function cardioFrequency(input: QuestionnaireInput): {
  total: number;
  hard: number;
} {
  const currentTotal =
    input.cardio.currentEasySessions +
    input.cardio.currentModerateSessions +
    input.cardio.currentHardSessions;
  if (input.cardio.goal?.type === "running_event") {
    const recentRuns = input.cardio.runningBaseline?.runsPerWeek ?? 0;
    const total = clamp(Math.max(currentTotal, recentRuns, 3), 3, 6);
    return {
      total,
      // New runners receive strides/run-walk changes, not a hard interval day.
      hard: recentRuns >= 2 || input.cardio.currentHardSessions > 0 ? 1 : 0,
    };
  }
  if (input.cardio.goal?.type === "vo2max") {
    const total = clamp(Math.max(currentTotal, 3), 3, 6);
    const hardCap = input.cardio.advanced?.maxHardSessions ?? 2;
    return {
      total,
      hard: Math.min(hardCap, currentTotal >= 4 ? 2 : 1),
    };
  }
  if (input.goals.primary === "cardio") {
    const total = clamp(
      Math.max(currentTotal, POLICY.cardio.cardioPriorityMinimumBouts),
      POLICY.cardio.cardioPriorityMinimumBouts,
      POLICY.cardio.cardioPriorityMaximumBouts,
    );
    const hardCap = input.cardio.advanced?.maxHardSessions ?? 2;
    const lowIntensityPurpose = ["recovery", "lifting_support"].includes(
      input.cardio.purpose,
    );
    return {
      total,
      hard: lowIntensityPurpose
        ? 0
        : Math.min(
            hardCap,
            Math.max(
              input.cardio.currentHardSessions,
              input.cardio.purpose === "performance" && currentTotal >= 3
                ? 1
                : 0,
            ),
            2,
          ),
    };
  }
  if (input.goals.primary === "health") {
    const emphasisMinimum =
      input.generalFitness?.emphasis === "aerobic"
        ? 3
        : POLICY.cardio.healthInitialBouts;
    const secondaryShare =
      input.goals.secondary === "cardio" ? 100 - input.goals.primaryWeight : 0;
    const secondaryMinimum =
      secondaryShare >= 50
        ? 4
        : secondaryShare >= 30
          ? 3
          : secondaryShare > 0
            ? 2
            : 0;
    const hard = ["recovery", "lifting_support"].includes(input.cardio.purpose)
      ? 0
      : secondaryShare >= 20 && input.cardio.currentHardSessions > 0
        ? 1
        : 0;
    return {
      total: Math.max(
        emphasisMinimum,
        secondaryMinimum,
        Math.min(currentTotal, 4),
      ),
      hard,
    };
  }
  const baseTotal =
    input.goals.primary === "hypertrophy"
      ? POLICY.cardio.hypertrophyInitialBouts
      : POLICY.cardio.strengthInitialBouts;
  const secondaryShare =
    input.goals.secondary === "cardio" ? 100 - input.goals.primaryWeight : 0;
  const secondaryTotal =
    secondaryShare >= 50
      ? 4
      : secondaryShare >= 30
        ? 3
        : secondaryShare > 0
          ? 2
          : 0;
  const total = Math.max(baseTotal, secondaryTotal);
  const hard = ["recovery", "lifting_support"].includes(input.cardio.purpose)
    ? 0
    : secondaryShare >= 20 && input.cardio.currentHardSessions > 0
      ? 1
      : 0;
  return { total, hard };
}

function cardioEventPhase(
  input: QuestionnaireInput,
  weekNumber: number,
): CardioPrescription["eventPhase"] {
  if (input.cardio.goal?.type !== "running_event") return undefined;
  const horizon = resolveHorizonWeeks(input).weeks;
  const remaining = Math.max(0, horizon - weekNumber);
  if (remaining <= 1) return "taper";
  if (remaining <= Math.max(2, Math.floor(horizon * 0.3))) return "specific";
  if (weekNumber <= Math.max(2, Math.ceil(horizon / 3))) return "base";
  return "build";
}

function cardioRoleForSession(
  input: QuestionnaireInput,
  eventPhase: CardioPrescription["eventPhase"],
  index: number,
  total: number,
  hardCount: number,
): NonNullable<CardioPrescription["role"]> {
  if (input.cardio.goal?.type === "running_event") {
    if (index === total - 1) return "long";
    if (hardCount > 0 && index === total - 2)
      return eventPhase === "base" ? "tempo" : "intervals";
    return index === 0 ? "easy" : "steady";
  }
  if (input.cardio.goal?.type === "vo2max") {
    return index >= total - hardCount ? "intervals" : "easy";
  }
  if (input.cardio.purpose === "recovery") return "recovery";
  if (index >= total - hardCount) return "intervals";
  return index === 0 && input.cardio.currentModerateSessions > 0
    ? "steady"
    : "easy";
}

const RUN_EVENT_KM: Record<
  "5k" | "10k" | "half_marathon" | "marathon",
  number
> = {
  "5k": 5,
  "10k": 10,
  half_marathon: 21.0975,
  marathon: 42.195,
};

function paceTargetForSession(
  input: QuestionnaireInput,
  role: NonNullable<CardioPrescription["role"]>,
): CardioPrescription["paceTarget"] {
  const race = input.cardio.goal?.runningEvent;
  if (race === undefined) return undefined;
  // Aspirational event outcomes are not measurements of today's capacity.
  // When no recent event-specific benchmark exists, prescribe exact effort only.
  if (race.recentBestMinutes === undefined) return undefined;
  const totalMinutes = Math.max(
    race.recentBestMinutes,
    race.targetTimeMinutes ?? race.recentBestMinutes,
  );
  if (totalMinutes === undefined) return undefined;
  const unit = input.cardio.runningBaseline?.distanceUnit ?? "mi";
  const distanceKm = RUN_EVENT_KM[race.distance];
  const distance = unit === "km" ? distanceKm : distanceKm * 0.621371;
  const raceSecondsPerUnit = (totalMinutes * 60) / distance;
  const multiplier =
    role === "easy" || role === "recovery"
      ? [1.2, 1.4]
      : role === "long"
        ? [1.15, 1.35]
        : role === "steady"
          ? [1.08, 1.22]
          : role === "tempo"
            ? [0.98, 1.08]
            : [0.88, 0.98];
  return {
    minSecondsPerUnit: Math.round(raceSecondsPerUnit * (multiplier[0] ?? 1)),
    maxSecondsPerUnit: Math.round(raceSecondsPerUnit * (multiplier[1] ?? 1)),
    unit,
    basis:
      totalMinutes === race.recentBestMinutes ? "recent_best" : "target_time",
  };
}

function targetDistanceForSession(
  input: QuestionnaireInput,
  role: NonNullable<CardioPrescription["role"]>,
  minutes: number,
): CardioPrescription["targetDistance"] {
  if (input.cardio.goal?.type !== "running_event") return undefined;
  const baseline = input.cardio.runningBaseline;
  const unit = baseline?.distanceUnit ?? "mi";
  const weeklyDistance = baseline?.weeklyDistance;
  const weeklyMinutes = baseline?.weeklyMinutes;
  if (
    weeklyDistance === undefined ||
    weeklyMinutes === undefined ||
    weeklyDistance <= 0 ||
    weeklyMinutes <= 0
  )
    return undefined;
  const typicalDistance = (weeklyDistance / weeklyMinutes) * minutes;
  const roleFactor = role === "long" ? 1 : role === "intervals" ? 0.75 : 0.9;
  return {
    value: Math.round(typicalDistance * roleFactor * 10) / 10,
    unit,
  };
}

function heartRateTarget(
  input: QuestionnaireInput,
  intensity: CardioPrescription["intensity"],
): CardioPrescription["heartRateBpm"] {
  if (
    input.cardio.heartRateDevice === "none" ||
    input.cardio.knownMaxHeartRate === undefined
  )
    return undefined;
  const maximum = input.cardio.knownMaxHeartRate;
  const resting = input.cardio.advanced?.restingHeartRate;
  const method = input.cardio.advanced?.intensityMethod;
  if (method === "heart_rate_reserve" && resting !== undefined) {
    const fractions =
      intensity === "easy"
        ? [0.4, 0.59]
        : intensity === "moderate"
          ? [0.6, 0.69]
          : [0.75, 0.9];
    const minimum = Math.round(
      resting + (maximum - resting) * (fractions[0] ?? 0),
    );
    const maximumTarget = Math.round(
      resting + (maximum - resting) * (fractions[1] ?? 0),
    );
    return {
      target: Math.round((minimum + maximumTarget) / 2),
      min: minimum,
      max: maximumTarget,
      method: "heart_rate_reserve",
    };
  }
  const fractions =
    intensity === "easy"
      ? [0.6, 0.7]
      : intensity === "moderate"
        ? [0.7, 0.8]
        : [0.8, 0.9];
  const minimum = Math.round(maximum * (fractions[0] ?? 0));
  const maximumTarget = Math.round(maximum * (fractions[1] ?? 0));
  return {
    target: Math.round((minimum + maximumTarget) / 2),
    min: minimum,
    max: maximumTarget,
    method: "percent_max",
  };
}

function assignCardioDays(
  input: QuestionnaireInput,
  liftSessions: TrainingSession[],
  count: number,
  hardCount: number,
): (DayOfWeek | undefined)[] {
  const available = DAYS.filter(
    (day) => !input.schedule.unavailableDays.includes(day),
  );
  const occupied = new Set(
    liftSessions
      .map((item) => item.day)
      .filter((day): day is DayOfWeek => day !== undefined),
  );
  const preferred = [...input.schedule.cardioFocusedDays, ...available]
    .filter((day, index, all) => all.indexOf(day) === index)
    .filter((day) => available.includes(day));
  const free = preferred.filter((day) => !occupied.has(day));
  const advancedSchedule = input.schedule.advanced;
  const configuredSameDayDays = new Set<DayOfWeek>(
    advancedSchedule === undefined
      ? DAYS
      : advancedSchedule.splitSessionDays.length > 0
        ? advancedSchedule.splitSessionDays
        : advancedSchedule.allowCombinedSessions === true ||
            advancedSchedule.allowSeparateSameDay === true
          ? DAYS
          : [],
  );
  const combined = preferred.filter(
    (day) => occupied.has(day) && configuredSameDayDays.has(day),
  );

  function spread(
    pool: DayOfWeek[],
    needed: number,
    used: DayOfWeek[],
  ): DayOfWeek[] {
    const result: DayOfWeek[] = [];
    while (result.length < needed) {
      const candidates = pool.filter(
        (day) => !used.includes(day) && !result.includes(day),
      );
      if (candidates.length === 0) break;
      const chosen = [...candidates].sort((left, right) => {
        const selected = [...used, ...result];
        const distance = (day: DayOfWeek) => {
          if (selected.length === 0) return 3;
          const index = DAYS.indexOf(day);
          return Math.min(
            ...selected.map((other) => {
              const difference = Math.abs(index - DAYS.indexOf(other));
              return Math.min(difference, DAYS.length - difference);
            }),
          );
        };
        const preference = (day: DayOfWeek) =>
          input.schedule.cardioFocusedDays.includes(day) ? 1 : 0;
        return (
          distance(right) - distance(left) ||
          preference(right) - preference(left) ||
          DAYS.indexOf(left) - DAYS.indexOf(right)
        );
      })[0];
      if (chosen === undefined) break;
      result.push(chosen);
    }
    return result;
  }

  // Reserve dedicated days for hard work first. Easy work can safely share a
  // day with lifting when the week otherwise exceeds the user's availability.
  const hardPool = free.filter((day) =>
    hardCardioDayIsCompatible(day, liftSessions),
  );
  const hardDays = spread(hardPool, Math.min(hardCount, hardPool.length), []);
  const remainingFree = free.filter((day) => !hardDays.includes(day));
  const otherCount = Math.max(0, count - hardDays.length);
  const otherFree = spread(
    remainingFree,
    Math.min(otherCount, remainingFree.length),
    hardDays,
  );
  const otherCombined = spread(
    combined,
    Math.max(0, otherCount - otherFree.length),
    [...hardDays, ...otherFree],
  );
  const selected = [...otherFree, ...otherCombined, ...hardDays];
  return Array.from({ length: count }, (_, index) => selected[index]);
}

function cardioSessionsForWeek(
  input: QuestionnaireInput,
  phase: Phase,
  weekNumber: number,
  liftSessions: TrainingSession[],
  context?: GenerationContext,
): TrainingSession[] {
  if (availableCardioModalities(input).length === 0) {
    if (context)
      addWarning(context, {
        code: "cardio-no-available-modality",
        severity: "blocking",
        message:
          "Choose at least one cardio activity supported by your available equipment.",
        ruleIds: ["CARDIO-1"],
      });
    return [];
  }
  const goalFrequency = cardioFrequency(input);
  const recentFrequency =
    input.cardio.goal?.type === "running_event"
      ? (input.cardio.runningBaseline?.runsPerWeek ?? 0)
      : input.cardio.currentEasySessions +
        input.cardio.currentModerateSessions +
        input.cardio.currentHardSessions;
  const rampCapacity = Math.max(
    1,
    recentFrequency + 1 + Math.floor((weekNumber - 1) / 2),
  );
  const requestedFrequency = {
    total: Math.min(goalFrequency.total, rampCapacity),
    hard:
      (recentFrequency === 0 && weekNumber <= 2) ||
      (input.cardio.goal?.type === "running_event" && recentFrequency < 2)
        ? 0
        : goalFrequency.hard,
  };
  if (context && requestedFrequency.total < goalFrequency.total)
    addWarning(context, {
      code: "cardio-baseline-frequency-ramp",
      severity: "info",
      message: `Cardio starts from the reported ${recentFrequency}-bout baseline, adding at most one weekly bout every two weeks toward the goal. Follow-up review should hold or reduce this progression when completion or recovery is poor.`,
      ruleIds: ["CARDIO-2"],
    });
  const availableDayCount = DAYS.filter(
    (day) => !input.schedule.unavailableDays.includes(day),
  ).length;
  const liftDays = new Set(
    liftSessions.flatMap((session) =>
      session.day === undefined ? [] : [session.day],
    ),
  );
  const advancedSchedule = input.schedule.advanced;
  const configuredSameDayDays = new Set<DayOfWeek>(
    advancedSchedule === undefined
      ? DAYS
      : advancedSchedule.splitSessionDays.length > 0
        ? advancedSchedule.splitSessionDays
        : advancedSchedule.allowCombinedSessions === true ||
            advancedSchedule.allowSeparateSameDay === true
          ? DAYS
          : [],
  );
  const dedicatedCapacity = Math.max(0, availableDayCount - liftDays.size);
  const sharedCapacity = [...liftDays].filter((day) =>
    configuredSameDayDays.has(day),
  ).length;
  const cardioDayCapacity = dedicatedCapacity + sharedCapacity;
  const frequency = {
    total: Math.min(requestedFrequency.total, cardioDayCapacity),
    hard: Math.min(requestedFrequency.hard, requestedFrequency.total),
  };
  const hardCapacity = DAYS.filter(
    (day) =>
      !input.schedule.unavailableDays.includes(day) &&
      !liftDays.has(day) &&
      hardCardioDayIsCompatible(day, liftSessions),
  ).length;
  frequency.hard = Math.min(frequency.hard, frequency.total, hardCapacity);
  if (context && frequency.hard < requestedFrequency.hard)
    addWarning(context, {
      code: "cardio-recovery-capacity",
      severity: "warning",
      message: `Hard cardio was reduced from ${requestedFrequency.hard} to ${frequency.hard} bouts because the selected schedule cannot separate it from heavy lower-body lifting. Remaining bouts are easy.`,
      ruleIds: ["CARDIO-1"],
    });
  if (context && frequency.total < requestedFrequency.total)
    addWarning(context, {
      code: "cardio-day-capacity",
      severity: "warning",
      message: `Only ${frequency.total} of ${requestedFrequency.total} requested cardio bouts fit the available days and same-day permissions.`,
      ruleIds: ["CARDIO-1", "SCHED-1"],
    });
  const days = assignCardioDays(
    input,
    liftSessions,
    frequency.total,
    frequency.hard,
  );
  // Running plans place the long easy bout last, so move the reserved hard day
  // to the preceding quality slot instead of accidentally assigning it easy work.
  if (
    input.cardio.goal?.type === "running_event" &&
    frequency.hard > 0 &&
    days.length >= 2
  ) {
    const last = days.length - 1;
    [days[last - 1], days[last]] = [days[last], days[last - 1]];
  }
  const baselineMinutes =
    input.cardio.typicalEasyMinutes > 0 ? input.cardio.typicalEasyMinutes : 20;
  const build =
    input.goals.primary === "cardio" && phase === "cardio_build"
      ? Math.floor((weekNumber - 1) / 2) *
        POLICY.cardio.durationProgressionMinutes
      : 0;
  const eventPhase = cardioEventPhase(input, weekNumber);
  return Array.from({ length: frequency.total }, (_, index) => {
    let role = cardioRoleForSession(
      input,
      eventPhase,
      index,
      frequency.total,
      frequency.hard,
    );
    let hard = role === "intervals" || role === "tempo";
    const runningBaseline = input.cardio.runningBaseline;
    const recentMinutes =
      role === "long"
        ? (runningBaseline?.longestRunMinutes ??
          input.cardio.longestRecentSessionMinutes ??
          baselineMinutes)
        : hard
          ? input.cardio.typicalHardMinutes || Math.min(25, baselineMinutes)
          : role === "steady"
            ? input.cardio.typicalModerateMinutes || baselineMinutes
            : baselineMinutes;
    const capByHistory =
      (runningBaseline?.longestRunMinutes ??
        input.cardio.longestRecentSessionMinutes) > 0
        ? (runningBaseline?.longestRunMinutes ??
            input.cardio.longestRecentSessionMinutes) +
          POLICY.cardio.durationProgressionMinutes
        : input.schedule.targetCardioMinutes;
    const roleBuild =
      role === "long" && eventPhase !== "taper"
        ? Math.floor((weekNumber - 1) / 2) *
          POLICY.cardio.durationProgressionMinutes
        : build;
    const taperFactor = eventPhase === "taper" ? 0.7 : 1;
    const minutes = Math.max(
      10,
      Math.round(
        Math.min(
          role === "long"
            ? Math.max(input.schedule.targetCardioMinutes, capByHistory)
            : input.schedule.targetCardioMinutes,
          role === "long" ? capByHistory + roleBuild : capByHistory,
          recentMinutes + roleBuild,
        ) * taperFactor,
      ),
    );
    // A short time budget must not invent intervals that overflow its warm-up.
    const minimumIntervalMinutes =
      input.cardio.goal?.type === "vo2max" ? 13 : 11;
    if (hard && minutes < minimumIntervalMinutes) {
      hard = false;
      role = "easy";
    }
    const intensity: CardioPrescription["intensity"] = hard
      ? "hard"
      : role === "steady"
        ? "moderate"
        : "easy";
    const modality =
      input.cardio.goal?.type === "running_event"
        ? "running"
        : input.cardio.goal?.type === "vo2max"
          ? (input.cardio.goal.vo2max?.modality ??
            cardioModalityForSession(
              input,
              weekNumber,
              index,
              frequency.total,
              intensity,
            ))
          : cardioModalityForSession(
              input,
              weekNumber,
              index,
              frequency.total,
              intensity,
            );
    const sameDayLift =
      days[index] === undefined
        ? undefined
        : liftSessions.find((session) => session.day === days[index]);
    const placement =
      sameDayLift === undefined
        ? hard
          ? "Dedicated cardio day. If you reschedule it, keep one non-lifting or easy day before the next heavy lower-body workout."
          : "Dedicated cardio day. Complete it at the prescribed effort."
        : input.schedule.advanced?.allowSeparateSameDay !== false &&
            input.schedule.advanced?.splitSessionDays.includes(
              days[index] as DayOfWeek,
            )
          ? `Same day as ${sameDayLift.title}; separate by at least ${POLICY.cardio.preferredSeparationHours} hours and lift first when lifting is the priority.`
          : `After ${sameDayLift.title}; lifting comes first. Keep this bout easy if the lift was lower-body demanding.`;
    const heartRateBpm = heartRateTarget(input, intensity);
    const workSeconds =
      input.cardio.goal?.type === "vo2max"
        ? 180
        : eventPhase === "specific"
          ? 120
          : 60;
    const recoverySeconds = workSeconds >= 180 ? 120 : workSeconds;
    const availableIntervalSeconds = Math.max(0, (minutes - 10) * 60);
    const intervalRepeats = Math.max(
      1,
      Math.min(
        10,
        Math.floor(
          (availableIntervalSeconds + recoverySeconds) /
            (workSeconds + recoverySeconds),
        ),
      ),
    );
    const targetDistance = targetDistanceForSession(input, role, minutes);
    const paceTarget = paceTargetForSession(input, role);
    const workMinutes = Math.max(5, minutes - (hard ? 10 : 5));
    const cardio: CardioPrescription = {
      modality,
      intensity,
      minutes,
      role,
      ...(eventPhase === undefined ? {} : { eventPhase }),
      ...(targetDistance === undefined ? {} : { targetDistance }),
      ...(paceTarget === undefined ? {} : { paceTarget }),
      ...(hard && role === "intervals"
        ? {
            intervals: {
              workSeconds,
              recoverySeconds,
              repeats: intervalRepeats,
            },
          }
        : {}),
      segments:
        hard && role === "tempo"
          ? [
              {
                kind: "warmup",
                label: "Easy warm-up",
                minutes: 5,
                intensity: "easy",
              },
              {
                kind: "work",
                label: "Controlled continuous tempo",
                minutes: minutes - 10,
                intensity: "hard",
              },
              {
                kind: "cooldown",
                label: "Easy cool-down",
                minutes: 5,
                intensity: "easy",
              },
            ]
          : hard
            ? [
                {
                  kind: "warmup",
                  label: "Easy warm-up",
                  minutes: 5,
                  intensity: "easy",
                },
                {
                  kind: "work",
                  label: `${intervalRepeats} work intervals`,
                  minutes: workSeconds / 60,
                  repeats: intervalRepeats,
                  intensity: "hard",
                },
                {
                  kind: "recovery",
                  label: "Easy recovery between intervals",
                  minutes: recoverySeconds / 60,
                  repeats: Math.max(0, intervalRepeats - 1),
                  intensity: "easy",
                },
                {
                  kind: "cooldown",
                  label: "Easy cool-down",
                  minutes:
                    5 +
                    Math.max(
                      0,
                      minutes -
                        10 -
                        (workSeconds * intervalRepeats +
                          recoverySeconds * Math.max(0, intervalRepeats - 1)) /
                          60,
                    ),
                  intensity: "easy",
                },
              ]
            : [
                {
                  kind: "warmup",
                  label: "Ease into the session",
                  minutes: 5,
                  intensity: "easy",
                },
                {
                  kind: "work",
                  label:
                    modality === "running" &&
                    (runningBaseline?.continuousRunMinutes ?? 0) < 10
                      ? "Run/walk: alternate 1 minute easy running and 2 minutes walking"
                      : role === "long"
                        ? "Comfortable long effort"
                        : "Main aerobic work",
                  minutes: workMinutes,
                  ...(targetDistance === undefined
                    ? {}
                    : {
                        distance: targetDistance.value,
                        distanceUnit: targetDistance.unit,
                      }),
                  intensity,
                },
              ],
      talkTest:
        intensity === "easy"
          ? "Target RPE 3 — you should be able to speak in full sentences during this workout."
          : intensity === "moderate"
            ? "Target RPE 5 — you should be able to speak in short sentences during this workout."
            : role === "tempo"
              ? "Target RPE 7 during the continuous tempo — keep the effort controlled and speak only in short phrases."
              : "Target RPE 8 during each work interval — speaking more than a few words should be difficult.",
      sessionRpe:
        intensity === "easy"
          ? { min: 3, max: 3 }
          : intensity === "moderate"
            ? { min: 5, max: 5 }
            : role === "tempo"
              ? { min: 7, max: 7 }
              : { min: 8, max: 8 },
      ...(heartRateBpm === undefined ? {} : { heartRateBpm }),
      placement,
      ruleIds: [
        "CARDIO-1",
        "CARDIO-2",
        "ACTION-1",
        ...(input.goals.primary === "cardio" ? ["CARDIO-3"] : []),
        ...(input.cardio.goal?.type === "running_event" ? ["CARDIO-4"] : []),
        ...(input.cardio.goal?.type === "vo2max" ? ["CARDIO-5"] : []),
      ],
    };
    synchronizeCardioDuration(cardio);
    return {
      id: `w${weekNumber}-cardio-${index + 1}`,
      weekNumber,
      sequence: liftSessions.length + index + 1,
      ...(days[index] === undefined ? {} : { day: days[index] }),
      kind: sameDayLift === undefined ? "cardio" : "combined",
      title: `${role[0]?.toUpperCase()}${role.slice(1)} ${modality}`,
      objective: hard
        ? role === "intervals"
          ? "Build aerobic power with a specific number of controlled intervals."
          : "Practice a sustained, controlled hard effort."
        : role === "long"
          ? "Build event-specific endurance at a comfortable effort."
          : "Build aerobic capacity without turning this into a hard day.",
      exercises: [],
      cardio,
      predictedMinutes: Math.ceil(cardio.minutes),
      targetMinutes: input.schedule.targetCardioMinutes,
      durationStatus:
        minutes <= input.schedule.targetCardioMinutes
          ? "fits"
          : "guideline_exceeded",
      explanation: placement,
    };
  });
}

function mergeCardioIntoLift(
  lifting: TrainingSession,
  cardioSession: TrainingSession,
): TrainingSession {
  const cardio = cardioSession.cardio;
  if (cardio === undefined) return lifting;
  const predictedMinutes =
    lifting.predictedMinutes + cardioSession.predictedMinutes;
  const targetMinutes = lifting.targetMinutes + cardioSession.targetMinutes;
  return {
    ...lifting,
    kind: "combined",
    cardio,
    predictedMinutes,
    targetMinutes,
    durationStatus:
      lifting.durationStatus === "infeasible" ||
      cardioSession.durationStatus === "infeasible"
        ? "infeasible"
        : predictedMinutes <= targetMinutes
          ? "fits"
          : "guideline_exceeded",
    explanation: `${lifting.explanation} ${cardioSession.explanation}`,
  };
}

function orderWeeklySessions(
  input: QuestionnaireInput,
  liftingSessions: TrainingSession[],
  cardioSessions: TrainingSession[],
): TrainingSession[] {
  const lifting = liftingSessions.map((session) => ({ ...session }));
  let cardio = [...cardioSessions];

  const remaining: TrainingSession[] = [];
  for (const cardioSession of cardio) {
    const liftIndex = lifting.findIndex(
      (session) =>
        session.day !== undefined &&
        session.day === cardioSession.day &&
        session.cardio === undefined,
    );
    if (liftIndex < 0) remaining.push(cardioSession);
    else {
      const lift = lifting[liftIndex];
      if (lift !== undefined)
        lifting[liftIndex] = mergeCardioIntoLift(lift, cardioSession);
    }
  }
  cardio = remaining;

  const sessions = [...lifting, ...cardio].sort((left, right) => {
    const leftDay =
      left.day === undefined ? DAYS.length : DAYS.indexOf(left.day);
    const rightDay =
      right.day === undefined ? DAYS.length : DAYS.indexOf(right.day);
    return leftDay - rightDay || left.sequence - right.sequence;
  });
  return sessions.map((session, index) => ({
    ...session,
    sequence: index + 1,
  }));
}

function movementSession(
  input: QuestionnaireInput,
  weekNumber: number,
): TrainingSession {
  const baselineSteps =
    input.dailyMovement?.baselineSteps ?? input.generalFitness?.baselineSteps;
  const walkingBaseline =
    input.dailyMovement?.baselineWalkingMinutes ??
    input.generalFitness?.dailyWalkingMinutes;
  const canCountSteps =
    input.dailyMovement?.trackingMethod !== "none" &&
    (input.dailyMovement !== undefined || baselineSteps !== undefined);
  const buildStep = Math.floor((weekNumber - 1) / 2) * 500;
  const stepCeiling = input.age >= 60 ? 8000 : 10000;
  const target = canCountSteps
    ? {
        steps: Math.max(
          baselineSteps ?? 0,
          Math.min(stepCeiling, (baselineSteps ?? 6000) + 500 + buildStep),
        ),
        explanation:
          "The daily step target begins close to your usual activity and increases only in small steps.",
      }
    : {
        walkingMinutes: Math.max(
          walkingBaseline ?? 0,
          Math.min(
            30,
            Math.max(
              10,
              (walkingBaseline ?? 15) +
                5 +
                Math.floor((weekNumber - 1) / 2) * 5,
            ),
          ),
        ),
        explanation:
          "The daily walking target begins close to your usual activity and grows gradually.",
      };
  return {
    id: `w${weekNumber}-movement`,
    weekNumber,
    sequence: 99,
    kind: "movement",
    title: "Daily movement target",
    objective: "Accumulate low-fatigue movement outside formal cardio.",
    exercises: [],
    movementTarget: target,
    predictedMinutes: 0,
    targetMinutes: 0,
    durationStatus: "fits",
    explanation: `${target.explanation} This is not a hard training session.`,
  };
}

function goalContract(input: QuestionnaireInput): string {
  const bodyweightContext = input.weight.ignoreAfterInitial
    ? " Bodyweight will not be requested after onboarding."
    : ` Bodyweight is optional training context (${input.weight.dietGoal}); this engine does not prescribe a diet.`;
  if (
    input.goals.primaryWeight === 100 ||
    input.goals.secondary === undefined
  ) {
    return `${input.goals.primary} is the sole protected goal.${bodyweightContext}`;
  }
  return `${input.goals.primary} receives ${input.goals.primaryWeight}% priority; ${input.goals.secondary} receives ${100 - input.goals.primaryWeight}%. Hard constraints still outrank both.${bodyweightContext}`;
}

function loggingPlan(
  input: QuestionnaireInput,
): TrainingProgram["loggingPlan"] {
  const effortPrompt =
    input.history.effortReporting === "rpe"
      ? "Log RPE (1–10) for the final work set and any set outside target."
      : input.history.effortReporting === "rir"
        ? "Log reps in reserve (RIR) for the final work set and any set outside target."
        : input.history.effortReporting === "verbal"
          ? "Choose easy, medium, difficult, or impossible for the final work set and any miss."
          : "Use RIR when familiar; otherwise choose easy, medium, difficult, or impossible.";
  return {
    setFields: [
      "completed reps",
      "load",
      "completed/failed",
      input.history.effortReporting,
    ],
    effortPrompt,
    sessionFields: [
      "completion status",
      "actual duration",
      "reason for any skipped work",
      "exercise-level pain impact and follow-up",
      "equipment/location change",
    ],
    cardioFields: [
      "completed and moving minutes",
      "completed intervals for structured sessions",
      "session RPE",
      "modality",
      "optional distance",
      "optional step count",
      "optional elevation, surface, and device source",
      ...(input.cardio.heartRateDevice === "none"
        ? []
        : ["heart rate from smartwatch/chest strap when valid"]),
    ],
    weeklyReviewFields: [
      "set and session completion",
      "median effort error",
      "two-exposure performance trend",
      "time overruns",
      "miss reason codes",
      "technique and exercise-level pain response",
      "cardio role, minutes, intervals, pace-at-effort, distance, and steps",
    ],
    bodyweightCheckIn:
      !input.weight.ignoreAfterInitial && input.weight.weeklyCheckIns
        ? "optional_weekly"
        : "disabled",
    movementFields: [
      "whether the previous day’s target was reached",
      ...(input.dailyMovement?.trackingMethod === "none"
        ? ["optional walking minutes"]
        : ["optional step count"]),
    ],
  };
}

export function generateProgram(input: QuestionnaireInput): GenerationResult {
  const issues = validateQuestionnaire(input);
  if (issues.some((issue) => issue.severity === "blocking")) return { issues };

  const needsPowerliftingBaselines =
    input.goals.primary === "powerlifting" ||
    input.goals.secondary === "powerlifting" ||
    input.hypertrophy?.preserveCompetitionLifts === true ||
    input.generalFitness?.preserveCompetitionLifts === true;
  const baselines = needsPowerliftingBaselines ? calculateBaselines(input) : [];
  const context: GenerationContext = {
    input,
    baselines,
    exerciseCache: new Map(),
    recoveryFactor: recoverySetFactor(input),
    warnings: issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => ({
        code: `validation-${issue.path}`,
        severity: "warning",
        message: issue.message,
        ruleIds: issue.ruleIds,
      })),
    unresolvedChoices: [],
    triggeredRuleIds: [
      "GOAL-1",
      "DOSE-1",
      "TIME-1",
      "SCHED-1",
      "CARDIO-1",
      "CARDIO-2",
      "MOVE-1",
      "ACTION-1",
    ],
  };
  if (input.cardio.goal?.type === "running_event")
    context.triggeredRuleIds.push("CARDIO-4");
  const runningTarget = input.cardio.goal?.runningEvent;
  if (runningTarget?.targetTimeMinutes !== undefined) {
    if (runningTarget.recentBestMinutes === undefined)
      addWarning(context, {
        code: "race-target-unverified",
        severity: "info",
        message:
          "The target race time has no recent comparable benchmark. Workouts use specific effort targets, not a pace inferred from the aspiration.",
        ruleIds: ["CARDIO-4"],
      });
    else if (runningTarget.targetTimeMinutes < runningTarget.recentBestMinutes)
      addWarning(context, {
        code: "race-target-ahead-of-baseline",
        severity: "info",
        message:
          "The target race time is faster than the reported recent best. Training paces remain anchored to that measured baseline; the engine does not guarantee the target outcome.",
        ruleIds: ["CARDIO-4"],
      });
  }
  if (input.cardio.goal?.type === "vo2max")
    context.triggeredRuleIds.push("CARDIO-5");
  if (input.cardio.advanced?.weeklyMinutes !== undefined) {
    const itemizedMinutes =
      input.cardio.currentEasySessions * input.cardio.typicalEasyMinutes +
      input.cardio.currentModerateSessions *
        input.cardio.typicalModerateMinutes +
      input.cardio.currentHardSessions * input.cardio.typicalHardMinutes;
    if (
      Math.abs(input.cardio.advanced.weeklyMinutes - itemizedMinutes) >
      Math.max(30, input.cardio.advanced.weeklyMinutes * 0.25)
    ) {
      addWarning(context, {
        code: "cardio-baseline-inconsistency",
        severity: "info",
        message: `Reported weekly cardio minutes (${input.cardio.advanced.weeklyMinutes}) differ materially from the itemized sessions (${itemizedMinutes}); the conservative lower dose controls the start.`,
        ruleIds: ["CARDIO-2"],
      });
    }
  }
  const split = selectHypertrophySplit(input);
  if (
    input.hypertrophy !== undefined &&
    input.hypertrophy.splitPreference !== "auto" &&
    !eligibleHypertrophySplits(input.schedule.liftingDaysPerWeek).includes(
      input.hypertrophy.splitPreference,
    )
  ) {
    addWarning(context, {
      code: "hypertrophy-split-fallback",
      severity: "info",
      message: `${input.hypertrophy.splitPreference.replaceAll("_", " ")} is not eligible for ${input.schedule.liftingDaysPerWeek} lifting days, so ${split?.replaceAll("_", " ") ?? "the default split"} was selected.`,
      ruleIds: ["SPLIT-1"],
    });
  }
  // Resolve the same seven-day anchor used by the calendar before phase planning.
  const previewContext: GenerationContext = {
    ...context,
    warnings: [],
    unresolvedChoices: [],
    triggeredRuleIds: [],
  };
  const previewLifting = liftingSessionsForWeek(
    buildLiftingTemplates(input, split),
    "base",
    1,
    1,
    previewContext,
  );
  const previewCardio = cardioSessionsForWeek(input, "base", 1, previewLifting);
  const scheduleStart = effectiveScheduleStart(
    input.goals.startDate,
    orderWeeklySessions(input, previewLifting, previewCardio),
  );
  const schedulingInput = {
    ...input,
    goals: { ...input.goals, startDate: scheduleStart },
  };
  context.input = schedulingInput;
  const horizon = resolveHorizonWeeks(schedulingInput);
  const phases = resolvePhaseMap(schedulingInput, horizon.weeks);
  const weeks: ProgramWeek[] = phases.map((phase, index) => {
    const weekNumber = index + 1;
    const phaseOccurrence = phases
      .slice(0, index + 1)
      .filter((candidate) => candidate === phase).length;
    const lifting = liftingSessionsForWeek(
      buildLiftingTemplates(input, split, weekNumber),
      phase,
      phaseOccurrence,
      weekNumber,
      context,
    );
    const cardio = cardioSessionsForWeek(
      schedulingInput,
      phase,
      weekNumber,
      lifting,
      context,
    );
    const dated = orderWeeklySessions(input, lifting, cardio)
      .map((session) => ({
        ...session,
        ...(session.day === undefined
          ? {}
          : {
              occurrenceDate: addScheduleDays(
                scheduleStart,
                index * 7 + weekdayOffset(scheduleStart, session.day),
              ),
            }),
      }))
      .filter(
        (session) =>
          !input.goals.event ||
          !session.occurrenceDate ||
          session.occurrenceDate < input.goals.event.date,
      )
      .sort((a, b) =>
        (a.occurrenceDate ?? "").localeCompare(b.occurrenceDate ?? ""),
      )
      .map((session, sessionIndex) => ({
        ...session,
        sequence: sessionIndex + 1,
      }));
    const sessions = [...dated, movementSession(input, weekNumber)];
    const hardSetBudget = sessions
      .flatMap((session) => session.exercises)
      .filter((item) => item.targetRir.min <= 4)
      .reduce((sum, item) => sum + item.sets, 0);
    const doseLedger = buildDoseLedger(sessions, input, phase);
    const constrained = doseLedger.filter(
      (item) => item.status !== "within_target",
    );
    if (constrained.length > 0)
      addWarning(context, {
        code: `dose-week-${weekNumber}`,
        severity: "warning",
        message: `Week ${weekNumber} dose differs from its planning targets for ${constrained.map((item) => `${item.muscle.replaceAll("_", " ")} (${item.effectiveSets}/${item.targetMin}–${item.targetMax} effective sets)`).join(", ")}. Time, equipment, split, recovery, and event constraints take priority; these are planning ranges, not extra sets to complete.`,
        ruleIds: ["DOSE-1"],
      });
    return {
      weekNumber,
      phase,
      sessions,
      hardSetBudget,
      doseLedger,
      explanation: `Week ${weekNumber} applies the ${phase} phase. Planned and later delivered work remain separate.`,
    };
  });

  if (input.hypertrophy?.useSupersets === true) {
    const pairedBlocks = weeks
      .flatMap((week) => week.sessions)
      .flatMap((session) => session.setBlocks ?? [])
      .filter((block) => block.type === "paired_superset");
    context.triggeredRuleIds.push("SUPERSET-1", "SUPERSET-2");
    if (pairedBlocks.length === 0) {
      addWarning(context, {
        code: "superset-no-compatible-pair",
        severity: "info",
        message:
          "Supersets were requested, but this block has no accessory pair that meets the compatibility and recovery checks. The exercises remain separate.",
        ruleIds: ["SUPERSET-1", "SUPERSET-2"],
      });
    }
  }

  const inputFingerprint = fingerprint(input);
  const blockingWarnings = context.warnings.some(
    (warning) => warning.severity === "blocking",
  );
  const program: TrainingProgram = {
    id: `program-${inputFingerprint}`,
    version: 1,
    engineVersion: ENGINE_VERSION,
    policyVersion: POLICY_VERSION,
    integrityVersion: 1,
    effectiveScheduleStartDate: scheduleStart,
    generatedForDate: input.asOfDate,
    inputFingerprint,
    status: blockingWarnings
      ? "infeasible"
      : context.unresolvedChoices.length > 0
        ? "needs_input"
        : "ready",
    goalContract: goalContract(input),
    horizonWeeks: horizon.weeks,
    rolling: horizon.rolling,
    loadSettings: {
      units: input.units,
      barbellIncrement: totalBarbellIncrementFromInput(input),
      dumbbellIncrement:
        input.facility.dumbbellIncrement ??
        defaultDumbbellIncrement(input.units),
    },
    adaptationSettings: structuredClone(input.adaptation),
    loggingPlan: loggingPlan(input),
    ...(split === undefined ? {} : { selectedSplit: split }),
    baselines,
    weeks,
    questionEffects: resolveQuestionEffects(input),
    warnings: context.warnings,
    unresolvedChoices: unique(context.unresolvedChoices),
    triggeredRuleIds: unique(context.triggeredRuleIds),
    reviewFingerprints: [],
    explanation: `Deterministic ${horizon.rolling ? "rolling" : "fixed"} plan generated from goal, feasibility, baseline, exercise eligibility, dose, and concurrent-cardio rules. Review questionEffects to see how every answer was used.`,
  };
  const invariantWarnings = validateGeneratedProgram(program, input);
  program.warnings.push(...invariantWarnings);
  program.triggeredRuleIds = unique([
    ...program.triggeredRuleIds,
    ...invariantWarnings.flatMap((warning) => warning.ruleIds),
  ]);
  if (invariantWarnings.length > 0) program.status = "infeasible";
  return { program, issues };
}
