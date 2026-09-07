import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const {
    data: { user },
  } = await locals.getUser();

  redirect(303, user ? "/dashboard" : "/login");
};
