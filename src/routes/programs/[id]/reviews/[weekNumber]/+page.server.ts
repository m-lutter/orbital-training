import type { Json } from "$lib/database.types";
import { adaptProgram, programmingSafetyIssues } from "$lib/domain";
import { readProgramDraft, type ProgramDraftV3 } from "$lib/engine";
import {
  PersistenceLimitError,
  assertWeeklyReviewWriteSizes,
} from "$lib/persistence/limits";
import { programReversePatchForWrite } from "$lib/persistence/program-history";
import {
  nextWeeklyReview,
  parseWeeklyReviewRow,
  goalProgressCharts,
  summarizeWeek,
  toWeekLogs,
  weeklyBreakdown,
  weeklyReviewMessages,
  type WeeklyReview,
  type WeeklyReviewDatabaseRow,
  type WeeklyReviewDecision,
  type WeeklyReviewSnapshot,
} from "$lib/reviews";
import { adaptationView } from "$lib/reviews/adaptation-view";
import {
  latestWorkoutLogs,
  parseWorkoutLogRow,
  type WorkoutLog,
} from "$lib/workouts";
import { error, fail, redirect } from "@sveltejs/kit";
import { rememberRecentProgram } from "$lib/server/recent-program";
import { loadWearableAdaptationContext } from "$lib/server/fitness/adaptation";
import {
  heartRateReviewLogsForWeek,
  loadWeeklyHeartRateReview,
} from "$lib/server/fitness/retrospective-workouts";
import { scheduledProgramWeekDates } from "$lib/program-dates";
import type { WearableAdaptationContext } from "$lib/domain";
import type { Actions, PageServerLoad } from "./$types";

const LOG_SELECT =
  "id, program_id, program_version, session_id, week_number, session_sequence, status, exercise_logs, cardio_log, movement_log, duration_minutes, miss_reason, started_at, completed_at, updated_at";
const REVIEW_SELECT =
  "id, program_id, week_number, source_program_version, result_program_version, decision, state, confidence, metrics, result, created_at";

interface ReviewContext {
  userId: string;
  programId: string;
  programName: string;
  draft: ProgramDraftV3;
  weekNumber: number;
  logs: WorkoutLog[];
  reviews: WeeklyReview[];
  adaptationReady: boolean;
  adaptationErrorCode?: string;
  wearable?: WearableAdaptationContext;
}

function requestedWeek(raw: string): number {
  const week = Number(raw);
  if (!Number.isInteger(week) || week < 1) error(404, "Review not found.");
  return week;
}

async function reviewContext(
  locals: App.Locals,
  programId: string,
  weekParam: string,
): Promise<ReviewContext> {
  const {
    data: { user },
  } = await locals.getUser();
  if (!user) redirect(303, "/login");

  const { data: program, error: programError } = await locals.supabase
    .from("programs")
    .select("id, name, payload")
    .eq("id", programId)
    .maybeSingle();
  if (programError) error(500, "The program could not be loaded.");
  if (!program) error(404, "Program not found.");

  const draft = readProgramDraft(program.payload);
  if (draft.schemaVersion !== 3) error(400, "This program cannot be reviewed.");
  const weekNumber = requestedWeek(weekParam);
  if (!draft.program.weeks.some((week) => week.weekNumber === weekNumber))
    error(404, "Review not found.");

  const weekDates = scheduledProgramWeekDates(
    draft.program,
    draft.inputSnapshot.goals.startDate,
    weekNumber,
  );
  const [logsResult, reviewsResult, wearable] = await Promise.all([
    locals.supabase
      .from("workout_logs")
      .select(LOG_SELECT)
      .eq("program_id", program.id)
      .lte("week_number", weekNumber)
      .order("week_number")
      .order("session_sequence")
      .order("program_version"),
    locals.supabase
      .from("weekly_reviews")
      .select(REVIEW_SELECT)
      .eq("program_id", program.id)
      .lte("week_number", weekNumber)
      .order("week_number"),
    loadWearableAdaptationContext({
      client: locals.supabase,
      weekStart: weekDates[0]?.isoDate ?? draft.inputSnapshot.goals.startDate,
      weekEnd: weekDates.at(-1)?.isoDate ?? draft.inputSnapshot.goals.startDate,
    }),
  ]);

  if (logsResult.error) {
    console.error("Unable to load workout logs:", logsResult.error.message);
    error(500, "Workout history could not be loaded.");
  }
  const adaptationReady = reviewsResult.error === null;
  if (
    reviewsResult.error &&
    !["42P01", "PGRST205"].includes(reviewsResult.error.code ?? "")
  )
    console.error(
      "Unable to load weekly reviews:",
      reviewsResult.error.message,
    );

  return {
    userId: user.id,
    programId: program.id,
    programName: program.name,
    draft,
    weekNumber,
    logs: latestWorkoutLogs(
      (logsResult.data ?? []).map((row) => parseWorkoutLogRow(row)),
    ),
    reviews: adaptationReady
      ? (reviewsResult.data ?? []).map((row) =>
          parseWeeklyReviewRow(row as WeeklyReviewDatabaseRow),
        )
      : [],
    adaptationReady,
    ...(wearable === undefined ? {} : { wearable }),
    ...(reviewsResult.error === null
      ? {}
      : {
          adaptationErrorCode:
            reviewsResult.error.code ?? "WEEKLY_ADAPTATION_UNAVAILABLE",
        }),
  };
}

