import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "$env/static/public";
import type { Database, Json } from "$lib/database.types";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { error, type RequestEvent } from "@sveltejs/kit";
import type {
  CloudFitnessProvider,
  FitnessProvider,
  FitnessRuntimeConfig,
} from "./config";
import { decryptFitnessToken, encryptFitnessToken } from "./token-crypto";
import {
  refreshFitnessAccessToken,
  type OAuthClientCredentials,
  type OAuthTokens,
} from "./provider-clients";
import type {
  DailyFitnessMetricInput,
  FitnessWorkoutSummaryInput,
  HeartRateBucketInput,
  HeartRateSampleInput,
} from "./sync-types";
import { boundedJsonBatches } from "./persistence-batches";
import type { MobileHealthDeletion } from "./mobile-sync";

export type FitnessConnectionRow =
  Database["public"]["Tables"]["fitness_connections"]["Row"];

export interface FitnessAuthContext {
  user: User;
  userClient: SupabaseClient<Database>;
}

export interface DecryptedConnectionTokens {
  accessToken: string;
  connectionId: string;
  expiresAt: string | null;
  provider: CloudFitnessProvider;
  providerAccountKey: string;
  refreshToken: string | null;
}

export interface FitnessSyncLease {
  connectionId: string;
  cursor: string | null;
  lastSuccessAt: string | null;
  leaseExpiresAt: string;
  leaseToken: string;
  generation: number;
  provider: FitnessProvider;
  purpose: "foreground" | "workout";
}

function serviceClient(serviceRoleKey: string): SupabaseClient<Database> {
  return createClient<Database>(PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { "x-client-info": "orbital-fitness-worker" } },
  });
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return undefined;
  const match = authorization.match(/^Bearer\s+([^\s]+)$/iu);
  if (match === null || match[1].length > 8192) {
    throw error(401, "Invalid authorization header.");
  }
  return match[1];
}

export async function requireFitnessUser(
  event: RequestEvent,
): Promise<FitnessAuthContext> {
  const token = bearerToken(event.request);
  if (token === undefined) {
    const { data, error: authError } = await event.locals.getUser();
    if (authError || data.user === null) throw error(401, "Sign in required.");
    return { user: data.user, userClient: event.locals.supabase };
  }

  const userClient = createClient<Database>(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { headers: { authorization: `Bearer ${token}` } },
    },
  );
  const { data, error: authError } = await userClient.auth.getUser(token);
  if (authError || data.user === null) throw error(401, "Sign in required.");
  return { user: data.user, userClient };
}

export function fitnessServiceClient(
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">,
): SupabaseClient<Database> {
  return serviceClient(config.serviceRoleKey);
}

export async function listFitnessConnections(
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">,
  userId: string,
): Promise<FitnessConnectionRow[]> {
  const { data, error: queryError } = await serviceClient(config.serviceRoleKey)
    .from("fitness_connections")
    .select("*")
    .eq("user_id", userId)
    .order("connected_at", { ascending: true });
  if (queryError) {
    console.error("Unable to list fitness connections:", {
      code: queryError.code,
    });
    throw error(500, "Fitness connections could not be loaded.");
  }
  return data ?? [];
}

export async function activeFitnessConnection(
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">,
  userId: string,
  provider: FitnessProvider,
): Promise<FitnessConnectionRow | null> {
  const { data, error: queryError } = await serviceClient(config.serviceRoleKey)
    .from("fitness_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  if (queryError) {
    console.error("Unable to load fitness connection:", {
      code: queryError.code,
      provider,
    });
    throw error(500, "Fitness connection could not be loaded.");
  }
  return data;
}

function oauthCredentials(
  config: FitnessRuntimeConfig,
  provider: CloudFitnessProvider,
): OAuthClientCredentials {
  // WHOOP is a retained adapter, not an enabled integration. Even an
  // accidentally configured legacy secret must not make it callable.
  const credentials =
    provider === "google_health" ? config.googleHealth : undefined;
  if (credentials === undefined) {
    throw error(503, `${provider} is not configured.`);
  }
  return credentials;
}

