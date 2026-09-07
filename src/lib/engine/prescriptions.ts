import type {
  CardioMethod,
  CardioSessionV2,
  ExerciseCategory,
  ExercisePrescription,
  GeneratedWeekV2,
  LiftingSessionV2,
  PrimaryGoal,
  ProgramRequestV1,
  RepRange,
  TrainingSessionV2,
  WeekPhase,
} from "./contracts";

type ExerciseRole =
  "main" | "secondary" | "compound" | "accessory" | "isolation";

interface ExerciseTemplate {
  name: string;
  category: ExerciseCategory;
  muscles: string[];
  role: ExerciseRole;
  substitutions: string[];
}

interface LiftingTemplate {
  title: string;
  exercises: ExerciseTemplate[];
}

const exercise = (
  name: string,
  category: ExerciseCategory,
  muscles: string[],
  role: ExerciseRole,
  substitutions: string[],
): ExerciseTemplate => ({ name, category, muscles, role, substitutions });

const POWERLIFTING_SESSIONS: Record<string, LiftingTemplate> = {
  squatBench: {
    title: "Squat + Bench",
    exercises: [
      exercise(
        "Competition Squat",
        "competition-lift",
        ["quadriceps", "glutes"],
        "main",
        ["High-Bar Squat", "Safety-Bar Squat"],
      ),
      exercise(
        "Competition Bench Press",
        "competition-lift",
        ["chest", "triceps"],
        "secondary",
        ["Paused Bench Press", "Dumbbell Bench Press"],
      ),
      exercise(
        "Romanian Deadlift",
        "compound",
        ["hamstrings", "glutes"],
        "compound",
        ["Good Morning", "Seated Leg Curl"],
      ),
      exercise(
        "Chest-Supported Row",
        "accessory",
        ["upper back", "biceps"],
        "accessory",
        ["Cable Row", "One-Arm Dumbbell Row"],
      ),
      exercise(
        "Cable Triceps Extension",
        "isolation",
        ["triceps"],
        "isolation",
        ["Dumbbell Skull Crusher", "Machine Dip"],
      ),
    ],
  },
  benchUpper: {
    title: "Bench + Upper",
    exercises: [
      exercise(
        "Competition Bench Press",
        "competition-lift",
        ["chest", "triceps"],
        "main",
        ["Paused Bench Press", "Dumbbell Bench Press"],
      ),
      exercise(
        "Overhead Press",
        "compound",
        ["shoulders", "triceps"],
        "secondary",
        ["Machine Shoulder Press", "Seated Dumbbell Press"],
      ),
      exercise("Lat Pulldown", "accessory", ["lats", "biceps"], "accessory", [
        "Assisted Pull-Up",
        "Pull-Up",
      ]),
      exercise(
        "Cable Row",
        "accessory",
        ["upper back", "biceps"],
        "accessory",
        ["Chest-Supported Row", "Dumbbell Row"],
      ),
      exercise(
        "Dumbbell Lateral Raise",
        "isolation",
        ["shoulders"],
        "isolation",
        ["Cable Lateral Raise", "Machine Lateral Raise"],
      ),
    ],
  },
  deadliftBench: {
    title: "Deadlift + Bench",
    exercises: [
      exercise(
        "Competition Deadlift",
        "competition-lift",
        ["glutes", "hamstrings", "back"],
        "main",
        ["Conventional Deadlift", "Sumo Deadlift", "Trap-Bar Deadlift"],
      ),
      exercise(
        "Close-Grip Bench Press",
        "compound",
        ["chest", "triceps"],
        "secondary",
        ["Spoto Press", "Dumbbell Bench Press"],
      ),
      exercise("Leg Press", "compound", ["quadriceps", "glutes"], "compound", [
        "Belt Squat",
        "Bulgarian Split Squat",
      ]),
      exercise("Lat Pulldown", "accessory", ["lats", "biceps"], "accessory", [
        "Assisted Pull-Up",
        "Pull-Up",
      ]),
      exercise("Ab Wheel", "core", ["trunk"], "accessory", [
        "Plank",
        "Cable Crunch",
      ]),
    ],
  },
  squatPosterior: {
    title: "Squat Variation + Posterior Chain",
    exercises: [
      exercise(
        "Paused Squat",
        "compound",
        ["quadriceps", "glutes"],
        "secondary",
        ["Tempo Squat", "Safety-Bar Squat"],
      ),
      exercise(
        "Bench Press",
        "competition-lift",
        ["chest", "triceps"],
        "secondary",
        ["Incline Bench Press", "Dumbbell Bench Press"],
      ),
      exercise("Hip Thrust", "compound", ["glutes"], "compound", [
        "Romanian Deadlift",
        "45-Degree Back Extension",
      ]),
      exercise("Seated Leg Curl", "accessory", ["hamstrings"], "accessory", [
        "Lying Leg Curl",
        "Nordic Curl",
      ]),
      exercise("Farmer Carry", "carry", ["grip", "trunk"], "accessory", [
        "Suitcase Carry",
        "Weighted Plank",
      ]),
    ],
  },
  techniqueUpper: {
    title: "Bench Technique + Upper Assistance",
    exercises: [
      exercise(
        "Paused Bench Press",
        "competition-lift",
        ["chest", "triceps"],
        "secondary",
        ["Tempo Bench Press", "Machine Chest Press"],
      ),
      exercise(
        "Chest-Supported Row",
        "accessory",
        ["upper back", "biceps"],
        "accessory",
        ["Cable Row", "Dumbbell Row"],
      ),
      exercise(
        "Incline Dumbbell Press",
        "compound",
        ["chest", "shoulders"],
        "compound",
        ["Incline Machine Press", "Push-Up"],
      ),
      exercise(
        "Dumbbell Lateral Raise",
        "isolation",
        ["shoulders"],
        "isolation",
        ["Cable Lateral Raise", "Machine Lateral Raise"],
      ),
      exercise("Dumbbell Curl", "isolation", ["biceps"], "isolation", [
        "Cable Curl",
        "Machine Curl",
      ]),
    ],
  },
  lowerCapacity: {
    title: "Lower Work Capacity",
    exercises: [
      exercise(
        "Front Squat",
        "compound",
        ["quadriceps", "glutes"],
        "secondary",
        ["Goblet Squat", "Hack Squat"],
      ),
      exercise(
        "Romanian Deadlift",
        "compound",
        ["hamstrings", "glutes"],
        "compound",
        ["Good Morning", "Seated Leg Curl"],
      ),
      exercise(
        "Walking Lunge",
        "accessory",
        ["quadriceps", "glutes"],
        "accessory",
        ["Split Squat", "Step-Up"],
      ),
      exercise("Back Extension", "accessory", ["glutes", "back"], "accessory", [
        "Hip Extension Machine",
        "Cable Pull-Through",
      ]),
      exercise("Cable Crunch", "core", ["trunk"], "accessory", [
        "Ab Wheel",
        "Plank",
      ]),
    ],
  },
};

