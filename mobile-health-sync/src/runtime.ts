import { supabase } from "./auth/supabase";
import { mobileConfig } from "./config";
import { createHealthProvider } from "./health/provider";
import { HealthStateStore } from "./storage/storage";
import { HealthSyncEngine } from "./sync/engine";
import { WorkerHealthSyncTransport } from "./sync/transport";
import { WorkoutLifecycle } from "./workout/workout-lifecycle";

export function createMobileRuntime(userId: string) {
  const provider = createHealthProvider();
  const store = new HealthStateStore();
  const transport = new WorkerHealthSyncTransport(
    supabase,
    mobileConfig.appOrigin,
  );
  const engine = new HealthSyncEngine({
    userId,
    provider,
    store,
    transport,
  });
  return {
    provider,
    store,
    transport,
    engine,
    workouts: new WorkoutLifecycle({ userId, provider, store, engine }),
  };
}

export type MobileRuntime = ReturnType<typeof createMobileRuntime>;