export async function storeFitnessTokens(options: {
  config: FitnessRuntimeConfig;
  metadata?: Json;
  provider: CloudFitnessProvider;
  providerAccountKey: string;
  tokens: OAuthTokens;
  userId: string;
}): Promise<string> {
  const [accessTokenCiphertext, refreshTokenCiphertext] = await Promise.all([
    encryptFitnessToken(
      options.tokens.accessToken,
      options.config.encryptionKey,
    ),
    options.tokens.refreshToken === null
      ? Promise.resolve(null)
      : encryptFitnessToken(
          options.tokens.refreshToken,
          options.config.encryptionKey,
        ),
  ]);
  const { data, error: rpcError } = await serviceClient(
    options.config.serviceRoleKey,
  ).rpc("fitness_store_connection_tokens", {
    p_user_id: options.userId,
    p_provider: options.provider,
    p_provider_account_key: options.providerAccountKey,
    p_access_token_ciphertext: accessTokenCiphertext,
    p_refresh_token_ciphertext: refreshTokenCiphertext ?? undefined,
    p_access_token_expires_at: options.tokens.expiresAt ?? undefined,
    p_scopes: options.tokens.scopes,
    p_consent_version: "fitness-v1",
    p_encryption_key_version: "v1",
    p_metadata:
      options.metadata ??
      ({ transport: "oauth", syncVersion: 1 } satisfies Json),
  });
  if (rpcError || data === null) {
    console.error("Unable to store fitness credentials:", {
      code: rpcError?.code,
      provider: options.provider,
    });
    throw error(500, "The fitness connection could not be saved.");
  }
  return data;
}

async function refreshStoredFitnessTokens(options: {
  config: FitnessRuntimeConfig;
  connectionId: string;
  expectedGeneration: number;
  providerAccountKey: string;
  tokens: OAuthTokens;
  userId: string;
}): Promise<void> {
  const [accessTokenCiphertext, refreshTokenCiphertext] = await Promise.all([
    encryptFitnessToken(
      options.tokens.accessToken,
      options.config.encryptionKey,
    ),
    options.tokens.refreshToken === null
      ? Promise.resolve(null)
      : encryptFitnessToken(
          options.tokens.refreshToken,
          options.config.encryptionKey,
        ),
  ]);
  const { data, error: rpcError } = await serviceClient(
    options.config.serviceRoleKey,
  ).rpc("fitness_refresh_connection_tokens", {
    p_user_id: options.userId,
    p_connection_id: options.connectionId,
    p_expected_generation: options.expectedGeneration,
    p_provider_account_key: options.providerAccountKey,
    p_access_token_ciphertext: accessTokenCiphertext,
    p_refresh_token_ciphertext: refreshTokenCiphertext ?? undefined,
    p_access_token_expires_at: options.tokens.expiresAt ?? undefined,
    p_scopes: options.tokens.scopes,
    p_encryption_key_version: "v1",
  });
  if (rpcError || data !== true) {
    console.warn("Discarded a stale fitness token refresh:", {
      code: rpcError?.code,
      connectionId: options.connectionId,
    });
    throw error(
      409,
      "This fitness connection changed while it was syncing. Reopen the app before retrying.",
    );
  }
}

