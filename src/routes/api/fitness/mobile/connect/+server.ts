import type { Json } from "$lib/database.types";
import {
  fitnessConfigurationStatus,
  fitnessRuntimeConfig,
  type DeviceFitnessProvider,
} from "$lib/server/fitness/config";
import {
  readFitnessObject,
  requireFitnessMutationOrigin,
} from "$lib/server/fitness/http";
import {
  mobileConsentScopes,
  parseMobileConnectionRequest,
} from "$lib/server/fitness/mobile-sync";
import {
  registerDeviceConnection,
  requireFitnessUser,
} from "$lib/server/fitness/repository";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

function providerName(
  provider: "apple_healthkit" | "android_health_connect",
): DeviceFitnessProvider {
  return provider === "apple_healthkit" ? "apple_health" : "health_connect";
}

export const POST: RequestHandler = async (event) => {
  requireFitnessMutationOrigin(event);
  const { user } = await requireFitnessUser(event);
  if (!fitnessConfigurationStatus(event).baseConfigured) {
    throw error(503, "Mobile health synchronization is not configured yet.");
  }
  const input = parseMobileConnectionRequest(
    await readFitnessObject(event.request, 16 * 1024),
  );
  if (input === undefined) {
    throw error(400, "The mobile health connection request is invalid.");
  }
  const config = fitnessRuntimeConfig(event);
  const provider = providerName(input.provider);
  await registerDeviceConnection({
    config,
    userId: user.id,
    provider,
    deviceKey: `orbital-health-device:${user.id}:${provider}`,
    scopes: mobileConsentScopes(input.permissions),
    metadata: {
      transport: "native_companion",
      syncVersion: 1,
      nativeProvider: input.provider,
      writeCompletedWorkouts: input.permissions.writeCompletedWorkouts,
      backgroundRead: input.permissions.allowBackgroundRead,
      extendedHistory: input.permissions.allowHistoryOlderThan30Days,
      explicitConnectionAction: true,
    } satisfies Json,
  });
  return json(
    { connected: true, provider },
    { headers: { "cache-control": "private, no-store" } },
  );
};
