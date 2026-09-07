export interface WearableDay {
  date: string;
  steps: number | null;
  stepGoal: number | null;
  goalMet: boolean;
  source: string | null;
  syncedAt: string | null;
}

export interface WorkoutHeartRateSample {
  recordedAt: string;
  bpm: number;
}

export interface WorkoutHeartRateBucket {
  bucketStart: string;
  avgBpm: number;
  minBpm: number;
  maxBpm: number;
  sampleCount: number;
}

export type WorkoutHeartRateProvider =
  "apple_health" | "google_health" | "health_connect";

export interface HeartRateZoneProfile {
  maximumHeartRateBpm: number;
  method: "heart_rate_reserve" | "percent_max";
  restingHeartRateBpm?: number;
}

export interface HeartRateTargetBand {
  min: number;
  max: number;
}

/**
 * Provider-neutral workout telemetry returned by the web API. The status is a
 * string on purpose so a provider can add an intermediate state without
 * forcing an app release; the client reduces it to idle/active/complete.
 */
export interface WorkoutHeartRateContract {
  importStatus?:
    | "checking"
    | "no_provider_samples"
    | "reconnect_required"
    | "synced"
    | "temporarily_unavailable";
  mobileDeepLink?: string;
  provider?: WorkoutHeartRateProvider;
  /** The time the Worker last checked stored telemetry for this response. */
  checkedAt?: string;
  /** True when `samples` contains only rows after the requested cursor. */
  isDelta?: boolean;
  /** More stored samples are available after the last returned sample. */
  hasMore?: boolean;
  workoutSessionId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  samples: WorkoutHeartRateSample[];
  buckets: WorkoutHeartRateBucket[];
}

export interface WorkoutCaptureStartResponse {
  mobileDeepLink?: string;
  provider?: WorkoutHeartRateProvider;
  workoutSessionId: string;
  status: string;
  startedAt: string | null;
}

/**
 * Imperative lifecycle controls exposed by the capture panel to the workout
 * form. Ending capture is deliberately best-effort: callers can preserve the
 * workout log even when a provider is temporarily unavailable.
 */
export interface WorkoutCaptureController {
  endCapture(): Promise<boolean>;
}
