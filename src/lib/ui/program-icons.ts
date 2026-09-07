import type { ProgramDraftV3 } from "$lib/engine";
import { latestWorkoutLogs, type WorkoutLog } from "$lib/workouts";

export const PROGRAM_ICONS = [
  "orbital_strength",
  "launch_vector",
  "orbital_relay",
  "solar_forge",
  "atlas_lifter",
  "mission_control",
  "deep_space_pathfinder",
  "lunar_completion",
] as const;

export type ProgramIconName = (typeof PROGRAM_ICONS)[number];

export interface ProgramIconOption {
  name: ProgramIconName;
  label: string;
  cuteLabel: string;
  description: string;
  achievement?: "full_program";
}

export const PROGRAM_ICON_OPTIONS: readonly ProgramIconOption[] = [
  {
    name: "orbital_strength",
    label: "Orbital Strength",
    cuteLabel: "Heart",
    description: "Barbell mission badge",
  },
  {
    name: "launch_vector",
    label: "Launch Vector",
    cuteLabel: "Cat",
    description: "Single-stage rocket badge",
  },
  {
    name: "orbital_relay",
    label: "Orbital Relay",
    cuteLabel: "Blossom",
    description: "Communications satellite badge",
  },
  {
    name: "solar_forge",
    label: "Solar Forge",
    cuteLabel: "Daisy flower",
    description: "Solar barbell badge",
  },
  {
    name: "atlas_lifter",
    label: "Atlas Lifter",
    cuteLabel: "Dog",
    description: "Heavy-lift rocket badge",
  },
  {
    name: "mission_control",
    label: "Mission Control",
    cuteLabel: "Sitting cat",
    description: "Tracking display badge",
  },
  {
    name: "deep_space_pathfinder",
    label: "Deep-Space Pathfinder",
    cuteLabel: "Barbell",
    description: "Ringed planet badge",
  },
  {
    name: "lunar_completion",
    label: "Lunar Completion",
    cuteLabel: "Gold star",
    description: "Awarded after completing a full program",
    achievement: "full_program",
  },
];

const ICON_PATHS: Record<ProgramIconName, string> = {
  orbital_strength: "/badges/orbital-strength.svg",
  launch_vector: "/badges/launch-vector.svg",
  orbital_relay: "/badges/orbital-relay.svg",
  solar_forge: "/badges/solar-forge.svg",
  atlas_lifter: "/badges/atlas-lifter.svg",
  mission_control: "/badges/mission-control.svg",
  deep_space_pathfinder: "/badges/deep-space-pathfinder.svg",
  lunar_completion: "/badges/lunar-completion.svg",
};

export function programIconName(value: unknown): ProgramIconName {
  // Preserve compatibility with the two icon values used before the badge set.
  if (value === "orbiter") return "deep_space_pathfinder";
  if (value === "launch_vehicle") return "launch_vector";
  return PROGRAM_ICONS.includes(value as ProgramIconName)
    ? (value as ProgramIconName)
    : "orbital_strength";
}

export function programIconPath(name: ProgramIconName): string {
  return ICON_PATHS[name];
}

/**
 * Visual-only alternatives used by the cute appearance. Keeping this mapping
 * outside the component makes it deterministic and prevents appearance from
 * leaking into saved program data.
 */
export function cuteProgramIconMark(name: ProgramIconName): string {
  const marks: Record<ProgramIconName, string> = {
    orbital_strength: "♥",
    launch_vector: "cat",
    orbital_relay: "✿",
    solar_forge: "flower",
    atlas_lifter: "dog",
    mission_control: "cat_silhouette",
    deep_space_pathfinder: "barbell",
    lunar_completion: "★",
  };
  return marks[name];
}

export function selectableProgramIcons(
  lunarCompletionUnlocked: boolean,
): readonly ProgramIconOption[] {
  return PROGRAM_ICON_OPTIONS.filter(
    (option) =>
      option.achievement !== "full_program" || lunarCompletionUnlocked,
  );
}

/** Logs must already be restricted to this program by the caller. */
export function hasFullyCompletedProgram(
  draft: ProgramDraftV3,
  logs: WorkoutLog[],
): boolean {
  const plannedSessionIds = draft.program.weeks.flatMap((week) =>
    week.sessions
      .filter((session) => session.kind !== "movement")
      .map((session) => session.id),
  );
  if (plannedSessionIds.length === 0) return false;
  const statusBySession = new Map(
    latestWorkoutLogs(logs).map((log) => [log.sessionId, log.status]),
  );
  return plannedSessionIds.every(
    (sessionId) => statusBySession.get(sessionId) === "completed",
  );
}

export function programIconFromDraft(draft: ProgramDraftV3): ProgramIconName {
  return programIconName(draft.questionnaireFormValues?.programIcon);
}

export function programIconFromPayload(payload: unknown): ProgramIconName {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    return "orbital_strength";
  const snapshot = (payload as Record<string, unknown>).questionnaireFormValues;
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    Array.isArray(snapshot)
  )
    return "orbital_strength";
  return programIconName((snapshot as Record<string, unknown>).programIcon);
}
