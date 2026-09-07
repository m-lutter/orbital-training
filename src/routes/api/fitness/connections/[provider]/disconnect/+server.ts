import {
  fitnessRuntimeConfig,
  requireEnabledFitnessProvider,
} from "$lib/server/fitness/config";
import { revokeFitnessAccess } from "$lib/server/fitness/provider-clients";
import {
  activeFitnessConnection,
  fitnessServiceClient,
  loadFitnessTokens,
  requireFitnessUser,
} from "$lib/server/fitness/repository";
import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const origin = event.request.headers.get("origin");
  if (origin !== null && origin !== event.url.origin) {
    error(403, "Cross-origin disconnect was not accepted.");
  }
  const provider = requireEnabledFitnessProvider(event.params.provider);
  const { user } = await requireFitnessUser(event);
  const config = fitnessRuntimeConfig(event);
  const connection = await activeFitnessConnection(config, user.id, provider);
  if (connection === null) redirect(303, "/account?fitness=not-connected");
  const form = await event.request.formData();
  const deleteHealthData = form.get("deleteHealthData") === "true";

  if (provider === "google_health") {
    try {
      const tokens = await loadFitnessTokens({
        config,
        userId: user.id,
        connection,
      });
      await revokeFitnessAccess(provider, tokens.accessToken);
    } catch (caught) {
      // Local credential removal must still succeed if the provider is down or
      // the grant was already revoked externally.
      console.warn("Provider revocation could not be confirmed:", {
        provider,
        type: caught instanceof Error ? caught.name : "unknown",
      });
    }
  }

  const { data, error: rpcError } = await fitnessServiceClient(config).rpc(
    "fitness_disconnect_provider",
    {
      p_user_id: user.id,
      p_connection_id: connection.id,
      p_delete_health_data: deleteHealthData,
    },
  );
  if (rpcError || data !== true) {
    console.error("Unable to disconnect fitness provider:", {
      provider,
      code: rpcError?.code,
    });
    error(500, "The fitness provider could not be disconnected.");
  }
  redirect(303, `/account?fitness=disconnected&provider=${provider}`);
};
