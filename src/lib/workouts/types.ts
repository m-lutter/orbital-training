import type { Json } from "$lib/database.types";
import type {
  CardioModality,
  ExerciseLog,
  MissReason,
  PainEvent,
  TrainingSession,
} from "$lib/domain";

export type WorkoutStatus = "in_progress" | "completed" | "partial" | "skipped";

export type VerbalEffort = "easy" | "medium" | "difficult" | "impossible";

export interface LoggedSet {
  setNumber: number;
  reps?: number;
  load?: number;
  rir?: number;
  rpe?: number;
  difficulty?: VerbalEffort;
  completed: boolean;
  techniqueOkay?: boolean;
  pain?: boolean;
}

export interface LoggedExercise {
  prescriptionId: string;
  prescribedExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  performanceSeriesId: string;
  prescriptionContext?: ExerciseLog["prescriptionContext"];
  setBlockId?: string;
  setBlockMode?: "paired" | "unpaired";
  sets: LoggedSet[];
  missReason?: MissReason;
  painEvent?: PainEvent;
}

export interface LoggedCardio {
  /** Actual activity; absent on legacy logs that used the prescribed activity. */
  modality?: CardioModality;
  prescribedModality?: CardioModality;
  completedMinutes?: number;
  movingMinutes?: number;
  sessionRpe?: number;
  distance?: number;
  distanceUnit?: "mi" | "km";
  steps?: number;
  completedIntervals?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  elevationGain?: number;
  elevationUnit?: "ft" | "m";
  surface?: "road" | "track" | "trail" | "treadmill" | "mixed" | "other";
  source?: "manual" | "watch" | "treadmill" | "bike" | "other";
}

export interface LoggedMovement {
  targetType: "steps" | "walking_minutes";
  target: number;
  met?: boolean;
  actualSteps?: number;
  actualWalkingMinutes?: number;
  checkInDate?: string;
}

export interface WorkoutLog {
  id?: string;
  programId: string;
  programVersion: number;
  sessionId: string;
  weekNumber: number;
  sessionSequence: number;
  status: WorkoutStatus;
  exerciseLogs: LoggedExercise[];
  cardioLog?: LoggedCardio;
  movementLog?: LoggedMovement;
  durationMinutes?: number;
  missReason?: MissReason;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

export interface WorkoutLogDatabaseRow {
  id: string;
  program_id: string;
  program_version: number;
  session_id: string;
  week_number: number;
  session_sequence: number;
  status: string;
  exercise_logs: Json;
  cardio_log: Json;
  movement_log?: Json;
  duration_minutes: number | null;
  miss_reason: string | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface SessionReference {
  session: TrainingSession;
  label: string;
  status?: WorkoutStatus;
}

export interface LoadRecommendation {
  kind: "prescribed" | "calibrate" | "repeat" | "increase" | "reduce";
  load?: number;
  text: string;
  basedOnWeek?: number;
}