function tokenRecord(value: Json): {
  accessTokenCiphertext: string;
  accessTokenExpiresAt: string | null;
  connectionId: string;
  provider: CloudFitnessProvider;
  providerAccountKey: string;
  refreshTokenCiphertext: string | null;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw error(500, "Fitness credentials were unavailable.");
  }
  const record = value as Record<string, Json | undefined>;
  if (
    typeof record.connectionId !== "string" ||
    (record.provider !== "google_health" && record.provider !== "whoop") ||
    typeof record.providerAccountKey !== "string" ||
    typeof record.accessTokenCiphertext !== "string" ||
    (record.refreshTokenCiphertext !== null &&
      typeof record.refreshTokenCiphertext !== "string") ||
    (record.accessTokenExpiresAt !== null &&
      typeof record.accessTokenExpiresAt !== "string")
  ) {
    throw error(500, "Fitness credentials were invalid.");
  }
  return {
    connectionId: record.connectionId,
    provider: record.provider,
    providerAccountKey: record.providerAccountKey,
    accessTokenCiphertext: record.accessTokenCiphertext,
    refreshTokenCiphertext: record.refreshTokenCiphertext,
    accessTokenExpiresAt: record.accessTokenExpiresAt,
  };
}

export async function loadFitnessTokens(options: {
  config: FitnessRuntimeConfig;
  connection: FitnessConnectionRow;
  userId: string;
}): Promise<DecryptedConnectionTokens> {
  const provider = options.connection.provider;
  if (provider !== "google_health" && provider !== "whoop") {
    throw error(400, "This fitness connection does not use OAuth credentials.");
  }
  const { data, error: rpcError } = await serviceClient(
    options.config.serviceRoleKey,
  ).rpc("fitness_load_connection_tokens", {
    p_user_id: options.userId,
    p_connection_id: options.connection.id,
  });
  if (rpcError || data === null) {
    console.error("Unable to load fitness credentials:", {
      code: rpcError?.code,
      provider,
    });
    throw error(500, "Fitness credentials were unavailable.");
  }
  const encrypted = tokenRecord(data);
  let accessToken = await decryptFitnessToken(
    encrypted.accessTokenCiphertext,
    options.config.encryptionKey,
  );
  let refreshToken =
    encrypted.refreshTokenCiphertext === null
      ? null
      : await decryptFitnessToken(
          encrypted.refreshTokenCiphertext,
          options.config.encryptionKey,
        );
  let expiresAt = encrypted.accessTokenExpiresAt;
  const expiresSoon =
    expiresAt !== null && Date.parse(expiresAt) <= Date.now() + 2 * 60 * 1000;
  if (expiresSoon) {
    if (refreshToken === null) {
      throw error(409, "Reconnect this fitness provider to continue syncing.");
    }
    const refreshed = await refreshFitnessAccessToken(
      provider,
      oauthCredentials(options.config, provider),
      refreshToken,
    );
    await refreshStoredFitnessTokens({
      config: options.config,
      connectionId: options.connection.id,
      expectedGeneration: options.connection.generation,
      providerAccountKey: encrypted.providerAccountKey,
      tokens: refreshed,
      userId: options.userId,
    });
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken;
    expiresAt = refreshed.expiresAt;
  }
  return {
    accessToken,
    refreshToken,
    expiresAt,
    connectionId: encrypted.connectionId,
    provider,
    providerAccountKey: encrypted.providerAccountKey,
  };
}

function parseLease(value: Json): FitnessSyncLease | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Json | undefined>;
  if (
    typeof record.connectionId !== "string" ||
    typeof record.leaseToken !== "string" ||
    typeof record.leaseExpiresAt !== "string" ||
    typeof record.generation !== "number" ||
    !Number.isInteger(record.generation) ||
    record.generation < 1 ||
    (record.provider !== "google_health" &&
      record.provider !== "whoop" &&
      record.provider !== "apple_health" &&
      record.provider !== "health_connect") ||
    (record.purpose !== "foreground" && record.purpose !== "workout")
  ) {
    return null;
  }
  return {
    connectionId: record.connectionId,
    provider: record.provider,
    purpose: record.purpose,
    leaseToken: record.leaseToken,
    leaseExpiresAt: record.leaseExpiresAt,
    generation: record.generation,
    cursor: typeof record.cursor === "string" ? record.cursor : null,
    lastSuccessAt:
      typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : null,
  };
}