const HYPERTROPHY_SESSIONS: Record<string, LiftingTemplate> = {
  fullA: {
    title: "Full Body A",
    exercises: [
      exercise("Back Squat", "compound", ["quadriceps", "glutes"], "compound", [
        "Leg Press",
        "Hack Squat",
      ]),
      exercise(
        "Dumbbell Bench Press",
        "compound",
        ["chest", "triceps"],
        "compound",
        ["Machine Chest Press", "Push-Up"],
      ),
      exercise(
        "Romanian Deadlift",
        "compound",
        ["hamstrings", "glutes"],
        "compound",
        ["Seated Leg Curl", "45-Degree Back Extension"],
      ),
      exercise("Lat Pulldown", "accessory", ["lats", "biceps"], "accessory", [
        "Assisted Pull-Up",
        "Pull-Up",
      ]),
      exercise(
        "Dumbbell Lateral Raise",
        "isolation",
        ["shoulders"],
        "isolation",
        ["Cable Lateral Raise", "Machine Lateral Raise"],
      ),
      exercise("Cable Curl", "isolation", ["biceps"], "isolation", [
        "Dumbbell Curl",
        "Machine Curl",
      ]),
    ],
  },
  fullB: {
    title: "Full Body B",
    exercises: [
      exercise("Leg Press", "compound", ["quadriceps", "glutes"], "compound", [
        "Goblet Squat",
        "Hack Squat",
      ]),
      exercise(
        "Incline Dumbbell Press",
        "compound",
        ["chest", "shoulders"],
        "compound",
        ["Incline Machine Press", "Push-Up"],
      ),
      exercise("Hip Thrust", "compound", ["glutes"], "compound", [
        "Romanian Deadlift",
        "Back Extension",
      ]),
      exercise(
        "Chest-Supported Row",
        "accessory",
        ["upper back", "biceps"],
        "accessory",
        ["Cable Row", "Dumbbell Row"],
      ),
      exercise("Leg Curl", "isolation", ["hamstrings"], "isolation", [
        "Nordic Curl",
        "Stability-Ball Curl",
      ]),
      exercise(
        "Cable Triceps Extension",
        "isolation",
        ["triceps"],
        "isolation",
        ["Dumbbell Skull Crusher", "Machine Dip"],
      ),
    ],
  },
  fullC: {
    title: "Full Body C",
    exercises: [
      exercise(
        "Bulgarian Split Squat",
        "compound",
        ["quadriceps", "glutes"],
        "compound",
        ["Step-Up", "Single-Leg Press"],
      ),
      exercise(
        "Machine Chest Press",
        "compound",
        ["chest", "triceps"],
        "compound",
        ["Dumbbell Bench Press", "Push-Up"],
      ),
      exercise("Seated Leg Curl", "isolation", ["hamstrings"], "isolation", [
        "Lying Leg Curl",
        "Romanian Deadlift",
      ]),
      exercise(
        "One-Arm Cable Row",
        "accessory",
        ["upper back", "biceps"],
        "accessory",
        ["Dumbbell Row", "Machine Row"],
      ),
      exercise("Cable Lateral Raise", "isolation", ["shoulders"], "isolation", [
        "Dumbbell Lateral Raise",
        "Machine Lateral Raise",
      ]),
      exercise("Standing Calf Raise", "isolation", ["calves"], "isolation", [
        "Seated Calf Raise",
        "Leg-Press Calf Raise",
      ]),
    ],
  },
  upperA: {
    title: "Upper A",
    exercises: [
      exercise("Bench Press", "compound", ["chest", "triceps"], "compound", [
        "Dumbbell Bench Press",
        "Machine Chest Press",
      ]),
      exercise(
        "Chest-Supported Row",
        "compound",
        ["upper back", "biceps"],
        "compound",
        ["Cable Row", "Dumbbell Row"],
      ),
      exercise(
        "Incline Dumbbell Press",
        "accessory",
        ["chest", "shoulders"],
        "accessory",
        ["Incline Machine Press", "Push-Up"],
      ),
      exercise("Lat Pulldown", "accessory", ["lats", "biceps"], "accessory", [
        "Pull-Up",
        "Assisted Pull-Up",
      ]),
      exercise(
        "Dumbbell Lateral Raise",
        "isolation",
        ["shoulders"],
        "isolation",
        ["Cable Lateral Raise", "Machine Lateral Raise"],
      ),
      exercise(
        "Cable Triceps Extension",
        "isolation",
        ["triceps"],
        "isolation",
        ["Skull Crusher", "Machine Dip"],
      ),
    ],
  },
  lowerA: {
    title: "Lower A",
    exercises: [
      exercise("Back Squat", "compound", ["quadriceps", "glutes"], "compound", [
        "Leg Press",
        "Hack Squat",
      ]),
      exercise(
        "Romanian Deadlift",
        "compound",
        ["hamstrings", "glutes"],
        "compound",
        ["Good Morning", "Seated Leg Curl"],
      ),
      exercise("Leg Extension", "isolation", ["quadriceps"], "isolation", [
        "Sissy Squat",
        "Reverse Nordic",
      ]),
      exercise("Seated Leg Curl", "isolation", ["hamstrings"], "isolation", [
        "Lying Leg Curl",
        "Nordic Curl",
      ]),
      exercise("Standing Calf Raise", "isolation", ["calves"], "isolation", [
        "Seated Calf Raise",
        "Leg-Press Calf Raise",
      ]),
    ],
  },
  upperB: {
    title: "Upper B",
    exercises: [
      exercise(
        "Overhead Press",
        "compound",
        ["shoulders", "triceps"],
        "compound",
        ["Machine Shoulder Press", "Seated Dumbbell Press"],
      ),
      exercise("Lat Pulldown", "compound", ["lats", "biceps"], "compound", [
        "Pull-Up",
        "Assisted Pull-Up",
      ]),
      exercise(
        "Machine Chest Press",
        "accessory",
        ["chest", "triceps"],
        "accessory",
        ["Dumbbell Bench Press", "Push-Up"],
      ),
      exercise(
        "Cable Row",
        "accessory",
        ["upper back", "biceps"],
        "accessory",
        ["Chest-Supported Row", "Dumbbell Row"],
      ),
      exercise("Dumbbell Curl", "isolation", ["biceps"], "isolation", [
        "Cable Curl",
        "Machine Curl",
      ]),
      exercise("Cable Lateral Raise", "isolation", ["shoulders"], "isolation", [
        "Dumbbell Lateral Raise",
        "Machine Lateral Raise",
      ]),
    ],
  },
  lowerB: {
    title: "Lower B",
    exercises: [
      exercise("Leg Press", "compound", ["quadriceps", "glutes"], "compound", [
        "Hack Squat",
        "Goblet Squat",
      ]),
      exercise("Hip Thrust", "compound", ["glutes"], "compound", [
        "Romanian Deadlift",
        "Back Extension",
      ]),
      exercise(
        "Bulgarian Split Squat",
        "accessory",
        ["quadriceps", "glutes"],
        "accessory",
        ["Step-Up", "Single-Leg Press"],
      ),
      exercise("Lying Leg Curl", "isolation", ["hamstrings"], "isolation", [
        "Seated Leg Curl",
        "Nordic Curl",
      ]),
      exercise("Seated Calf Raise", "isolation", ["calves"], "isolation", [
        "Standing Calf Raise",
        "Leg-Press Calf Raise",
      ]),
    ],
  },
  push: { title: "Push", exercises: [] },
  pull: { title: "Pull", exercises: [] },
  legs: { title: "Legs", exercises: [] },
};

