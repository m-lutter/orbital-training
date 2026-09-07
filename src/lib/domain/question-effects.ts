import { RULES } from "./policy.js";
import type { QuestionEffect, QuestionnaireInput } from "./types.js";
import { answerSummary, valueAtPath } from "./utils.js";

export interface QuestionEffectDefinition {
  path: string;
  effect: string;
  ruleIds: string[];
  branch?: "powerlifting" | "hypertrophy" | "health";
}

const q = (
  path: string,
  effect: string,
  ruleIds: string[],
  branch?: QuestionEffectDefinition["branch"],
): QuestionEffectDefinition =>
  branch === undefined
    ? { path, effect, ruleIds }
    : { path, effect, ruleIds, branch };

/**
 * This is the auditable questionnaire contract. Every value accepted by the
 * engine has a classified contract here. Metadata/deferred fields must not be
 * reported as programming decisions merely because a value was supplied.
 */
export const QUESTION_EFFECT_DEFINITIONS: QuestionEffectDefinition[] = [
  q(
    "asOfDate",
    "Provides the explicit clock for date validation and deterministic generation; it never uses the server clock.",
    ["HORIZON-1"],
  ),
  q(
    "timeZone",
    "Defines local day and week boundaries for future scheduling, logging, and weekly reviews.",
    ["HORIZON-1", "ADAPT-4"],
  ),
  q(
    "age",
    "Limits automated programming to adults ages 18–100 and adds age-aware balance and movement guidance within that scope.",
    ["AGE-1"],
  ),
  q(
    "units",
    "Controls displayed loads, default barbell increment, and implement-aware rounding.",
    ["UNITS-1"],
  ),
  q(
    "weight.initialBodyWeight",
    "Supplies optional performance context such as relative strength; it does not generate a diet prescription.",
    ["WEIGHT-1"],
  ),
  q(
    "weight.ignoreAfterInitial",
    "When true, removes all future bodyweight prompts and prevents weight trend from affecting review confidence.",
    ["WEIGHT-1"],
  ),
  q(
    "weight.dietGoal",
    "Adds context to recovery/performance explanations; it never changes calories or promises weight change.",
    ["WEIGHT-1", "REC-1"],
  ),
  q(
    "weight.weeklyCheckIns",
    "When enabled and weight is not ignored, schedules one optional weekly trend check for training context.",
    ["WEIGHT-1"],
  ),
  q(
    "safety.disclaimerAccepted",
    "Must be accepted before a ready program can be returned.",
    ["SAFE-2"],
  ),
  q(
    "safety.allowOperationalRestrictions",
    "Authorizes the engine to use disclosed restrictions only to filter or modify training.",
    ["SAFE-1", "SAFE-2"],
  ),
  q(
    "safety.excludedExercises",
    "Hard-filters named exercises from all plans and substitution candidates.",
    ["SAFE-1", "EX-1"],
  ),
  q(
    "safety.excludedMovements",
    "Hard-filters every exercise sharing an excluded movement pattern.",
    ["SAFE-1", "EX-1"],
  ),
  q(
    "safety.restrictedBodyAreas",
    "Blocks automated programming until this restriction has been clarified by an appropriate professional; the engine does not infer a diagnosis or clearance.",
    ["SAFE-1", "SAFE-2"],
  ),
  q(
    "safety.clinicianRestrictions",
    "Blocks automated programming and progression pending professional clarification; free-text medical instructions are not interpreted automatically.",
    ["SAFE-1", "SAFE-2"],
  ),
  q(
    "goals.primary",
    "Protects this goal’s mandatory sessions, exercise specificity, and progression budget before all optional work.",
    ["GOAL-1", "DOSE-1"],
  ),
  q(
    "goals.secondary",
    "Receives the remaining time/recovery budget after the primary goal’s minimum effective work.",
    ["GOAL-1"],
  ),
  q(
    "goals.primaryWeight",
    "Controls how aggressively optional dose is allocated between primary and secondary goals; 50 means equal priority.",
    ["GOAL-1"],
  ),
  q(
    "goals.startDate",
    "Defines the first planned week and must be on or after the explicit as-of date.",
    ["HORIZON-1"],
  ),
  q(
    "goals.horizon",
    "Selects a fixed phase map or a rolling six-week plan with review checkpoints.",
    ["HORIZON-1", "HORIZON-2"],
  ),
  q(
    "goals.event",
    "Back-plans specificity and taper from a dated event; an impossible timeline is reported rather than hidden.",
    ["HORIZON-1"],
  ),
  q(
    "schedule.liftingDaysPerWeek",
    "Selects an eligible program architecture and limits the number of lifting sessions.",
    ["SPLIT-1", "DOSE-1"],
  ),
  q(
    "schedule.planningStyle",
    "Shows either recommended days of the week or a movable Day 1/Day 2 order while preserving the same evidence-based rest pattern.",
    ["SPLIT-1"],
  ),
  q(
    "schedule.preferredTrainingDays",
    "Ranks calendar placement among feasible days; it does not override unavailable days or spacing.",
    ["SPLIT-1", "CARDIO-1"],
  ),
  q(
    "schedule.unavailableDays",
    "Hard-blocks session placement on these weekdays.",
    ["SPLIT-1"],
  ),
  q(
    "schedule.targetLiftMinutes",
    "Sets the lifting-session duration guideline used by the bottom-up duration model and trimming logic.",
    ["TIME-1"],
  ),
  q(
    "schedule.targetCardioMinutes",
    "Records the engine-derived cardio duration ceiling based on the goal and recent completed cardio durations.",
    ["CARDIO-2", "TIME-1"],
  ),
  q(
    "schedule.cardioFocusedDays",
    "Ranks dedicated cardio placement while keeping hard cardio away from heavy lower-body work when possible.",
    ["CARDIO-1"],
  ),
  q(
    "schedule.advanced.minimumTrainingDays",
    "Prevents the engine from proposing a fallback architecture below this attendance preference.",
    ["SPLIT-1"],
  ),
  q(
    "schedule.advanced.splitSessionDays",
    "Allows same-day lift/cardio scheduling with a six-hour separation note on the selected days.",
    ["CARDIO-1"],
  ),
  q(
    "schedule.advanced.allowCombinedSessions",
    "Allows lifting and cardio to share one clearly labeled training day when this prevents the week from exceeding the user's available days.",
    ["CARDIO-1", "TIME-1"],
  ),
  q(
    "schedule.advanced.allowSeparateSameDay",
    "Allows same-day cardio to be performed later as a separate bout; the prescription adds a separation note and keeps lifting first when lifting is the priority.",
    ["CARDIO-1"],
  ),
  q(
    "schedule.advanced.durationPolicy",
    "Mirrors the single advanced session-duration preference so scheduling and weekly adaptation use the same rule.",
    ["TIME-1"],
  ),
  q(
    "history.resistanceTrainingYears",
    "Sets novice/experienced defaults for starting volume, calibration confidence, and exercise complexity.",
    ["BASE-2", "REC-1"],
  ),
  q(
    "history.recentConsistency",
    "Reduces starting dose after detraining and prevents old capacity from being treated as current capacity.",
    ["REC-1", "DOSE-1"],
  ),
  q(
    "history.effortFamiliarity",
    "Controls confidence in RPE/RIR-based load decisions; unfamiliar users receive verbal effort anchors.",
    ["BASE-1", "ADAPT-1"],
  ),
  q(
    "history.effortReporting",
    "Chooses the effort language shown in prescriptions and the metric expected in logs.",
    ["BASE-1", "ADAPT-1"],
  ),
  q(
    "history.recentSessionsPerWeek",
    "Advanced input that caps the first-week attendance jump and informs re-entry needs.",
    ["REC-1"],
  ),
  q(
    "history.recentHardSetsPerMuscle",
    "Advanced input that seeds muscle-specific maintenance floors and prevents abrupt volume jumps.",
    ["DOSE-2"],
  ),
  q(
    "facility.primaryEquipment",
    "Hard-filters the exercise catalog for normal sessions.",
    ["EX-1", "EX-2"],
  ),
  q(
    "facility.alternateEquipment",
    "Builds a separate temporary replacement pool for planned or one-off limited-gym sessions.",
    ["EX-2", "EX-3"],
  ),
  q(
    "facility.dumbbellIncrement",
    "Rounds dumbbell prescriptions to available jumps and favors rep progression when the jump is coarse.",
    ["UNITS-1"],
  ),
  q(
    "facility.barbellIncrement",
    "Rounds total barbell load by twice the smallest plate available; a 2.5 lb plate produces a 5 lb total change.",
    ["UNITS-1"],
  ),
  q(
    "facility.substitutionApproval",
    "Controls whether valid replacements are automatic, approval-gated, or user-selected.",
    ["EX-3"],
  ),
  q(
    "recovery.typicalSleepHours",
    "Conservatively reduces optional starting sets when typical sleep is short; mandatory skill/pattern work remains.",
    ["REC-1"],
  ),
  q(
    "recovery.nightsBelowSixPerWeek",
    "Adds recovery caution and lowers optional dose when short nights are frequent.",
    ["REC-1"],
  ),
  q(
    "recovery.workActivity",
    "Counts heavy occupational activity against optional lower-body and systemic fatigue budget.",
    ["REC-1"],
  ),
  q(
    "recovery.rotatingOrNightShifts",
    "Adds schedule flexibility and trims optional starting dose because recovery timing is less predictable.",
    ["REC-1"],
  ),
  q(
    "recovery.playsSport",
    "Reserves time and fatigue for sport instead of treating it as unlogged inactivity.",
    ["REC-1", "CARDIO-1"],
  ),
  q(
    "recovery.sport",
    "Classifies the sport’s likely cardio/impact demands only when a supported category can be recognized.",
    ["CARDIO-1"],
  ),
  q(
    "recovery.sportHoursPerWeek",
    "Reduces discretionary conditioning and optional volume as outside training demand rises.",
    ["REC-1", "CARDIO-1"],
  ),
  q(
    "recovery.sportLowerBodyDemandSessions",
    "Protects heavy lower-body lifting placement from known sport stressors.",
    ["REC-1", "CARDIO-1"],
  ),
  q(
    "dailyMovement.trackingMethod",
    "Chooses a countable step target or an equivalent walking-time target; a watch is never required.",
    ["MOVE-1"],
  ),
  q(
    "dailyMovement.baselineSteps",
    "Starts the daily target close to the reported range or average instead of imposing a universal 10,000-step goal.",
    ["MOVE-1"],
  ),
  q(
    "dailyMovement.baselineWalkingMinutes",
    "Starts a measurable walking-time target when the user cannot reliably count steps.",
    ["MOVE-1"],
  ),
  q(
    "generalFitness.emphasis",
    "Ranks strength, aerobic, mobility, or function slots within the health program while preserving a balanced minimum.",
    ["HEALTH-1"],
    "health",
  ),
  q(
    "generalFitness.preserveCompetitionLifts",
    "Keeps a small amount of squat, bench press, and deadlift practice in a general-fitness plan when powerlifting is not otherwise a goal.",
    ["DOSE-1", "EX-2", "HEALTH-1"],
    "health",
  ),
  q(
    "generalFitness.chairStandConcern",
    "Adds an early, scalable knee-dominant function slot.",
    ["HEALTH-1", "AGE-1"],
    "health",
  ),
  q(
    "generalFitness.balanceConcern",
    "Adds supported balance practice and keeps it low fatigue.",
    ["HEALTH-1", "AGE-1"],
    "health",
  ),
  q(
    "generalFitness.floorTransferConcern",
    "Adds trunk, split-stance, and floor-transfer preparation slots without diagnosing a cause.",
    ["HEALTH-1", "AGE-1"],
    "health",
  ),
  q(
    "generalFitness.dailyWalkingMinutes",
    "Seeds gradual daily movement progression from the user’s actual baseline.",
    ["CARDIO-2", "HEALTH-1"],
    "health",
  ),
  q(
    "generalFitness.baselineSteps",
    "Sets a gradual step target—normally baseline plus a small increment—rather than imposing 10,000 immediately.",
    ["CARDIO-2", "HEALTH-1"],
    "health",
  ),
  q(
    "powerlifting.goal",
    "Selects balanced development, return-to-specificity, meet prep, peaking, work capacity, hypertrophy, or bounded specialization rules.",
    ["HORIZON-1", "DOSE-1", "DOSE-2"],
    "powerlifting",
  ),
  q(
    "powerlifting.squatStyle",
    "Selects the competition squat exercise series and preserves its specificity.",
    ["EX-2", "INT-1"],
    "powerlifting",
  ),
  q(
    "powerlifting.benchStyle",
    "Selects the competition bench exercise series and preserves its specificity.",
    ["EX-2", "INT-1"],
    "powerlifting",
  ),
  q(
    "powerlifting.deadliftStyle",
    "Selects conventional or sumo competition-deadlift specificity.",
    ["EX-2", "INT-1"],
    "powerlifting",
  ),
  q(
    "powerlifting.competitionStyle",
    "Defaults to raw with sleeves and changes equipment/context labels; equipped programming remains conservatively flagged.",
    ["EX-2"],
    "powerlifting",
  ),
  q(
    "powerlifting.preserveCompetitionLifts",
    "Powerlifting selection automatically protects squat, bench press, and deadlift practice.",
    ["DOSE-1", "EX-2"],
    "powerlifting",
  ),
  q(
    "powerlifting.observations",
    "Calculates lift-specific e1RM and confidence from recent valid performances; missing lifts receive calibration.",
    ["BASE-1", "BASE-2"],
    "powerlifting",
  ),
  q(
    "powerlifting.advanced.squatFrequencyPreference",
    "Advanced preference ranks valid squat exposure counts after time, recovery, and minimum specificity are satisfied.",
    ["DOSE-1", "SPLIT-1"],
    "powerlifting",
  ),
  q(
    "powerlifting.advanced.benchFrequencyPreference",
    "Advanced preference ranks valid bench exposure counts after time, recovery, and minimum specificity are satisfied.",
    ["DOSE-1", "SPLIT-1"],
    "powerlifting",
  ),
  q(
    "powerlifting.advanced.deadliftFrequencyPreference",
    "Advanced preference ranks valid deadlift exposure counts after time, recovery, and minimum specificity are satisfied.",
    ["DOSE-1", "SPLIT-1"],
    "powerlifting",
  ),
  q(
    "powerlifting.advanced.trainingMaxPercent",
    "Optionally caps working calculations below e1RM; it cannot raise a baseline or override phase limits.",
    ["BASE-1", "INT-1"],
    "powerlifting",
  ),
  q(
    "hypertrophy.splitPreference",
    "Ranks an eligible split for the selected day count; ineligible preferences fall back with an explanation.",
    ["SPLIT-1"],
    "hypertrophy",
  ),
  q(
    "hypertrophy.splitPreferenceStrength",
    "Determines whether split preference is a tie-breaker or a strong ranking signal; hard feasibility still wins.",
    ["SPLIT-1"],
    "hypertrophy",
  ),
  q(
    "hypertrophy.balance",
    "Balanced uses even broad-region allocation; prioritized enables ranked muscle reallocation.",
    ["DOSE-2", "SPLIT-2"],
    "hypertrophy",
  ),
  q(
    "hypertrophy.musclePriorities",
    "Adds bounded sets to ranked muscles, distributed over at least two exposures when days permit.",
    ["DOSE-2", "SPLIT-2"],
    "hypertrophy",
  ),
  q(
    "hypertrophy.specializationBias",
    "Refines broad priorities such as arms, chest, back, legs, or delts into exercise-slot selection.",
    ["DOSE-2", "EX-1"],
    "hypertrophy",
  ),
  q(
    "hypertrophy.preserveCompetitionLifts",
    "Keeps low-volume squat/bench/deadlift skill exposures inside a hypertrophy plan when feasible.",
    ["DOSE-1", "EX-2"],
    "hypertrophy",
  ),
  q(
    "hypertrophy.exerciseSelection",
    "Chooses automatic selection or exposes 2–5 purpose-valid alternatives with trade-offs.",
    ["EX-1", "EX-3"],
    "hypertrophy",
  ),
  q(
    "hypertrophy.useSupersets",
    "When selected, allows one compatible accessory pair in a workout to save time. Competition lifts, demanding strength work, and AMRAPs stay separate.",
    ["SUPERSET-1", "SUPERSET-2"],
    "hypertrophy",
  ),
  q(
    "hypertrophy.advanced.targetFrequencyPerMuscle",
    "Advanced preference ranks valid exposure distributions; the engine caps it when time or per-session dose would fail.",
    ["SPLIT-2"],
    "hypertrophy",
  ),
  q(
    "cardio.purpose",
    "Selects health, base, performance, lifting-support, recovery, or sport-support cardio while preserving the primary training goal.",
    ["CARDIO-1", "CARDIO-2"],
  ),
  q(
    "cardio.goal.type",
    "Chooses a general conditioning plan, a dated running-event plan, or a VO₂max-focused plan so sessions receive a specific purpose instead of a generic cardio label.",
    ["CARDIO-2", "CARDIO-4", "CARDIO-5"],
  ),
  q(
    "cardio.goal.runningEvent",
    "Sets race distance, outcome, terrain, and any usable time goal; these determine phase, long-session emphasis, and optional pace guidance.",
    ["HORIZON-1", "CARDIO-4"],
  ),
  q(
    "cardio.goal.vo2max",
    "Selects the modality used for bounded VO₂max intervals and supplies an optional benchmark for later comparison.",
    ["CARDIO-5"],
  ),
  q(
    "cardio.runningBaseline",
    "Caps the first running week near recent frequency, distance, continuous-run ability, and longest-run tolerance before progression begins.",
    ["CARDIO-2", "CARDIO-4"],
  ),
  q(
    "cardio.currentEasySessions",
    "Seeds easy-cardio frequency from current tolerance and prevents abrupt attendance jumps.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.currentModerateSessions",
    "Seeds moderate-cardio dose and converts it to an auditable weekly total.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.currentHardSessions",
    "Caps initial hard sessions; strength/hypertrophy plans normally start with no more than one.",
    ["CARDIO-1", "CARDIO-2"],
  ),
  q(
    "cardio.typicalEasyMinutes",
    "Sets the initial easy-bout duration, capped by the desired session length.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.typicalModerateMinutes",
    "Sets the initial moderate-bout duration, capped by the desired session length.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.typicalHardMinutes",
    "Sets a conservative quality-session duration and never creates a hard session from duration alone.",
    ["CARDIO-1", "CARDIO-2"],
  ),
  q(
    "cardio.longestRecentSessionMinutes",
    "Limits starting long-session duration to a tolerable step from recent capacity.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.preferredModalities",
    "Uses the first eligible modality for most sessions and rotates only through alternatives the user marked as acceptable.",
    ["CARDIO-1"],
  ),
  q(
    "cardio.varietyPreference",
    "Sets how often acceptable alternatives rotate into easy or moderate sessions while keeping the primary modality in a strict majority and using it for hard goal-specific work.",
    ["CARDIO-1", "CARDIO-2"],
  ),
  q("cardio.avoidRunning", "Hard-filters running from cardio prescriptions.", [
    "SAFE-1",
    "CARDIO-1",
  ]),
  q(
    "cardio.heartRateDevice",
    "Enables optional heart-rate guidance for a smartwatch/chest strap; talk test and session RPE remain the default.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.knownMaxHeartRate",
    "Allows validated heart-rate reserve/zone calculations only when an objective maximum is supplied.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.advanced.weeklyMinutes",
    "Advanced input reconciles recent weekly dose with session-level answers and flags inconsistencies.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.advanced.restingHeartRate",
    "Enables heart-rate-reserve guidance when paired with a known maximum.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.advanced.intensityMethod",
    "Chooses talk test/RPE, heart-rate reserve, or pace/power language when the required data exists.",
    ["CARDIO-2"],
  ),
  q(
    "cardio.advanced.maxHardSessions",
    "Caps quality sessions below the engine’s goal-specific maximum.",
    ["CARDIO-1"],
  ),
  q(
    "adaptation.applyChanges",
    "Controls whether bounded weekly changes are applied automatically or returned as proposals.",
    ["ADAPT-3"],
  ),
  q(
    "adaptation.missedWorkoutPolicy",
    "Chooses the default future-calendar response; neither option creates catch-up debt.",
    ["ADAPT-2"],
  ),
  q(
    "adaptation.amrapPolicy",
    "Chooses whether AMRAP work is omitted, stopped with one repetition in reserve, or may reach a true max effort only in an explicitly programmed test context.",
    ["INT-3"],
  ),
  q(
    "adaptation.durationPolicy",
    "Controls whether a session may exceed its duration guideline or must shed low-priority work.",
    ["TIME-1"],
  ),
  q(
    "adaptation.substitutionPolicy",
    "Stored for compatibility; substitutions currently require explicit workout selections and do not run automatically from this preference.",
    ["EX-3"],
  ),
];

