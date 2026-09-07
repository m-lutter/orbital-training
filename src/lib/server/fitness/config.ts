import { error, type RequestEvent } from "@sveltejs/kit";

export const CLOUD_FITNESS_PROVIDERS = ["google_health", "whoop"] as const;
export const DEVICE_FITNESS_PROVIDERS = [
  "apple_health",
  "health_connect",
] as const;
export const FITNESS_PROVIDERS = [
  ...CLOUD_FITNESS_PROVIDERS,
  ...DEVICE_FITNESS_PROVIDERS,
] as const;

export type CloudFitnessProvider = (typeof CLOUD_FITNESS_PROVIDERS)[number];
export type DeviceFitnessProvider = (typeof DEVICE_FITNESS_PROVIDERS)[number];
export type FitnessProvider = (typeof FITNESS_PROVIDERS)[number];

// WHOOP remains a dormant adapter so it can be evaluated in a later release,
// but it is deliberately absent from every public allowlist. Public routes,
// account data, and foreground sync must use these enabled lists rather than
// the broader adapter lists above.
export const ENABLED_CLOUD_FITNESS_PROVIDERS = ["google_health"] as const;
export const ENABLED_FITNESS_PROVIDERS = [
  ...ENABLED_CLOUD_FITNESS_PROVIDERS,
  ...DEVICE_FITNESS_PROVIDERS,
] as const;

export type EnabledCloudFitnessProvider =
  (typeof ENABLED_CLOUD_FITNESS_PROVIDERS)[number];
export type EnabledFitnessProvider = (typeof ENABLED_FITNESS_PROVIDERS)[number];

export interface FitnessRuntimeConfig {
  canonicalOrigin: string;
  encryptionKey: string;
  googleHealth?: {
    clientId: string;
    clientSecret: string;
  };
  serviceRoleKey: string;
}

export interface FitnessConfigurationStatus {
  baseConfigured: boolean;
  googleHealthConfigured: boolean;
}

function optionalSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function requiredSecret(value: string | undefined, name: string): string {
  const normalized = optionalSecret(value);
  if (normalized === undefined) {
    throw error(503, `Fitness integration is not configured (${name}).`);
  }
  return normalized;
}

function canonicalOrigin(event: RequestEvent): string {
  // Local OAuth callbacks must stay local even when Wrangler also loads the
  // production CANONICAL_ORIGIN variable during `vite dev`.
  if (["localhost", "127.0.0.1", "[::1]"].includes(event.url.hostname)) {
    return event.url.origin;
  }
  const configured = optionalSecret(event.platform?.env.CANONICAL_ORIGIN);
  if (configured === undefined) return event.url.origin;

  try {
    return new URL(configured).origin;
  } catch {
    throw error(503, "Fitness integration has an invalid canonical origin.");
  }
}

export function fitnessRuntimeConfig(
  event: RequestEvent,
): FitnessRuntimeConfig {
  const env = event.platform?.env;
  const googleClientId = optionalSecret(env?.GOOGLE_HEALTH_CLIENT_ID);
  const googleClientSecret = optionalSecret(env?.GOOGLE_HEALTH_CLIENT_SECRET);

  return {
    canonicalOrigin: canonicalOrigin(event),
    encryptionKey: requiredSecret(
      env?.FITNESS_TOKEN_ENCRYPTION_KEY,
      "FITNESS_TOKEN_ENCRYPTION_KEY",
    ),
    serviceRoleKey: requiredSecret(
      env?.SUPABASE_SERVICE_ROLE_KEY,
      "SUPABASE_SERVICE_ROLE_KEY",
    ),
    ...(googleClientId !== undefined && googleClientSecret !== undefined
      ? {
          googleHealth: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : {}),
  };
}

export function fitnessConfigurationStatus(
  event: Pick<RequestEvent, "platform">,
): FitnessConfigurationStatus {
  const env = event.platform?.env;
  return {
    baseConfigured:
      optionalSecret(env?.FITNESS_TOKEN_ENCRYPTION_KEY) !== undefined &&
      optionalSecret(env?.SUPABASE_SERVICE_ROLE_KEY) !== undefined,
    googleHealthConfigured:
      optionalSecret(env?.GOOGLE_HEALTH_CLIENT_ID) !== undefined &&
      optionalSecret(env?.GOOGLE_HEALTH_CLIENT_SECRET) !== undefined,
  };
}

export function isFitnessProvider(value: string): value is FitnessProvider {
  return (FITNESS_PROVIDERS as readonly string[]).includes(value);
}

export function isCloudFitnessProvider(
  value: string,
): value is CloudFitnessProvider {
  return (CLOUD_FITNESS_PROVIDERS as readonly string[]).includes(value);
}

export function isEnabledCloudFitnessProvider(
  value: string,
): value is EnabledCloudFitnessProvider {
  return (ENABLED_CLOUD_FITNESS_PROVIDERS as readonly string[]).includes(value);
}

export function isEnabledFitnessProvider(
  value: string,
): value is EnabledFitnessProvider {
  return (ENABLED_FITNESS_PROVIDERS as readonly string[]).includes(value);
}

export function requireEnabledCloudFitnessProvider(
  value: string,
): EnabledCloudFitnessProvider {
  if (!isEnabledCloudFitnessProvider(value)) error(404, "Provider not found.");
  return value;
}

export function requireEnabledFitnessProvider(
  value: string,
): EnabledFitnessProvider {
  if (!isEnabledFitnessProvider(value)) error(404, "Provider not found.");
  return value;
}

export function isDeviceFitnessProvider(
  value: string,
): value is DeviceFitnessProvider {
  return (DEVICE_FITNESS_PROVIDERS as readonly string[]).includes(value);
}

export function providerCallbackUrl(
  config: Pick<FitnessRuntimeConfig, "canonicalOrigin">,
  provider: CloudFitnessProvider,
): string {
  return new URL(
    `/api/fitness/connections/${provider}/callback`,
    config.canonicalOrigin,
  ).toString();
}
