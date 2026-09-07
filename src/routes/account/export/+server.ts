import { APP_VERSION } from "$lib/app-meta";
import {
  AccountExportBudget,
  AccountExportLimitError,
  serializeBoundedAccountExport,
} from "$lib/server/account-export";
import type { Database } from "$lib/database.types";
import type { PostgrestError } from "@supabase/supabase-js";
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const PAGE_SIZE = 250;
type FitnessHeartRateBucket =
  Database["public"]["Tables"]["fitness_hr_5m"]["Row"];

class AccountExportQueryError extends Error {
  constructor(readonly code: string) {
    super("account_export_query_failed");
    this.name = "AccountExportQueryError";
  }
}

async function collectPages<T extends { id: string }>(
  loadPage: (
    afterId: string | undefined,
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  budget: AccountExportBudget,
): Promise<T[]> {
  const data: T[] = [];
  let afterId: string | undefined;
  for (;;) {
    const result = await loadPage(afterId);
    if (result.error)
      throw new AccountExportQueryError(result.error.code ?? "UNKNOWN");
    const page = result.data ?? [];
    budget.add(page);
    data.push(...page);
    if (page.length < PAGE_SIZE) return data;
    const nextId = page.at(-1)?.id;
    if (nextId === undefined || nextId === afterId)
      throw new AccountExportQueryError("INVALID_PAGE_CURSOR");
    afterId = nextId;
  }
}

async function loadAccountData(
  supabase: App.Locals["supabase"],
  budget: AccountExportBudget,
) {
  const profileResult = await supabase
    .from("profiles")
    .select("*")
    .maybeSingle();
  if (profileResult.error)
    throw new AccountExportQueryError(profileResult.error.code ?? "UNKNOWN");
  budget.add([profileResult.data]);

  const programs = await collectPages((afterId) => {
    let query = supabase
      .from("programs")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const questionnaireResponses = await collectPages((afterId) => {
    let query = supabase
      .from("questionnaire_responses")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const programVersions = await collectPages((afterId) => {
    let query = supabase
      .from("program_versions")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const workoutLogs = await collectPages((afterId) => {
    let query = supabase
      .from("workout_logs")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const weeklyReviews = await collectPages((afterId) => {
    let query = supabase
      .from("weekly_reviews")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const fitnessConnections = await collectPages((afterId) => {
    let query = supabase
      .from("fitness_connections")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const fitnessDailyMetrics = await collectPages((afterId) => {
    let query = supabase
      .from("fitness_daily_metrics")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const fitnessWorkoutSessions = await collectPages((afterId) => {
    let query = supabase
      .from("fitness_workout_sessions")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const fitnessWorkoutSummaries = await collectPages((afterId) => {
    let query = supabase
      .from("fitness_workout_summaries")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const fitnessHeartRateBuckets: FitnessHeartRateBucket[] = [];
  for (const connection of fitnessConnections) {
    let afterBucketStart: string | undefined;
    for (;;) {
      let query = supabase
        .from("fitness_hr_5m")
        .select("*")
        .eq("connection_id", connection.id)
        .order("bucket_start")
        .limit(PAGE_SIZE);
      if (afterBucketStart !== undefined)
        query = query.gt("bucket_start", afterBucketStart);
      const result = await query;
      if (result.error)
        throw new AccountExportQueryError(result.error.code ?? "UNKNOWN");
      const page = result.data ?? [];
      budget.add(page);
      fitnessHeartRateBuckets.push(...page);
      if (page.length < PAGE_SIZE) break;
      const nextBucketStart = page.at(-1)?.bucket_start;
      if (nextBucketStart === undefined || nextBucketStart === afterBucketStart)
        throw new AccountExportQueryError("INVALID_PAGE_CURSOR");
      afterBucketStart = nextBucketStart;
    }
  }
  const fitnessSummaries = await collectPages((afterId) => {
    let query = supabase
      .from("fitness_summaries")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const fitnessConsentEvents = await collectPages((afterId) => {
    let query = supabase
      .from("fitness_consent_events")
      .select("*")
      .order("id")
      .limit(PAGE_SIZE);
    if (afterId !== undefined) query = query.gt("id", afterId);
    return query;
  }, budget);
  const feedbackResult = await supabase.rpc("export_my_feedback");
  if (feedbackResult.error)
    throw new AccountExportQueryError(feedbackResult.error.code ?? "UNKNOWN");
  const feedbackReports = Array.isArray(feedbackResult.data)
    ? feedbackResult.data
    : [];
  budget.add(feedbackReports);

  return {
    profile: profileResult.data,
    programs,
    questionnaireResponses,
    programVersions,
    workoutLogs,
    weeklyReviews,
    fitnessConnections,
    fitnessDailyMetrics,
    fitnessWorkoutSessions,
    fitnessWorkoutSummaries,
    fitnessHeartRateBuckets,
    fitnessSummaries,
    fitnessConsentEvents,
    feedbackReports,
  };
}

export const GET: RequestHandler = () =>
  new Response("Account exports require an intentional form submission.", {
    status: 405,
    headers: {
      allow: "POST",
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });

export const POST: RequestHandler = async ({ locals, request, url }) => {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) {
    return new Response("Cross-origin export requests are not allowed.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const {
    data: { user },
  } = await locals.getUser();
  if (!user) redirect(303, "/login");

  const budget = new AccountExportBudget();
  let accountData: Awaited<ReturnType<typeof loadAccountData>>;
  try {
    accountData = await loadAccountData(locals.supabase, budget);
  } catch (caughtError) {
    if (caughtError instanceof AccountExportLimitError) {
      return new Response(
        "Your export is larger than the safe instant-download limit. Email support from the address on your account to arrange a staged export.",
        {
          status: 413,
          headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
    }
    if (caughtError instanceof AccountExportQueryError) {
      console.error("Unable to export account data:", caughtError.code);
      return new Response(
        "Your data could not be exported. Confirm the latest Supabase migrations are applied, then try again.",
        {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
    }
    throw caughtError;
  }

  const exportedAt = new Date();
  const payload = {
    export: {
      format: "orbital-training-account-v1",
      appVersion: APP_VERSION,
      exportedAt: exportedAt.toISOString(),
      accountEmail: user.email ?? null,
    },
    ...accountData,
  };

  let encoded: { body: string; byteLength: number };
  try {
    encoded = serializeBoundedAccountExport(payload);
  } catch (caughtError) {
    if (!(caughtError instanceof AccountExportLimitError)) throw caughtError;
    return new Response(
      "Your export is larger than the safe instant-download limit. Email support from the address on your account to arrange a staged export.",
      {
        status: 413,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  return new Response(encoded.body, {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="orbital-training-export-${exportedAt.toISOString().slice(0, 10)}.json"`,
      "content-length": String(encoded.byteLength),
      "content-type": "application/json; charset=utf-8",
    },
  });
};