export async function claimFitnessSync(options: {
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">;
  connectionId: string;
  minimumIntervalSeconds: number;
  purpose: "foreground" | "workout";
  userId: string;
}): Promise<FitnessSyncLease | null> {
  const { data, error: rpcError } = await serviceClient(
    options.config.serviceRoleKey,
  ).rpc("fitness_claim_connection_sync", {
    p_user_id: options.userId,
    p_connection_id: options.connectionId,
    p_min_interval_seconds: options.minimumIntervalSeconds,
    p_lease_seconds: options.purpose === "workout" ? 45 : 120,
    p_purpose: options.purpose,
  });
  if (rpcError) {
    console.error("Unable to claim fitness sync:", { code: rpcError.code });
    throw error(500, "Fitness synchronization could not start.");
  }
  return parseLease(data);
}

export async function completeFitnessSync(options: {
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">;
  connectionId: string;
  cursor?: string;
  leaseToken: string;
  nextSyncAt?: string;
}): Promise<void> {
  const { error: rpcError } = await serviceClient(
    options.config.serviceRoleKey,
  ).rpc("fitness_complete_sync_lease", {
    p_connection_id: options.connectionId,
    p_lease_token: options.leaseToken,
    p_cursor: options.cursor,
    p_next_sync_at: options.nextSyncAt,
  });
  if (rpcError) {
    console.error("Unable to complete fitness sync:", { code: rpcError.code });
  }
}

export async function failFitnessSync(options: {
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">;
  connectionId: string;
  errorCode: string;
  leaseToken: string;
}): Promise<void> {
  const { error: rpcError } = await serviceClient(
    options.config.serviceRoleKey,
  ).rpc("fitness_fail_sync_lease", {
    p_connection_id: options.connectionId,
    p_lease_token: options.leaseToken,
    p_error_code: options.errorCode.slice(0, 128),
  });
  if (rpcError) {
    console.error("Unable to release failed fitness sync:", {
      code: rpcError.code,
    });
  }
}

const asJson = (value: unknown): Json => value as Json;

export async function persistFitnessSync(options: {
  buckets: HeartRateBucketInput[];
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">;
  connectionId: string;
  expectedGeneration: number;
  metrics: DailyFitnessMetricInput[];
  summaries: FitnessWorkoutSummaryInput[];
  tolerateWorkoutSummaryFailure?: boolean;
  userId: string;
}): Promise<{ workoutSummaries: "stored" | "failed" }> {
  const client = serviceClient(options.config.serviceRoleKey);
  for (const metrics of boundedJsonBatches(options.metrics, 31, 120 * 1024)) {
    const { error: rpcError } = await client.rpc(
      "fitness_upsert_daily_metrics",
      {
        p_user_id: options.userId,
        p_connection_id: options.connectionId,
        p_expected_generation: options.expectedGeneration,
        p_metrics: asJson(metrics),
      },
    );
    if (rpcError) {
      console.error("Unable to persist normalized fitness data:", {
        code: rpcError.code,
        kind: "daily_metrics",
      });
      throw error(500, "Fitness data could not be saved.");
    }
  }

  for (const buckets of boundedJsonBatches(options.buckets, 600, 240 * 1024)) {
    const { error: rpcError } = await client.rpc("fitness_upsert_hr_buckets", {
      p_user_id: options.userId,
      p_connection_id: options.connectionId,
      p_expected_generation: options.expectedGeneration,
      p_buckets: asJson(buckets),
    });
    if (rpcError) {
      console.error("Unable to persist normalized fitness data:", {
        code: rpcError.code,
        kind: "heart_rate_buckets",
      });
      throw error(500, "Fitness data could not be saved.");
    }
  }

  try {
    for (const summaries of boundedJsonBatches(
      options.summaries,
      100,
      240 * 1024,
    )) {
      const { error: rpcError } = await client.rpc(
        "fitness_upsert_workout_summaries",
        {
          p_user_id: options.userId,
          p_connection_id: options.connectionId,
          p_expected_generation: options.expectedGeneration,
          p_summaries: asJson(summaries),
        },
      );
      if (rpcError) {
        console.error("Unable to persist normalized fitness data:", {
          code: rpcError.code,
          kind: "workout_summaries",
        });
        throw error(500, "Fitness data could not be saved.");
      }
    }
  } catch (caught) {
    if (!options.tolerateWorkoutSummaryFailure) throw caught;
    return { workoutSummaries: "failed" };
  }
  return { workoutSummaries: "stored" };
}

