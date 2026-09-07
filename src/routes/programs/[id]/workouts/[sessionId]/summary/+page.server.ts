import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const {
    data: { user },
  } = await event.locals.getUser();
  if (!user) redirect(303, "/login");
  const { data: program, error: programError } = await event.locals.supabase
    .from("programs")
    .select("id")
    .eq("id", event.params.id)
    .maybeSingle();
  if (programError) error(500, "The program could not be loaded.");
  if (program === null) error(404, "Program not found.");

  return {
    nextHref: `/programs/${event.params.id}/workout`,
  };
};
