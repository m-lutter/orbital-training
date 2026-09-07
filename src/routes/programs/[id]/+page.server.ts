import { readProgramDraft, ProgramPayloadError } from "$lib/engine";
import {
  heldProgressionTargets,
  nextWeeklyReview,
  parseWeeklyReviewRow,
  type WeeklyReviewDatabaseRow,
} from "$lib/reviews";
import {
  latestWorkoutLogs,
  loadRecommendation,
  nextWorkoutSession,
  parseWorkoutLogRow,
} from "$lib/workouts";
import { error, redirect } from "@sveltejs/kit";
import { rememberRecentProgram } from "$lib/server/recent-program";
import { presentProgramOverview } from "$lib/server/program-overview";
import {
  PROGRAM_OVERVIEW_VISITS_COOKIE,
  programOverviewVisit,
} from "$lib/program-overview-visit";
import type { PageServerLoad } from "./$types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({
  locals,
  params,
  cookies,
  url,
}) => {
  const {
    data: { user },
  } = await locals.getUser();

  if (!user) {
    redirect(303, "/login");
  }

  if (!UUID_PATTERN.test(params.id)) {
    error(404, "Program not found.");
  }

  /*
   * There is deliberately no user_id filter. If the row belongs to
   * another user, RLS makes it appear nonexistent.
   */
  const { data: program, error: queryError } = await locals.supabase
    .from("programs")
    .select("id, name, created_at, payload")
    .eq("id", params.id)
    .maybeSingle();

  if (queryError) {
    console.error("Unable to load program:", queryError.message);
    error(500, "The program could not be loaded.");
  }

  if (!program) {
    error(404, "Program not found.");
  }

  rememberRecentProgram(cookies, program.id, url.protocol === "https:");

  try {
    const draft = readProgramDraft(program.payload);
    if (draft.schemaVersion !== 3) {
      return {
        program: {
          id: program.id,
          name: program.name,
          createdAt: program.created_at,
        },
        overview: undefined,
        loggingReady: false,
        loggingErrorCode: "LEGACY_PROGRAM",
        sessionStatuses: {},
        firstOverviewVisit: false,
      };
    }

    const { firstVisit: firstOverviewVisit } = programOverviewVisit(
      cookies.get(PROGRAM_OVERVIEW_VISITS_COOKIE),
      program.id,
    );

    const [logResult, reviewResult] = await Promise.all([
      locals.supabase
        .from("workout_logs")
        .select(
          "id, program_id, program_version, session_id, week_number, session_sequence, status, exercise_logs, cardio_log, movement_log, duration_minutes, miss_reason, started_at, completed_at, updated_at",
        )
        .eq("program_id", program.id)
        .order("week_number")
        .order("session_sequence")
        .order("program_version"),
      locals.supabase
        .from("weekly_reviews")
        .select(
          "id, program_id, week_number, source_program_version, result_program_version, decision, state, confidence, metrics, result, created_at",
        )
        .eq("program_id", program.id)
        .order("week_number"),
    ]);
    const { data: logRows, error: logError } = logResult;
    const loggingReady = logError === null;
    if (logError && !["42P01", "PGRST205"].includes(logError.code ?? "")) {
      console.error("Unable to load workout logs:", logError.message);
    }
    const logs = loggingReady
      ? latestWorkoutLogs((logRows ?? []).map((row) => parseWorkoutLogRow(row)))
      : [];
    const adaptationReady = reviewResult.error === null;
    if (
      reviewResult.error &&
      !["42P01", "PGRST205"].includes(reviewResult.error.code ?? "")
    )
      console.error(
        "Unable to load weekly reviews:",
        reviewResult.error.message,
      );
    const reviews = adaptationReady
      ? (reviewResult.data ?? []).map((row) =>
          parseWeeklyReviewRow(row as WeeklyReviewDatabaseRow),
        )
      : [];
    const recommendations = Object.fromEntries(
      draft.program.weeks.flatMap((week) =>
        week.sessions.flatMap((session) =>
          session.exercises.map((exercise) => [
            exercise.id,
            loadRecommendation(exercise, draft.program, logs, week.weekNumber, {
              holdProgression: heldProgressionTargets(
                reviews,
                week.weekNumber,
              ).has(exercise.exerciseId),
            }),
          ]),
        ),
      ),
    );
    const nextSession = nextWorkoutSession(
      draft.program,
      draft.inputSnapshot,
      logs,
    );
    const reviewDue = loggingReady
      ? nextWeeklyReview(
          draft.program,
          logs,
          reviews.map((review) => review.weekNumber),
        )
      : undefined;

    return {
      program: {
        id: program.id,
        name: program.name,
        createdAt: program.created_at,
      },
      overview: presentProgramOverview(draft, recommendations),
      loggingReady,
      loggingErrorCode: loggingReady
        ? undefined
        : (logError?.code ?? "WORKOUT_LOGGING_UNAVAILABLE"),
      adaptationReady,
      adaptationErrorCode: adaptationReady
        ? undefined
        : (reviewResult.error?.code ?? "WEEKLY_ADAPTATION_UNAVAILABLE"),
      reviewDue,
      weeklyReviews: Object.fromEntries(
        reviews.map((review) => [
          review.weekNumber,
          {
            state: review.state,
            decision: review.decision,
            resultProgramVersion: review.resultProgramVersion,
          },
        ]),
      ),
      sessionStatuses: Object.fromEntries(
        logs.map((log) => [log.sessionId, log.status]),
      ),
      nextSession:
        nextSession === undefined || reviewDue !== undefined
          ? undefined
          : {
              id: nextSession.session.id,
              label: nextSession.label,
              status: nextSession.status,
            },
      firstOverviewVisit,
    };
  } catch (caughtError) {
    if (caughtError instanceof ProgramPayloadError) {
      console.error("Invalid stored program.");
    } else {
      console.error("Unexpected program parsing error.");
    }

    error(500, "The stored program data could not be read.");
  }
};
