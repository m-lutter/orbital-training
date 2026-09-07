import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  const {
    data: { user },
  } = await locals.getUser();
  return { fitnessSyncUserId: user?.id ?? null };
};
