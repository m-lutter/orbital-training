import { describe, expect, it } from "vitest";
import { publicEnvironmentError } from "./environment";

function jwt(role: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

describe("publicEnvironmentError", () => {
  it("accepts local HTTP and hosted HTTPS with public keys", () => {
    expect(
      publicEnvironmentError({
        supabaseUrl: "http://127.0.0.1:54321",
        supabasePublishableKey: jwt("anon"),
      }),
    ).toBeUndefined();
    expect(
      publicEnvironmentError({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
      }),
    ).toBeUndefined();
  });

  it("rejects invalid or insecure hosted URLs", () => {
    expect(
      publicEnvironmentError({
        supabaseUrl: "not-a-url",
        supabasePublishableKey: jwt("anon"),
      }),
    ).toContain("valid absolute URL");
    expect(
      publicEnvironmentError({
        supabaseUrl: "http://project.supabase.co",
        supabasePublishableKey: jwt("anon"),
      }),
    ).toContain("must use HTTPS");
  });

  it("rejects missing, secret, and service-role keys", () => {
    expect(
      publicEnvironmentError({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "short",
      }),
    ).toContain("missing or malformed");
    expect(
      publicEnvironmentError({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: [
          "sb",
          "secret",
          "abcdefghijklmnopqrstuvwxyz",
        ].join("_"),
      }),
    ).toContain("must never be exposed");
    expect(
      publicEnvironmentError({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: jwt("service_role"),
      }),
    ).toContain("must never be exposed");
  });
});
