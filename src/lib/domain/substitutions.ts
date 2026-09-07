import {
  choiceCandidates,
  getExercise,
  isExerciseEligible,
  rankExercises,
} from "./exercises.js";
import type {
  AdaptationChange,
  Equipment,
  EquipmentVariantResult,
  QuestionnaireInput,
  TrainingSession,
  TrainingProgram,
} from "./types.js";
import {
  refreshProgramSetBlocks,
  refreshSessionSetBlocks,
  sanitizeSessionSetBlocks,
} from "./set-blocks.js";
import { unique } from "./utils.js";
import { refreshWeekDoseLedger } from "./dose.js";
import { recalculateSessionDuration } from "./duration.js";
import { ENGINE_VERSION, POLICY_VERSION } from "./policy.js";

const ALL_EQUIPMENT: Equipment[] = [
  "bodyweight",
  "barbell",
  "rack",
  "bench",
  "plates",
  "dumbbells",
  "cables",
  "machines",
  "smith_machine",
  "pullup_bar",
  "bands",
  "cardio_bike",
  "treadmill",
  "rower",
  "elliptical",
  "pool",
  "outdoors",
];

export interface SessionEquipmentVariant {
  session: TrainingSession;
  configured: boolean;
  changes: Array<{
    prescriptionId: string;
    before: string;
    after: string;
    competitionTradeoff: boolean;
  }>;
  warnings: string[];
}

/**
 * Resolves only one workout for a secondary gym. It never mutates the stored
 * program or later sessions. Without a saved secondary-gym setup, it keeps the
 * prescribed exercises and exposes broad, safety-filtered best-fit choices so
 * the athlete can select equipment that is actually present.
 */
export function createSessionEquipmentVariant(
  program: TrainingProgram,
  input: QuestionnaireInput,
  sessionId: string,
): SessionEquipmentVariant {
  const original = program.weeks
    .flatMap((week) => week.sessions)
    .find((session) => session.id === sessionId);
  if (original === undefined)
    throw new Error("The workout could not be found for this gym change.");

  const equipment = input.facility.alternateEquipment;
  if (equipment !== undefined && equipment.length > 0) {
    const variant = createEquipmentVariant(
      program,
      input,
      equipment,
      original.weekNumber,
      original.weekNumber,
    );
    const session = variant.program.weeks
      .flatMap((week) => week.sessions)
      .find((candidate) => candidate.id === sessionId);
    if (session === undefined)
      throw new Error("The alternate-gym workout could not be prepared.");
    const prescriptionIds = new Set(
      original.exercises.map((exercise) => exercise.id),
    );
    const changes = variant.changes
      .filter((change) => prescriptionIds.has(change.target))
      .map((change) => {
        const planned = original.exercises.find(
          (exercise) => exercise.id === change.target,
        );
        return {
          prescriptionId: change.target,
          before: change.before ?? "Planned exercise",
          after: change.after ?? "Replacement exercise",
          competitionTradeoff:
            getExercise(planned?.exerciseId ?? "")?.exerciseClass ===
            "competition",
        };
      });
    return {
      session,
      configured: true,
      changes,
      warnings: variant.warnings
        .filter((warning) =>
          original.exercises.some((exercise) =>
            warning.code.includes(exercise.id),
          ),
        )
        .map((warning) => warning.message),
    };
  }

  const session = structuredClone(original);
  for (const prescription of session.exercises) {
    const current = getExercise(prescription.exerciseId);
    if (current === undefined) continue;
    const ranked = rankExercises(
      input,
      {
        purpose:
          current.exerciseClass === "competition"
            ? "strength"
            : prescription.purpose,
        patterns: current.patterns,
        ...(current.primaryMuscles.length === 0
          ? {}
          : { muscles: current.primaryMuscles }),
        maximumFatigue: current.fatigue,
      },
      ALL_EQUIPMENT,
    ).filter((candidate) => candidate.id !== current.id);
    prescription.alternativeChoices = [
      ...prescription.alternativeChoices,
      ...choiceCandidates(ranked),
    ].filter(
      (choice, index, all) =>
        choice.exerciseId !== prescription.exerciseId &&
        all.findIndex(
          (candidate) => candidate.exerciseId === choice.exerciseId,
        ) === index,
    );
  }
  return {
    session,
    configured: false,
    changes: [],
    warnings: [
      "No secondary gym is saved for this program. Choose a replacement below only if that equipment is available today.",
    ],
  };
}

export interface PermanentSubstitutionRequest {
  originalExerciseId: string;
  replacementExerciseId: string;
}

/**
 * Carries an exercise selected in today's workout into later workouts. The
 * current prescription remains unchanged so its already-started log continues
 * to describe what was originally prescribed. Each replacement gets a new
 * performance series and a calibration recommendation; loads never transfer
 * between different exercises.
 */
