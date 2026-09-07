import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  adaptProgram,
  generateProgram,
  type QuestionnaireInput,
} from "../src/lib/domain";
import { summarizeRecentProgram } from "../src/lib/dashboard/recent-program";
import {
  cardioPriorityInput,
  limitedEquipmentHypertrophyInput,
  meetPowerlifterInput,
  noviceOlderHealthInput,
} from "../src/lib/domain/tests/fixtures";
import { parseProgramDraft } from "../src/lib/engine/parse";
import { createStoredProgramV3 } from "../src/lib/engine/v3";
import { createProgramReversePatch } from "../src/lib/persistence/program-history";
import { adaptationView } from "../src/lib/reviews/adaptation-view";
import { presentProgramOverview } from "../src/lib/server/program-overview";

interface TimingSummary {
  medianMs: number;
  p95Ms: number;
  maximumMs: number;
}

interface Scenario {
  name: string;
  makeInput: () => QuestionnaireInput;
}

const encoder = new TextEncoder();
const budgets = JSON.parse(
  readFileSync(
    new URL("../config/performance-budgets.json", import.meta.url),
    "utf8",
  ),
);

function bytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function measure(
  operation: () => void,
  warmups = 5,
  samples = 20,
): TimingSummary {
  for (let index = 0; index < warmups; index += 1) operation();
  const timings: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    operation();
    timings.push(performance.now() - startedAt);
  }
  timings.sort((left, right) => left - right);
  return {
    medianMs: percentile(timings, 50),
    p95Ms: percentile(timings, 95),
    maximumMs: timings.at(-1) ?? 0,
  };
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function summarizeTiming(timing: TimingSummary): TimingSummary {
  return {
    medianMs: round(timing.medianMs),
    p95Ms: round(timing.p95Ms),
    maximumMs: round(timing.maximumMs),
  };
}

