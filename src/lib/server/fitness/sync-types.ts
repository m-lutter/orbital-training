export interface DailyFitnessMetricInput {
  activeCalories?: number;
  activeMinutes?: number;
  distanceMeters?: number;
  extensions?: Record<string, unknown>;
  heartRateVariabilityMs?: number;
  metricDate: string;
  recoveryScore?: number;
  respiratoryRate?: number;
  restingHeartRateBpm?: number;
  sleepEndAt?: string;
  sleepMinutes?: number;
  sleepScore?: number;
  sleepStages?: {
    awake?: number;
    deep?: number;
    light?: number;
    rem?: number;
  };
  sleepStartAt?: string;
  sourceUpdatedAt?: string;
  spo2Percent?: number;
  steps?: number;
  strainScore?: number;
  timeZone: string;
}

export interface HeartRateBucketInput {
  avgBpm: number;
  bucketStart: string;
  maxBpm: number;
  minBpm: number;
  sampleCount?: number;
}

export interface HeartRateSampleInput {
  bpm: number;
  sampledAt: string;
  sourceRecordId?: string;
  sourceSessionKey?: string;
}

export interface FitnessWorkoutSummaryInput {
  activeCalories?: number;
  averageHeartRateBpm?: number;
  distanceMeters?: number;
  endedAt: string;
  heartRateZones?: Record<string, number>;
  maximumHeartRateBpm?: number;
  sourceUpdatedAt?: string;
  sourceWorkoutId: string;
  startedAt: string;
  strainScore?: number;
  workoutType?: string;
}

export interface FitnessProviderSyncResult {
  dailyMetrics: DailyFitnessMetricInput[];
  heartRateBuckets: HeartRateBucketInput[];
  workoutSummaries: FitnessWorkoutSummaryInput[];
}
