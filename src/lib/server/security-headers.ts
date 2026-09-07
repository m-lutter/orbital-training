const STANDARD_SECURITY_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
} as const;

export function applySecurityHeaders(
  response: Response,
  requestUrl: URL,
): void {
  for (const [name, value] of Object.entries(STANDARD_SECURITY_HEADERS))
    response.headers.set(name, value);

  if (requestUrl.protocol === "https:") {
    response.headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const redirect = response.status >= 300 && response.status < 400;
  if (
    contentType.includes("text/html") ||
    contentType.includes("json") ||
    redirect ||
    response.headers.has("set-cookie")
  )
    response.headers.set("cache-control", "private, no-store");
}
