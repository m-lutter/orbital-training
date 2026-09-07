import { getExercise, type UnitSystem } from "$lib/domain";

export type PlateDisplayMode = "iron" | "colored" | "metric";

export interface PlateVisual {
  value: number;
  color: string;
  textColor: string;
}

export interface PlatePlan {
  requestedTotal: number;
  displayedTotal: number;
  unit: UnitSystem;
  barWeight: number;
  plates: PlateVisual[];
}

export interface PlateGeometry extends PlateVisual {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LB_PLATES = [45, 35, 25, 10, 5, 2.5, 1.25];
const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5, 0.25];
const LB_PER_KG = 2.2046226218;

function plateColor(value: number, unit: UnitSystem): string {
  if (unit === "kg") {
    if (value === 25) return "#d84b52";
    if (value === 20) return "#2f75d6";
    if (value === 15) return "#e0bd35";
    if (value === 10) return "#2d9b68";
    if (value === 5) return "#e9edf2";
    if (value === 2.5) return "#232b35";
    return "#aeb8c5";
  }
  if (value === 45) return "#2f75d6";
  if (value === 35) return "#e0bd35";
  if (value === 25) return "#2d9b68";
  if (value === 10) return "#e9edf2";
  if (value === 5) return "#232b35";
  return "#aeb8c5";
}

function plateTextColor(color: string): string {
  return color === "#e9edf2" || color === "#e0bd35" ? "#09111d" : "#ffffff";
}

function roundTo(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

export function isBarbellExercise(exerciseId: string): boolean {
  return (
    getExercise(exerciseId)?.equipmentAlternatives.some(
      (alternative) =>
        alternative.includes("barbell") && alternative.includes("plates"),
    ) ?? false
  );
}

export function calculatePlatePlan(
  requestedTotal: number,
  sourceUnit: UnitSystem,
  mode: PlateDisplayMode,
): PlatePlan {
  const unit: UnitSystem = mode === "metric" ? "kg" : sourceUnit;
  const convertedTotal =
    mode === "metric" && sourceUnit === "lb"
      ? requestedTotal / LB_PER_KG
      : requestedTotal;
  const barWeight = unit === "kg" ? 20 : 45;
  const denominations = unit === "kg" ? KG_PLATES : LB_PLATES;
  const smallest = denominations.at(-1) ?? 1.25;
  const targetPerSide = Math.max(0, (convertedTotal - barWeight) / 2);
  let remaining = roundTo(targetPerSide, smallest);
  const plates: PlateVisual[] = [];

  for (const value of denominations) {
    while (remaining + 0.0001 >= value) {
      const color =
        mode === "iron"
          ? plates.length % 2 === 0
            ? "#77818d"
            : "#626d79"
          : plateColor(value, unit);
      plates.push({ value, color, textColor: plateTextColor(color) });
      remaining = Math.round((remaining - value) * 100) / 100;
    }
  }

  const displayedTotal =
    barWeight + plates.reduce((total, plate) => total + plate.value * 2, 0);

  return {
    requestedTotal,
    displayedTotal: Math.round(displayedTotal * 100) / 100,
    unit,
    barWeight,
    plates,
  };
}

function representativeDiameter(value: number, unit: UnitSystem): number {
  if (unit === "kg") {
    if (value >= 10) return 136;
    if (value >= 5) return 94;
    if (value >= 2.5) return 76;
    if (value >= 1.25) return 64;
    return 54;
  }
  if (value >= 25) return 136;
  if (value >= 10) return 94;
  if (value >= 5) return 76;
  if (value >= 2.5) return 64;
  return 54;
}

function representativeWidth(value: number, unit: UnitSystem): number {
  if (unit === "kg") {
    if (value >= 25) return 36;
    if (value >= 20) return 34;
    if (value >= 15) return 32;
    if (value >= 10) return 29;
    if (value >= 5) return 21;
    return 15;
  }
  if (value >= 45) return 36;
  if (value >= 35) return 33;
  if (value >= 25) return 30;
  if (value >= 10) return 22;
  if (value >= 5) return 18;
  return 14;
}

/** Side profile of plates seated against the inside collar on one sleeve. */
export function layoutPlateGeometry(
  plates: PlateVisual[],
  unit: UnitSystem,
  startX = 154,
  centerY = 90,
): PlateGeometry[] {
  let x = startX;
  return plates.map((plate) => {
    const width = representativeWidth(plate.value, unit);
    const height = representativeDiameter(plate.value, unit);
    const geometry = {
      ...plate,
      x,
      y: centerY - height / 2,
      width,
      height,
    };
    // Loaded plates sit flush against one another on the sleeve.
    x += width;
    return geometry;
  });
}
