function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized)
    throw new Error(
      `${name} is required. Copy .env.example to .env.local and provide the public client configuration.`,
    );
  return normalized;
}

function appOrigin(value: string | undefined): string {
  const configured = required("EXPO_PUBLIC_APP_ORIGIN", value);
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("EXPO_PUBLIC_APP_ORIGIN must be an absolute URL.");
  }
  const localDevelopment =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !localDevelopment)
    throw new Error(
      "EXPO_PUBLIC_APP_ORIGIN must use HTTPS outside local development.",
    );
  return parsed.origin;
}

export const mobileConfig = {
  supabaseUrl: required(
    "EXPO_PUBLIC_SUPABASE_URL",
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ),
  supabasePublishableKey: required(
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  appOrigin: appOrigin(process.env.EXPO_PUBLIC_APP_ORIGIN),
} as const;
