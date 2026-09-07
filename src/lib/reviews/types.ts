import type { Json } from "$lib/database.types";
import type {
  AdaptationChange,
  AdaptationSafetySignal,
  DayOfWeek,
  EngineWarning,
  GoalDomain,
  WeeklyState,
  WearableAdaptationContext,
} from "$lib/domain";

export type WeeklyReviewDecision = "applied" | "kept" | "no_change";

export interface WeeklyReviewMetrics {
  weekNumber: number;
  plannedSessions: number;
  completedSessions: number;
  partialSessions: number;
  skippedSessions: number;
  plannedSets: number;
  completedSets: number;
  requiredPlannedSets: number;
  requiredCompletedSets: number;
  accessoryPlannedSets: number;
  accessoryCompletedSets: number;
  plannedCardioMinutes: number;
  completedCardioMinutes: number;
  cardioDistance: number;
  cardioDistanceUnit: "mi" | "km";
  cardioSteps: number;
  cardioMovingMinutes?: number;
  plannedCardioIntervals?: number;
  completedCardioIntervals?: number;
  qualityCardioMinutes?: number;
  longestCardioDistance?: number;
  cardioElevationGain?: number;
  cardioElevationUnit?: "ft" | "m";
  wearable?: WearableAdaptationContext;
}

export interface WeeklyReviewSnapshot {
  schemaVersion: 1;
  reviewedAt: string;
  state: WeeklyState;
  confidence: "low" | "moderate" | "high";
  explanation: string;
  changes: AdaptationChange[];
  safetySignals?: AdaptationSafetySignal[];
  warnings: EngineWarning[];
  reviewedWeeks: number[];
  triggeredRuleIds: string[];
}

export type ReviewItemStatus =
  | "completed"
  | "overperformed"
  | "partial"
  | "skipped"
  | "pain"
  | "not_planned";

export interface ReviewExerciseBreakdown {
  id: string;
  name: string;
  role: "primary" | "accessory";
  status: ReviewItemStatus;
  completedSets: number;
  plannedSets: number;
}

export interface ReviewCardioBreakdown {
  status: ReviewItemStatus;
  name: string;
  completedMinutes: number;
  plannedMinutes: number;
  distance?: number;
  distanceUnit?: "mi" | "km";
  steps?: number;
  movingMinutes?: number;
  completedIntervals?: number;
  plannedIntervals?: number;
  averageHeartRate?: number;
}

export interface ReviewSessionBreakdown {
  id: string;
  title: string;
  kind: "lifting" | "cardio" | "combined";
  status: ReviewItemStatus;
  exercises: ReviewExerciseBreakdown[];
  cardio?: ReviewCardioBreakdown;
}

export interface ReviewDayBreakdown {
  key: DayOfWeek | `day-${number}`;
  label: string;
  isoDate?: string;
  sessions: ReviewSessionBreakdown[];
}

export type ReviewMarkRole = "primary" | "secondary" | "cardio";

/** One compact, accessible status mark in the weekly review calendar. */
export interface ReviewStatusMark {
  id: string;
  label: string;
  role: ReviewMarkRole;
  status: ReviewItemStatus;
}

export interface ReviewMessage {
  code: string;
  tone: "celebration" | "encouragement" | "neutral" | "safety";
  title: string;
  body: string;
}

export interface ReviewChartSeries {
  label: string;
  color: string;
  values: number[];
}

export interface ReviewChart {
  id: string;
  title: string;
  unit: string;
  weeks: number[];
  series: ReviewChartSeries[];
  goal: GoalDomain;
}

export interface WeeklyReview {
  id: string;
  programId: string;
  weekNumber: number;
  sourceProgramVersion: number;
  resultProgramVersion: number;
  decision: WeeklyReviewDecision;
  state: WeeklyState;
  confidence: "low" | "moderate" | "high";
  metrics: WeeklyReviewMetrics;
  result: WeeklyReviewSnapshot;
  createdAt: string;
}

export interface WeeklyReviewDatabaseRow {
  id: string;
  program_id: string;
  week_number: number;
  source_program_version: number;
  result_program_version: number;
  decision: string;
  state: string;
  confidence: string;
  metrics: Json;
  result: Json;
  created_at: string;
}
