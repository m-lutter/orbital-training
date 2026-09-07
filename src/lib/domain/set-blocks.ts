import { getExercise } from "./exercises.js";
import { POLICY, POLICY_VERSION } from "./policy.js";
import { recalculateSessionDuration } from "./duration.js";
import type {
  ExerciseDefinition,
  ExercisePrescription,
  MovementPattern,
  QuestionnaireInput,
  SetBlock,
  TrainingSession,
} from "./types.js";

const ANTAGONIST_PATTERNS: ReadonlyArray<
  readonly [MovementPattern, MovementPattern]
> = [
  ["horizontal_push", "horizontal_pull"],
  ["vertical_push", "vertical_pull"],
  ["elbow_flexion", "elbow_extension"],
  ["squat", "knee_flexion"],
];

function straightBlock(
  prescription: ExercisePrescription,
  sessionId: string,
): SetBlock {
  return {
    id: `${sessionId}-block-${prescription.id}`,
    type: "straight",
    sequence: [{ prescriptionId: prescription.id, orderLabel: "" }],
    rounds: prescription.sets,
    transitionSeconds: 0,
    interRoundRestSeconds: prescription.restSeconds,
    sameExerciseRecoveryMinimumSeconds: prescription.restSeconds,
    fallback: "unpair",
    methodPolicyVersion: POLICY_VERSION,
    rationaleCode: "straight_default",
    evidenceTag: "supported",
    estimatedTimeSavedMinutes: 0,
    instruction: `Complete all ${prescription.sets} sets of ${prescription.name}, resting ${formatSeconds(prescription.restSeconds)} between sets.`,
  };
}

function formatSeconds(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}

function overlaps(
  left: ExerciseDefinition,
  right: ExerciseDefinition,
): boolean {
  const rightMuscles = new Set([
    ...right.primaryMuscles,
    ...right.secondaryMuscles,
  ]);
  return [...left.primaryMuscles, ...left.secondaryMuscles].some((muscle) =>
    rightMuscles.has(muscle),
  );
}

function isAntagonist(
  left: ExerciseDefinition,
  right: ExerciseDefinition,
): boolean {
  return ANTAGONIST_PATTERNS.some(
    ([first, second]) =>
      (left.patterns.includes(first) && right.patterns.includes(second)) ||
      (left.patterns.includes(second) && right.patterns.includes(first)),
  );
}

function usesEquipment(definition: ExerciseDefinition, equipment: string) {
  return definition.equipmentAlternatives.some((option) =>
    option.includes(equipment as never),
  );
}

function portable(definition: ExerciseDefinition): boolean {
  return ["bodyweight", "dumbbells", "bands"].some((equipment) =>
    usesEquipment(definition, equipment),
  );
}

function fixedStation(definition: ExerciseDefinition): boolean {
  return ["machines", "cables", "rack", "bench"].some((equipment) =>
    usesEquipment(definition, equipment),
  );
}

function eligible(
  prescription: ExercisePrescription,
  definition: ExerciseDefinition | undefined,
): definition is ExerciseDefinition {
  return (
    definition !== undefined &&
    ["stable_compound", "isolation", "trunk"].includes(
      definition.exerciseClass,
    ) &&
    prescription.amrapStopRir === undefined &&
    prescription.sets >= 2 &&
    ["hypertrophy", "low_fatigue_volume", "general_function", "trunk"].includes(
      prescription.purpose,
    )
  );
}

interface Candidate {
  firstIndex: number;
  secondIndex: number;
  score: number;
  rationaleCode: SetBlock["rationaleCode"];
}

function scoreCandidate(
  exercises: ExercisePrescription[],
  firstIndex: number,
  secondIndex: number,
): Candidate | undefined {
  const first = exercises[firstIndex];
  const second = exercises[secondIndex];
  if (first === undefined || second === undefined) return undefined;
  const firstDefinition = getExercise(first.exerciseId);
  const secondDefinition = getExercise(second.exerciseId);
  if (!eligible(first, firstDefinition) || !eligible(second, secondDefinition))
    return undefined;
  if (first.sets !== second.sets || first.optional !== second.optional)
    return undefined;
  if (overlaps(firstDefinition, secondDefinition)) return undefined;

  const antagonist = isAntagonist(firstDefinition, secondDefinition);
  let score = antagonist ? 6 : 4;
  const bothCable =
    usesEquipment(firstDefinition, "cables") &&
    usesEquipment(secondDefinition, "cables");
  const atLeastOnePortable =
    portable(firstDefinition) || portable(secondDefinition);
  if (bothCable) score += 2;
  else if (atLeastOnePortable) score += 2;
  else if (fixedStation(firstDefinition) && fixedStation(secondDefinition))
    score -= 2;
  score -= Math.max(0, secondIndex - firstIndex - 1);

  return {
    firstIndex,
    secondIndex,
    score,
    rationaleCode: antagonist
      ? "antagonist_accessory"
      : "noncompeting_accessory",
  };
}

function bestCandidate(
  exercises: ExercisePrescription[],
): Candidate | undefined {
  const candidates: Candidate[] = [];
  for (let firstIndex = 0; firstIndex < exercises.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex <= Math.min(exercises.length - 1, firstIndex + 2);
      secondIndex += 1
    ) {
      const candidate = scoreCandidate(exercises, firstIndex, secondIndex);
      if (
        candidate !== undefined &&
        candidate.score >= POLICY.superset.minimumCompatibilityScore
      )
        candidates.push(candidate);
    }
  }
  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.firstIndex - right.firstIndex ||
      left.secondIndex - right.secondIndex,
  )[0];
}