HYPERTROPHY_SESSIONS.push.exercises =
  HYPERTROPHY_SESSIONS.upperA.exercises.filter(
    (item) =>
      !item.muscles.includes("upper back") &&
      !item.muscles.includes("lats") &&
      !item.muscles.includes("biceps"),
  );
HYPERTROPHY_SESSIONS.pull.exercises =
  HYPERTROPHY_SESSIONS.upperB.exercises.filter((item) =>
    item.muscles.some((muscle) =>
      ["lats", "upper back", "biceps", "shoulders"].includes(muscle),
    ),
  );
HYPERTROPHY_SESSIONS.legs.exercises = HYPERTROPHY_SESSIONS.lowerA.exercises;

const GENERAL_SESSIONS: LiftingTemplate[] = [
  {
    title: "Full Body A",
    exercises: [
      exercise(
        "Goblet Squat",
        "compound",
        ["quadriceps", "glutes"],
        "compound",
        ["Leg Press", "Back Squat"],
      ),
      exercise(
        "Dumbbell Bench Press",
        "compound",
        ["chest", "triceps"],
        "compound",
        ["Machine Chest Press", "Push-Up"],
      ),
      exercise(
        "Romanian Deadlift",
        "compound",
        ["hamstrings", "glutes"],
        "compound",
        ["Seated Leg Curl", "Back Extension"],
      ),
      exercise(
        "Cable Row",
        "accessory",
        ["upper back", "biceps"],
        "accessory",
        ["Chest-Supported Row", "Dumbbell Row"],
      ),
      exercise("Farmer Carry", "carry", ["grip", "trunk"], "accessory", [
        "Suitcase Carry",
        "Weighted Walk",
      ]),
    ],
  },
  {
    title: "Full Body B",
    exercises: [
      exercise(
        "Trap-Bar Deadlift",
        "compound",
        ["glutes", "hamstrings", "back"],
        "compound",
        ["Kettlebell Deadlift", "Leg Press"],
      ),
      exercise(
        "Seated Dumbbell Press",
        "compound",
        ["shoulders", "triceps"],
        "compound",
        ["Machine Shoulder Press", "Landmine Press"],
      ),
      exercise(
        "Split Squat",
        "accessory",
        ["quadriceps", "glutes"],
        "accessory",
        ["Step-Up", "Single-Leg Press"],
      ),
      exercise("Lat Pulldown", "accessory", ["lats", "biceps"], "accessory", [
        "Assisted Pull-Up",
        "Cable Pullover",
      ]),
      exercise("Plank", "core", ["trunk"], "accessory", [
        "Dead Bug",
        "Pallof Press",
      ]),
    ],
  },
  {
    title: "Full Body C",
    exercises: [
      exercise("Leg Press", "compound", ["quadriceps", "glutes"], "compound", [
        "Goblet Squat",
        "Hack Squat",
      ]),
      exercise(
        "Incline Dumbbell Press",
        "compound",
        ["chest", "shoulders"],
        "compound",
        ["Machine Chest Press", "Push-Up"],
      ),
      exercise("Hip Thrust", "compound", ["glutes"], "compound", [
        "Back Extension",
        "Romanian Deadlift",
      ]),
      exercise(
        "Chest-Supported Row",
        "accessory",
        ["upper back", "biceps"],
        "accessory",
        ["Cable Row", "Dumbbell Row"],
      ),
      exercise("Suitcase Carry", "carry", ["trunk", "grip"], "accessory", [
        "Farmer Carry",
        "Pallof Press",
      ]),
    ],
  },
];

