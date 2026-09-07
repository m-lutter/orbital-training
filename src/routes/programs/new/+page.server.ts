import type { Json } from "$lib/database.types";
import { generateProgram } from "$lib/domain";
import { createStoredProgramV3 } from "$lib/engine";
import { readProgramDraft } from "$lib/engine";
import {
  PersistenceLimitError,
  assertProgramWriteSizes,
} from "$lib/persistence/limits";
import {
  QUESTIONNAIRE_VERSION,
  QuestionnaireFormError,
  captureQuestionnaireFormValues,
  parseQuestionnaireForm,
  questionnaireEditFormValues,
  questionnaireFormValuesForStorage,
} from "$lib/questionnaire";
import {
  safeQuestionnaireAsOfDate,
  utcDate,
} from "$lib/server/questionnaire-date";
import { lunarCompletionIsUnlocked } from "$lib/server/program-badges";
import { programIconName } from "$lib/ui/program-icons";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

interface DatabaseFailure {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function saveFailureMessage(error: DatabaseFailure | null): string {
  const code = error?.code ?? "UNKNOWN";
  if (["PGRST202", "42883"].includes(code)) {
    return "The database save function is unavailable. Apply the latest Supabase migration, then reload the app.";
  }
  if (["42P01", "PGRST205"].includes(code)) {
    return "The versioned program tables are missing. Apply the questionnaire migrations before creating a program.";
  }
  if (code === "42501") {
    return "Supabase rejected the save permission. Sign out and back in; if it continues, reapply the latest migration grants.";
  }
  if (code === "22023") {
    return "The database rejected the questionnaire or program schema version. Apply the latest questionnaire-v3 migration so the app and database agree.";
  }
  return `The database rejected the generated program (error ${code}). Your answers are still shown so you can retry after the database issue is fixed.`;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const {
    data: { user },
  } = await locals.getUser();

  if (!user) redirect(303, "/login");

  const [storageResult, lunarCompletionUnlocked] = await Promise.all([
    locals.supabase.rpc("questionnaire_engine_status"),
    lunarCompletionIsUnlocked(locals.supabase),
  ]);
  const { data: storageStatus, error: storageError } = storageResult;
  const status =
    storageStatus !== null &&
    typeof storageStatus === "object" &&
    !Array.isArray(storageStatus)
      ? storageStatus
      : undefined;
  const storageReady =
    storageError === null &&
    status?.ready === true &&
    status.questionnaireVersion === 3 &&
    status.programSchemaVersion === 3 &&
    status.compactHistoryVersion === 1;

  const today = utcDate();
  const editId = url.searchParams.get("edit");
  let editingProgram: { id: string; name: string } | undefined;
  let initialValues: Record<string, string | string[]> | undefined;
  if (editId !== null) {
    if (!UUID_PATTERN.test(editId)) redirect(303, "/dashboard");
    const { data: existing, error: existingError } = await locals.supabase
      .from("programs")
      .select("id, name, payload")
      .eq("id", editId)
      .maybeSingle();
    if (existingError || !existing) redirect(303, "/dashboard");
    const draft = readProgramDraft(existing.payload);
    if (draft.schemaVersion !== 3) redirect(303, `/programs/${existing.id}`);
    editingProgram = { id: existing.id, name: existing.name };
    initialValues = questionnaireEditFormValues(existing.name, draft);
    // Editing rebuilds the program from now. A completed historical start date
    // cannot be reused for a new deterministic block.
    if (String(initialValues.startDate) < today)
      initialValues.startDate = today;
    if (
      initialValues.hasEvent === "yes" &&
      String(initialValues.eventDate ?? "") <= today
    ) {
      initialValues.hasEvent = "no";
      initialValues.horizonKind = "fixed";
      initialValues.horizonWeeks = "4";
    }
  }

