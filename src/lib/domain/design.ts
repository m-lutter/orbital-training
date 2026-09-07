import type {
  ExercisePurpose,
  HypertrophySplit,
  Lift,
  MovementPattern,
  Muscle,
  Phase,
  QuestionnaireInput,
} from "./types.js";
import { daysBetween } from "./utils.js";

export interface ProgramSlot {
  key: string;
  title: string;
  purpose: ExercisePurpose;
  patterns: MovementPattern[];
  muscles: Muscle[];
  sets: number;
  reps: { min: number; max: number };
  targetRir: { min: number; max: number };
  priority: number;
  optional: boolean;
  exactExerciseId?: string;
  lift?: Lift;
  loading:
    "heavy_competition" | "competition_volume" | "hypertrophy" | "general";
  maximumFatigue?: 1 | 2 | 3;
}

export interface LiftingTemplate {
  title: string;
  objective: string;
  slots: ProgramSlot[];
  lowerBodyStress: "low" | "moderate" | "high";
}

export function resolveHorizonWeeks(input: QuestionnaireInput): {
  weeks: number;
  rolling: boolean;
} {
  if (input.goals.event !== undefined) {
    return {
      weeks: Math.max(
        1,
        Math.ceil(
          daysBetween(input.goals.startDate, input.goals.event.date) / 7,
        ),
      ),
      rolling: false,
    };
  }
  if (input.goals.horizon.kind === "indefinite")
    return { weeks: 6, rolling: true };
  return { weeks: input.goals.horizon.weeks, rolling: false };
}

export function resolvePhaseMap(
  input: QuestionnaireInput,
  horizonWeeks: number,
): Phase[] {
  const primary = input.goals.primary;
  const powerliftingGoal = input.powerlifting?.goal;
  const hasMeet =
    input.goals.event?.type === "powerlifting_meet" ||
    powerliftingGoal === "meet_prep";
  const phases: Phase[] = [];

  if (primary === "powerlifting") {
    // Reserve the event taper before any other phase, including seven-day runways.
    const taperWeeks = hasMeet
      ? Math.min(horizonWeeks, horizonWeeks >= 10 ? 2 : 1)
      : 0;
    const reentryWeeks =
      powerliftingGoal === "return_to_powerlifting"
        ? Math.min(2, Math.max(0, horizonWeeks - taperWeeks - 1))
        : 0;
    const peakWeeks =
      hasMeet || powerliftingGoal === "peak_or_test"
        ? Math.min(
            horizonWeeks - taperWeeks - reentryWeeks,
            3,
            Math.max(1, Math.floor(horizonWeeks * 0.25)),
          )
        : 0;
    const remaining = Math.max(
      0,
      horizonWeeks - reentryWeeks - taperWeeks - peakWeeks,
    );
    const basePhase: Phase =
      powerliftingGoal === "work_capacity"
        ? "work_capacity"
        : powerliftingGoal === "powerlifting_hypertrophy"
          ? "hypertrophy"
          : "strength";
    for (let index = 0; index < reentryWeeks; index += 1)
      phases.push("reentry");
    const baseWeeks = Math.max(0, Math.floor(remaining * 0.45));
    const specificityWeeks = remaining - baseWeeks;
    for (let index = 0; index < baseWeeks; index += 1) phases.push(basePhase);
    for (let index = 0; index < specificityWeeks; index += 1)
      phases.push(hasMeet ? "specificity" : "strength");
    for (let index = 0; index < peakWeeks; index += 1) phases.push("peak");
    for (let index = 0; index < taperWeeks; index += 1) phases.push("taper");
  } else if (primary === "hypertrophy") {
    for (let index = 0; index < horizonWeeks; index += 1) {
      phases.push(
        index === horizonWeeks - 1 && horizonWeeks >= 6
          ? "review"
          : "hypertrophy",
      );
    }
  } else if (primary === "cardio") {
    const baseWeeks = Math.max(2, Math.ceil(horizonWeeks / 3));
    for (let index = 0; index < horizonWeeks; index += 1) {
      phases.push(
        index < baseWeeks
          ? "aerobic_base"
          : index === horizonWeeks - 1
            ? "review"
            : "cardio_build",
      );
    }
  } else {
    const reentryWeeks = ["none", "sporadic"].includes(
      input.history.recentConsistency,
    )
      ? Math.min(2, horizonWeeks - 1)
      : 0;
    for (let index = 0; index < horizonWeeks; index += 1)
      phases.push(
        index < reentryWeeks
          ? "reentry"
          : index === horizonWeeks - 1
            ? "review"
            : "base",
      );
  }
  while (phases.length < horizonWeeks) phases.push(phases.at(-1) ?? "base");
  return phases.slice(0, horizonWeeks);
}

