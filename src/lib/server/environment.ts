export interface PublicEnvironment {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

function jwtRole(value: string): string | undefined {
  const payload = value.split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : undefined;
  } catch {
    return undefined;
  }
}

/** Returns a deployment-safe explanation, or undefined when configuration is valid. */
export function publicEnvironmentError(
  environment: PublicEnvironment,
): string | undefined {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(environment.supabaseUrl);
  } catch {
    return "PUBLIC_SUPABASE_URL is not a valid absolute URL.";
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol))
    return "PUBLIC_SUPABASE_URL must use HTTP or HTTPS.";

  const localHost = ["127.0.0.1", "localhost"].includes(parsedUrl.hostname);
  if (!localHost && parsedUrl.protocol !== "https:")
    return "Hosted Supabase connections must use HTTPS.";

  const key = environment.supabasePublishableKey.trim();
  if (key.length < 20 || /\s/.test(key))
    return "PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or malformed.";
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role")
    return "A secret or service-role key must never be exposed as PUBLIC_SUPABASE_PUBLISHABLE_KEY.";

  return undefined;
}
