import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HealthPermissionSelection,
  HealthProviderName,
  HealthSyncEnvelopeV1,
} from "../health/types";

export interface SyncAcknowledgement {
  readonly accepted: true;
  readonly receivedRecords: number;
  readonly receivedDeletions: number;
  readonly workoutCapture?: {
    readonly endedAt?: string;
    readonly sourceSessionKey: string;
  };
}

export interface HealthSyncTransport {
  connect(
    provider: HealthProviderName,
    permissions: HealthPermissionSelection,
  ): Promise<void>;
  send(envelope: HealthSyncEnvelopeV1): Promise<SyncAcknowledgement>;
}

type AuthenticatedSession = {
  readonly access_token: string;
};

function acknowledgement(
  value: unknown,
  envelope: HealthSyncEnvelopeV1,
): SyncAcknowledgement {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { accepted?: unknown }).accepted !== true
  )
    throw new Error("Health sync returned an invalid acknowledgement.");
  const response = value as {
    receivedRecords?: unknown;
    receivedDeletions?: unknown;
    workoutCapture?: unknown;
  };
  const capture =
    typeof response.workoutCapture === "object" &&
    response.workoutCapture !== null
      ? (response.workoutCapture as Record<string, unknown>)
      : undefined;
  return {
    accepted: true,
    receivedRecords:
      typeof response.receivedRecords === "number"
        ? response.receivedRecords
        : envelope.records.length,
    receivedDeletions:
      typeof response.receivedDeletions === "number"
        ? response.receivedDeletions
        : envelope.deletions.length,
    ...(capture && typeof capture.sourceSessionKey === "string"
      ? {
          workoutCapture: {
            sourceSessionKey: capture.sourceSessionKey,
            ...(typeof capture.endedAt === "string"
              ? { endedAt: capture.endedAt }
              : {}),
          },
        }
      : {}),
  };
}

async function responseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function errorMessage(status: number, value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const response = value as { message?: unknown; error?: unknown };
    if (typeof response.message === "string" && response.message.trim())
      return response.message;
    if (typeof response.error === "string" && response.error.trim())
      return response.error;
  }
  return `request failed with HTTP ${status}`;
}

/**
 * Sends health records to the same Cloudflare Worker as the web app. Ownership
 * is derived from the Supabase access token; the advisory userId in the body is
 * never an authorization mechanism.
 */
export class WorkerHealthSyncTransport implements HealthSyncTransport {
  private readonly connectEndpoint: string;
  private readonly endpoint: string;

  constructor(
    private readonly client: SupabaseClient,
    appOrigin: string,
  ) {
    this.endpoint = new URL("/api/fitness/mobile/sync", appOrigin).toString();
    this.connectEndpoint = new URL(
      "/api/fitness/mobile/connect",
      appOrigin,
    ).toString();
  }

  async connect(
    provider: HealthProviderName,
    permissions: HealthPermissionSelection,
  ): Promise<void> {
    const { response, body } = await this.authenticatedRequest(
      this.connectEndpoint,
      { schemaVersion: 1, provider, permissions },
    );
    if (!response.ok)
      throw new Error(
        `Health connection was rejected: ${errorMessage(response.status, body)}`,
      );
    if (
      typeof body !== "object" ||
      body === null ||
      (body as { connected?: unknown }).connected !== true
    ) {
      throw new Error("Health connection returned an invalid acknowledgement.");
    }
  }

  async send(envelope: HealthSyncEnvelopeV1): Promise<SyncAcknowledgement> {
    const { response, body } = await this.authenticatedRequest(
      this.endpoint,
      envelope,
    );
    if (!response.ok)
      throw new Error(
        `Health sync was rejected: ${errorMessage(response.status, body)}`,
      );
    return acknowledgement(body, envelope);
  }

  private async authenticatedRequest(
    endpoint: string,
    body: unknown,
  ): Promise<{ body: unknown; response: Response }> {
    let session = await this.session(false);
    let response = await this.request(endpoint, body, session.access_token);
    if (response.status === 401) {
      session = await this.session(true);
      response = await this.request(endpoint, body, session.access_token);
    }
    return { response, body: await responseBody(response) };
  }

  private async session(refresh: boolean): Promise<AuthenticatedSession> {
    const result = refresh
      ? await this.client.auth.refreshSession()
      : await this.client.auth.getSession();
    if (result.error)
      throw new Error(`Authentication failed: ${result.error.message}`);
    const accessToken = result.data.session?.access_token;
    if (!accessToken)
      throw new Error(
        "Sign in to Orbital Training before syncing health data.",
      );
    return { access_token: accessToken };
  }

  private async request(
    endpoint: string,
    body: unknown,
    accessToken: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new Error(
          "Health sync timed out. It will retry when the app resumes.",
          { cause: error },
        );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