export function applyPermanentExerciseSubstitutions(
  program: TrainingProgram,
  requests: PermanentSubstitutionRequest[],
  afterWeek: number,
  afterSequence: number,
  input?: QuestionnaireInput,
): { program: TrainingProgram; changedPrescriptionCount: number } {
  const next = structuredClone(program);
  if (requests.length === 0)
    return { program: next, changedPrescriptionCount: 0 };
  let changedPrescriptionCount = 0;
  const changedSessionIds = new Set<string>();

  for (const request of requests) {
    const replacement = getExercise(request.replacementExerciseId);
    const original = getExercise(request.originalExerciseId);
    if (replacement === undefined || original === undefined) continue;

    for (const week of next.weeks) {
      for (const session of week.sessions) {
        const isFuture =
          week.weekNumber > afterWeek ||
          (week.weekNumber === afterWeek && session.sequence > afterSequence);
        if (!isFuture) continue;
        for (const prescription of session.exercises) {
          if (prescription.exerciseId !== request.originalExerciseId) continue;
          const validChoice = prescription.alternativeChoices.some(
            (choice) => choice.exerciseId === request.replacementExerciseId,
          );
          if (!validChoice) continue;

          prescription.exerciseId = replacement.id;
          prescription.name = replacement.name;
          prescription.performanceSeriesId = `${replacement.id}:replacement:${prescription.contextRole ?? prescription.purpose}`;
          delete prescription.load;
          delete prescription.percentE1rm;
          prescription.progression = {
            method: "calibration",
            instruction: `Complete ${prescription.sets} sets of ${prescription.reps.min} reps at ${prescription.targetRir.min} RIR. Start with a light load for set 1 and log the load that meets this target; this exercise uses its own history.`,
          };
          prescription.alternativeChoices = [
            ...prescription.alternativeChoices.filter(
              (choice) => choice.exerciseId !== replacement.id,
            ),
            {
              exerciseId: original.id,
              name: original.name,
              score: 0,
              tradeoff: "Return to the exercise that was originally planned.",
            },
          ].filter(
            (choice, index, all) =>
              all.findIndex(
                (candidate) => candidate.exerciseId === choice.exerciseId,
              ) === index,
          );
          prescription.explanation = `${replacement.name} replaces ${original.name} in future workouts. Use the same sets, reps, and effort, but establish a separate starting weight.`;
          prescription.ruleIds = unique([
            ...prescription.ruleIds,
            "EX-2",
            "EX-3",
            "ADAPT-4",
          ]);
          changedPrescriptionCount += 1;
          changedSessionIds.add(session.id);
        }
      }
    }
  }

  if (changedPrescriptionCount === 0)
    return { program: next, changedPrescriptionCount: 0 };
  if (input !== undefined) {
    refreshProgramSetBlocks(next, input, (session) =>
      changedSessionIds.has(session.id),
    );
  } else {
    for (const session of next.weeks.flatMap((week) => week.sessions)) {
      if (!changedSessionIds.has(session.id)) continue;
      sanitizeSessionSetBlocks(session);
      recalculateSessionDuration(session);
      delete session.durationAlternative;
    }
  }
  next.version = program.version + 1;
  next.originEngineVersion ??= program.engineVersion;
  next.originPolicyVersion ??= program.policyVersion;
  next.engineVersion = ENGINE_VERSION;
  next.policyVersion = POLICY_VERSION;
  for (const week of next.weeks.filter((week) =>
    week.sessions.some((session) => changedSessionIds.has(session.id)),
  ))
    refreshWeekDoseLedger(week);
  next.triggeredRuleIds = unique([
    ...next.triggeredRuleIds,
    "EX-2",
    "EX-3",
    "ADAPT-4",
  ]);
  next.explanation = `${program.explanation} Version ${next.version} carries the selected exercise replacement into later workouts while keeping its load history separate.`;
  return { program: next, changedPrescriptionCount };
}

/**
 * Creates an immutable program version for a temporary facility. The original
 * exercise series is restored outside the selected week range, and replacement
 * loads are deliberately not inferred from the original implement.
 */
