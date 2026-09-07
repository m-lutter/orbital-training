import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ locals }) => {
  const { error } = await locals.supabase.auth.signOut();

  if (error) {
    return new Response("Unable to log out.", { status: 500 });
  }

  redirect(303, "/login");
};
