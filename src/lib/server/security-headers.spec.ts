import { describe, expect, it } from "vitest";
import { applySecurityHeaders } from "./security-headers";

describe("applySecurityHeaders", () => {
  it("hardens HTML responses and prevents sensitive caching", () => {
    const response = new Response("<p>account</p>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    applySecurityHeaders(response, new URL("http://127.0.0.1/account"));

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("strict-transport-security")).toBe(false);
  });

  it("adds HSTS to HTTPS JSON responses", () => {
    const response = Response.json({ status: "ok" });
    applySecurityHeaders(response, new URL("https://training.example/api"));

    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=31536000",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not overwrite explicit static-asset caching", () => {
    const response = new Response("image", {
      headers: {
        "cache-control": "public, max-age=31536000",
        "content-type": "image/svg+xml",
      },
    });
    applySecurityHeaders(
      response,
      new URL("https://training.example/icon.svg"),
    );

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000",
    );
  });

  it("prevents authentication redirects from being cached", () => {
    const response = new Response(null, {
      status: 303,
      headers: { location: "/login" },
    });
    applySecurityHeaders(
      response,
      new URL("https://training.example/dashboard"),
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