function pairedBlock(
  first: ExercisePrescription,
  second: ExercisePrescription,
  sessionId: string,
  pairNumber: number,
  rationaleCode: SetBlock["rationaleCode"],
): SetBlock {
  const firstDefinition = getExercise(first.exerciseId);
  const secondDefinition = getExercise(second.exerciseId);
  const containsStableCompound = [firstDefinition, secondDefinition].some(
    (definition) => definition?.exerciseClass === "stable_compound",
  );
  const interRoundRestSeconds = containsStableCompound
    ? POLICY.superset.stableCompoundInterRoundRestSeconds
    : POLICY.superset.isolationInterRoundRestSeconds;
  const estimatedTimeSavedMinutes = Math.max(
    1,
    Math.min(6, Math.round(1 + (first.sets - 1) * 0.75)),
  );
  const label = String.fromCharCode(65 + pairNumber);
  return {
    id: `${sessionId}-superset-${label.toLowerCase()}`,
    type: "paired_superset",
    sequence: [
      { prescriptionId: first.id, orderLabel: `${label}1` },
      { prescriptionId: second.id, orderLabel: `${label}2` },
    ],
    rounds: first.sets,
    transitionSeconds: POLICY.superset.transitionSeconds,
    interRoundRestSeconds,
    sameExerciseRecoveryMinimumSeconds: Math.max(
      first.restSeconds,
      second.restSeconds,
    ),
    stopRule:
      "Do the exercises separately today if either movement becomes noticeably less controlled, the target effort cannot be maintained, or the equipment setup is impractical.",
    fallback: "unpair",
    methodPolicyVersion: POLICY_VERSION,
    rationaleCode,
    evidenceTag:
      rationaleCode === "antagonist_accessory" ? "supported" : "cautious",
    estimatedTimeSavedMinutes,
    instruction: `Complete ${first.name} (${label}1), move to ${second.name} (${label}2) after about ${POLICY.superset.transitionSeconds} seconds, then rest ${formatSeconds(interRoundRestSeconds)}. Repeat for ${first.sets} rounds.`,
  };
}

/** Builds deterministic straight or A1/A2 execution blocks for one session. */
export function buildSetBlocks(
  exercises: ExercisePrescription[],
  sessionId: string,
  input: QuestionnaireInput,
): SetBlock[] {
  if (input.hypertrophy?.useSupersets !== true) {
    return exercises.map((exercise) => straightBlock(exercise, sessionId));
  }

  const candidate = bestCandidate(exercises);
  if (candidate === undefined) {
    return exercises.map((exercise) => straightBlock(exercise, sessionId));
  }

  const paired = new Set([candidate.firstIndex, candidate.secondIndex]);
  return exercises.flatMap((exercise, index) => {
    if (index === candidate.firstIndex) {
      return [
        pairedBlock(
          exercise,
          exercises[candidate.secondIndex] as ExercisePrescription,
          sessionId,
          0,
          candidate.rationaleCode,
        ),
      ];
    }
    return paired.has(index) ? [] : [straightBlock(exercise, sessionId)];
  });
}

export function refreshSessionSetBlocks(
  session: TrainingSession,
  input: QuestionnaireInput,
): void {
  session.setBlocks = buildSetBlocks(session.exercises, session.id, input);
  recalculateSessionDuration(session);
  // A short alternative belongs to the original exercise/set structure.
  delete session.durationAlternative;
}

export function refreshProgramSetBlocks(
  program: { weeks: Array<{ sessions: TrainingSession[] }> },
  input: QuestionnaireInput,
  include: (session: TrainingSession) => boolean = () => true,
): void {
  for (const week of program.weeks) {
    for (const session of week.sessions) {
      if (session.exercises.length > 0 && include(session))
        refreshSessionSetBlocks(session, input);
    }
  }
}

/** Safely degrades stale/invalid pairs when the original questionnaire is unavailable. */
export function sanitizeSessionSetBlocks(session: TrainingSession): void {
  const blocks = session.setBlocks;
  if (blocks === undefined) return;
  const byId = new Map(
    session.exercises.map((exercise) => [exercise.id, exercise]),
  );
  const validPair = (block: SetBlock) => {
    if (block.type !== "paired_superset" || block.sequence.length !== 2) {
      if (block.type !== "straight" || block.sequence.length !== 1)
        return false;
      const prescription = byId.get(block.sequence[0]!.prescriptionId);
      return prescription !== undefined && block.rounds === prescription.sets;
    }
    const [first, second] = block.sequence.map((item) =>
      byId.get(item.prescriptionId),
    );
    const firstDefinition =
      first === undefined ? undefined : getExercise(first.exerciseId);
    const secondDefinition =
      second === undefined ? undefined : getExercise(second.exerciseId);
    return (
      first !== undefined &&
      second !== undefined &&
      eligible(first, firstDefinition) &&
      eligible(second, secondDefinition) &&
      !overlaps(firstDefinition, secondDefinition) &&
      first.sets === second.sets &&
      block.rounds === first.sets &&
      first.amrapStopRir === undefined &&
      second.amrapStopRir === undefined
    );
  };
  if (!blocks.every(validPair)) {
    session.setBlocks = session.exercises.map((exercise) =>
      straightBlock(exercise, session.id),
    );
  }
}
