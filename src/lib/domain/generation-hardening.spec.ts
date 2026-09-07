import { describe, expect, it } from "vitest";
import { buildLiftingTemplates } from "./design.js";
import {
  cardioSegmentMinutes,
  estimateSessionMinutes,
  recalculateSessionDuration,
} from "./duration.js";
import { muscleSets } from "./dose.js";
import { generateProgram } from "./generator.js";
import { validateGeneratedProgram } from "./generation-invariants.js";
import { addScheduleDays, hardCardioDayIsCompatible } from "./schedule.js";
import { DAYS } from "./utils.js";
import {
  baseInput,
  cardioPriorityInput,
  limitedEquipmentHypertrophyInput,
  meetPowerlifterInput,
} from "./tests/fixtures.js";

describe("programming hardening invariants", () => {
  it("retains selection warnings when the schedule preview has warmed the exercise cache", () => {
    const input = meetPowerlifterInput();
    input.facility.primaryEquipment = ["dumbbells", "bench"];
    const program = generateProgram(input).program!;
    expect(program.status).toBe("infeasible");
    expect(
      program.warnings
        .filter((warning) =>
          warning.code.startsWith("specificity-unavailable-"),
        )
        .map((warning) => warning.code)
        .sort(),
    ).toEqual([
      "specificity-unavailable-bench",
      "specificity-unavailable-deadlift",
      "specificity-unavailable-squat",
    ]);
    expect(program.triggeredRuleIds).toEqual(
      expect.arrayContaining(["EX-1", "EX-2", "EX-3"]),
    );
  });
  it("ramps a zero-cardio baseline rather than starting at the goal frequency", () => {
    const input = cardioPriorityInput();
    input.cardio.currentEasySessions = 0;
    input.cardio.currentModerateSessions = 0;
    input.cardio.currentHardSessions = 0;
    input.cardio.goal = { type: "vo2max", vo2max: { modality: "cycling" } };
    const program = generateProgram(input).program!;
    const counts = program.weeks.map(
      (week) =>
        week.sessions.filter((session) => session.cardio !== undefined).length,
    );
    expect(counts.slice(0, 6)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(
      program.weeks
        .slice(0, 2)
        .every((week) =>
          week.sessions.every(
            (session) => session.cardio?.intensity !== "hard",
          ),
        ),
    ).toBe(true);
  });

  it("caps aspirational race paces at measured ability and uses effort without a benchmark", () => {
    const input = cardioPriorityInput();
    input.goals.event = {
      type: "race",
      date: "2026-10-24",
      certainty: "confirmed",
    };
    input.cardio.goal = {
      type: "running_event",
      runningEvent: {
        distance: "10k",
        outcome: "target_time",
        targetTimeMinutes: 35,
        recentBestMinutes: 60,
        surface: "road",
        routeProfile: "flat",
      },
    };
    input.cardio.runningBaseline = { runsPerWeek: 3, distanceUnit: "km" };
    const program = generateProgram(input).program!;
    expect(
      program.weeks
        .flatMap((week) => week.sessions)
        .filter((session) => session.cardio?.paceTarget)
        .every(
          (session) => session.cardio!.paceTarget!.basis === "recent_best",
        ),
    ).toBe(true);
    expect(
      program.warnings.some(
        (warning) => warning.code === "race-target-ahead-of-baseline",
      ),
    ).toBe(true);
    delete input.cardio.goal.runningEvent!.recentBestMinutes;
    const unverified = generateProgram(input).program!;
    expect(
      unverified.weeks.every((week) =>
        week.sessions.every(
          (session) => session.cardio?.paceTarget === undefined,
        ),
      ),
    ).toBe(true);
    expect(
      unverified.weeks
        .flatMap((week) => week.sessions)
        .filter((session) => session.cardio)
        .every(
          (session) =>
            session.cardio!.sessionRpe.min === session.cardio!.sessionRpe.max,
        ),
    ).toBe(true);
  });
  it("does not silently prescribe an unselected fallback cardio modality", () => {
    const input = baseInput();
    input.cardio.preferredModalities = ["cycling"];
    input.facility.primaryEquipment = input.facility.primaryEquipment.filter(
      (item) => item !== "cardio_bike",
    );
    const program = generateProgram(input).program!;
    expect(program.status).toBe("infeasible");
    expect(
      program.warnings.some(
        (warning) => warning.code === "cardio-no-available-modality",
      ),
    ).toBe(true);
    expect(
      program.weeks.every((week) =>
        week.sessions.every((session) => session.cardio === undefined),
      ),
    ).toBe(true);
  });
  it("covers all competition lifts even with one lifting day", () => {
    const input = meetPowerlifterInput();
    input.schedule.liftingDaysPerWeek = 1;
    input.schedule.preferredTrainingDays = ["monday"];
    delete input.schedule.advanced;
    const program = generateProgram(input).program!;
    expect(program.status).toBe("ready");
    for (const week of program.weeks) {
      const ids = week.sessions.flatMap((session) =>
        session.exercises.map((item) => item.exerciseId),
      );
      expect(ids).toEqual(
        expect.arrayContaining([
          "competition_squat",
          "competition_bench",
          "competition_deadlift",
        ]),
      );
    }
  });

  it("reserves a taper for a seven-day event runway", () => {
    const input = meetPowerlifterInput();
    input.goals.event!.date = addScheduleDays(input.goals.startDate, 7);
    const program = generateProgram(input).program!;
    expect(program.horizonWeeks).toBe(1);
    expect(program.weeks[0]!.phase).toBe("taper");
    expect(validateGeneratedProgram(program, input)).toEqual([]);
  });

  it("keeps authoritative dates before events across every start and event weekday", () => {
    for (let start = 0; start < 7; start += 1)
      for (let offset = 7; offset < 21; offset += 1) {
        const input = meetPowerlifterInput();
        input.goals.startDate = addScheduleDays("2026-08-10", start);
        input.goals.event!.date = addScheduleDays(
          input.goals.startDate,
          offset,
        );
        const program = generateProgram(input).program!;
        expect(
          program.status,
          JSON.stringify(
            program.warnings.filter(
              (warning) => warning.severity === "blocking",
            ),
          ),
        ).toBe("ready");
        expect(
          program.effectiveScheduleStartDate! >= input.goals.startDate,
        ).toBe(true);
        const dates = program.weeks.flatMap((week) =>
          week.sessions.flatMap((session) =>
            session.occurrenceDate ? [session.occurrenceDate] : [],
          ),
        );
        expect(dates.every((date) => date < input.goals.event!.date)).toBe(
          true,
        );
        expect([...dates].sort()).toEqual(dates);
        expect(program.weeks.at(-1)!.phase).toBe("taper");
      }
  });

  it("rotates odd upper/lower and PPL splits across block boundaries", () => {
    const input = limitedEquipmentHypertrophyInput();
    input.schedule.liftingDaysPerWeek = 3;
    const upperLower = [1, 2].flatMap((week) =>
      buildLiftingTemplates(input, "upper_lower", week).map(
        (item) => item.title,
      ),
    );
    expect(
      upperLower.filter((title) => title.startsWith("upper")),
    ).toHaveLength(3);
    expect(
      upperLower.filter((title) => title.startsWith("lower")),
    ).toHaveLength(3);
    input.schedule.liftingDaysPerWeek = 4;
    const ppl = [1, 2, 3].flatMap((week) =>
      buildLiftingTemplates(input, "ppl", week).map((item) => item.title),
    );
    for (const focus of ["push", "pull", "legs"])
      expect(ppl.filter((title) => title.startsWith(focus))).toHaveLength(4);
  });

  it("includes trunk in full-body work and reports direct/fractional dose", () => {
    const input = limitedEquipmentHypertrophyInput();
    input.schedule.liftingDaysPerWeek = 2;
    input.schedule.preferredTrainingDays = ["monday", "thursday"];
    input.hypertrophy!.splitPreference = "full_body";
    input.schedule.targetLiftMinutes = 120;
    input.adaptation.durationPolicy = "allow_exceed";
    const program = generateProgram(input).program!;
    const week = program.weeks[0]!;
    expect(
      week.doseLedger?.find((item) => item.muscle === "trunk")?.directSets,
    ).toBeGreaterThan(0);
    const triceps = muscleSets(
      generateProgram(meetPowerlifterInput()).program!.weeks[0]!.sessions,
      "triceps",
    );
    expect(triceps.indirectSets).toBeGreaterThan(0);
    expect(triceps.effectiveSets).toBe(
      triceps.directSets + triceps.indirectSets,
    );
    expect(week.doseLedger).toHaveLength(14);
  });

  it("gives duration policies distinct behavior without vague lifting targets", () => {
    const input = limitedEquipmentHypertrophyInput();
    input.schedule.targetLiftMinutes = 30;
    delete input.schedule.advanced;
    input.adaptation.durationPolicy = "allow_exceed";
    const full = generateProgram(input).program!;
    input.adaptation.durationPolicy = "offer_shorter";
    const offered = generateProgram(input).program!;
    input.adaptation.durationPolicy = "trim_low_priority";
    const trimmed = generateProgram(input).program!;
    const lift = (program: typeof full) =>
      program.weeks[0]!.sessions.find(
        (session) => session.exercises.length > 0,
      )!;
    expect(lift(offered).exercises.map((item) => item.sets)).toEqual(
      lift(full).exercises.map((item) => item.sets),
    );
    expect(lift(offered).durationAlternative).toBeDefined();
    expect(lift(trimmed).predictedMinutes).toBeLessThan(
      lift(full).predictedMinutes,
    );
    for (const program of [full, offered, trimmed])
      for (const item of program.weeks.flatMap((week) =>
        week.sessions.flatMap((session) => session.exercises),
      )) {
        expect(item.reps.min).toBe(item.reps.max);
        expect(item.targetRir.min).toBe(item.targetRir.max);
        expect(item.phase).toBeDefined();
        expect(item.contextRole).toBeDefined();
      }
  });

  it("conserves cardio segment minutes at every short duration and weekday capacity", () => {
    for (const minutes of [10, 11, 12, 13, 15, 20, 30]) {
      const input = baseInput();
      input.goals.primary = "cardio";
      input.cardio.goal = {
        type: "vo2max",
        vo2max: { modality: "cycling" },
      } as typeof input.cardio.goal;
      input.cardio.currentHardSessions = 2;
      input.cardio.typicalHardMinutes = minutes;
      input.schedule.targetCardioMinutes = minutes;
      input.schedule.preferredTrainingDays = [...DAYS];
      const program = generateProgram(input).program!;
      for (const week of program.weeks)
        for (const session of week.sessions) {
          if (!session.cardio) continue;
          expect(cardioSegmentMinutes(session.cardio)).toBeCloseTo(
            session.cardio.minutes,
            6,
          );
          expect(session.cardio.minutes).toBeLessThanOrEqual(minutes);
          if (session.cardio.intensity === "hard")
            expect(hardCardioDayIsCompatible(session.day!, week.sessions)).toBe(
              true,
            );
        }
    }
  });

  it("uses the same duration calculator after edits and preserves hard infeasibility", () => {
    const session = generateProgram(
      baseInput(),
    ).program!.weeks[0]!.sessions.find((item) => item.exercises.length > 0)!;
    session.exercises[0]!.sets += 1;
    session.durationStatus = "infeasible";
    recalculateSessionDuration(session);
    expect(session.predictedMinutes).toBe(
      estimateSessionMinutes(
        session.exercises,
        session.cardio?.minutes ?? 0,
        session.setBlocks,
      ),
    );
    expect(session.durationStatus).toBe("infeasible");
  });

  it("rejects corrupt generated output rather than presenting it as coherent", () => {
    const input = baseInput();
    const program = generateProgram(input).program!;
    program.weeks[0]!.sessions[0]!.occurrenceDate = "2099-01-01";
    program.weeks[0]!.sessions[1]!.id = program.weeks[0]!.sessions[0]!.id;
    expect(
      validateGeneratedProgram(program, input).some((warning) =>
        warning.code.includes("duplicate"),
      ),
    ).toBe(true);
    expect(
      validateGeneratedProgram(program, input).some((warning) =>
        warning.code.includes("date"),
      ),
    ).toBe(true);
  });
});
