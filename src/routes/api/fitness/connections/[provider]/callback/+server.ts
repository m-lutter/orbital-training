import {
  fitnessRuntimeConfig,
  providerCallbackUrl,
  requireEnabledCloudFitnessProvider,
} from "$lib/server/fitness/config";
import { exchangeFitnessAuthorizationCode } from "$lib/server/fitness/provider-clients";
import {
  credentialsForProvider,
  requireFitnessUser,
  storeFitnessTokens,
} from "$lib/server/fitness/repository";
import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

function oauthCookieName(provider: string): string {
  return `orbital_fitness_oauth_${provider}`;
}

export const GET: RequestHandler = async (event) => {
  const provider = requireEnabledCloudFitnessProvider(event.params.provider);
  const cookiePath = `/api/fitness/connections/${provider}/callback`;
  const cookieName = oauthCookieName(provider);
  const expected = event.cookies.get(cookieName);
  event.cookies.delete(cookieName, { path: cookiePath });
  const { user } = await requireFitnessUser(event);

  const providerError = event.url.searchParams.get("error");
  if (providerError !== null) {
    redirect(303, `/account?fitness=denied&provider=${provider}`);
  }
  const state = event.url.searchParams.get("state");
  const code = event.url.searchParams.get("code");
  if (
    expected === undefined ||
    state === null ||
    code === null ||
    expected !== `${state}:${user.id}` ||
    state.length < 32 ||
    code.length > 8192
  ) {
    error(
      400,
      "The fitness authorization could not be verified. Try connecting again.",
    );
  }

  const config = fitnessRuntimeConfig(event);
  try {
    const tokens = await exchangeFitnessAuthorizationCode(
      provider,
      credentialsForProvider(config, provider),
      { code, redirectUri: providerCallbackUrl(config, provider) },
    );
    await storeFitnessTokens({
      config,
      userId: user.id,
      provider,
      providerAccountKey: `orbital-user:${user.id}`,
      tokens,
    });
  } catch (caught) {
    console.error("Fitness OAuth callback failed:", {
      provider,
      type: caught instanceof Error ? caught.name : "unknown",
    });
    redirect(303, `/account?fitness=error&provider=${provider}`);
  }
  redirect(303, `/account?fitness=connected&provider=${provider}`);
};
