import type { Json } from "$lib/database.types";
import { readProgramDraft } from "$lib/engine";
import {
  PersistenceLimitError,
  assertWorkoutWriteSizes,
} from "$lib/persistence/limits";
import { programScheduleDateOffset } from "$lib/program-dates";
import { parseWorkoutLogRow } from "$lib/workouts";
import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function movementContext(
  locals: App.Locals,
  programId: string,
  date: string,
) {
  const {
    data: { user },
  } = await locals.getUser();
  if (!user) redirect(303, "/login");
  if (!DATE_PATTERN.test(date)) error(404, "Training day not found.");

  const { data: row, error: queryError } = await locals.supabase
    .from("programs")
    .select("id, name, payload")
    .eq("id", programId)
    .maybeSingle();
  if (queryError) error(500, "The program could not be loaded.");
  if (!row) error(404, "Program not found.");
  const draft = readProgramDraft(row.payload);
  if (draft.schemaVersion !== 3)
    error(400, "This program has no daily movement target.");
  const offset = programScheduleDateOffset(
    draft.program,
    draft.inputSnapshot.goals.startDate,
    date,
  );
  const weekNumber = Math.floor(offset / 7) + 1;
  if (offset < 0 || weekNumber > draft.program.horizonWeeks)
    error(404, "That date is outside this program.");
  const target = draft.program.weeks[weekNumber - 1]?.sessions.find(
    (session) => session.kind === "movement",
  )?.movementTarget;
  if (target === undefined) error(404, "No daily movement target was found.");
  return { row, draft, offset, weekNumber, target };
}

export const load: PageServerLoad = async ({ locals, params }) => {
  const context = await movementContext(locals, params.id, params.date);
  const sessionId = `daily-movement:${params.date}`;
  const { data, error: logError } = await locals.supabase
    .from("workout_logs")
    .select(
      "id, program_id, program_version, session_id, week_number, session_sequence, status, exercise_logs, cardio_log, movement_log, duration_minutes, miss_reason, started_at, completed_at, updated_at",
    )
    .eq("program_id", context.row.id)
    .eq("program_version", context.draft.program.version)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (logError) error(500, "The daily movement check-in could not be loaded.");
  const existing =
    data === null ? undefined : parseWorkoutLogRow(data).movementLog;
  return {
    program: { id: context.row.id, name: context.row.name },
    date: params.date,
    weekNumber: context.weekNumber,
    target: context.target,
    existing,
  };
};

export const actions: Actions = {
  save: async ({ locals, params, request }) => {
    const context = await movementContext(locals, params.id, params.date);
    const form = await request.formData();
    const answer = String(form.get("answer") ?? "");
    if (!["yes", "no", "untracked"].includes(answer))
      return fail(400, {
        message: "Choose whether you reached the movement target.",
      });
    const rawActual = String(form.get("actual") ?? "").trim();
    const actual = rawActual === "" ? undefined : Number(rawActual);
    const maximum = context.target.steps !== undefined ? 250_000 : 1_440;
    if (
      actual !== undefined &&
      (!Number.isFinite(actual) || actual < 0 || actual > maximum)
    )
      return fail(400, { message: "Check the movement amount entered." });
    const movementLog = {
      targetType:
        context.target.steps !== undefined ? "steps" : "walking_minutes",
      target: context.target.steps ?? context.target.walkingMinutes ?? 0,
      ...(answer === "untracked" ? {} : { met: answer === "yes" }),
      ...(actual === undefined
        ? {}
        : context.target.steps !== undefined
          ? { actualSteps: Math.round(actual) }
          : { actualWalkingMinutes: Math.round(actual) }),
      checkInDate: params.date,
    };
    try {
      assertWorkoutWriteSizes({
        exerciseLogs: [],
        cardioLog: {},
        movementLog,
      });
    } catch (caughtError) {
      if (caughtError instanceof PersistenceLimitError)
        return fail(413, {
          message: "The movement check-in is too large to save safely.",
        });
      throw caughtError;
    }
    const { error: saveError } = await locals.supabase.rpc(
      "save_workout_log_v4",
      {
        p_program_id: context.row.id,
        p_program_version: context.draft.program.version,
        p_session_id: `daily-movement:${params.date}`,
        p_week_number: context.weekNumber,
        p_session_sequence: (context.offset % 7) + 1,
        p_status: "completed",
        p_exercise_logs: [] as unknown as Json,
        p_cardio_log: {} as unknown as Json,
        p_movement_log: movementLog as unknown as Json,
        p_duration_minutes: undefined,
        p_miss_reason: undefined,
        p_new_program_payload: null,
        p_reverse_patch: null,
      },
    );
    if (saveError) {
      console.error("Unable to save daily movement:", saveError.message);
      return fail(500, {
        message: "The movement check-in could not be saved.",
      });
    }
    return { message: "Daily movement saved." };
  },
};
