const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const AUTOMATIC_SYNC_INTERVAL_SECONDS = 6 * 60 * 60;
const MANUAL_SYNC_INTERVAL_SECONDS = 5 * 60;

export type FitnessSyncTrigger = "automatic" | "manual";

export function validFitnessSyncTrigger(
  value: unknown,
): FitnessSyncTrigger | undefined {
  return value === "automatic" || value === "manual" ? value : undefined;
}

export function foregroundSyncMinimumIntervalSeconds(
  trigger: FitnessSyncTrigger,
): number {
  return trigger === "manual"
    ? MANUAL_SYNC_INTERVAL_SECONDS
    : AUTOMATIC_SYNC_INTERVAL_SECONDS;
}

export function validLocalDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) {
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().startsWith(value)
    ? value
    : undefined;
}

export function validTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return undefined;
  }
}
