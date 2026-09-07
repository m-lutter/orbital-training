export const HEALTH_DATA_TYPES = [
  "steps",
  "heart_rate",
  "resting_heart_rate",
  "heart_rate_variability",
  "sleep",
  "active_energy",
  "workout",
] as const;

export type HealthDataType = (typeof HEALTH_DATA_TYPES)[number];
export type HealthProviderName = "apple_healthkit" | "android_health_connect";
export type HealthRecordOrigin = HealthProviderName | "orbital_companion";

export interface HealthPermissionSelection {
  readonly read: Readonly<Record<HealthDataType, boolean>>;
  readonly writeCompletedWorkouts: boolean;
  readonly allowBackgroundRead: boolean;
  readonly allowHistoryOlderThan30Days: boolean;
}

export interface HealthSource {
  readonly origin: HealthRecordOrigin;
  readonly appId?: string;
  readonly appName?: string;
  readonly deviceModel?: string;
}

interface NormalizedHealthRecordBase {
  readonly schemaVersion: 1;
  readonly sourceRecordId: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly source: HealthSource;
}

export interface NormalizedScalarRecord extends NormalizedHealthRecordBase {
  readonly kind:
    | "steps"
    | "heart_rate"
    | "resting_heart_rate"
    | "heart_rate_variability"
    | "active_energy";
  readonly value: number;
  readonly unit: "count" | "bpm" | "ms" | "kcal";
}

/** A provider-computed, source-merged five-minute heart-rate interval. */
export interface NormalizedHeartRateBucketRecord extends NormalizedHealthRecordBase {
  readonly kind: "heart_rate_bucket";
  readonly averageBpm: number;
  readonly minimumBpm: number;
  readonly maximumBpm: number;
  readonly sampleCount: number;
  readonly unit: "bpm";
}

export type SleepStage =
  | "in_bed"
  | "awake"
  | "asleep_unspecified"
  | "asleep_core"
  | "asleep_deep"
  | "asleep_rem"
  | "unknown";

export interface NormalizedSleepRecord extends NormalizedHealthRecordBase {
  readonly kind: "sleep";
  readonly stage: SleepStage;
}

export interface NormalizedWorkoutRecord extends NormalizedHealthRecordBase {
  readonly kind: "workout";
  readonly activity: string;
  readonly durationSeconds: number;
  readonly energyKcal?: number;
  readonly distanceMeters?: number;
  readonly programId?: string;
  readonly sessionId?: string;
}

export type NormalizedHealthRecord =
  | NormalizedScalarRecord
  | NormalizedHeartRateBucketRecord
  | NormalizedSleepRecord
  | NormalizedWorkoutRecord;

export interface HealthDeletion {
  readonly kind: HealthDataType;
  readonly sourceRecordId: string;
}

export interface HealthCursor {
  readonly schemaVersion: 1;
  readonly provider: HealthProviderName;
  readonly lastWindowEndAt?: string;
  readonly anchors?: Readonly<Partial<Record<HealthDataType, string>>>;
}

export interface HealthReadWindow {
  readonly startAt: string;
  readonly endAt: string;
}

export interface HealthReadResult {
  readonly records: readonly NormalizedHealthRecord[];
  readonly deletions: readonly HealthDeletion[];
  readonly nextCursor: HealthCursor;
  readonly truncated: boolean;
}

export type SyncTrigger =
  | "app_open_daily"
  | "foreground_catch_up"
  | "background_catch_up"
  | "workout_started"
  | "workout_stopped"
  | "manual";

export interface HealthSyncEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly syncRunId: string;
  readonly trigger: SyncTrigger;
  /** Advisory only. The backend must derive ownership from the authenticated JWT. */
  readonly userId: string;
  readonly provider: HealthProviderName;
  /** IANA time-zone name used by the backend for calendar-day aggregation. */
  readonly timeZone: string;
  readonly window: HealthReadWindow;
  readonly batch: {
    readonly index: number;
    readonly count: number;
  };
  readonly permissions: HealthPermissionSelection;
  readonly records: readonly NormalizedHealthRecord[];
  readonly deletions: readonly HealthDeletion[];
  readonly proposedCursor: HealthCursor;
  readonly generatedAt: string;
  readonly truncated: boolean;
  readonly activeWorkout?: {
    readonly startedAt: string;
    readonly sourceSessionKey?: string;
  };
}

export interface CompletedWorkout {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly programId?: string;
  readonly sessionId?: string;
}

export interface HealthAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

export interface HealthProvider {
  readonly name: HealthProviderName;
  getAvailability(): Promise<HealthAvailability>;
  requestPermissions(selection: HealthPermissionSelection): Promise<void>;
  read(input: {
    readonly selection: HealthPermissionSelection;
    readonly cursor?: HealthCursor;
    readonly window: HealthReadWindow;
    readonly limit: number;
    readonly mode: "daily" | "workout";
  }): Promise<HealthReadResult>;
  writeCompletedWorkout(workout: CompletedWorkout): Promise<string | null>;
  openPermissionSettings(): Promise<void>;
}
