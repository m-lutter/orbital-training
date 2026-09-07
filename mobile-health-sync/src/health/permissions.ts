import {
  HEALTH_DATA_TYPES,
  type HealthDataType,
  type HealthPermissionSelection,
} from "./types";

export const DEFAULT_PERMISSION_SELECTION: HealthPermissionSelection = {
  read: {
    steps: false,
    heart_rate: false,
    resting_heart_rate: false,
    heart_rate_variability: false,
    sleep: false,
    active_energy: false,
    workout: false,
  },
  writeCompletedWorkouts: false,
  allowBackgroundRead: false,
  allowHistoryOlderThan30Days: false,
};

export const HEALTH_DATA_LABELS: Readonly<Record<HealthDataType, string>> = {
  steps: "Steps",
  heart_rate: "Heart rate",
  resting_heart_rate: "Resting heart rate",
  heart_rate_variability: "Heart-rate variability",
  sleep: "Sleep",
  active_energy: "Active energy",
  workout: "Workouts",
};

export function selectedHealthDataTypes(
  selection: HealthPermissionSelection,
): HealthDataType[] {
  return HEALTH_DATA_TYPES.filter((type) => selection.read[type]);
}

export function withReadPermission(
  selection: HealthPermissionSelection,
  type: HealthDataType,
  enabled: boolean,
): HealthPermissionSelection {
  return {
    ...selection,
    read: { ...selection.read, [type]: enabled },
  };
}

/**
 * Active-workout polling deliberately reads only heart-rate samples. Daily and
 * resume syncs still use the user's full selection.
 */
export function heartRateOnlySelection(
  selection: HealthPermissionSelection,
): HealthPermissionSelection {
  return {
    ...selection,
    read: {
      steps: false,
      heart_rate: selection.read.heart_rate,
      resting_heart_rate: false,
      heart_rate_variability: false,
      sleep: false,
      active_energy: false,
      workout: false,
    },
  };
}
