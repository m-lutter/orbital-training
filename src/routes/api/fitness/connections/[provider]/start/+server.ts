import {
  fitnessRuntimeConfig,
  providerCallbackUrl,
  requireEnabledCloudFitnessProvider,
} from "$lib/server/fitness/config";
import { fitnessAuthorizationUrl } from "$lib/server/fitness/provider-clients";
import {
  credentialsForProvider,
  requireFitnessUser,
} from "$lib/server/fitness/repository";
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

function oauthCookieName(provider: string): string {
  return `orbital_fitness_oauth_${provider}`;
}

export const GET: RequestHandler = async (event) => {
  const provider = requireEnabledCloudFitnessProvider(event.params.provider);
  const { user } = await requireFitnessUser(event);
  const config = fitnessRuntimeConfig(event);
  const credentials = credentialsForProvider(config, provider);
  const state =
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
  const callbackUrl = providerCallbackUrl(config, provider);
  event.cookies.set(oauthCookieName(provider), `${state}:${user.id}`, {
    path: `/api/fitness/connections/${provider}/callback`,
    httpOnly: true,
    sameSite: "lax",
    secure: event.url.protocol === "https:",
    maxAge: 10 * 60,
  });
  redirect(
    303,
    fitnessAuthorizationUrl({
      provider,
      clientId: credentials.clientId,
      redirectUri: callbackUrl,
      state,
    }).toString(),
  );
};
