import { generateProgram } from "$lib/domain";
import { describe, expect, it } from "vitest";
import { parseQuestionnaireForm } from "./parse";
import {
  questionnaireFormFromValues,
  questionnaireScenarioForm,
  setQuestionnaireValues,
  type QuestionnaireScenario,
} from "./questionnaire.fixture";
import {
  questionnaireFormValuesForStorage,
  questionnaireToFormValues,
} from "./serialize";

const SCENARIOS: QuestionnaireScenario[] = [
  {
    label: "general health calendar",
    primary: "health",
    liftingDays: 3,
    planningStyle: "calendar_days",
  },
  {
    label: "cardio-first flexible",
    primary: "cardio",
    secondary: "health",
    liftingDays: 3,
    planningStyle: "flexible_sequence",
  },
  {
    label: "powerlifting calendar",
    primary: "powerlifting",
    liftingDays: 4,
    planningStyle: "calendar_days",
    advancedSchedule: true,
  },
  {
    label: "hypertrophy flexible with supersets",
    primary: "hypertrophy",
    liftingDays: 5,
    planningStyle: "flexible_sequence",
    supersets: true,
  },
  {
    label: "powerlifting plus hypertrophy",
    primary: "powerlifting",
    secondary: "hypertrophy",
    liftingDays: 4,
    planningStyle: "calendar_days",
    supersets: true,
  },
  {
    label: "hypertrophy plus powerlifting",
    primary: "hypertrophy",
    secondary: "powerlifting",
    liftingDays: 5,
    planningStyle: "flexible_sequence",
  },
  {
    label: "health plus cardio",
    primary: "health",
    secondary: "cardio",
    liftingDays: 2,
    planningStyle: "calendar_days",
  },
  {
    label: "cardio plus hypertrophy",
    primary: "cardio",
    secondary: "hypertrophy",
    liftingDays: 3,
    planningStyle: "flexible_sequence",
  },
];

describe("questionnaire cross-boundary round trips", () => {
  it.each(SCENARIOS)(
    "$label survives form -> domain -> editable form -> domain",
    (scenario) => {
      const parsed = parseQuestionnaireForm(
        questionnaireScenarioForm(scenario),
        "2026-08-07",
      );
      const editable = questionnaireToFormValues(parsed.name, parsed.input);
      const reparsed = parseQuestionnaireForm(
        questionnaireFormFromValues(editable),
        "2026-08-07",
      );

      expect(reparsed).toMatchObject({
        name: parsed.name,
        input: parsed.input,
      });
      expect(generateProgram(reparsed.input).program).toBeDefined();
    },
  );

  it("round-trips a dated running-event plan and baseline", () => {
    const form = questionnaireScenarioForm({
      label: "10K plan",
      primary: "cardio",
      liftingDays: 2,
      planningStyle: "flexible_sequence",
    });
    setQuestionnaireValues(form, {
      hasEvent: "yes",
      eventType: "race",
      eventDate: "2026-10-18",
      eventCertainty: "confirmed",
      cardioPlanType: "running_event",
      cardioPurpose: "performance",
      primaryCardioModality: "running",
      runningEventDistance: "10k",
      runningGoalOutcome: "target_time",
      runningTargetTimeMinutes: "52.5",
      runningSurface: "road",
      runningRouteProfile: "rolling",
      runningSessionsPerWeek: "3",
      runningDistanceUnit: "mi",
      runningWeeklyDistance: "14",
      runningWeeklyMinutes: "140",
      longestRunDistance: "6",
      longestRunMinutes: "62",
      continuousRunMinutes: "75",
      runningBenchmarkType: "none",
    });
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    const reparsed = parseQuestionnaireForm(
      questionnaireFormFromValues(
        questionnaireToFormValues(parsed.name, parsed.input),
      ),
      "2026-08-07",
    );

    expect(reparsed.input.cardio).toEqual(parsed.input.cardio);
    expect(generateProgram(reparsed.input).program).toBeDefined();
  });

  it("round-trips a VO2max distance benchmark with its unit", () => {
    const form = questionnaireScenarioForm({
      label: "Rowing aerobic power",
      primary: "cardio",
      liftingDays: 2,
      planningStyle: "flexible_sequence",
    });
    setQuestionnaireValues(form, {
      cardioPlanType: "vo2max",
      cardioPurpose: "performance",
      primaryCardioModality: "rowing",
      vo2maxModality: "rowing",
      vo2maxBenchmarkType: "twelve_minute",
      vo2maxBenchmarkDistance: "2800",
      vo2maxBenchmarkDistanceUnit: "m",
      vo2maxBenchmarkMinutes: "12",
    });
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    const reparsed = parseQuestionnaireForm(
      questionnaireFormFromValues(
        questionnaireToFormValues(parsed.name, parsed.input),
      ),
      "2026-08-07",
    );

    expect(reparsed.input.cardio).toEqual(parsed.input.cardio);
    expect(generateProgram(reparsed.input).program).toBeDefined();
  });

  it("removes values owned by inactive and closed branches before storage", () => {
    const form = questionnaireScenarioForm({
      label: "Clean health form",
      primary: "health",
      liftingDays: 3,
      planningStyle: "calendar_days",
    });
    form.set("powerliftingGoal", "deadlift_specialization");
    form.set("preserveCompetitionLifts", "no");
    form.set("preserveCompetitionLiftsHealth", "yes");
    form.set("hypertrophySplit", "ppl");
    form.set("useSupersets", "yes");
    form.set("eventDate", "2026-12-01");
    form.set("currentHardSessions", "4");
    form.set("programId", "00000000-0000-4000-8000-000000000001");

    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    const stored = questionnaireFormValuesForStorage(parsed.values);
    expect(stored).not.toHaveProperty("powerliftingGoal");
    expect(stored).not.toHaveProperty("preserveCompetitionLifts");
    expect(stored).toHaveProperty("preserveCompetitionLiftsHealth", "yes");
    expect(stored).not.toHaveProperty("hypertrophySplit");
    expect(stored).not.toHaveProperty("useSupersets");
    expect(stored).not.toHaveProperty("eventDate");
    expect(stored).not.toHaveProperty("currentHardSessions");
    expect(stored).not.toHaveProperty("programId");
  });

  it("removes the general-fitness lift preference when powerlifting already answers it", () => {
    const form = questionnaireScenarioForm({
      label: "Powerlifting cleanup",
      primary: "powerlifting",
      liftingDays: 4,
      planningStyle: "calendar_days",
    });
    form.set("preserveCompetitionLiftsHealth", "yes");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    const stored = questionnaireFormValuesForStorage(parsed.values);
    expect(stored).not.toHaveProperty("preserveCompetitionLifts");
    expect(stored).not.toHaveProperty("preserveCompetitionLiftsHealth");
    expect(stored).not.toHaveProperty("preserveCompetitionLiftsHypertrophy");
  });
});