function branchIsActive(
  definition: QuestionEffectDefinition,
  input: QuestionnaireInput,
): boolean {
  if (definition.branch === undefined) return true;
  if (definition.branch === "powerlifting") {
    return (
      input.goals.primary === "powerlifting" ||
      input.goals.secondary === "powerlifting"
    );
  }
  if (definition.branch === "hypertrophy") {
    return (
      input.goals.primary === "hypertrophy" ||
      input.goals.secondary === "hypertrophy"
    );
  }
  return input.goals.primary === "health" || input.goals.secondary === "health";
}

const EFFECT_CLASSIFICATIONS: Record<
  string,
  NonNullable<QuestionEffect["classification"]>
> = {
  "weight.initialBodyWeight": "metadata",
  "weight.dietGoal": "metadata",
  "safety.disclaimerAccepted": "validation_only",
  "safety.allowOperationalRestrictions": "metadata",
  "safety.restrictedBodyAreas": "validation_only",
  "safety.clinicianRestrictions": "validation_only",
  "schedule.planningStyle": "metadata",
  "schedule.advanced.minimumTrainingDays": "validation_only",
  "history.effortFamiliarity": "metadata",
  "facility.substitutionApproval": "deferred",
  "recovery.sport": "metadata",
  "recovery.sportLowerBodyDemandSessions": "deferred",
  "powerlifting.competitionStyle": "metadata",
  "hypertrophy.splitPreferenceStrength": "deferred",
  "hypertrophy.specializationBias": "deferred",
  "hypertrophy.advanced.targetFrequencyPerMuscle": "deferred",
  "cardio.advanced.weeklyMinutes": "metadata",
  "adaptation.substitutionPolicy": "deferred",
};