function powerliftingTemplates(days: number): LiftingTemplate[] {
  const s = POWERLIFTING_SESSIONS;
  const byDays: Record<number, LiftingTemplate[]> = {
    1: [
      {
        title: "Full Powerlifting Session",
        exercises: [
          s.squatBench.exercises[0],
          s.squatBench.exercises[1],
          s.deadliftBench.exercises[0],
          s.squatBench.exercises[3],
          s.deadliftBench.exercises[4],
        ],
      },
    ],
    2: [s.squatBench, s.deadliftBench],
    3: [s.squatBench, s.benchUpper, s.deadliftBench],
    4: [s.squatBench, s.benchUpper, s.deadliftBench, s.squatPosterior],
    5: [
      s.squatBench,
      s.benchUpper,
      s.deadliftBench,
      s.squatPosterior,
      s.techniqueUpper,
    ],
    6: [
      s.squatBench,
      s.benchUpper,
      s.deadliftBench,
      s.squatPosterior,
      s.techniqueUpper,
      s.lowerCapacity,
    ],
  };
  return byDays[days] ?? [];
}

function hypertrophyTemplates(days: number): LiftingTemplate[] {
  const s = HYPERTROPHY_SESSIONS;
  const byDays: Record<number, LiftingTemplate[]> = {
    1: [s.fullA],
    2: [s.fullA, s.fullB],
    3: [s.fullA, s.fullB, s.fullC],
    4: [s.upperA, s.lowerA, s.upperB, s.lowerB],
    5: [s.push, s.pull, s.legs, s.upperA, s.lowerB],
    6: [s.push, s.pull, s.legs, s.push, s.pull, s.legs],
  };
  return byDays[days] ?? [];
}

