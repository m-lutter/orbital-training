import { Platform } from "react-native";
import { companionWorkoutRecord } from "../health/normalize";
import { heartRateOnlySelection } from "../health/permissions";
import type { CompletedWorkout, HealthProvider } from "../health/types";
import type { HealthStateStore } from "../storage/storage";
import type { HealthSyncEngine } from "../sync/engine";

export interface StoredWorkout extends CompletedWorkout {
  readonly nativeWritten: boolean;
}

function parseStored(value: string | null): StoredWorkout | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredWorkout>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.nativeWritten !== "boolean"
    )
      return undefined;
    return parsed as StoredWorkout;
  } catch {
    return undefined;
  }
}

function workoutId(): string {
  return `orbital-workout-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export class WorkoutLifecycle {
  constructor(
    private readonly dependencies: {
      userId: string;
      provider: HealthProvider;
      store: HealthStateStore;
      engine: HealthSyncEngine;
    },
  ) {}

  async getActive(): Promise<StoredWorkout | undefined> {
    return parseStored(
      await this.dependencies.store.getActiveWorkout(this.dependencies.userId),
    );
  }

  async start(
    input: {
      programId?: string;
      sessionId?: string;
    } = {},
  ): Promise<StoredWorkout> {
    const existing = await this.getActive();
    if (existing) {
      const sameRequestedWorkout =
        (!input.programId || existing.programId === input.programId) &&
        (!input.sessionId || existing.sessionId === input.sessionId);
      if (sameRequestedWorkout) return existing;
      throw new Error(
        "A different workout is already active on this device. End it before starting the new workout.",
      );
    }
    const workout: StoredWorkout = {
      id: workoutId(),
      startedAt: new Date().toISOString(),
      endedAt: "",
      nativeWritten: false,
      ...(input.programId ? { programId: input.programId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    };
    await this.dependencies.store.setActiveWorkout(
      this.dependencies.userId,
      JSON.stringify(workout),
    );
    const permissions = await this.dependencies.store.getPermissions(
      this.dependencies.userId,
      this.dependencies.provider.name,
    );
    await this.dependencies.engine.sync("workout_started", {
      force: true,
      selection: heartRateOnlySelection(permissions),
      activeWorkoutStartedAt: workout.startedAt,
      ...(workout.programId && workout.sessionId
        ? {
            activeWorkoutSourceSessionKey: `${workout.programId}:${workout.sessionId}`,
          }
        : {}),
    });
    return workout;
  }

  async stop(): Promise<CompletedWorkout | undefined> {
    const existing = await this.getActive();
    if (!existing) return undefined;
    const stopped: StoredWorkout = existing.endedAt
      ? existing
      : { ...existing, endedAt: new Date().toISOString() };
    await this.dependencies.store.setActiveWorkout(
      this.dependencies.userId,
      JSON.stringify(stopped),
    );
    await this.flushPendingStop();
    return stopped;
  }

  async acknowledgeServerEnd(sourceSessionKey: string): Promise<boolean> {
    const workout = await this.getActive();
    if (!workout?.programId || !workout.sessionId) return false;
    if (`${workout.programId}:${workout.sessionId}` !== sourceSessionKey)
      return false;
    await this.dependencies.store.clearActiveWorkout(this.dependencies.userId);
    return true;
  }

  async flushPendingStop(): Promise<boolean> {
    let workout = await this.getActive();
    if (!workout?.endedAt) return false;
    const permissions = await this.dependencies.store.getPermissions(
      this.dependencies.userId,
      this.dependencies.provider.name,
    );
    if (permissions.writeCompletedWorkouts && !workout.nativeWritten) {
      await this.dependencies.provider.writeCompletedWorkout(workout);
      workout = { ...workout, nativeWritten: true };
      await this.dependencies.store.setActiveWorkout(
        this.dependencies.userId,
        JSON.stringify(workout),
      );
    }
    const record = companionWorkoutRecord({
      id: workout.id,
      startedAt: workout.startedAt,
      endedAt: workout.endedAt,
      platform: Platform.OS === "ios" ? "ios" : "android",
      ...(workout.programId ? { programId: workout.programId } : {}),
      ...(workout.sessionId ? { sessionId: workout.sessionId } : {}),
    });
    await this.dependencies.engine.sync("workout_stopped", {
      extraRecords: [record],
      force: true,
      selection: permissions,
      activeWorkoutStartedAt: workout.startedAt,
      ...(workout.programId && workout.sessionId
        ? {
            activeWorkoutSourceSessionKey: `${workout.programId}:${workout.sessionId}`,
          }
        : {}),
    });
    await this.dependencies.store.clearActiveWorkout(this.dependencies.userId);
    return true;
  }
}

export { parseWorkoutDeepLink, type WorkoutDeepLinkAction } from "./deep-link";
