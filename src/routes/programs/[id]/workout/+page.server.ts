import { readProgramDraft } from "$lib/engine";
import { nextWeeklyReview } from "$lib/reviews";
import {
  latestWorkoutLogs,
  nextWorkoutSession,
  parseWorkoutLogRow,
  type WorkoutLogDatabaseRow,
} from "$lib/workouts";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const load: PageServerLoad = async ({ locals, params }) => {
  const {
    data: { user },
  } = await locals.getUser();
  if (!user) redirect(303, "/login");

  const { data, error: contextError } = await locals.supabase.rpc(
    "dashboard_program_context_v2",
    { p_program_id: params.id },
  );
  if (contextError) {
    const migrationMissing = ["42883", "PGRST202"].includes(
      contextError.code ?? "",
    );
    if (migrationMissing) {
      error(
        503,
        "Apply the latest Supabase performance migration before opening the next workout.",
      );
    }
    error(500, "The program could not be loaded.");
  }
  if (!isRecord(data)) error(404, "Program not found.");

  const draft = readProgramDraft(data.payload);
  if (draft.schemaVersion !== 3) redirect(303, `/programs/${params.id}`);

  const logRows = Array.isArray(data.logs) ? data.logs : [];
  const logs = latestWorkoutLogs(
    logRows
      .filter(isRecord)
      .map((row) =>
        parseWorkoutLogRow(row as unknown as WorkoutLogDatabaseRow),
      ),
  );
  const reviewedWeeks = Array.isArray(data.reviewedWeeks)
    ? data.reviewedWeeks.filter((week): week is number =>
        Number.isInteger(week),
      )
    : [];
  const reviewDue = nextWeeklyReview(draft.program, logs, reviewedWeeks);
  if (reviewDue !== undefined) {
    redirect(303, `/programs/${params.id}/reviews/${reviewDue}`);
  }

  const next = nextWorkoutSession(draft.program, draft.inputSnapshot, logs);
  if (next === undefined) redirect(303, `/programs/${params.id}?complete=1`);
  redirect(
    303,
    `/programs/${params.id}/workouts/${encodeURIComponent(next.session.id)}`,
  );
};
