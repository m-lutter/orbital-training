export type IsoDate = `${number}-${number}-${number}`;
export type UnitSystem = "lb" | "kg";
export type GoalDomain = "powerlifting" | "hypertrophy" | "cardio" | "health";
export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type Equipment =
  | "bodyweight"
  | "barbell"
  | "rack"
  | "bench"
  | "plates"
  | "dumbbells"
  | "cables"
  | "machines"
  | "smith_machine"
  | "pullup_bar"
  | "bands"
  | "cardio_bike"
  | "treadmill"
  | "rower"
  | "elliptical"
  | "pool"
  | "outdoors";

export type MovementPattern =
  | "squat"
  | "hinge"
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "knee_flexion"
  | "elbow_flexion"
  | "elbow_extension"
  | "lateral_raise"
  | "calf_raise"
  | "trunk"
  | "carry"
  | "locomotion";

export type Muscle =
  | "chest"
  | "upper_chest"
  | "lats"
  | "upper_back"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "biceps"
  | "triceps"
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "trunk";

export interface WeightTrackingInput {
  initialBodyWeight?: number;
  ignoreAfterInitial: boolean;
  dietGoal: "gain" | "maintain" | "lose" | "no_goal";
  weeklyCheckIns: boolean;
}

export interface SafetyInput {
  disclaimerAccepted: boolean;
  allowOperationalRestrictions: boolean;
  excludedExercises: string[];
  excludedMovements: MovementPattern[];
  restrictedBodyAreas: string[];
  clinicianRestrictions: string[];
}

export interface GoalInput {
  primary: GoalDomain;
  secondary?: GoalDomain;
  primaryWeight: 50 | 60 | 70 | 80 | 90 | 100;
  startDate: IsoDate;
  horizon: { kind: "fixed"; weeks: number } | { kind: "indefinite" };
  event?: {
    type: "powerlifting_meet" | "mock_meet" | "race" | "sport_event" | "other";
    date: IsoDate;
    certainty: "confirmed" | "likely" | "tentative";
  };
}

export interface ScheduleInput {
  liftingDaysPerWeek: number;
  planningStyle: "flexible_sequence" | "calendar_days";
  preferredTrainingDays: DayOfWeek[];
  unavailableDays: DayOfWeek[];
  targetLiftMinutes: number;
  targetCardioMinutes: number;
  cardioFocusedDays: DayOfWeek[];
  advanced?: {
    minimumTrainingDays: number;
    splitSessionDays: DayOfWeek[];
    allowCombinedSessions?: boolean;
    allowSeparateSameDay?: boolean;
    durationPolicy: "allow_exceed" | "trim_low_priority" | "offer_shorter";
  };
}

export interface TrainingHistoryInput {
  resistanceTrainingYears: number;
  recentConsistency: "none" | "sporadic" | "one_to_two" | "three_plus";
  effortFamiliarity: "none" | "basic" | "confident";
  effortReporting: "rpe" | "rir" | "auto" | "verbal";
  recentSessionsPerWeek?: number;
  recentHardSetsPerMuscle?: Partial<Record<Muscle, number>>;
}

export interface FacilityInput {
  primaryEquipment: Equipment[];
  alternateEquipment?: Equipment[];
  dumbbellIncrement?: number;
  barbellIncrement?: number;
  substitutionApproval: "recommend_then_ask" | "automatic" | "manual_only";
}

export interface RecoveryInput {
  typicalSleepHours:
    "<6" | "6" | "6.5" | "7" | "7.5" | "8" | "8.5" | "9" | "9.5" | "10" | ">10";
  nightsBelowSixPerWeek: number;
  workActivity: "sedentary" | "light" | "moderate" | "heavy";
  rotatingOrNightShifts: boolean;
  playsSport: boolean;
  sport?: string;
  sportHoursPerWeek?: number;
  sportLowerBodyDemandSessions?: number;
}

