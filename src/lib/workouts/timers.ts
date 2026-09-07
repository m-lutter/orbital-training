/**
 * Timer calculations use wall-clock anchors instead of counting interval
 * callbacks. Background tabs and locked phones may throttle JavaScript, but
 * the next update still reflects the real elapsed time.
 */
export function elapsedTimerSeconds(
  baseSeconds: number,
  startedAtMs: number,
  nowMs: number,
): number {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  return Math.max(0, Math.floor(baseSeconds + elapsed / 1000));
}

export function remainingTimerSeconds(endsAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}
