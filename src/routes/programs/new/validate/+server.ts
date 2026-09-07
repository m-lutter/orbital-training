import { validateQuestionnaireThroughStep } from "$lib/questionnaire/step-validation";
import { safeQuestionnaireAsOfDate } from "$lib/server/questionnaire-date";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, locals }) => {
  const {
    data: { user },
  } = await locals.getUser();
  if (!user)
    return json(
      {
        valid: false,
        message: "Your session expired. Sign in again before continuing.",
        field: "questionnaire",
      },
      { status: 401 },
    );

  const formData = await request.formData();
  const step = Number(formData.get("questionnaireStep"));
  formData.delete("questionnaireStep");
  return json(
    validateQuestionnaireThroughStep(
      formData,
      step,
      safeQuestionnaireAsOfDate(formData),
    ),
  );
};
