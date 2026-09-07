import { validateGeneratedProgram } from "./generation-invariants.js";
import type { QuestionnaireInput, TrainingProgram, WeekLog } from "./types.js";
import { fingerprint } from "./utils.js";

/** Offline/shadow evaluation only: this does not persist telemetry or alter an active plan. */
export function programQualitySnapshot(
  program: TrainingProgram,
  input?: QuestionnaireInput,
) {
  const sessions = program.weeks
    .flatMap((week) => week.sessions)
    .filter((session) => session.kind !== "movement");
  const exercises = sessions.flatMap((session) => session.exercises);
  return {
    engineVersion: program.engineVersion,
    policyVersion: program.policyVersion,
    inputFingerprint: program.inputFingerprint,
    blockingInvariants: validateGeneratedProgram(program, input).map(
      (issue) => issue.code,
    ),
    formalSessions: sessions.length,
    exerciseExposures: exercises.length,
    specificPrescriptions: exercises.filter(
      (item) =>
        item.reps.min === item.reps.max &&
        item.targetRir.min === item.targetRir.max,
    ).length,
    predictedMinutes: sessions.reduce(
      (sum, session) => sum + session.predictedMinutes,
      0,
    ),
    infeasibleSessions: sessions.filter(
      (session) => session.durationStatus === "infeasible",
    ).length,
    unmetDoseTargets: program.weeks.reduce(
      (sum, week) =>
        sum +
        (week.doseLedger?.filter((entry) => entry.status !== "within_target")
          .length ?? 0),
      0,
    ),
    payloadBytes: new TextEncoder().encode(JSON.stringify(program)).byteLength,
  };
}

export function compareProgramCandidates(
  current: TrainingProgram,
  candidate: TrainingProgram,
  input?: QuestionnaireInput,
) {
  const before = new Map(
    current.weeks
      .flatMap((week) => week.sessions)
      .map((session) => [session.id, session]),
  );
  const after = new Map(
    candidate.weeks
      .flatMap((week) => week.sessions)
      .map((session) => [session.id, session]),
  );
  const sessionIds = [...new Set([...before.keys(), ...after.keys()])].sort();
  return {
    current: programQualitySnapshot(current, input),
    candidate: programQualitySnapshot(candidate, input),
    changedSessionIds: sessionIds.filter(
      (id) =>
        fingerprint(before.get(id) ?? null) !==
        fingerprint(after.get(id) ?? null),
    ),
    sameInput: current.inputFingerprint === candidate.inputFingerprint,
  };
}

/** Descriptive outcomes, not efficacy or injury prediction. Keep versions attached to every cohort. */
export function summarizeTrainingOutcomes(
  program: TrainingProgram,
  logs: WeekLog[],
) {
  const sessions = new Map(
    program.weeks
      .flatMap((week) => week.sessions)
      .map((session) => [session.id, session]),
  );
  let completed = 0;
  let attempted = 0;
  let durationSamples = 0;
  let absoluteDurationErrorMinutes = 0;
  let painReportedSets = 0;
  let loggedSets = 0;
  const seen = new Set<string>();
  for (const week of logs)
    for (const log of week.sessions) {
      const planned = sessions.get(log.sessionId);
      if (!planned || seen.has(log.sessionId)) continue;
      seen.add(log.sessionId);
      attempted += 1;
      if (log.status === "completed") completed += 1;
      if (log.durationMinutes !== undefined) {
        durationSamples += 1;
        absoluteDurationErrorMinutes += Math.abs(
          log.durationMinutes - planned.predictedMinutes,
        );
      }
      for (const exercise of log.exercises)
        for (const set of exercise.sets) {
          loggedSets += 1;
          if (set.pain) painReportedSets += 1;
        }
    }
  return {
    engineVersion: program.engineVersion,
    policyVersion: program.policyVersion,
    attempted,
    completed,
    completionFraction: attempted ? completed / attempted : undefined,
    meanAbsoluteDurationErrorMinutes: durationSamples
      ? absoluteDurationErrorMinutes / durationSamples
      : undefined,
    loggedSets,
    painReportedSets,
  };
}