export async function ingestHeartRateSamples(options: {
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">;
  connectionId: string;
  expectedGeneration: number;
  samples: HeartRateSampleInput[];
  userId: string;
}): Promise<void> {
  const client = serviceClient(options.config.serviceRoleKey);
  for (const samples of boundedJsonBatches(options.samples, 2000, 480 * 1024)) {
    const { error: rpcError } = await client.rpc("fitness_ingest_hr_samples", {
      p_user_id: options.userId,
      p_connection_id: options.connectionId,
      p_expected_generation: options.expectedGeneration,
      p_samples: asJson(samples),
    });
    if (rpcError) {
      console.error("Unable to store workout heart rate:", {
        code: rpcError.code,
      });
      throw error(500, "Workout heart-rate data could not be saved.");
    }
  }
}

export async function deleteMobileFitnessRecords(options: {
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">;
  connectionId: string;
  deletions: MobileHealthDeletion[];
  expectedGeneration: number;
  userId: string;
}): Promise<void> {
  const actionable = options.deletions.filter(
    (deletion) => deletion.kind === "heart_rate" || deletion.kind === "workout",
  );
  const client = serviceClient(options.config.serviceRoleKey);
  for (const deletions of boundedJsonBatches(actionable, 100, 30 * 1024)) {
    const { error: rpcError } = await client.rpc(
      "fitness_delete_mobile_source_records",
      {
        p_user_id: options.userId,
        p_connection_id: options.connectionId,
        p_deletions: asJson(deletions),
        p_expected_generation: options.expectedGeneration,
      },
    );
    if (rpcError) {
      console.error("Unable to reconcile deleted mobile fitness data:", {
        code: rpcError.code,
      });
      throw error(500, "Deleted fitness data could not be reconciled.");
    }
  }
}

export async function registerDeviceConnection(options: {
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">;
  deviceKey: string;
  metadata: Json;
  provider: "apple_health" | "health_connect";
  scopes: string[];
  userId: string;
}): Promise<string> {
  const { data, error: rpcError } = await serviceClient(
    options.config.serviceRoleKey,
  ).rpc("fitness_register_device_connection", {
    p_user_id: options.userId,
    p_provider: options.provider,
    p_device_key: options.deviceKey,
    p_scopes: options.scopes,
    p_consent_version: "fitness-v1",
    p_metadata: options.metadata,
  });
  if (rpcError || data === null) {
    console.error("Unable to register device fitness connection:", {
      code: rpcError?.code,
      provider: options.provider,
    });
    throw error(500, "The device health connection could not be saved.");
  }
  return data;
}

export async function markDeviceFitnessSynced(options: {
  config: Pick<FitnessRuntimeConfig, "serviceRoleKey">;
  connectionId: string;
  userId: string;
}): Promise<void> {
  const { error: updateError } = await serviceClient(
    options.config.serviceRoleKey,
  )
    .from("fitness_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", options.connectionId)
    .eq("user_id", options.userId);
  if (updateError) {
    console.warn("Unable to update device fitness sync state:", {
      code: updateError.code,
    });
  }
}

export function credentialsForProvider(
  config: FitnessRuntimeConfig,
  provider: CloudFitnessProvider,
): OAuthClientCredentials {
  return oauthCredentials(config, provider);
}
