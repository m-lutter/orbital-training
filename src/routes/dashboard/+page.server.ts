import { fail, redirect } from "@sveltejs/kit";
import { readProgramDraft } from "$lib/engine";
import { summarizeRecentProgram } from "$lib/dashboard/recent-program";
import { recentProgramId } from "$lib/server/recent-program";
import { programIconName } from "$lib/ui/program-icons";
import {
  latestWorkoutLogs,
  parseWorkoutLogRow,
  type WorkoutLogDatabaseRow,
} from "$lib/workouts";
import type { Actions, PageServerLoad } from "./$types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROGRAM_ARCHIVE_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
  const {
    data: { user },
  } = await locals.getUser();

  if (!user) {
    redirect(303, "/login");
  }

  const { data: programs, error } = await locals.supabase
    .from("programs")
    .select(
      "id, name, created_at, icon:payload->questionnaireFormValues->>programIcon",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(PROGRAM_ARCHIVE_LIMIT + 1);

  if (error) {
    console.error("Unable to load programs:", error.message);
  }

  const programArchiveTruncated =
    (programs?.length ?? 0) > PROGRAM_ARCHIVE_LIMIT;
  const rows = (programs ?? []).slice(0, PROGRAM_ARCHIVE_LIMIT);
  const ownedIds = new Set(rows.map((program) => program.id));
  let selectedId = recentProgramId(cookies);
  if (selectedId === undefined || !ownedIds.has(selectedId)) {
    const { data: latestLog, error: latestLogError } = await locals.supabase
      .from("workout_logs")
      .select("program_id, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      latestLogError &&
      !["42P01", "PGRST205"].includes(latestLogError.code ?? "")
    )
      console.error(
        "Unable to identify the recent program:",
        latestLogError.message,
      );
    selectedId =
      latestLog !== null && ownedIds.has(latestLog.program_id)
        ? latestLog.program_id
        : rows[0]?.id;
  }

  const recentRow = rows.find((program) => program.id === selectedId);
  let recentProgram:
    | {
        id: string;
        name: string;
        summary: ReturnType<typeof summarizeRecentProgram>;
      }
    | undefined;
  if (recentRow !== undefined) {
    try {
      const { data: projectedData, error: projectedError } =
        await locals.supabase.rpc("dashboard_program_context_v2", {
          p_program_id: recentRow.id,
        });
      if (projectedError) throw projectedError;
      if (!isRecord(projectedData))
        throw new Error("Recent program not found.");
      const draft = readProgramDraft(projectedData.payload);
      if (draft.schemaVersion === 3) {
        const logRows = Array.isArray(projectedData.logs)
          ? projectedData.logs
          : [];
        const logs = latestWorkoutLogs(
          logRows
            .filter(isRecord)
            .map((row) =>
              parseWorkoutLogRow(row as unknown as WorkoutLogDatabaseRow),
            ),
        );
        const reviewedWeeks = Array.isArray(projectedData.reviewedWeeks)
          ? projectedData.reviewedWeeks.filter((week): week is number =>
              Number.isInteger(week),
            )
          : [];
        recentProgram = {
          id: recentRow.id,
          name: recentRow.name,
          summary: summarizeRecentProgram(
            recentRow.id,
            draft,
            logs,
            reviewedWeeks,
          ),
        };
      }
    } catch {
      console.error("Unable to prepare the recent program.");
    }
  }

  return {
    email: user.email ?? "",
    programs: rows.map((program) => ({
      id: program.id,
      name: program.name,
      created_at: program.created_at,
      icon: programIconName(program.icon),
    })),
    programArchiveTruncated,
    recentProgram,
  };
};

export const actions: Actions = {
  delete: async ({ locals, request }) => {
    const {
      data: { user },
    } = await locals.getUser();
    if (!user) redirect(303, "/login");

    const formData = await request.formData();
    const programId = String(formData.get("programId") ?? "");
    if (!UUID_PATTERN.test(programId)) {
      return fail(400, { message: "That program could not be identified." });
    }

    /* RLS makes another user's program invisible and undeletable. */
    const { data: deleted, error } = await locals.supabase
      .from("programs")
      .delete()
      .eq("id", programId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("Unable to delete program:", error.message);
      return fail(500, {
        message:
          "The program could not be deleted. Confirm the newest Supabase migration has been applied.",
      });
    }
    if (!deleted) return fail(404, { message: "Program not found." });
    return { deletedId: deleted.id, message: "Program deleted." };
  },
};
