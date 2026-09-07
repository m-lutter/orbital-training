import type { CloudFitnessProvider } from "./config";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const WHOOP_API_ORIGIN = "https://api.prod.whoop.com";
const WHOOP_AUTHORIZATION_URL = `${WHOOP_API_ORIGIN}/oauth/oauth2/auth`;
const WHOOP_TOKEN_URL = `${WHOOP_API_ORIGIN}/oauth/oauth2/token`;

export const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
] as const;

export const WHOOP_SCOPES = [
  "offline",
  "read:cycles",
  "read:recovery",
  "read:sleep",
  "read:workout",
] as const;

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface OAuthTokens {
  accessToken: string;
  expiresAt: string | null;
  refreshToken: string | null;
  scopes: string[];
  tokenType: string;
}

type Fetcher = typeof fetch;

export class FitnessProviderError extends Error {
  readonly provider: CloudFitnessProvider;
  readonly status: number;

  constructor(provider: CloudFitnessProvider, status: number, message: string) {
    super(message);
    this.name = "FitnessProviderError";
    this.provider = provider;
    this.status = status;
  }
}

function scopesFor(provider: CloudFitnessProvider): readonly string[] {
  return provider === "google_health" ? GOOGLE_HEALTH_SCOPES : WHOOP_SCOPES;
}

export function fitnessAuthorizationUrl(options: {
  clientId: string;
  provider: CloudFitnessProvider;
  redirectUri: string;
  state: string;
}): URL {
  const url = new URL(
    options.provider === "google_health"
      ? GOOGLE_AUTHORIZATION_URL
      : WHOOP_AUTHORIZATION_URL,
  );
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopesFor(options.provider).join(" "));
  url.searchParams.set("state", options.state);
  if (options.provider === "google_health") {
    url.searchParams.set("access_type", "offline");
    // The first consent is the reliable point at which Google returns a
    // refresh token. Reconnecting is an explicit user action, so reprompting
    // here is intentional.
    url.searchParams.set("prompt", "consent");
  }
  return url;
}

function tokenEndpoint(provider: CloudFitnessProvider): string {
  return provider === "google_health" ? GOOGLE_TOKEN_URL : WHOOP_TOKEN_URL;
}

function normalizeTokenResponse(
  provider: CloudFitnessProvider,
  value: unknown,
  fallbackRefreshToken: string | null,
): OAuthTokens {
  if (typeof value !== "object" || value === null) {
    throw new FitnessProviderError(provider, 502, "Invalid token response.");
  }
  const token = value as Record<string, unknown>;
  if (
    typeof token.access_token !== "string" ||
    token.access_token.length === 0
  ) {
    throw new FitnessProviderError(
      provider,
      502,
      "Token response was incomplete.",
    );
  }
  const expiresIn =
    typeof token.expires_in === "number"
      ? token.expires_in
      : Number(token.expires_in ?? Number.NaN);
  const expiresAt = Number.isFinite(expiresIn)
    ? new Date(Date.now() + Math.max(0, expiresIn - 30) * 1000).toISOString()
    : null;
  const scopeValue = typeof token.scope === "string" ? token.scope : "";
  return {
    accessToken: token.access_token,
    refreshToken:
      typeof token.refresh_token === "string" && token.refresh_token.length > 0
        ? token.refresh_token
        : fallbackRefreshToken,
    expiresAt,
    scopes:
      scopeValue.length > 0
        ? scopeValue.split(/[ ,]+/u).filter(Boolean)
        : [...scopesFor(provider)],
    tokenType:
      typeof token.token_type === "string" ? token.token_type : "Bearer",
  };
}

async function tokenRequest(
  provider: CloudFitnessProvider,
  credentials: OAuthClientCredentials,
  form: URLSearchParams,
  fallbackRefreshToken: string | null,
  fetcher: Fetcher,
): Promise<OAuthTokens> {
  form.set("client_id", credentials.clientId);
  form.set("client_secret", credentials.clientSecret);
  const response = await fetcher(tokenEndpoint(provider), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new FitnessProviderError(
      provider,
      response.status,
      `Provider token request failed (${response.status}).`,
    );
  }
  return normalizeTokenResponse(provider, body, fallbackRefreshToken);
}

export function exchangeFitnessAuthorizationCode(
  provider: CloudFitnessProvider,
  credentials: OAuthClientCredentials,
  options: { code: string; redirectUri: string },
  fetcher: Fetcher = fetch,
): Promise<OAuthTokens> {
  return tokenRequest(
    provider,
    credentials,
    new URLSearchParams({
      code: options.code,
      grant_type: "authorization_code",
      redirect_uri: options.redirectUri,
    }),
    null,
    fetcher,
  );
}

export function refreshFitnessAccessToken(
  provider: CloudFitnessProvider,
  credentials: OAuthClientCredentials,
  refreshToken: string,
  fetcher: Fetcher = fetch,
): Promise<OAuthTokens> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (provider === "whoop") form.set("scope", WHOOP_SCOPES.join(" "));
  return tokenRequest(provider, credentials, form, refreshToken, fetcher);
}

export async function revokeFitnessAccess(
  provider: CloudFitnessProvider,
  accessToken: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const response =
    provider === "google_health"
      ? await fetcher(GOOGLE_REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: accessToken }),
          signal: AbortSignal.timeout(15_000),
        })
      : await fetcher(`${WHOOP_API_ORIGIN}/developer/v2/user/access`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        });
  if (!response.ok && response.status !== 401) {
    throw new FitnessProviderError(
      provider,
      response.status,
      `Provider disconnect failed (${response.status}).`,
    );
  }
}

export function providerApiOrigin(provider: CloudFitnessProvider): string {
  return provider === "google_health"
    ? "https://health.googleapis.com/v4"
    : `${WHOOP_API_ORIGIN}/developer/v2`;
}
