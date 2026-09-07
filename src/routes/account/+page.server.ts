import { fail, redirect } from "@sveltejs/kit";
import {
  fitnessConfigurationStatus,
  isEnabledFitnessProvider,
} from "$lib/server/fitness/config";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform }) => {
  const {
    data: { user },
  } = await locals.getUser();
  if (!user) redirect(303, "/login");

  const configuration = fitnessConfigurationStatus({ platform });
  const { data: fitnessConnections, error: fitnessError } =
    await locals.supabase
      .from("fitness_connections")
      .select(
        "id, provider, status, scopes, connected_at, disconnected_at, last_synced_at, last_error_code",
      )
      .order("connected_at", { ascending: true });
  if (
    fitnessError !== null &&
    !["42P01", "PGRST204", "PGRST205"].includes(fitnessError.code ?? "")
  ) {
    console.error("Unable to load fitness connections:", {
      code: fitnessError.code,
    });
  }

  return {
    email: user.email ?? "",
    fitness: {
      configuration,
      schemaReady: fitnessError === null,
      connections: (fitnessConnections ?? []).filter((connection) =>
        isEnabledFitnessProvider(connection.provider),
      ),
    },
  };
};

export const actions: Actions = {
  delete: async ({ locals, request }) => {
    const {
      data: { user },
    } = await locals.getUser();
    if (!user?.email) redirect(303, "/login");

    const formData = await request.formData();
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "").trim();
    if (confirmation !== "DELETE")
      return fail(400, {
        message: 'Type "DELETE" exactly to confirm account deletion.',
      });
    if (password.length < 8)
      return fail(400, {
        message: "Enter your current password before deleting your account.",
      });

    // Reauthenticate immediately before the destructive RPC. This protects
    // users who leave an authenticated device unattended and avoids adding a
    // service-role secret to the application runtime.
    const { error: authenticationError } =
      await locals.supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });
    if (authenticationError)
      return fail(400, {
        message: "The password was incorrect. Your account was not deleted.",
      });

    const { data: deleted, error } =
      await locals.supabase.rpc("delete_my_account");
    if (error || deleted !== true) {
      console.error("Unable to delete account:", { code: error?.code });
      return fail(500, {
        message:
          "Your account could not be deleted. Confirm the Phase 6 Supabase migration is applied, then try again.",
      });
    }

    // Local sign-out clears the SSR auth cookies even though the corresponding
    // Auth user has just been removed by the transaction above.
    const { error: signOutError } = await locals.supabase.auth.signOut({
      scope: "local",
    });
    if (signOutError)
      console.warn("Account deleted, but local sign-out reported an error:", {
        code: signOutError.code,
      });

    redirect(303, "/login?account=deleted");
  },
};