export interface GeneralFitnessInput {
  emphasis: "balanced" | "strength" | "aerobic" | "mobility" | "function";
  /** Optional for compatibility with programs saved before this preference existed. */
  preserveCompetitionLifts?: boolean;
  chairStandConcern: boolean;
  balanceConcern: boolean;
  floorTransferConcern: boolean;
  dailyWalkingMinutes?: number;
  baselineSteps?: number;
}

export interface DailyMovementInput {
  trackingMethod: "wearable" | "phone" | "other_pedometer" | "none";
  /** Approximate baseline is sufficient; targets deliberately use coarse increments. */
  baselineSteps?: number;
  baselineWalkingMinutes?: number;
}

export type PowerliftingGoal =
  | "general_powerlifting"
  | "return_to_powerlifting"
  | "meet_prep"
  | "peak_or_test"
  | "work_capacity"
  | "powerlifting_hypertrophy"
  | "squat_specialization"
  | "bench_specialization"
  | "deadlift_specialization"
  | "lower_specialization"
  | "upper_specialization";

export interface PerformanceObservation {
  load: number;
  reps: number;
  rir?: number;
  rpe?: number;
  date: IsoDate;
  stableTechnique: boolean;
  completed: boolean;
}

export interface PowerliftingInput {
  goal: PowerliftingGoal;
  squatStyle: "high_bar" | "low_bar";
  benchStyle: "standard" | "close_grip" | "wide_grip";
  deadliftStyle: "conventional" | "sumo";
  competitionStyle: "raw_sleeves" | "raw_wraps" | "equipped";
  /** Powerlifting programs always preserve the competition lifts. */
  preserveCompetitionLifts: boolean;
  observations: Partial<
    Record<"squat" | "bench" | "deadlift", PerformanceObservation[]>
  >;
  advanced?: {
    squatFrequencyPreference?: number;
    benchFrequencyPreference?: number;
    deadliftFrequencyPreference?: number;
    trainingMaxPercent?: number;
  };
}

export type HypertrophySplit =
  | "auto"
  | "full_body"
  | "upper_lower"
  | "push_pull"
  | "ppl"
  | "ppl_upper_lower"
  | "arnold"
  | "torso_limbs"
  | "body_part"
  | "priority_hybrid";

export interface MusclePriority {
  muscle: Muscle;
  rank: 1 | 2 | 3;
}

export interface HypertrophyInput {
  splitPreference: HypertrophySplit;
  splitPreferenceStrength: "engine_decide" | "slight" | "strong";
  balance: "balanced" | "prioritized";
  musclePriorities: MusclePriority[];
  specializationBias?: "arms" | "chest" | "back" | "legs" | "delts";
  preserveCompetitionLifts: boolean;
  exerciseSelection: "engine_decide" | "offer_choices" | "user_selects";
  useSupersets?: boolean;
  advanced?: {
    targetFrequencyPerMuscle?: number;
  };
}

export type CardioModality =
  | "walking"
  | "running"
  | "cycling"
  | "rowing"
  | "elliptical"
  | "swimming"
  | "rucking"
  | "sport";

export type CardioPlanType = "general" | "running_event" | "vo2max";
export type RunningEventDistance = "5k" | "10k" | "half_marathon" | "marathon";
export type RunningGoalOutcome =
  "finish" | "comfortable_finish" | "improve_pb" | "target_time";
export type CardioSessionRole =
  "recovery" | "easy" | "steady" | "long" | "tempo" | "intervals" | "benchmark";

export interface CardioBenchmarkInput {
  type: "timed_distance" | "twelve_minute" | "wearable_vo2max";
  date?: IsoDate;
  distance?: number;
  distanceUnit?: "mi" | "km" | "m" | "yd";
  timeMinutes?: number;
  wearableVo2max?: number;
}

