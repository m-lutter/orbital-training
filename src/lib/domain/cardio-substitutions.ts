import type {
  CardioModality,
  CardioPrescription,
  QuestionnaireInput,
} from "./types.js";

export const CARDIO_MODALITIES: readonly CardioModality[] = [
  "walking",
  "running",
  "cycling",
  "rowing",
  "elliptical",
  "swimming",
  "rucking",
  "sport",
];

export function isCardioModality(value: unknown): value is CardioModality {
  return (
    typeof value === "string" &&
    CARDIO_MODALITIES.includes(value as CardioModality)
  );
}

/** Access is explicit for equipment-dependent activities. Outdoor activities
 * are declared available by selecting them in the cardio preferences. */
export function modalityIsAvailable(
  modality: CardioModality,
  input: QuestionnaireInput,
  facilityMode: "primary" | "secondary" = "primary",
): boolean {
  const equipment = new Set<string>(
    facilityMode === "secondary"
      ? (input.facility.alternateEquipment ?? [])
      : (input.facility.primaryEquipment ?? []),
  );
  const required: Partial<Record<CardioModality, string>> = {
    cycling: "cardio_bike",
    rowing: "rower",
    elliptical: "elliptical",
    swimming: "pool",
  };
  return required[modality] === undefined || equipment.has(required[modality]!);
}

/** Never invent a fallback preference. The generator must explain infeasibility
 * if no selected activity is available; the logger retains legacy prescriptions. */
export function availableCardioModalities(
  input: QuestionnaireInput,
  facilityMode: "primary" | "secondary" = "primary",
): CardioModality[] {
  return [...new Set(input.cardio.preferredModalities ?? [])].filter(
    (modality) =>
      isCardioModality(modality) &&
      !(modality === "running" && input.cardio.avoidRunning) &&
      modalityIsAvailable(modality, input, facilityMode),
  );
}

/** Today's alternate is time/effort equivalent, not pace, distance, or HR
 * equivalent. The original prescription and future programming stay untouched. */
export function createCardioModalityVariant(
  prescription: CardioPrescription,
  modality: CardioModality,
): CardioPrescription {
  const variant = structuredClone(prescription);
  if (modality === prescription.modality) return variant;
  variant.modality = modality;
  delete variant.targetDistance;
  delete variant.paceTarget;
  delete variant.heartRateBpm;
  const actions: Record<CardioModality, string> = {
    walking: "Walk",
    running: "Run",
    cycling: "Cycle",
    rowing: "Row",
    elliptical: "Use the elliptical",
    swimming: "Swim",
    rucking: "Ruck",
    sport: "Do your selected sport",
  };
  const effort = {
    easy: "Keep breathing comfortable enough for full sentences.",
    moderate: "Use a steady effort that allows short sentences.",
    hard: "Work hard but controlled; recover easily between work intervals.",
  };
  variant.talkTest = `${actions[modality]}. ${effort[variant.intensity]} Use the prescribed effort, not the original activity's pace, distance, or heart-rate target.`;
  variant.segments = variant.segments?.map((segment) => {
    const timed = { ...segment };
    delete timed.distance;
    delete timed.distanceUnit;
    const labels = {
      warmup: "Easy warm-up",
      work: "Work",
      recovery: "Easy recovery",
      cooldown: "Easy cool-down",
    };
    return {
      ...timed,
      label: `${labels[segment.kind]} · ${actions[modality].toLowerCase()}`,
    };
  });
  return variant;
}
