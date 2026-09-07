import { describe, expect, it, vi } from "vitest";
import {
  exchangeFitnessAuthorizationCode,
  fitnessAuthorizationUrl,
  GOOGLE_HEALTH_SCOPES,
  refreshFitnessAccessToken,
  WHOOP_SCOPES,
} from "./provider-clients";

describe("fitness provider OAuth clients", () => {
  it("builds Google offline consent with only required health scopes", () => {
    const url = fitnessAuthorizationUrl({
      clientId: "google-client",
      provider: "google_health",
      redirectUri: "https://example.com/callback",
      state: "state-value",
    });
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      ...GOOGLE_HEALTH_SCOPES,
    ]);
  });

  it("requests WHOOP offline access and bounded read scopes", () => {
    const url = fitnessAuthorizationUrl({
      clientId: "whoop-client",
      provider: "whoop",
      redirectUri: "https://example.com/callback",
      state: "eight-character-state",
    });
    expect(url.origin).toBe("https://api.prod.whoop.com");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      ...WHOOP_SCOPES,
    ]);
  });

  it("exchanges an authorization code without logging provider contents", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: "read:sleep offline",
          token_type: "bearer",
        }),
        { status: 200 },
      ),
    );
    const tokens = await exchangeFitnessAuthorizationCode(
      "whoop",
      { clientId: "id", clientSecret: "secret" },
      { code: "code", redirectUri: "https://example.com/callback" },
      fetcher,
    );
    expect(tokens.accessToken).toBe("access");
    expect(tokens.refreshToken).toBe("refresh");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("retains a rotating provider's prior refresh token when omitted", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    const tokens = await refreshFitnessAccessToken(
      "google_health",
      { clientId: "id", clientSecret: "secret" },
      "existing-refresh",
      fetcher,
    );
    expect(tokens.refreshToken).toBe("existing-refresh");
  });
});
