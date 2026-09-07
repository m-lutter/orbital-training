const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Returns the canonical URL for safe navigation requests made to a legacy or
 * alternate production hostname. Non-navigation requests stay on the old
 * host so an already-open workout can finish saving during the cutover.
 */
export function canonicalRedirectUrl(
  requestUrl: URL,
  method: string,
  configuredOrigin: string | undefined,
): URL | undefined {
  if (!configuredOrigin || !["GET", "HEAD"].includes(method.toUpperCase()))
    return undefined;
  if (LOCAL_HOSTS.has(requestUrl.hostname)) return undefined;

  let canonical: URL;
  try {
    canonical = new URL(configuredOrigin);
  } catch {
    return undefined;
  }
  if (canonical.protocol !== "https:" || canonical.pathname !== "/")
    return undefined;
  if (requestUrl.origin === canonical.origin) return undefined;

  canonical.pathname = requestUrl.pathname;
  canonical.search = requestUrl.search;
  return canonical;
}
