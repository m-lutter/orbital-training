export interface WorkoutSaveLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface WorkoutSaveWindow {
  attempts: number;
  windowStartedAt: number;
  blockedUntil: number;
}

export interface WorkoutSaveGuardOptions {
  burstLimit?: number;
  windowMs?: number;
  cooldownMs?: number;
  maxEntries?: number;
}

export interface WorkoutSaveAdmission {
  release: () => void;
}

/**
 * A small per-isolate circuit breaker. The database remains the global source
 * of truth, but this prevents one browser/session loop from forwarding an
 * unbounded number of workout writes from the same Worker isolate.
 */
export function createWorkoutSaveGuard(
  options: WorkoutSaveGuardOptions = {},
): (key: string, now?: number) => WorkoutSaveLimitResult {
  const burstLimit = options.burstLimit ?? 6;
  const windowMs = options.windowMs ?? 30_000;
  const cooldownMs = options.cooldownMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 4_096;
  const windows = new Map<string, WorkoutSaveWindow>();

  const prune = (now: number): void => {
    if (windows.size < maxEntries) return;
    for (const [key, entry] of windows) {
      if (
        entry.blockedUntil <= now &&
        entry.windowStartedAt + windowMs <= now
      ) {
        windows.delete(key);
      }
    }
    while (windows.size >= maxEntries) {
      const oldestKey = windows.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      windows.delete(oldestKey);
    }
  };

  return (key: string, now = Date.now()): WorkoutSaveLimitResult => {
    const current = windows.get(key);
    if (current?.blockedUntil !== undefined && current.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.blockedUntil - now) / 1_000),
        ),
      };
    }

    if (
      current === undefined ||
      current.blockedUntil > 0 ||
      current.windowStartedAt + windowMs <= now
    ) {
      prune(now);
      windows.set(key, {
        attempts: 1,
        windowStartedAt: now,
        blockedUntil: 0,
      });
      return { allowed: true };
    }

    current.attempts += 1;
    if (current.attempts <= burstLimit) return { allowed: true };

    current.blockedUntil = now + cooldownMs;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(cooldownMs / 1_000)),
    };
  };
}

export const checkWorkoutSaveLimit = createWorkoutSaveGuard();

/**
 * Reject duplicate saves before they load workout context or send a write to
 * Supabase. A token-aware release prevents a stale/double release from
 * removing a newer request for the same workout.
 */
export function createWorkoutSaveSingleFlight(
  maxEntries = 4_096,
): (key: string) => WorkoutSaveAdmission | undefined {
  const active = new Map<string, symbol>();

  return (key: string): WorkoutSaveAdmission | undefined => {
    if (active.has(key) || active.size >= maxEntries) return undefined;

    const token = Symbol(key);
    active.set(key, token);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (active.get(key) === token) active.delete(key);
      },
    };
  };
}

export const acquireWorkoutSaveSlot = createWorkoutSaveSingleFlight();