export interface RunningBaselineInput {
  runsPerWeek: number;
  weeklyDistance?: number;
  distanceUnit: "mi" | "km";
  weeklyMinutes?: number;
  longestRunDistance?: number;
  longestRunMinutes?: number;
  continuousRunMinutes?: number;
  benchmark?: CardioBenchmarkInput;
}

export interface CardioGoalInput {
  type: CardioPlanType;
  generalFocus?: "health" | "aerobic_base" | "performance";
  runningEvent?: {
    distance: RunningEventDistance;
    outcome: RunningGoalOutcome;
    targetTimeMinutes?: number;
    recentBestMinutes?: number;
    surface: "road" | "track" | "trail" | "treadmill" | "mixed";
    routeProfile: "flat" | "rolling" | "hilly" | "unknown";
  };
  vo2max?: {
    modality: CardioModality;
    benchmark?: CardioBenchmarkInput;
  };
}

export interface CardioInput {
  purpose:
    | "health"
    | "aerobic_base"
    | "performance"
    | "lifting_support"
    | "recovery"
    | "sport_support";
  currentEasySessions: number;
  currentModerateSessions: number;
  currentHardSessions: number;
  typicalEasyMinutes: number;
  typicalModerateMinutes: number;
  typicalHardMinutes: number;
  longestRecentSessionMinutes: number;
  preferredModalities: CardioModality[];
  varietyPreference?: "mostly_primary" | "regular_variety" | "broad_mix";
  avoidRunning: boolean;
  heartRateDevice: "none" | "smartwatch" | "chest_strap" | "other";
  knownMaxHeartRate?: number;
  /** Optional so questionnaire-v3 programs saved before goal-specific cardio remain readable. */
  goal?: CardioGoalInput;
  /** Running-specific capacity is collected only when it changes the prescription. */
  runningBaseline?: RunningBaselineInput;
  advanced?: {
    weeklyMinutes?: number;
    restingHeartRate?: number;
    intensityMethod?: "talk_test_rpe" | "heart_rate_reserve" | "pace_power";
    maxHardSessions?: number;
  };
}

export interface AdaptationPreferenceInput {
  applyChanges: "automatic" | "ask_first";
  missedWorkoutPolicy: "preserve_weekdays_drop_low_priority" | "reflow_week";
  amrapPolicy: "none" | "controlled" | "max_effort";
  durationPolicy: "allow_exceed" | "trim_low_priority" | "offer_shorter";
  substitutionPolicy: "recommend_then_ask" | "automatic" | "manual_only";
}

export interface QuestionnaireInput {
  asOfDate: IsoDate;
  timeZone: string;
  age: number;
  units: UnitSystem;
  weight: WeightTrackingInput;
  safety: SafetyInput;
  goals: GoalInput;
  schedule: ScheduleInput;
  history: TrainingHistoryInput;
  facility: FacilityInput;
  recovery: RecoveryInput;
  /** Optional so programs saved before daily movement became goal-independent remain readable. */
  dailyMovement?: DailyMovementInput;
  generalFitness?: GeneralFitnessInput;
  powerlifting?: PowerliftingInput;
  hypertrophy?: HypertrophyInput;
  cardio: CardioInput;
  adaptation: AdaptationPreferenceInput;
}

export type Phase =
  | "reentry"
  | "base"
  | "hypertrophy"
  | "work_capacity"
  | "strength"
  | "specificity"
  | "peak"
  | "taper"
  | "aerobic_base"
  | "cardio_build"
  | "review";

export type Lift = "squat" | "bench" | "deadlift";
export type ExerciseClass =
  "competition" | "compound" | "stable_compound" | "isolation" | "trunk";
export type ExercisePurpose =
  | "competition_skill"
  | "strength"
  | "hypertrophy"
  | "low_fatigue_volume"
  | "general_function"
  | "trunk";