function assertReviewDue(context: ReviewContext): void {
  if (
    context.reviews.some((review) => review.weekNumber === context.weekNumber)
  )
    return;
  const due = nextWeeklyReview(
    context.draft.program,
    context.logs,
    context.reviews.map((review) => review.weekNumber),
  );
  if (due !== context.weekNumber)
    error(409, "Finish the workouts in this week before reviewing it.");
}

export const load: PageServerLoad = async ({
  locals,
  params,
  cookies,
  url,
}) => {
  const context = await reviewContext(locals, params.id, params.weekNumber);
  rememberRecentProgram(cookies, context.programId, url.protocol === "https:");
  if (context.adaptationReady) assertReviewDue(context);
  const programWeek = context.draft.program.weeks.find(
    (week) => week.weekNumber === context.weekNumber,
  );
  const heartRateReviewPromise = loadWeeklyHeartRateReview({
    client: locals.supabase,
    userId: context.userId,
    workoutLogs: heartRateReviewLogsForWeek({
      logs: context.logs,
      sessions: programWeek?.sessions ?? [],
      weekNumber: context.weekNumber,
    }),
  }).catch(() => {
    console.warn("Workout heart-rate review could not be loaded.");
    return { status: "unavailable" as const, workouts: [] };
  });
  const existing = context.reviews.find(
    (review) => review.weekNumber === context.weekNumber,
  );
  const metrics = {
    ...summarizeWeek(context.draft.program, context.logs, context.weekNumber),
    ...(context.wearable === undefined ? {} : { wearable: context.wearable }),
  };
  const proposal =
    existing === undefined
      ? adaptProgram(
          context.draft.program,
          toWeekLogs(context.draft.program, context.logs, context.weekNumber),
          {
            applyChanges: false,
            wearable: context.wearable,
            safetyReviewReasons: programmingSafetyIssues(
              context.draft.inputSnapshot,
            ).map((issue) => issue.message),
          },
        )
      : undefined;
  const days = weeklyBreakdown(
    context.draft.program,
    context.logs,
    context.weekNumber,
    context.draft.inputSnapshot.goals.startDate,
  );
  const reviewResult =
    existing === undefined
      ? proposal
      : {
          confidence: existing.confidence,
          safetySignals: existing.result.safetySignals ?? [],
        };
  const messages =
    reviewResult === undefined
      ? undefined
      : weeklyReviewMessages(
          metrics,
          existing?.state ?? proposal?.state ?? "insufficient_data",
          reviewResult,
          days,
        );

  return {
    program: { id: context.programId, name: context.programName },
    weekNumber: context.weekNumber,
    mode: context.draft.program.adaptationSettings.applyChanges,
    metrics,
    proposal: proposal === undefined ? undefined : adaptationView(proposal),
    existing,
    days,
    messages,
    charts: goalProgressCharts(
      context.draft.program,
      context.draft.inputSnapshot,
      context.logs,
      context.weekNumber,
    ),
    heartRateReview: await heartRateReviewPromise,
    adaptationReady: context.adaptationReady,
    adaptationErrorCode: context.adaptationErrorCode,
  };
};