function phaseForWeek(weekNumber: number): WeekPhase {
  const position = ((weekNumber - 1) % 4) + 1;
  if (position === 4) return "recovery";
  if (position === 3) return "intensification";
  return "accumulation";
}

function maxExercisesForMinutes(minutes: number): number {
  if (minutes <= 30) return 3;
  if (minutes <= 45) return 4;
  if (minutes <= 75) return 5;
  return 6;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function powerliftingPrescription(
  role: ExerciseRole,
  phase: WeekPhase,
): Pick<
  ExercisePrescription,
  "sets" | "reps" | "effort" | "restSeconds" | "notes"
> {
  if (role === "main") {
    if (phase === "recovery")
      return {
        sets: 2,
        reps: { min: 4, max: 4 },
        effort: { scale: "rpe", target: 6 },
        restSeconds: 180,
        notes:
          "Use technically consistent repetitions; stop well before grinding.",
      };
    if (phase === "intensification")
      return {
        sets: 4,
        reps: { min: 3, max: 3 },
        effort: { scale: "rpe", target: 7.5 },
        restSeconds: 240,
        notes: "Competition-standard technique; no missed repetitions.",
      };
    return {
      sets: 4,
      reps: { min: 4, max: 5 },
      effort: { scale: "rpe", target: 7 },
      restSeconds: 210,
      notes:
        "Competition-standard technique; add load only while RPE remains on target.",
    };
  }
  if (role === "secondary") {
    return phase === "recovery"
      ? {
          sets: 2,
          reps: { min: 5, max: 6 },
          effort: { scale: "rpe", target: 6 },
          restSeconds: 150,
          notes: "Keep the variation crisp and submaximal.",
        }
      : {
          sets: 3,
          reps: { min: 5, max: 6 },
          effort: {
            scale: "rpe",
            target: phase === "intensification" ? 7.5 : 7,
          },
          restSeconds: 180,
          notes: "Use the variation to reinforce the competition lift.",
        };
  }
  if (role === "compound") {
    return {
      sets: phase === "recovery" ? 2 : 3,
      reps: { min: 6, max: 10 },
      effort: { scale: "rir", target: phase === "recovery" ? 3 : 2 },
      restSeconds: 120,
      notes: "Use controlled repetitions and a stable range of motion.",
    };
  }
  return {
    sets: phase === "recovery" ? 2 : 3,
    reps: {
      min: role === "isolation" ? 10 : 8,
      max: role === "isolation" ? 15 : 12,
    },
    effort: { scale: "rir", target: phase === "recovery" ? 3 : 2 },
    restSeconds: 75,
    notes: "Stop the set if technique changes materially.",
  };
}

function hypertrophyPrescription(
  role: ExerciseRole,
  phase: WeekPhase,
): Pick<
  ExercisePrescription,
  "sets" | "reps" | "effort" | "restSeconds" | "notes"
> {
  const isolation = role === "isolation";
  const reps: RepRange = isolation ? { min: 10, max: 20 } : { min: 6, max: 12 };
  if (phase === "recovery")
    return {
      sets: 2,
      reps,
      effort: { scale: "rir", target: 3 },
      restSeconds: isolation ? 60 : 120,
      notes:
        "Reduce load or repetitions and avoid failure during the recovery week.",
    };
  return {
    sets: phase === "intensification" ? (isolation ? 3 : 4) : 3,
    reps,
    effort: { scale: "rir", target: phase === "intensification" ? 1 : 2 },
    restSeconds: isolation ? 75 : 150,
    notes:
      "When every set reaches the top of the rep range at the target RIR, add a small amount of load.",
  };
}

function generalPrescription(
  role: ExerciseRole,
  phase: WeekPhase,
): Pick<
  ExercisePrescription,
  "sets" | "reps" | "effort" | "restSeconds" | "notes"
> {
  return {
    sets: phase === "recovery" ? 2 : 3,
    reps:
      role === "accessory" || role === "isolation"
        ? { min: 8, max: 15 }
        : { min: 6, max: 12 },
    effort: { scale: "rir", target: phase === "recovery" ? 3 : 2 },
    restSeconds: role === "accessory" || role === "isolation" ? 75 : 120,
    notes:
      "Choose a load that leaves the prescribed repetitions in reserve with stable technique.",
  };
}

function createLiftingSessions(
  goal: PrimaryGoal,
  weekNumber: number,
  phase: WeekPhase,
  input: ProgramRequestV1,
): LiftingSessionV2[] {
  const templates =
    goal === "powerlifting"
      ? powerliftingTemplates(input.liftingDaysPerWeek)
      : goal === "hypertrophy"
        ? hypertrophyTemplates(input.liftingDaysPerWeek)
        : Array.from(
            { length: input.liftingDaysPerWeek },
            (_, index) => GENERAL_SESSIONS[index % GENERAL_SESSIONS.length],
          );
  const limit = maxExercisesForMinutes(input.liftingSessionMinutes);

  return templates.map((template, dayIndex) => ({
    id: `week-${weekNumber}-lifting-${dayIndex + 1}`,
    kind: "lifting",
    title: template.title,
    targetMinutes: input.liftingSessionMinutes,
    exercises: template.exercises.slice(0, limit).map((item, exerciseIndex) => {
      const prescription =
        goal === "powerlifting"
          ? powerliftingPrescription(item.role, phase)
          : goal === "hypertrophy"
            ? hypertrophyPrescription(item.role, phase)
            : generalPrescription(item.role, phase);
      return {
        id: `week-${weekNumber}-day-${dayIndex + 1}-${exerciseIndex + 1}-${slug(item.name)}`,
        name: item.name,
        category: item.category,
        muscles: [...item.muscles],
        substitutions: [...item.substitutions],
        ...prescription,
      };
    }),
  }));
}

function cardioMethods(goal: PrimaryGoal, count: number): CardioMethod[] {
  if (count === 0) return [];
  if (goal === "cardio") {
    const patterns: Record<number, CardioMethod[]> = {
      1: ["easy-steady"],
      2: ["easy-steady", "long-easy"],
      3: ["easy-steady", "intervals", "long-easy"],
      4: ["easy-steady", "tempo", "recovery", "long-easy"],
      5: ["easy-steady", "intervals", "recovery", "easy-steady", "long-easy"],
      6: [
        "easy-steady",
        "intervals",
        "recovery",
        "tempo",
        "easy-steady",
        "long-easy",
      ],
      7: [
        "easy-steady",
        "intervals",
        "recovery",
        "easy-steady",
        "tempo",
        "easy-steady",
        "long-easy",
      ],
    };
    return patterns[count] ?? [];
  }
  if (goal === "general-fitness" && count >= 3) {
    return Array.from({ length: count }, (_, index) =>
      index === 1
        ? "intervals"
        : index === count - 1
          ? "long-easy"
          : "easy-steady",
    );
  }
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 && count > 1 ? "long-easy" : "easy-steady",
  );
}

