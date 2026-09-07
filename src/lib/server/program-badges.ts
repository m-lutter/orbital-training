import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/database.types";

/**
 * The database returns only the entitlement boolean. It applies RLS and an
 * explicit auth.uid() predicate instead of transferring all training data.
 */
export async function lunarCompletionIsUnlocked(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("lunar_completion_is_unlocked");
  if (error) {
    if (!["42883", "PGRST202"].includes(error.code ?? ""))
      console.error("Unable to check badge unlock:", error.message);
    return false;
  }
  return data === true;
}
