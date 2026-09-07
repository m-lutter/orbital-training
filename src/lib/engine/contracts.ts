export const ENGINE_VERSION = "0.2.0" as const;
export const LEGACY_ENGINE_VERSION = "0.1.0" as const;
export const QUESTIONNAIRE_VERSION = 1 as const;

import type { QuestionnaireInput, TrainingProgram } from "$lib/domain";

export type PrimaryGoal =
  "powerlifting" | "hypertrophy" | "general-fitness" | "cardio";

export type ProgramLength =
  { mode: "fixed"; weeks: number } | { mode: "indefinite" };

export interface ProgramRequestV1 {
  questionnaireVersion: typeof QUESTIONNAIRE_VERSION;
  primaryGoal: PrimaryGoal;
  liftingDaysPerWeek: number;
  cardioDaysPerWeek: number;
  liftingSessionMinutes: number;
  cardioSessionMinutes: number;
  programLength: ProgramLength;
}

export interface EngineDecision {
  input: string;
  effect: string;
  support?: string;
  ruleIds?: string[];
}

// Schema v1: retained so programs created by the shell remain readable.
export interface ScheduledSession {
  id: string;
  kind: "lifting" | "cardio";
  targetMinutes: number;
}

export interface GeneratedWeek {
  weekNumber: number;
  sessions: ScheduledSession[];
}

export interface ProgramDraftV1 {
  schemaVersion: 1;
  engineVersion: string;
  strategyId: string;
  continuation: "fixed" | "rolling";
  inputSnapshot: ProgramRequestV1;
  weeks: GeneratedWeek[];
  decisions: EngineDecision[];
}

export type ExerciseCategory =
  | "competition-lift"
  | "compound"
  | "accessory"
  | "isolation"
  | "carry"
  | "core";

export interface RepRange {
  min: number;
  max: number;
}

export type EffortTarget =
  { scale: "rpe"; target: number } | { scale: "rir"; target: number };

export interface ExercisePrescription {
  id: string;
  name: string;
  category: ExerciseCategory;
  muscles: string[];
  sets: number;
  reps: RepRange;
  effort: EffortTarget;
  restSeconds: number;
  substitutions: string[];
  notes?: string;
}

export type CardioMethod =
  "recovery" | "easy-steady" | "tempo" | "intervals" | "long-easy";

export interface CardioPrescription {
  method: CardioMethod;
  modality: string;
  durationMinutes: number;
  intensityRpe: RepRange;
  structure: string;
  notes: string;
}

interface SessionBaseV2 {
  id: string;
  title: string;
  targetMinutes: number;
}

export interface LiftingSessionV2 extends SessionBaseV2 {
  kind: "lifting";
  exercises: ExercisePrescription[];
}

export interface CardioSessionV2 extends SessionBaseV2 {
  kind: "cardio";
  prescription: CardioPrescription;
}

export type TrainingSessionV2 = LiftingSessionV2 | CardioSessionV2;
export type WeekPhase = "accumulation" | "intensification" | "recovery";

export interface GeneratedWeekV2 {
  weekNumber: number;
  phase: WeekPhase;
  sessions: TrainingSessionV2[];
}

export interface ProgramDraftV2 {
  schemaVersion: 2;
  engineVersion: string;
  strategyId: string;
  continuation: "fixed" | "rolling";
  inputSnapshot: ProgramRequestV1;
  weeks: GeneratedWeekV2[];
  decisions: EngineDecision[];
}

/**
 * Schema v3 stores the full questionnaire snapshot and the deterministic,
 * stateful domain-engine output. V1 and V2 stay readable indefinitely.
 */
export interface ProgramDraftV3 {
  schemaVersion: 3;
  questionnaireVersion: 2 | 3;
  engineVersion: string;
  policyVersion: string;
  strategyId: string;
  continuation: "fixed" | "rolling";
  inputSnapshot: QuestionnaireInput;
  /**
   * Exact successful form values used to build the program. Older schema-v3
   * payloads may omit this and fall back to reconstruction from inputSnapshot.
   */
  questionnaireFormValues?: Record<string, string | string[]>;
  decisions: EngineDecision[];
  program: TrainingProgram;
}

export type ProgramDraft = ProgramDraftV1 | ProgramDraftV2 | ProgramDraftV3;