function cardioDetails(
  method: CardioMethod,
  minutes: number,
  goal: PrimaryGoal,
): Omit<CardioSessionV2, "id" | "kind"> {
  const modality =
    goal === "powerlifting" || goal === "hypertrophy"
      ? "Low-impact modality of choice (bike, incline walk, elliptical, or rower)"
      : "Preferred sustainable cardio modality";
  if (method === "intervals") {
    const warmup = Math.max(3, Math.round(minutes * 0.2));
    const cooldown = warmup;
    const bouts = Math.max(1, Math.floor((minutes - warmup - cooldown) / 3));
    return {
      title: "Aerobic Intervals",
      targetMinutes: minutes,
      prescription: {
        method,
        modality,
        durationMinutes: minutes,
        intensityRpe: { min: 8, max: 9 },
        structure: `${warmup} min easy warm-up; ${bouts} × 1 min hard with 2 min easy; ${cooldown} min easy cool-down.`,
        notes:
          "The hard work should be repeatable. Stop adding intensity if later bouts deteriorate sharply.",
      },
    };
  }
  if (method === "tempo") {
    return {
      title: "Tempo Cardio",
      targetMinutes: minutes,
      prescription: {
        method,
        modality,
        durationMinutes: minutes,
        intensityRpe: { min: 6, max: 7 },
        structure:
          "Warm up easily, complete a sustained comfortably-hard middle segment, then cool down.",
        notes:
          "Speech should be limited to short phrases, but the effort should remain controlled.",
      },
    };
  }
  if (method === "recovery") {
    return {
      title: "Recovery Cardio",
      targetMinutes: minutes,
      prescription: {
        method,
        modality,
        durationMinutes: minutes,
        intensityRpe: { min: 2, max: 3 },
        structure: "Continuous easy movement for the prescribed duration.",
        notes:
          "Keep this easier than normal easy cardio; its purpose is movement, not fatigue.",
      },
    };
  }
  return {
    title: method === "long-easy" ? "Long Easy Cardio" : "Easy Steady Cardio",
    targetMinutes: minutes,
    prescription: {
      method,
      modality,
      durationMinutes: minutes,
      intensityRpe: { min: 3, max: 4 },
      structure: "Continuous aerobic work at a conversational pace.",
      notes:
        goal === "powerlifting" || goal === "hypertrophy"
          ? "When combined with lifting on the same day, lift first. Prefer a separate session when practical."
          : "Maintain a pace that could be sustained beyond the prescribed duration.",
    },
  };
}

function createCardioSessions(
  goal: PrimaryGoal,
  weekNumber: number,
  phase: WeekPhase,
  input: ProgramRequestV1,
): CardioSessionV2[] {
  return cardioMethods(goal, input.cardioDaysPerWeek).map(
    (plannedMethod, index) => {
      const method =
        phase === "recovery" &&
        (plannedMethod === "intervals" || plannedMethod === "tempo")
          ? "recovery"
          : plannedMethod;
      return {
        id: `week-${weekNumber}-cardio-${index + 1}`,
        kind: "cardio",
        ...cardioDetails(method, input.cardioSessionMinutes, goal),
      };
    },
  );
}

export function createGoalSpecificWeek(
  weekNumber: number,
  input: ProgramRequestV1,
): GeneratedWeekV2 {
  const phase = phaseForWeek(weekNumber);
  const sessions: TrainingSessionV2[] = [
    ...createLiftingSessions(input.primaryGoal, weekNumber, phase, input),
    ...createCardioSessions(input.primaryGoal, weekNumber, phase, input),
  ];
  return { weekNumber, phase, sessions };
}