const EFFECT_OVERRIDES: Record<string, string> = {
  "weight.initialBodyWeight":
    "Retained as optional profile context; it does not currently alter training dose or relative-strength calculations.",
  "weight.dietGoal":
    "Shown in the goal explanation only; it does not prescribe calories or alter training dose.",
  "safety.allowOperationalRestrictions":
    "Retained for compatibility. Consent cannot bypass unresolved body-area or clinician restrictions.",
  "schedule.planningStyle":
    "Controls schedule presentation; both styles use the same authoritative dated training sequence.",
  "schedule.preferredTrainingDays":
    "Defines permitted lifting days. The engine optimizes spacing within these selected days, excluding unavailable days.",
  "schedule.advanced.minimumTrainingDays":
    "Validated against requested training frequency; an automatic disrupted-week fallback is not yet generated.",
  "history.effortFamiliarity":
    "Retained for effort-prompt presentation; it does not change load-estimate confidence by itself.",
  "history.recentHardSetsPerMuscle":
    "Provides recent dose context for the per-muscle ledger and a conservative starting recovery adjustment.",
  "facility.substitutionApproval":
    "Stored for compatibility; workout substitutions remain explicit user selections rather than automatic decisions from this field.",
  "recovery.sport":
    "Retained as sport context; sport hours, rather than the sport name, influence the current recovery model.",
  "recovery.sportLowerBodyDemandSessions":
    "Not yet used by the schedule solver. Sport hours contribute to recovery conservatism; this count is not claimed as enforced spacing.",
  "powerlifting.competitionStyle":
    "Retained as competition context; equipment-specific suit/wrap loading models are not implemented.",
  "hypertrophy.splitPreferenceStrength":
    "Preference strength is retained but does not change split ranking; the selected split and available days determine the current template.",
  "hypertrophy.specializationBias":
    "Broad specialization label is retained; ranked muscle priorities, not this label, drive the current dose model.",
  "hypertrophy.advanced.targetFrequencyPerMuscle":
    "Retained as an advanced preference; the current split rotation determines frequency, and this numeric target is not guaranteed.",
  "cardio.goal.runningEvent":
    "Distance, outcome, and available time benchmarks inform roles and targets. Surface and route profile are retained as context, not enforced terrain-specific programming.",
  "cardio.advanced.weeklyMinutes":
    "Retained as reported baseline context; current progression uses the session-level baseline inputs.",
};

export function resolveQuestionEffects(
  input: QuestionnaireInput,
): QuestionEffect[] {
  return QUESTION_EFFECT_DEFINITIONS.map((definition) => {
    const value = valueAtPath(input, definition.path);
    const classification =
      EFFECT_CLASSIFICATIONS[definition.path] ?? "behavioral";
    const active = branchIsActive(definition, input) && value !== undefined;
    const used =
      active &&
      (classification === "behavioral" || classification === "validation_only");
    const effect = EFFECT_OVERRIDES[definition.path] ?? definition.effect;
    const sources = definition.ruleIds
      .map((ruleId) => RULES[ruleId]?.source)
      .filter((source): source is string => source !== undefined);
    return {
      path: definition.path,
      answer: answerSummary(value),
      effect: active ? effect : `Not active for this program. ${effect}`,
      support: sources.join("; "),
      ruleIds: definition.ruleIds,
      used,
      classification,
    };
  });
}