export function createEquipmentVariant(
  program: TrainingProgram,
  input: QuestionnaireInput,
  equipment: Equipment[],
  fromWeek: number,
  toWeek = fromWeek,
): EquipmentVariantResult {
  const next = structuredClone(program);
  const warnings: EquipmentVariantResult["warnings"] = [];
  const changes: AdaptationChange[] = [];

  for (const week of next.weeks.filter(
    (item) => item.weekNumber >= fromWeek && item.weekNumber <= toWeek,
  )) {
    for (const session of week.sessions) {
      let sessionChanged = false;
      for (const prescription of session.exercises) {
        const current = getExercise(prescription.exerciseId);
        if (
          current === undefined ||
          isExerciseEligible(current, input, equipment)
        )
          continue;
        const explicitAlternatives = current.alternatives
          .map((id) => getExercise(id))
          .filter(
            (item): item is NonNullable<typeof item> => item !== undefined,
          )
          .filter((item) => isExerciseEligible(item, input, equipment));
        const ranked =
          explicitAlternatives.length > 0
            ? explicitAlternatives
            : rankExercises(
                input,
                {
                  purpose:
                    current.exerciseClass === "competition"
                      ? "hypertrophy"
                      : prescription.purpose,
                  patterns: current.patterns,
                  ...(current.primaryMuscles.length === 0
                    ? {}
                    : { muscles: current.primaryMuscles }),
                  maximumFatigue: current.fatigue,
                },
                equipment,
              );
        const replacement = ranked[0];
        if (replacement === undefined) {
          warnings.push({
            code: `travel-no-replacement-${prescription.exerciseId}`,
            severity: "warning",
            message: `No purpose-valid temporary replacement is available for ${prescription.name}; that slot was omitted for week ${week.weekNumber}.`,
            ruleIds: ["EX-1", "EX-3"],
          });
          session.exercises = session.exercises.filter(
            (item) => item.id !== prescription.id,
          );
          sessionChanged = true;
          changes.push({
            type: "exercise",
            target: prescription.id,
            before: prescription.name,
            after: "Omitted: no eligible equipment-specific replacement",
            reason:
              "No eligible alternative is available; do not improvise an unsupported replacement or make up the omitted work.",
            ruleIds: ["EX-1", "EX-3"],
            applied: true,
            engineVersion: ENGINE_VERSION,
            policyVersion: POLICY_VERSION,
          });
          continue;
        }
        const originalName = prescription.name;
        prescription.exerciseId = replacement.id;
        prescription.performanceSeriesId = `${replacement.id}:temporary-equipment`;
        prescription.name = replacement.name;
        delete prescription.load;
        delete prescription.percentE1rm;
        prescription.progression = {
          method: "calibration",
          instruction: `Complete ${prescription.sets} sets of ${prescription.reps.min} reps at ${prescription.targetRir.min} RIR. Calibrate this replacement with a light first set and log its own load; do not transfer the original load.`,
        };
        prescription.alternativeChoices = choiceCandidates(
          ranked.filter((item) => item.id !== replacement.id),
        );
        prescription.explanation = `${replacement.name} is a temporary replacement for ${originalName}. Start with a lighter weight and use the prescribed reps and effort to find the right load; weights from the original exercise do not transfer directly.`;
        prescription.ruleIds = unique([
          ...prescription.ruleIds,
          "EX-2",
          "EX-3",
        ]);
        changes.push({
          type: "exercise",
          target: prescription.id,
          before: originalName,
          after: replacement.name,
          reason: `Equipment for ${originalName} is unavailable during week ${week.weekNumber}; the replacement starts a separate load series.`,
          ruleIds: ["EX-1", "EX-2", "EX-3"],
          applied: true,
          engineVersion: ENGINE_VERSION,
          policyVersion: POLICY_VERSION,
        });
        sessionChanged = true;
        if (current.exerciseClass === "competition") {
          warnings.push({
            code: `travel-specificity-${prescription.id}`,
            severity: "warning",
            message: `${replacement.name} maintains relevant training but does not replace ${originalName} skill specificity.`,
            ruleIds: ["EX-2", "EX-3"],
          });
        }
      }
      if (sessionChanged) refreshSessionSetBlocks(session, input);
    }
    refreshWeekDoseLedger(week);
  }

  if (changes.length > 0) {
    next.version = program.version + 1;
    next.originEngineVersion ??= program.engineVersion;
    next.originPolicyVersion ??= program.policyVersion;
    next.engineVersion = ENGINE_VERSION;
    next.policyVersion = POLICY_VERSION;
    next.triggeredRuleIds = unique([
      ...next.triggeredRuleIds,
      "EX-1",
      "EX-2",
      "EX-3",
      "ADAPT-4",
    ]);
    next.explanation = `${program.explanation} Version ${next.version} uses a temporary equipment-specific exercise resolution for weeks ${fromWeek}–${toWeek}; loads and histories remain separate.`;
  }
  return {
    program: changes.length > 0 ? next : program,
    changedExerciseCount: changes.length,
    warnings,
    changes,
    explanation:
      changes.length > 0
        ? `Changed ${changes.length} exercise prescriptions only inside weeks ${fromWeek}–${toWeek}; the original plan remains intact elsewhere.`
        : "All prescribed exercises are already eligible with the temporary equipment.",
  };
}