const eligibleSplits: Record<number, HypertrophySplit[]> = {
  1: ["full_body"],
  2: ["full_body", "upper_lower", "push_pull"],
  3: ["full_body", "upper_lower", "ppl", "arnold", "torso_limbs"],
  4: ["upper_lower", "torso_limbs", "full_body", "ppl"],
  5: ["ppl_upper_lower", "priority_hybrid", "body_part", "torso_limbs"],
  6: ["ppl", "arnold", "upper_lower", "body_part", "full_body"],
};

export function eligibleHypertrophySplits(days: number): HypertrophySplit[] {
  const normalized = Math.max(1, Math.min(6, Math.round(days)));
  return [...(eligibleSplits[normalized] ?? ["full_body"])];
}

export function selectHypertrophySplit(
  input: QuestionnaireInput,
): HypertrophySplit | undefined {
  const hypertrophy = input.hypertrophy;
  if (hypertrophy === undefined) return undefined;
  const days = Math.max(1, Math.min(6, input.schedule.liftingDaysPerWeek));
  const eligible = eligibleHypertrophySplits(days);
  if (
    hypertrophy.splitPreference !== "auto" &&
    eligible.includes(hypertrophy.splitPreference)
  ) {
    return hypertrophy.splitPreference;
  }
  if (days <= 3) return "full_body";
  if (days === 4) return "upper_lower";
  if (days === 5) return "ppl_upper_lower";
  return "ppl";
}

const slot = (value: ProgramSlot): ProgramSlot => value;

function accessory(
  key: string,
  title: string,
  patterns: MovementPattern[],
  muscles: Muscle[],
  priority: number,
  sets = 2,
): ProgramSlot {
  const trunk = patterns.includes("trunk");
  return slot({
    key,
    title,
    purpose: trunk ? "trunk" : "hypertrophy",
    patterns,
    muscles,
    sets,
    reps: trunk ? { min: 6, max: 12 } : { min: 8, max: 15 },
    targetRir: { min: 1, max: 3 },
    priority,
    optional: true,
    loading: "hypertrophy",
    maximumFatigue: 2,
  });
}

function healthSlot(
  key: string,
  title: string,
  pattern: MovementPattern,
  muscles: Muscle[],
  priority: number,
): ProgramSlot {
  return slot({
    key,
    title,
    purpose: "general_function",
    patterns: [pattern],
    muscles,
    sets: 2,
    reps: { min: 6, max: 15 },
    targetRir: { min: 2, max: 4 },
    priority,
    optional: false,
    loading: "general",
    maximumFatigue: 2,
  });
}

function competitionSlot(
  lift: Lift,
  loading: "heavy_competition" | "competition_volume",
  priority: number,
): ProgramSlot {
  const pattern: Record<Lift, MovementPattern> = {
    squat: "squat",
    bench: "horizontal_push",
    deadlift: "hinge",
  };
  const muscles: Record<Lift, Muscle[]> = {
    squat: ["quads", "glutes"],
    bench: ["chest", "triceps"],
    deadlift: ["hamstrings", "glutes"],
  };
  return slot({
    key: `${lift}-${loading}`,
    title: `${lift[0]?.toUpperCase()}${lift.slice(1)} ${loading === "heavy_competition" ? "primary" : "volume"}`,
    purpose: "competition_skill",
    patterns: [pattern[lift]],
    muscles: muscles[lift],
    sets: loading === "heavy_competition" ? 3 : 3,
    reps:
      loading === "heavy_competition" ? { min: 1, max: 3 } : { min: 3, max: 6 },
    targetRir:
      loading === "heavy_competition" ? { min: 1, max: 3 } : { min: 2, max: 4 },
    priority,
    optional: false,
    exactExerciseId: `competition_${lift}`,
    lift,
    loading,
    maximumFatigue: 3,
  });
}

