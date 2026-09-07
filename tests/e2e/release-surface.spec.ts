import { APP_VERSION } from "../../src/lib/app-meta";
import { expect, test } from "playwright/test";

test("the public release surface is healthy and hardened", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", version: APP_VERSION });
  expect(health.headers()["cache-control"]).toContain("no-store");
  expect(health.headers()["x-content-type-options"]).toBe("nosniff");

  const login = await request.get("/login");
  expect(login.status()).toBe(200);
  expect(login.headers()["x-frame-options"]).toBe("DENY");
  expect(login.headers()["content-security-policy"]).toContain(
    "default-src 'self'",
  );
  expect(login.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );

  const dashboard = await request.get("/dashboard", { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(dashboard.status());
  expect(
    new URL(dashboard.headers().location, "http://127.0.0.1:4173").pathname,
  ).toBe("/login");
});