  return {
    today,
    storageReady,
    storageStatus: storageReady
      ? String(status.migration ?? "ready")
      : undefined,
    storageErrorCode: storageReady
      ? undefined
      : (storageError?.code ?? "MIGRATION_STATUS_UNAVAILABLE"),
    editingProgram,
    initialValues,
    lunarCompletionUnlocked,
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const {
      data: { user },
    } = await locals.getUser();

    if (!user) redirect(303, "/login");

    const formData = await request.formData();
    const values = captureQuestionnaireFormValues(formData);
    const requestedIcon = programIconName(values.programIcon);
    values.programIcon = requestedIcon;

    if (
      requestedIcon === "lunar_completion" &&
      !(await lunarCompletionIsUnlocked(locals.supabase))
    ) {
      return fail(403, {
        values,
        message:
          "Lunar Completion unlocks after every scheduled workout in one full program has been completed.",
        field: "programIcon",
      });
    }

    let parsed;
    try {
      parsed = parseQuestionnaireForm(
        formData,
        safeQuestionnaireAsOfDate(formData),
      );
    } catch (caughtError) {
      if (caughtError instanceof QuestionnaireFormError) {
        return fail(400, {
          values,
          message: caughtError.message,
          field: caughtError.path,
        });
      }
      console.error("Unexpected questionnaire parsing error.");
      return fail(500, {
        values,
        message: "The questionnaire could not be processed.",
      });
    }

    const generated = generateProgram(parsed.input);
    const blockingIssue = generated.issues.find(
      (issue) => issue.severity === "blocking",
    );
    if (blockingIssue !== undefined || generated.program === undefined) {
      return fail(400, {
        values,
        message:
          blockingIssue?.message ??
          "The answers do not describe a feasible program.",
        field: blockingIssue?.path ?? "questionnaire",
        issues: generated.issues,
      });
    }

    if (generated.program.status === "infeasible") {
      const warning =
        generated.program.warnings.find(
          (item) => item.severity === "blocking",
        ) ?? generated.program.warnings[0];
      return fail(400, {
        values,
        message:
          warning?.message ??
          "The requested program is not feasible with the current constraints.",
        field: "questionnaire",
      });
    }

    const storedValues = questionnaireFormValuesForStorage(values);
    const stored = createStoredProgramV3(
      parsed.input,
      generated.program,
      storedValues,
    );
    try {
      assertProgramWriteSizes(parsed.input, stored);
    } catch (caughtError) {
      if (caughtError instanceof PersistenceLimitError) {
        console.error("Generated program exceeded a persistence limit:", {
          field: caughtError.field,
          actualBytes: caughtError.actualBytes,
          maximumBytes: caughtError.maximumBytes,
        });
        return fail(413, {
          values,
          message:
            "This combination produced more program data than can be saved safely. Shorten the block or reduce optional selections, then try again.",
          field: "questionnaire",
        });
      }
      throw caughtError;
    }
    const editId = String(formData.get("programId") ?? "");
    const replacing = UUID_PATTERN.test(editId);
    const saveArguments = {
      p_name: parsed.name,
      p_questionnaire_version: QUESTIONNAIRE_VERSION,
      p_engine_version: generated.program.engineVersion,
      p_policy_version: generated.program.policyVersion,
      p_input_fingerprint: generated.program.inputFingerprint,
      p_questionnaire: parsed.input as unknown as Json,
      p_payload: stored as unknown as Json,
    };
    const { data: programId, error: insertError } = replacing
      ? await locals.supabase.rpc("replace_program_from_questionnaire_v4", {
          p_program_id: editId,
          ...saveArguments,
        })
      : await locals.supabase.rpc(
          "create_program_with_initial_version_v4",
          saveArguments,
        );

    if (insertError || !programId) {
      console.error("Unable to save questionnaire/program version:", {
        code: insertError?.code,
        message: insertError?.message,
        details: insertError?.details,
        hint: insertError?.hint,
      });
      return fail(500, {
        values,
        message: saveFailureMessage(insertError),
        saveErrorCode: insertError?.code ?? "UNKNOWN",
      });
    }

    redirect(303, `/programs/${programId}`);
  },
};