function powerliftingTemplates(
  days: number,
  input: QuestionnaireInput,
): LiftingTemplate[] {
  if (days === 1) {
    return [
      {
        title: "Squat + bench + deadlift",
        objective:
          "Preserve weekly practice of all three competition lifts within a minimum-dose session.",
        lowerBodyStress: "high",
        slots: (["squat", "bench", "deadlift"] as Lift[]).map((lift, index) => {
          const slot = competitionSlot(lift, "competition_volume", index + 1);
          slot.sets = 2;
          return slot;
        }),
      },
    ];
  }
  const base: LiftingTemplate[] =
    days <= 2
      ? [
          {
            title: "Squat + bench",
            objective:
              "Primary squat and bench practice with balanced assistance.",
            lowerBodyStress: "high",
            slots: [
              competitionSlot("squat", "heavy_competition", 1),
              competitionSlot("bench", "competition_volume", 2),
              accessory(
                "row",
                "Upper-back support",
                ["horizontal_pull"],
                ["upper_back", "lats"],
                5,
              ),
            ],
          },
          {
            title: "Deadlift + bench",
            objective:
              "Primary deadlift and bench practice with lower-body assistance.",
            lowerBodyStress: "high",
            slots: [
              competitionSlot("deadlift", "heavy_competition", 1),
              competitionSlot("bench", "heavy_competition", 2),
              accessory(
                "quad",
                "Knee-dominant assistance",
                ["squat"],
                ["quads"],
                5,
              ),
              accessory("trunk", "Trunk support", ["trunk"], ["trunk"], 6),
            ],
          },
        ]
      : days === 3
        ? [
            {
              title: "Squat primary + bench volume",
              objective: "Heavy squat practice and submaximal bench volume.",
              lowerBodyStress: "high",
              slots: [
                competitionSlot("squat", "heavy_competition", 1),
                competitionSlot("bench", "competition_volume", 2),
                accessory(
                  "quad",
                  "Quadriceps assistance",
                  ["squat"],
                  ["quads"],
                  5,
                ),
                accessory(
                  "row",
                  "Upper-back support",
                  ["horizontal_pull"],
                  ["upper_back"],
                  6,
                ),
              ],
            },
            {
              title: "Bench primary + deadlift volume",
              objective: "Heavy bench practice and controlled deadlift volume.",
              lowerBodyStress: "moderate",
              slots: [
                competitionSlot("bench", "heavy_competition", 1),
                competitionSlot("deadlift", "competition_volume", 2),
                accessory(
                  "triceps",
                  "Triceps assistance",
                  ["elbow_extension"],
                  ["triceps"],
                  5,
                ),
                accessory(
                  "lats",
                  "Lat assistance",
                  ["vertical_pull"],
                  ["lats"],
                  6,
                ),
              ],
            },
            {
              title: "Deadlift primary + squat volume",
              objective: "Heavy deadlift practice and controlled squat volume.",
              lowerBodyStress: "high",
              slots: [
                competitionSlot("deadlift", "heavy_competition", 1),
                competitionSlot("squat", "competition_volume", 2),
                competitionSlot("bench", "competition_volume", 3),
                accessory(
                  "hamstrings",
                  "Hamstring assistance",
                  ["knee_flexion"],
                  ["hamstrings"],
                  6,
                ),
                accessory("trunk", "Trunk support", ["trunk"], ["trunk"], 7),
              ],
            },
          ]
        : [
            {
              title: "Squat primary + bench volume",
              objective: "Heavy squat practice with bench volume.",
              lowerBodyStress: "high",
              slots: [
                competitionSlot("squat", "heavy_competition", 1),
                competitionSlot("bench", "competition_volume", 2),
                accessory(
                  "quad",
                  "Quadriceps assistance",
                  ["squat"],
                  ["quads"],
                  5,
                ),
                accessory(
                  "row",
                  "Upper-back support",
                  ["horizontal_pull"],
                  ["upper_back"],
                  6,
                ),
              ],
            },
            {
              title: "Bench primary + deadlift volume",
              objective:
                "Heavy bench practice with controlled deadlift volume.",
              lowerBodyStress: "moderate",
              slots: [
                competitionSlot("bench", "heavy_competition", 1),
                competitionSlot("deadlift", "competition_volume", 2),
                accessory(
                  "triceps",
                  "Triceps assistance",
                  ["elbow_extension"],
                  ["triceps"],
                  5,
                ),
                accessory(
                  "lats",
                  "Lat assistance",
                  ["vertical_pull"],
                  ["lats"],
                  6,
                ),
              ],
            },
            {
              title: "Squat volume + bench variation",
              objective:
                "Technical volume without another maximal lower-body stressor.",
              lowerBodyStress: "moderate",
              slots: [
                competitionSlot("squat", "competition_volume", 1),
                competitionSlot("bench", "competition_volume", 2),
                accessory(
                  "hamstrings",
                  "Hamstring assistance",
                  ["knee_flexion"],
                  ["hamstrings"],
                  5,
                ),
                accessory(
                  "side-delts",
                  "Deltoid assistance",
                  ["lateral_raise"],
                  ["side_delts"],
                  7,
                ),
              ],
            },
            {
              title: "Deadlift primary + bench volume",
              objective:
                "Heavy deadlift practice with a further bench exposure.",
              lowerBodyStress: "high",
              slots: [
                competitionSlot("deadlift", "heavy_competition", 1),
                competitionSlot("bench", "competition_volume", 2),
                accessory(
                  "posterior",
                  "Posterior-chain assistance",
                  ["hinge"],
                  ["hamstrings", "glutes"],
                  5,
                ),
                accessory(
                  "row",
                  "Stable upper-back volume",
                  ["horizontal_pull"],
                  ["upper_back", "lats"],
                  6,
                ),
                accessory("trunk", "Trunk support", ["trunk"], ["trunk"], 7),
              ],
            },
          ];

  while (base.length < days) {
    base.push({
      title: `Low-fatigue assistance ${base.length + 1}`,
      objective:
        "Distribute optional muscle-building work without adding another demanding competition exposure.",
      lowerBodyStress: "low",
      slots: [
        accessory(
          "upper-chest",
          "Chest assistance",
          ["horizontal_push"],
          ["chest"],
          5,
        ),
        accessory(
          "back",
          "Back assistance",
          ["horizontal_pull"],
          ["upper_back", "lats"],
          5,
        ),
        accessory("arms", "Arm assistance", ["elbow_flexion"], ["biceps"], 6),
        accessory("legs", "Leg assistance", ["squat"], ["quads"], 6),
      ],
    });
  }

  const goal = input.powerlifting?.goal;
  const priorityLift: Lift | undefined =
    goal === "squat_specialization"
      ? "squat"
      : goal === "bench_specialization"
        ? "bench"
        : goal === "deadlift_specialization"
          ? "deadlift"
          : undefined;
  if (priorityLift !== undefined && base.length >= 3) {
    const target =
      base.find(
        (template) =>
          !template.slots.some((item) => item.lift === priorityLift),
      ) ?? base.at(-1);
    target?.slots.unshift(
      competitionSlot(priorityLift, "competition_volume", 2),
    );
    for (const template of base) {
      for (const item of template.slots) {
        if (
          item.lift !== undefined &&
          item.lift !== priorityLift &&
          item.loading === "competition_volume"
        ) {
          item.sets = Math.max(2, item.sets - 1);
        }
      }
    }
  }
  if (goal === "upper_specialization") {
    base[0]?.slots.push(
      accessory(
        "upper-priority-row",
        "Upper-back priority",
        ["horizontal_pull"],
        ["upper_back"],
        4,
        3,
      ),
    );
    base[1]?.slots.push(
      accessory(
        "upper-priority-chest",
        "Chest/triceps priority",
        ["horizontal_push"],
        ["chest", "triceps"],
        4,
        3,
      ),
    );
  }
  if (goal === "lower_specialization") {
    base[0]?.slots.push(
      accessory(
        "lower-priority-quad",
        "Quadriceps priority",
        ["squat"],
        ["quads"],
        4,
        3,
      ),
    );
    base
      .at(-1)
      ?.slots.push(
        accessory(
          "lower-priority-ham",
          "Hamstring priority",
          ["knee_flexion"],
          ["hamstrings"],
          4,
          3,
        ),
      );
  }
  if (input.goals.secondary === "hypertrophy") {
    const secondaryShare = 100 - input.goals.primaryWeight;
    const additions = Math.max(1, Math.min(5, Math.ceil(secondaryShare / 10)));
    base
      .flatMap((template) => template.slots)
      .filter((item) => item.optional && item.purpose === "hypertrophy")
      .sort((left, right) => left.priority - right.priority)
      .slice(0, additions)
      .forEach((item) => {
        item.sets += 1;
      });
  }
  const frequencyPreferences: Partial<Record<Lift, number | undefined>> = {
    squat: input.powerlifting?.advanced?.squatFrequencyPreference,
    bench: input.powerlifting?.advanced?.benchFrequencyPreference,
    deadlift: input.powerlifting?.advanced?.deadliftFrequencyPreference,
  };
  const minimums: Record<Lift, number> = { squat: 1, bench: 2, deadlift: 1 };
  for (const lift of ["squat", "bench", "deadlift"] as Lift[]) {
    const requested = frequencyPreferences[lift];
    if (requested === undefined) continue;
    const validTarget = Math.max(minimums[lift], Math.min(days, requested));
    let exposures = base
      .flatMap((template) => template.slots)
      .filter((item) => item.lift === lift);
    while (exposures.length > validTarget) {
      const removable = [...base]
        .reverse()
        .flatMap((template) =>
          template.slots.map((item) => ({ template, item })),
        )
        .find(
          ({ item }) =>
            item.lift === lift && item.loading === "competition_volume",
        );
      if (removable === undefined) break;
      removable.template.slots = removable.template.slots.filter(
        (item) => item !== removable.item,
      );
      exposures = base
        .flatMap((template) => template.slots)
        .filter((item) => item.lift === lift);
    }
    while (exposures.length < validTarget) {
      const target = base.find(
        (template) => !template.slots.some((item) => item.lift === lift),
      );
      if (target === undefined) break;
      const added = competitionSlot(lift, "competition_volume", 3);
      added.sets = 2;
      target.slots.unshift(added);
      exposures.push(added);
    }
  }
  return base.slice(0, days);
}

