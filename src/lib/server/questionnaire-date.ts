export type IsoDate = `${number}-${number}-${number}`;

const ONE_DAY_MS = 86_400_000;

export function utcDate(now = new Date()): IsoDate {
  return now.toISOString().slice(0, 10) as IsoDate;
}

/**
 * Accept the browser's local calendar date only when it is plausibly adjacent
 * to the server date. This preserves correct local-date behavior around
 * midnight without allowing a client to move time-sensitive validation far
 * into the past or future.
 */
export function safeQuestionnaireAsOfDate(
  formData: FormData,
  now = new Date(),
): IsoDate {
  const serverDate = utcDate(now);
  const candidate = String(formData.get("clientDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return serverDate;

  const candidateTimestamp = Date.parse(`${candidate}T12:00:00Z`);
  const serverTimestamp = Date.parse(`${serverDate}T12:00:00Z`);
  if (!Number.isFinite(candidateTimestamp)) return serverDate;
  // Date.parse normalizes impossible dates (for example February 31) instead
  // of rejecting them. Require a calendar-date round trip before trusting it.
  if (new Date(candidateTimestamp).toISOString().slice(0, 10) !== candidate)
    return serverDate;

  return Math.abs(candidateTimestamp - serverTimestamp) <= ONE_DAY_MS
    ? (candidate as IsoDate)
    : serverDate;
}
