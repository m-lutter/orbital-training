import type { QuestionnaireInput, TrainingProgram } from "$lib/domain";
import type { ProgramDraftV3 } from "./contracts";

export function createStoredProgramV3(
  input: QuestionnaireInput,
  program: TrainingProgram,
  questionnaireFormValues?: Record<string, string | string[]>,
): ProgramDraftV3 {
  return {
    schemaVersion: 3,
    questionnaireVersion: 3,
    engineVersion: program.engineVersion,
    policyVersion: program.policyVersion,
    strategyId: `v3/${input.goals.primary}/${program.selectedSplit ?? program.weeks[0]?.phase ?? "base"}`,
    continuation: program.rolling ? "rolling" : "fixed",
    inputSnapshot: structuredClone(input),
    ...(questionnaireFormValues === undefined
      ? {}
      : {
          questionnaireFormValues: structuredClone(questionnaireFormValues),
        }),
    decisions: program.questionEffects
      .filter((decision) => decision.used)
      .map((decision) => ({
        input: decision.path,
        effect: decision.effect,
        support: decision.support,
        ruleIds: [...decision.ruleIds],
      })),
    program: structuredClone(program),
  };
}