type Focus =
  | "full"
  | "upper"
  | "lower"
  | "push"
  | "pull"
  | "legs"
  | "torso"
  | "limbs"
  | "chest_back"
  | "shoulders_arms"
  | "priority";

function splitFocuses(
  split: HypertrophySplit,
  days: number,
  weekNumber: number,
): Focus[] {
  const patterns: Record<HypertrophySplit, Focus[]> = {
    auto: ["full"],
    full_body: ["full"],
    upper_lower: ["upper", "lower"],
    push_pull: ["push", "pull"],
    ppl: ["push", "pull", "legs"],
    ppl_upper_lower: ["push", "pull", "legs", "upper", "lower"],
    arnold: ["chest_back", "shoulders_arms", "legs"],
    torso_limbs: ["torso", "limbs", "torso", "limbs", "priority"],
    body_part: ["push", "pull", "legs", "shoulders_arms", "priority", "full"],
    priority_hybrid: ["upper", "lower", "upper", "lower", "priority"],
  };
  const source = patterns[split];
  return Array.from(
    { length: days },
    (_, index) =>
      source[((weekNumber - 1) * days + index) % source.length] ?? "full",
  );
}

function muscleSlot(
  muscle: Muscle,
  keySuffix: string,
  sets = 2,
  priority = 5,
): ProgramSlot {
  const mapping: Record<Muscle, { pattern: MovementPattern; title: string }> = {
    chest: { pattern: "horizontal_push", title: "Chest" },
    upper_chest: { pattern: "horizontal_push", title: "Upper chest" },
    lats: { pattern: "vertical_pull", title: "Lats" },
    upper_back: { pattern: "horizontal_pull", title: "Upper back" },
    quads: { pattern: "squat", title: "Quadriceps" },
    hamstrings: { pattern: "knee_flexion", title: "Hamstrings" },
    glutes: { pattern: "hinge", title: "Glutes" },
    calves: { pattern: "calf_raise", title: "Calves" },
    biceps: { pattern: "elbow_flexion", title: "Biceps" },
    triceps: { pattern: "elbow_extension", title: "Triceps" },
    front_delts: { pattern: "vertical_push", title: "Front delts" },
    side_delts: { pattern: "lateral_raise", title: "Side delts" },
    rear_delts: { pattern: "horizontal_pull", title: "Rear delts" },
    trunk: { pattern: "trunk", title: "Trunk" },
  };
  const item = mapping[muscle];
  return accessory(
    `${muscle}-${keySuffix}`,
    `${item.title} hypertrophy`,
    [item.pattern],
    [muscle],
    priority,
    sets,
  );
}