export interface ExerciseDefinition {
  id: string;
  name: string;
  patterns: MovementPattern[];
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  equipmentAlternatives: Equipment[][];
  exerciseClass: ExerciseClass;
  purposes: ExercisePurpose[];
  lift?: Lift;
  specificity: 0 | 1 | 2 | 3;
  fatigue: 1 | 2 | 3;
  unilateral?: boolean;
  partialSubstitute?: boolean;
  /** How a logged load should be described to the athlete. */
  loadType?: "external" | "added_to_bodyweight";
  alternatives: string[];
}

export interface BaselineEstimate {
  lift: Lift;
  e1rm?: number;
  confidence: "low" | "moderate" | "high";
  source: "observations" | "calibration_required";
  observationCount: number;
}

export interface ChoiceCandidate {
  exerciseId: string;
  name: string;
  score: number;
  tradeoff: string;
}

export interface ExercisePrescription {
  id: string;
  exerciseId: string;
  performanceSeriesId: string;
  /** Internal comparability context; displayed targets remain exact. */
  contextRole?: string;
  phase?: Phase;
  name: string;
  purpose: ExercisePurpose;
  sets: number;
  reps: { min: number; max: number };
  targetRir: { min: number; max: number };
  percentE1rm?: number;
  load?: number;
  restSeconds: number;
  priority: number;
  optional: boolean;
  skipRule?: string;
  amrapStopRir?: number;
  progression: {
    method: "percentage_wave" | "double_progression" | "calibration";
    instruction: string;
    /** Internal progression bounds, not a substitute for the exact reps above. */
    repFloor?: number;
    repCeiling?: number;
    requiredSuccessfulExposures?: number;
  };
  alternativeChoices: ChoiceCandidate[];
  explanation: string;
  ruleIds: string[];
}

export type SetBlockType = "straight" | "paired_superset";

export interface SetBlockSequenceItem {
  prescriptionId: string;
  orderLabel: string;
}

/**
 * First-class workout order. A paired block is an A1/A2 prescription, not a
 * user-created relationship between otherwise independent exercise cards.
 */
export interface SetBlock {
  id: string;
  type: SetBlockType;
  sequence: SetBlockSequenceItem[];
  rounds: number;
  transitionSeconds: number;
  interRoundRestSeconds: number;
  sameExerciseRecoveryMinimumSeconds: number;
  stopRule?: string;
  fallback: "unpair";
  methodPolicyVersion: string;
  rationaleCode:
    "straight_default" | "antagonist_accessory" | "noncompeting_accessory";
  evidenceTag: "supported" | "cautious";
  estimatedTimeSavedMinutes: number;
  instruction: string;
}

export interface CardioPrescription {
  modality: CardioModality;
  intensity: "easy" | "moderate" | "hard";
  minutes: number;
  /** Optional for programs generated before goal-specific cardio roles existed. */
  role?: CardioSessionRole;
  eventPhase?: "base" | "build" | "specific" | "taper";
  targetDistance?: { value: number; unit: "mi" | "km" };
  paceTarget?: {
    minSecondsPerUnit: number;
    maxSecondsPerUnit: number;
    unit: "mi" | "km";
    basis: "recent_best" | "target_time" | "benchmark";
  };
  segments?: {
    kind: "warmup" | "work" | "recovery" | "cooldown";
    label: string;
    minutes?: number;
    distance?: number;
    distanceUnit?: "mi" | "km";
    repeats?: number;
    intensity: "easy" | "moderate" | "hard";
  }[];
  intervals?: { workSeconds: number; recoverySeconds: number; repeats: number };
  talkTest: string;
  sessionRpe: { min: number; max: number };
  heartRateBpm?: {
    target?: number;
    min: number;
    max: number;
    method: "heart_rate_reserve" | "percent_max";
  };
  placement: string;
  ruleIds: string[];
}

