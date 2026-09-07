import { createClient } from "@supabase/supabase-js";

const LOCAL_SUPABASE_HOSTS = new Set(["127.0.0.1", "localhost"]);

export async function provisionConfirmedLocalUser(
  email: string,
  password: string,
): Promise<void> {
  const rawSupabaseUrl = process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (rawSupabaseUrl === undefined || serviceRoleKey === undefined) {
    throw new Error(
      "Local E2E user provisioning requires PUBLIC_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const supabaseUrl = new URL(rawSupabaseUrl);
  if (!LOCAL_SUPABASE_HOSTS.has(supabaseUrl.hostname)) {
    throw new Error("E2E user provisioning is restricted to local Supabase.");
  }

  const admin = createClient(rawSupabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error !== null) {
    throw new Error(
      `Local confirmed-user provisioning failed: ${error.message}`,
    );
  }
}