async function recordReview(
  locals: App.Locals,
  params: { id: string; weekNumber: string },
  intent: "apply" | "keep",
) {
  const context = await reviewContext(locals, params.id, params.weekNumber);
  if (!context.adaptationReady) {
    return fail(503, {
      message:
        "Apply Supabase migration 20260814090000_weekly_feedback_and_adaptation, then reload.",
    });
  }
  const prior = context.reviews.find(
    (review) => review.weekNumber === context.weekNumber,
  );
  if (prior) redirect(303, `/programs/${context.programId}/workout`);
  assertReviewDue(context);

  const weekLogs = toWeekLogs(
    context.draft.program,
    context.logs,
    context.weekNumber,
  );
  const proposal = adaptProgram(context.draft.program, weekLogs, {
    applyChanges: false,
    wearable: context.wearable,
    safetyReviewReasons: programmingSafetyIssues(
      context.draft.inputSnapshot,
    ).map((issue) => issue.message),
  });
  const actionable = proposal.changes.some((change) => change.type !== "hold");
  const approvalFirst =
    context.draft.program.adaptationSettings.applyChanges === "ask_first";

  if (intent === "keep" && !approvalFirst) {
    return fail(400, {
      message: "This program applies bounded weekly changes automatically.",
    });
  }

  const shouldApply = actionable && intent === "apply";
  const result = shouldApply
    ? adaptProgram(context.draft.program, weekLogs, {
        applyChanges: true,
        wearable: context.wearable,
        safetyReviewReasons: programmingSafetyIssues(
          context.draft.inputSnapshot,
        ).map((issue) => issue.message),
      })
    : proposal;
  const applied = result.changes.some((change) => change.applied);
  const decision: WeeklyReviewDecision = applied
    ? "applied"
    : intent === "keep" && actionable
      ? "kept"
      : "no_change";
  const metrics = {
    ...summarizeWeek(context.draft.program, context.logs, context.weekNumber),
    ...(context.wearable === undefined ? {} : { wearable: context.wearable }),
  };
  const snapshot: WeeklyReviewSnapshot = {
    schemaVersion: 1,
    reviewedAt: new Date().toISOString(),
    state: result.state,
    confidence: result.confidence,
    explanation:
      decision === "kept"
        ? `${result.explanation} You chose to keep the current future plan.`
        : result.explanation,
    changes: result.changes,
    safetySignals: result.safetySignals,
    warnings: result.warnings,
    reviewedWeeks: result.reviewedWeeks,
    triggeredRuleIds: result.triggeredRuleIds,
  };

  const newDraft: ProgramDraftV3 | undefined = applied
    ? {
        ...context.draft,
        engineVersion: result.program.engineVersion,
        policyVersion: result.program.policyVersion,
        decisions: [
          ...context.draft.decisions,
          ...result.changes
            .filter((change) => change.applied)
            .map((change) => ({
              input: `Week ${context.weekNumber} review`,
              effect: `${change.target}: ${change.before ?? "current plan"} → ${change.after ?? "updated plan"}. ${change.reason}`,
              ruleIds: change.ruleIds,
            })),
        ],
        program: result.program,
      }
    : undefined;
  const reversePatch =
    newDraft === undefined
      ? null
      : programReversePatchForWrite(context.draft, newDraft);

  try {
    assertWeeklyReviewWriteSizes({
      metrics,
      result: snapshot,
      ...(newDraft === undefined ? {} : { newProgramPayload: newDraft }),
      ...(reversePatch === null ? {} : { reversePatch }),
    });
  } catch (caughtError) {
    if (caughtError instanceof PersistenceLimitError) {
      console.error("Weekly review exceeded a persistence limit:", {
        field: caughtError.field,
        actualBytes: caughtError.actualBytes,
        maximumBytes: caughtError.maximumBytes,
      });
      return fail(413, {
        message:
          "This review contains more detail than can be saved safely. Your program has not changed; reload and send a beta report.",
      });
    }
    throw caughtError;
  }

  const { error: saveError } = await locals.supabase.rpc(
    "record_weekly_review_v4",
    {
      p_program_id: context.programId,
      p_source_program_version: context.draft.program.version,
      p_week_number: context.weekNumber,
      p_decision: decision,
      p_state: result.state,
      p_confidence: result.confidence,
      p_metrics: metrics as unknown as Json,
      p_result: snapshot as unknown as Json,
      p_new_payload: (newDraft as unknown as Json | undefined) ?? null,
      p_reverse_patch: (reversePatch as unknown as Json | null) ?? null,
    },
  );
  if (saveError) {
    console.error("Unable to save weekly review:", saveError.message);
    const migrationMissing = ["42P01", "42883", "PGRST202"].includes(
      saveError.code ?? "",
    );
    return fail(migrationMissing ? 503 : 409, {
      message: migrationMissing
        ? "Apply Supabase migrations through 20260819220000_phase4_compact_program_history, then reload."
        : "The review could not be saved. Reload the program and try again; no prescription was changed.",
    });
  }

  redirect(303, `/programs/${context.programId}/workout`);
}

export const actions: Actions = {
  apply: ({ locals, params }) => recordReview(locals, params, "apply"),
  keep: ({ locals, params }) => recordReview(locals, params, "keep"),
};