export interface TrainingSession {
  id: string;
  weekNumber: number;
  sequence: number;
  day?: DayOfWeek;
  /** Authoritative date for new programs; legacy programs use date projection. */
  occurrenceDate?: IsoDate;
  kind: "lifting" | "cardio" | "combined" | "movement";
  title: string;
  objective: string;
  exercises: ExercisePrescription[];
  /** Optional so programs saved before set blocks remain readable. */
  setBlocks?: SetBlock[];
  cardio?: CardioPrescription;
  movementTarget?: {
    steps?: number;
    walkingMinutes?: number;
    explanation: string;
  };
  predictedMinutes: number;
  targetMinutes: number;
  durationStatus: "fits" | "guideline_exceeded" | "infeasible";
  durationAlternative?: {
    targetMinutes: number;
    predictedMinutes: number;
    exerciseIds: string[];
    prescriptions: { prescriptionId: string; sets: number }[];
    explanation: string;
  };
  explanation: string;
}

export interface ProgramWeek {
  weekNumber: number;
  phase: Phase;
  sessions: TrainingSession[];
  hardSetBudget: number;
  doseLedger?: {
    muscle: Muscle;
    directSets: number;
    indirectSets: number;
    effectiveSets: number;
    targetMin: number;
    targetMax: number;
    status: "within_target" | "below_target" | "above_target";
  }[];
  explanation: string;
}

export interface QuestionEffect {
  path: string;
  answer: string;
  effect: string;
  support: string;
  ruleIds: string[];
  used: boolean;
  classification?: "behavioral" | "validation_only" | "metadata" | "deferred";
}

export interface EngineWarning {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  ruleIds: string[];
}

export interface TrainingProgram {
  id: string;
  version: number;
  engineVersion: string;
  policyVersion: string;
  originEngineVersion?: string;
  originPolicyVersion?: string;
  /** Opt-in relational contract for newly generated payloads; absent on legacy plans. */
  integrityVersion?: 1;
  effectiveScheduleStartDate?: IsoDate;
  generatedForDate: IsoDate;
  inputFingerprint: string;
  status: "ready" | "needs_input" | "infeasible";
  goalContract: string;
  horizonWeeks: number;
  rolling: boolean;
  loadSettings: {
    units: UnitSystem;
    barbellIncrement: number;
    dumbbellIncrement: number;
  };
  adaptationSettings: AdaptationPreferenceInput;
  loggingPlan: {
    setFields: string[];
    effortPrompt: string;
    sessionFields: string[];
    cardioFields: string[];
    movementFields?: string[];
    weeklyReviewFields: string[];
    bodyweightCheckIn: "disabled" | "optional_weekly";
  };
  selectedSplit?: string;
  baselines: BaselineEstimate[];
  weeks: ProgramWeek[];
  questionEffects: QuestionEffect[];
  warnings: EngineWarning[];
  unresolvedChoices: string[];
  triggeredRuleIds: string[];
  reviewFingerprints: string[];
  adaptationEvidenceConsumedThrough?: Record<string, number>;
  explanation: string;
}

export type MissReason =
  | "time"
  | "schedule"
  | "travel"
  | "too_hard"
  | "soreness"
  | "pain"
  | "equipment"
  | "preference"
  | "unknown";

export interface CompletedSet {
  reps: number;
  load?: number;
  rir?: number;
  rpe?: number;
  completed: boolean;
  techniqueOkay?: boolean;
  pain?: boolean;
}

export type PainImpact =
  "noticed" | "modified" | "stopped_exercise" | "stopped_workout";
export type PainOnset = "gradual" | "sudden" | "accident" | "unsure";
export type PainBaseline = "new" | "familiar" | "familiar_worse" | "unsure";
export type PainFollowUp =
  "not_checked" | "normal" | "better" | "same" | "worse" | "affects_daily_life";

/** Training feedback only; this is deliberately not a diagnosis. */
export interface PainEvent {
  impact: PainImpact;
  severity?: number;
  onset?: PainOnset;
  baseline?: PainBaseline;
  bodyArea?: string;
  followUp?: PainFollowUp;
  urgentWarningSigns?: boolean;
}

