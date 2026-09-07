import type { DayOfWeek, IsoDate } from "./types.js";

export const DAYS: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function fingerprint(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function daysBetween(start: IsoDate, end: IsoDate): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000);
}

export function isIsoDate(value: string): value is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

export function valueAtPath(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value === undefined || value === null || typeof value !== "object")
      return undefined;
    return (value as Record<string, unknown>)[key];
  }, input);
}

export function answerSummary(value: unknown): string {
  if (value === undefined) return "Not answered; engine default used";
  if (value === null) return "None";
  if (Array.isArray(value))
    return value.length === 0 ? "None selected" : value.join(", ");
  if (typeof value === "object") return stableStringify(value);
  return String(value);
}
