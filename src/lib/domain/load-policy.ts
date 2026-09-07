import { getExercise } from "./exercises.js";
import type {
  QuestionnaireInput,
  TrainingProgram,
  UnitSystem,
} from "./types.js";

const CANONICAL_BARBELL_INCREMENT_VERSION = [0, 10, 0] as const;

function parsedVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Engine 0.10 made `loadSettings.barbellIncrement` the total change on the
 * bar. Earlier programs stored the smallest plate per side instead.
 */
export function usesCanonicalBarbellIncrement(engineVersion: string): boolean {
  const parsed = parsedVersion(engineVersion);
  if (parsed === undefined) return true;
  for (let index = 0; index < parsed.length; index += 1) {
    const part = parsed[index] ?? 0;
    const minimum = CANONICAL_BARBELL_INCREMENT_VERSION[index] ?? 0;
    if (part > minimum) return true;
    if (part < minimum) return false;
  }
  return true;
}

export function defaultSmallestBarbellPlate(units: UnitSystem): number {
  return units === "lb" ? 2.5 : 1;
}

export function defaultDumbbellIncrement(units: UnitSystem): number {
  return units === "lb" ? 2.5 : 1;
}

/** Questionnaire input is the smallest plate on one side of the bar. */
export function totalBarbellIncrementFromInput(
  input: Pick<QuestionnaireInput, "units" | "facility">,
): number {
  return (
    (input.facility.barbellIncrement ??
      defaultSmallestBarbellPlate(input.units)) * 2
  );
}

/** Converts a persisted program setting to the canonical total-bar change. */
export function totalBarbellIncrement(
  program: Pick<TrainingProgram, "engineVersion" | "loadSettings">,
): number {
  return usesCanonicalBarbellIncrement(program.engineVersion)
    ? program.loadSettings.barbellIncrement
    : program.loadSettings.barbellIncrement * 2;
}

export function loadIncrementForExercise(
  program: Pick<TrainingProgram, "engineVersion" | "loadSettings">,
  exerciseId: string,
): number {
  const definition = getExercise(exerciseId);
  const primaryEquipment = definition?.equipmentAlternatives[0] ?? [];
  return primaryEquipment.includes("barbell")
    ? totalBarbellIncrement(program)
    : program.loadSettings.dumbbellIncrement;
}

/** Promote legacy settings before saving a payload under the current engine. */
export function canonicalizeLoadSettings(
  program: Pick<TrainingProgram, "engineVersion" | "loadSettings">,
): TrainingProgram["loadSettings"] {
  return {
    ...program.loadSettings,
    barbellIncrement: totalBarbellIncrement(program),
  };
}
