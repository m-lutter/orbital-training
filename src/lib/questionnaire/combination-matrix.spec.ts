import { generateProgram } from "$lib/domain";
import { createStoredProgramV3, parseProgramDraft } from "$lib/engine";
import { describe, expect, it } from "vitest";
import {
  buildPairwiseCases,
  missingPairwisePairs,
  type PairwiseFactors,
} from "./pairwise.fixture";
import { parseQuestionnaireForm } from "./parse";
import {
  questionnaireFormFromValues,
  questionnaireScenarioForm,
  setQuestionnaireValues,
  type QuestionnaireGoal,
} from "./questionnaire.fixture";
import {
  questionnaireEditFormValues,
  questionnaireFormValuesForStorage,
} from "./serialize";

const GOALS = [
  "powerlifting",
  "hypertrophy",
  "cardio",
  "health",
] as const satisfies readonly QuestionnaireGoal[];

const FACTORS = {
  primary: GOALS,
  secondaryOffset: ["none", "1", "2", "3"],
  planningStyle: ["calendar_days", "flexible_sequence"],
  liftingDays: ["2", "3", "4", "5"],
  advancedSchedule: ["off", "on"],
  cardioPlan: ["general", "running_event", "vo2max"],
  units: ["lb", "kg"],
  weightTracking: ["ignore", "track"],
  effortReporting: ["auto", "rpe", "rir", "verbal"],
  supersets: ["off", "on"],
} as const satisfies PairwiseFactors;

const CASES = buildPairwiseCases(FACTORS);

function secondaryGoal(
  primary: QuestionnaireGoal,
  rawOffset: string,
): QuestionnaireGoal | undefined {
  if (rawOffset === "none") return undefined;
  const offset = Number(rawOffset);
  const primaryIndex = GOALS.indexOf(primary);
  return GOALS[(primaryIndex + offset) % GOALS.length];
}

function formForCase(row: (typeof CASES)[number], index: number): FormData {
  const primary = row.primary as QuestionnaireGoal;
  const secondary = secondaryGoal(primary, row.secondaryOffset!);
  const form = questionnaireScenarioForm({
    label: `Pairwise contract ${index + 1}`,
    primary,
    secondary,
    liftingDays: Number(row.liftingDays),
    planningStyle: row.planningStyle as "calendar_days" | "flexible_sequence",
    advancedSchedule: row.advancedSchedule === "on",
    supersets: row.supersets === "on",
    cardioPlan: row.cardioPlan as "general" | "running_event" | "vo2max",
  });
  setQuestionnaireValues(form, {
    units: row.units!,
    effortReporting: row.effortReporting!,
    bodyweightTracking: row.weightTracking!,
  });
  if (row.weightTracking === "track") {
    setQuestionnaireValues(form, {
      initialBodyWeight: row.units === "kg" ? "82" : "180",
      dietGoal: "maintain",
      weeklyWeightCheckIns: "yes",
    });
  }
  return form;
}

describe("questionnaire deterministic pairwise contract", () => {
  it("covers every pair of declared questionnaire factors", () => {
    expect(CASES.length).toBeLessThan(80);
    expect(missingPairwisePairs(FACTORS, CASES)).toEqual([]);
  });

  it.each(CASES.map((row, index) => ({ row, index })))(
    "case $index survives parse, generation, storage, and edit regeneration",
    ({ row, index }) => {
      const parsed = parseQuestionnaireForm(
        formForCase(row, index),
        "2026-08-07",
      );
      const generated = generateProgram(parsed.input);
      expect(
        generated.issues.filter((issue) => issue.severity === "blocking"),
      ).toEqual([]);
      expect(
        generated.program?.status,
        JSON.stringify(
          generated.program?.warnings.filter(
            (warning) => warning.severity === "blocking",
          ),
        ),
      ).toBe("ready");
      const program = generated.program;
      if (program === undefined)
        throw new Error(`Pairwise case ${index} did not generate a program.`);

      const storedValues = questionnaireFormValuesForStorage(parsed.values);
      const stored = createStoredProgramV3(parsed.input, program, storedValues);
      const databaseJson = JSON.parse(JSON.stringify(stored)) as unknown;
      const read = parseProgramDraft(databaseJson);
      expect(read).toEqual(stored);
      if (read.schemaVersion !== 3)
        throw new Error(`Pairwise case ${index} changed schema version.`);

      const edited = parseQuestionnaireForm(
        questionnaireFormFromValues(
          questionnaireEditFormValues(parsed.name, read),
        ),
        "2026-08-07",
      );
      expect(edited.input).toEqual(parsed.input);
      expect(generateProgram(edited.input).program).toEqual(program);
    },
  );
});