function focusMuscles(focus: Focus): Muscle[] {
  const mapping: Record<Focus, Muscle[]> = {
    full: ["quads", "hamstrings", "chest", "upper_back", "side_delts", "trunk"],
    upper: ["chest", "upper_back", "lats", "side_delts", "biceps", "triceps"],
    lower: ["quads", "hamstrings", "glutes", "calves", "trunk"],
    push: ["chest", "upper_chest", "side_delts", "triceps"],
    pull: ["lats", "upper_back", "rear_delts", "biceps"],
    legs: ["quads", "hamstrings", "glutes", "calves", "trunk"],
    torso: ["chest", "upper_back", "lats", "side_delts"],
    limbs: ["quads", "hamstrings", "biceps", "triceps", "calves"],
    chest_back: ["chest", "upper_chest", "lats", "upper_back"],
    shoulders_arms: ["side_delts", "rear_delts", "biceps", "triceps"],
    priority: [],
  };
  return mapping[focus];
}

function hypertrophyTemplates(
  days: number,
  input: QuestionnaireInput,
  split: HypertrophySplit,
  weekNumber = 1,
): LiftingTemplate[] {
  const priorities =
    input.hypertrophy?.balance === "prioritized"
      ? [...(input.hypertrophy?.musclePriorities ?? [])].sort(
          (left, right) => left.rank - right.rank,
        )
      : [];
  const focusSequence = splitFocuses(split, days, weekNumber);
  const templates: LiftingTemplate[] = focusSequence.map(
    (focus, index): LiftingTemplate => {
      let muscles =
        focus === "priority"
          ? priorities.map((item) => item.muscle)
          : focusMuscles(focus);
      if (muscles.length === 0) muscles = focusMuscles("full");
      const slots = muscles
        .slice(0, 6)
        .map((muscle, muscleIndex) =>
          muscleSlot(
            muscle,
            `${index + 1}`,
            muscleIndex < 2 ? 3 : 2,
            muscleIndex + 1,
          ),
        );
      for (const priority of priorities) {
        const existing = slots.find((item) =>
          item.muscles.includes(priority.muscle),
        );
        if (existing !== undefined) {
          existing.priority = Math.min(existing.priority, priority.rank);
        }
      }
      return {
        title: `${focus.replace("_", " & ")} hypertrophy`,
        objective: `Develop ${muscles.slice(0, 3).join(", ")} with measurable, equipment-valid work.`,
        lowerBodyStress: muscles.some((muscle) =>
          ["quads", "hamstrings", "glutes"].includes(muscle),
        )
          ? "moderate"
          : "low",
        slots,
      };
    },
  );
  if (
    input.hypertrophy?.preserveCompetitionLifts === true ||
    input.goals.secondary === "powerlifting"
  ) {
    const skillSets =
      input.goals.secondary === "powerlifting" &&
      100 - input.goals.primaryWeight < 30
        ? 1
        : 2;
    (["squat", "bench", "deadlift"] as Lift[]).forEach((lift, index) => {
      const target = templates[index % templates.length];
      if (target !== undefined) {
        const preserved = competitionSlot(lift, "competition_volume", 1);
        preserved.sets = skillSets;
        target.slots.unshift(preserved);
      }
    });
  }
  return templates;
}