describe("engine and stored-payload baseline", () => {
  it("measures representative user scenarios", () => {
    const scenarios: Scenario[] = [
      {
        name: "powerlifting-meet",
        makeInput: meetPowerlifterInput,
      },
      {
        name: "hypertrophy-limited-equipment",
        makeInput: limitedEquipmentHypertrophyInput,
      },
      {
        name: "general-health-older-novice",
        makeInput: noviceOlderHealthInput,
      },
      {
        name: "cardio-priority-six-week",
        makeInput: () => {
          const input = cardioPriorityInput();
          input.goals.horizon = { kind: "fixed", weeks: 6 };
          return input;
        },
      },
    ];

    const results = scenarios.map(({ name, makeInput }) => {
      const input = makeInput();
      const generated = generateProgram(input);
      if (generated.program === undefined) {
        throw new Error(
          `${name} did not generate a program: ${JSON.stringify(generated.issues)}`,
        );
      }

      const draft = createStoredProgramV3(input, generated.program);
      const serialized = JSON.stringify(draft);
      const progressedDraft = structuredClone(draft);
      progressedDraft.program.version += 1;
      for (const week of progressedDraft.program.weeks.slice(1)) {
        for (const exercise of week.sessions.flatMap(
          (session) => session.exercises,
        )) {
          if (exercise.load !== undefined) exercise.load += 5;
          exercise.targetRir = {
            min: Math.min(12, exercise.targetRir.min + 1),
            max: Math.min(12, exercise.targetRir.max + 1),
          };
        }
      }
      const reversePatch = createProgramReversePatch(draft, progressedDraft);
      const routeDataBytes = {
        dashboardSummary: bytes(
          summarizeRecentProgram("measurement-program", draft, [], []),
        ),
        programOverview: bytes(presentProgramOverview(draft, {})),
        weeklyReviewProposal: bytes(
          adaptationView(
            adaptProgram(generated.program, [], { applyChanges: false }),
          ),
        ),
      };
      const sessions = generated.program.weeks.flatMap((week) => week.sessions);
      const exercises = sessions.flatMap((session) => session.exercises);
      const generationTiming = measure(() => {
        const result = generateProgram(makeInput());
        if (result.program === undefined)
          throw new Error(`${name} failed during timed generation.`);
      });
      const readTiming = measure(() => {
        parseProgramDraft(JSON.parse(serialized));
      });

      return {
        scenario: name,
        weeks: generated.program.weeks.length,
        sessions: sessions.length,
        exerciseExposures: exercises.length,
        payloadBytes: encoder.encode(serialized).byteLength,
        representativeReversePatchBytes: bytes(reversePatch),
        breakdownBytes: {
          inputSnapshot: bytes(draft.inputSnapshot),
          decisions: bytes(draft.decisions),
          program: bytes(draft.program),
          weeks: bytes(draft.program.weeks),
          questionEffects: bytes(draft.program.questionEffects),
          exercisePrescriptions: bytes(exercises),
        },
        routeDataBytes,
        generation: summarizeTiming(generationTiming),
        deserializeAndValidate: summarizeTiming(readTiming),
      };
    });

    const warnings: string[] = [];
    const failures: string[] = [];
    for (const result of results) {
      if (result.payloadBytes > budgets.storedProgram.maximumBytes) {
        failures.push(
          `${result.scenario} payload is ${result.payloadBytes} bytes; maximum is ${budgets.storedProgram.maximumBytes}.`,
        );
      } else if (result.payloadBytes > budgets.storedProgram.warningBytes) {
        warnings.push(
          `${result.scenario} payload is ${result.payloadBytes} bytes; warning threshold is ${budgets.storedProgram.warningBytes}.`,
        );
      }
      if (
        result.representativeReversePatchBytes >
        budgets.programHistory.reversePatchMaximumBytes
      ) {
        failures.push(
          `${result.scenario} representative history patch is ${result.representativeReversePatchBytes} bytes; maximum is ${budgets.programHistory.reversePatchMaximumBytes}.`,
        );
      } else if (
        result.representativeReversePatchBytes >
        budgets.programHistory.reversePatchWarningBytes
      ) {
        warnings.push(
          `${result.scenario} representative history patch is ${result.representativeReversePatchBytes} bytes.`,
        );
      }
      if (result.generation.p95Ms > budgets.engine.generationP95WarningMs) {
        warnings.push(
          `${result.scenario} generation p95 is ${result.generation.p95Ms} ms.`,
        );
      }
      if (
        result.deserializeAndValidate.p95Ms >
        budgets.engine.readValidationP95WarningMs
      ) {
        warnings.push(
          `${result.scenario} read validation p95 is ${result.deserializeAndValidate.p95Ms} ms.`,
        );
      }
      const routeLimits = budgets.routeData;
      if (
        result.routeDataBytes.dashboardSummary >
        routeLimits.dashboardSummaryMaximumBytes
      )
        failures.push(
          `${result.scenario} dashboard summary is ${result.routeDataBytes.dashboardSummary} bytes.`,
        );
      if (
        result.routeDataBytes.programOverview >
        routeLimits.programOverviewMaximumBytes
      )
        failures.push(
          `${result.scenario} program overview is ${result.routeDataBytes.programOverview} bytes.`,
        );
      if (
        result.routeDataBytes.weeklyReviewProposal >
        routeLimits.weeklyReviewProposalMaximumBytes
      )
        failures.push(
          `${result.scenario} weekly-review proposal is ${result.routeDataBytes.weeklyReviewProposal} bytes.`,
        );
    }

    const report = {
      measuredAt: new Date().toISOString(),
      runtime: process.version,
      samplesPerScenario: 20,
      results,
      warnings,
      failures,
    };

    if (process.env.MEASURE_JSON === "1") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("\nEngine and stored-payload baseline\n");
      console.table(
        results.map((result) => ({
          scenario: result.scenario,
          weeks: result.weeks,
          sessions: result.sessions,
          exposures: result.exerciseExposures,
          "payload KiB": round(result.payloadBytes / 1024, 1),
          "history patch KiB": round(
            result.representativeReversePatchBytes / 1024,
            1,
          ),
          "overview KiB": round(
            result.routeDataBytes.programOverview / 1024,
            1,
          ),
          "generate p50 ms": result.generation.medianMs,
          "generate p95 ms": result.generation.p95Ms,
          "read p95 ms": result.deserializeAndValidate.p95Ms,
        })),
      );
      for (const warning of warnings) console.warn(`WARNING: ${warning}`);
      for (const failure of failures) console.error(`ERROR: ${failure}`);
      console.log(
        "Timing is diagnostic only; --check fails only deterministic payload limits.",
      );
    }

    expect(results).toHaveLength(scenarios.length);
    if (process.env.MEASURE_BUDGET_CHECK === "1") expect(failures).toEqual([]);
  });
});