export interface ExerciseLog {
  prescriptionId: string;
  exerciseId: string;
  performanceSeriesId?: string;
  prescriptionContext?: {
    purpose: ExercisePurpose;
    phase?: Phase;
    contextRole?: string;
    reps: { min: number; max: number };
    targetRir: { min: number; max: number };
    load?: number;
    percentE1rm?: number;
  };
  sets: CompletedSet[];
  missReason?: MissReason;
  painEvent?: PainEvent;
}

export interface SessionLog {
  sessionId: string;
  programVersion?: number;
  status: "completed" | "partial" | "skipped";
  durationMinutes?: number;
  missReason?: MissReason;
  exercises: ExerciseLog[];
  cardioCompletedMinutes?: number;
  cardioModality?: CardioModality;
  cardioPrescribedModality?: CardioModality;
  cardioSessionRpe?: number;
  cardioDistance?: number;
  cardioDistanceUnit?: "mi" | "km";
  cardioSteps?: number;
  cardioMovingMinutes?: number;
  cardioCompletedIntervals?: number;
  cardioAverageHeartRate?: number;
  cardioMaxHeartRate?: number;
  cardioElevationGain?: number;
  cardioElevationUnit?: "ft" | "m";
  cardioSurface?: "road" | "track" | "trail" | "treadmill" | "mixed" | "other";
  cardioSource?: "manual" | "watch" | "treadmill" | "bike" | "other";
  movementTargetMet?: boolean;
  priorDaySteps?: number;
  priorDayWalkingMinutes?: number;
}

export interface WeekLog {
  weekNumber: number;
  sessions: SessionLog[];
}

export type WeeklyState =
  | "on_track"
  | "underloaded"
  | "physiologically_overloaded"
  | "time_infeasible"
  | "schedule_infeasible"
  | "exercise_mismatch"
  | "safety_constrained"
  | "insufficient_data";

export interface AdaptationChange {
  engineVersion?: string;
  policyVersion?: string;
  type:
    | "load"
    | "reps"
    | "sets"
    | "effort"
    | "exercise"
    | "schedule"
    | "cardio"
    | "movement"
    | "hold";
  target: string;
  before?: string;
  after?: string;
  reason: string;
  ruleIds: string[];
  applied: boolean;
}

export interface AdaptationSafetySignal {
  exerciseId: string;
  level:
    "monitor" | "modify_next" | "replace_temporarily" | "stop_and_seek_care";
  title: string;
  message: string;
}

/**
 * A deliberately small, provider-neutral recovery trend. Detailed health
 * records never enter the programming engine; only week-vs-baseline summaries
 * can act as secondary evidence.
 */
export interface WearableAdaptationContext {
  averageHeartRateVariabilityMs?: number;
  averageRestingHeartRateBpm?: number;
  averageSleepMinutes?: number;
  baselineDays: number;
  baselineHeartRateVariabilityMs?: number;
  baselineRestingHeartRateBpm?: number;
  baselineSleepMinutes?: number;
  caution: boolean;
  currentDays: number;
  reasons: string[];
  source: string;
}

export interface AdaptationResult {
  state: WeeklyState;
  confidence: "low" | "moderate" | "high";
  reviewedWeeks: number[];
  program: TrainingProgram;
  changes: AdaptationChange[];
  safetySignals: AdaptationSafetySignal[];
  explanation: string;
  warnings: EngineWarning[];
  triggeredRuleIds: string[];
}

export interface ValidationIssue {
  path: string;
  severity: "warning" | "blocking";
  message: string;
  ruleIds: string[];
}

export interface GenerationResult {
  program?: TrainingProgram;
  issues: ValidationIssue[];
}

export interface EquipmentVariantResult {
  program: TrainingProgram;
  changedExerciseCount: number;
  warnings: EngineWarning[];
  changes: AdaptationChange[];
  explanation: string;
}