function healthTemplates(
  days: number,
  input: QuestionnaireInput,
): LiftingTemplate[] {
  const templates: LiftingTemplate[] = [];
  for (let index = 0; index < days; index += 1) {
    const slots = [
      healthSlot(
        `knee-${index}`,
        "Knee-dominant strength",
        "squat",
        ["quads", "glutes"],
        1,
      ),
      healthSlot(
        `hinge-${index}`,
        "Hip-hinge strength",
        "hinge",
        ["hamstrings", "glutes"],
        2,
      ),
      healthSlot(
        `push-${index}`,
        "Upper-body push",
        "horizontal_push",
        ["chest", "triceps"],
        3,
      ),
      healthSlot(
        `pull-${index}`,
        "Upper-body pull",
        index % 2 === 0 ? "horizontal_pull" : "vertical_pull",
        ["upper_back", "lats"],
        4,
      ),
      healthSlot(`trunk-${index}`, "Trunk or carry", "trunk", ["trunk"], 5),
    ];
    if (input.generalFitness?.emphasis === "strength") {
      const knee = slots[0];
      const hinge = slots[1];
      if (knee !== undefined) knee.sets = 3;
      if (hinge !== undefined) hinge.sets = 3;
    }
    if (input.generalFitness?.chairStandConcern === true && index === 0) {
      const knee = slots[0];
      if (knee !== undefined) {
        knee.exactExerciseId = "chair_stand";
        knee.title = "Chair-stand strength and practice";
      }
    }
    if (
      (input.age >= 65 || input.generalFitness?.balanceConcern === true) &&
      index === 0
    ) {
      slots.push(
        slot({
          key: "balance",
          title: "Supported balance practice",
          purpose: "general_function",
          patterns: ["locomotion"],
          muscles: [],
          sets: 2,
          reps: { min: 20, max: 30 },
          targetRir: { min: 4, max: 4 },
          priority: 4,
          optional: false,
          exactExerciseId: "supported_balance",
          loading: "general",
          maximumFatigue: 1,
        }),
      );
    }
    if (input.generalFitness?.floorTransferConcern === true && index === 0) {
      slots.push(
        slot({
          key: "floor-transfer",
          title: "Supported floor-transfer practice",
          purpose: "general_function",
          patterns: ["locomotion", "trunk"],
          muscles: ["trunk", "quads"],
          sets: 2,
          reps: { min: 3, max: 6 },
          targetRir: { min: 4, max: 4 },
          priority: 4,
          optional: false,
          exactExerciseId: "floor_transfer_practice",
          loading: "general",
          maximumFatigue: 1,
        }),
      );
    }
    if (input.generalFitness?.emphasis === "mobility" && index === 0) {
      slots.push(
        slot({
          key: "mobility",
          title: "Controlled mobility sequence",
          purpose: "general_function",
          patterns: ["squat", "hinge", "vertical_push"],
          muscles: [],
          sets: 2,
          reps: { min: 5, max: 8 },
          targetRir: { min: 4, max: 4 },
          priority: 3,
          optional: false,
          exactExerciseId: "controlled_mobility_sequence",
          loading: "general",
          maximumFatigue: 1,
        }),
      );
    }
    templates.push({
      title: `Whole-body health ${index + 1}`,
      objective:
        "Train the major movement patterns with low complexity and sustainable effort.",
      lowerBodyStress: "moderate",
      slots,
    });
  }
  const preserveCompetitionPractice =
    input.powerlifting !== undefined ||
    input.hypertrophy?.preserveCompetitionLifts === true ||
    input.generalFitness?.preserveCompetitionLifts === true;
  if (preserveCompetitionPractice && templates.length > 0) {
    const secondaryShare = 100 - input.goals.primaryWeight;
    const skillSets =
      input.goals.secondary === "powerlifting" && secondaryShare < 30 ? 1 : 2;
    const squat = competitionSlot("squat", "competition_volume", 2);
    const bench = competitionSlot("bench", "competition_volume", 2);
    const deadlift = competitionSlot("deadlift", "competition_volume", 2);
    squat.sets = skillSets;
    bench.sets = skillSets;
    deadlift.sets = skillSets;
    const first = templates[0];
    if (first !== undefined) {
      first.slots[0] = squat;
      first.slots[2] = bench;
    }
    const deadliftDay = templates[Math.min(1, templates.length - 1)];
    if (deadliftDay !== undefined) deadliftDay.slots[1] = deadlift;
  }
  if (
    input.goals.secondary === "hypertrophy" &&
    input.hypertrophy?.balance === "prioritized"
  ) {
    const secondaryShare = 100 - input.goals.primaryWeight;
    const additions = Math.max(1, Math.min(3, Math.ceil(secondaryShare / 20)));
    for (const priority of input.hypertrophy.musclePriorities.slice(
      0,
      additions,
    )) {
      const matching = templates
        .flatMap((template) => template.slots)
        .find((item) => item.muscles.includes(priority.muscle));
      if (matching !== undefined) matching.sets += 1;
    }
  }
  return templates;
}

export function buildLiftingTemplates(
  input: QuestionnaireInput,
  split: HypertrophySplit | undefined,
  weekNumber = 1,
): LiftingTemplate[] {
  const days = input.schedule.liftingDaysPerWeek;
  if (input.goals.primary === "powerlifting")
    return powerliftingTemplates(days, input);
  if (input.goals.primary === "hypertrophy")
    return hypertrophyTemplates(days, input, split ?? "full_body", weekNumber);
  if (input.goals.primary === "cardio") {
    const retainedDays = Math.min(days, 2);
    if (input.goals.secondary === "powerlifting")
      return powerliftingTemplates(retainedDays, input);
    if (input.goals.secondary === "hypertrophy")
      return hypertrophyTemplates(
        retainedDays,
        input,
        split ?? "full_body",
        weekNumber,
      );
    return healthTemplates(retainedDays, input);
  }
  return healthTemplates(days, input);
}
