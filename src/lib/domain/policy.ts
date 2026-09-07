export const ENGINE_VERSION = "0.12.0";
export const POLICY_VERSION = "research-policy-2026-09-02.1";

interface RuleText {
  id: string;
  title: string;
  rationale: string;
  source: string;
  kind: "research" | "consensus" | "engineering_default" | "safety";
}

const RULE_TEXT: Record<string, RuleText> = {
  "SAFE-1": {
    id: "SAFE-1",
    title: "Safety constraints outrank training preferences",
    rationale:
      "Active exclusions and pain flags hard-filter the affected exercise path without diagnosing or penalizing adherence.",
    source: "Technical specification §§3.2, 7.5, 8.5, 12.2",
    kind: "safety",
  },
  "SAFE-2": {
    id: "SAFE-2",
    title: "Operational—not diagnostic—health handling",
    rationale:
      "Automated programming is limited to adults. Unresolved body-area or clinician restrictions block generation and progression; consent is not exercise clearance.",
    source: "Technical specification §§2.2, 3.1, 12.2",
    kind: "safety",
  },
  "GOAL-1": {
    id: "GOAL-1",
    title: "Explicit weighted goal contract",
    rationale:
      "The primary goal receives the protected dose and scheduling priority; a secondary goal receives the remaining budget.",
    source: "Technical specification §§4.1–4.2",
    kind: "engineering_default",
  },
  "HORIZON-1": {
    id: "HORIZON-1",
    title: "Back-plan fixed endpoints",
    rationale:
      "A dated meet/test reserves its taper and endpoint first; phases are compressed or omitted rather than crammed.",
    source: "Technical specification §§4.3–4.4, 10",
    kind: "consensus",
  },
  "HORIZON-2": {
    id: "HORIZON-2",
    title: "Rolling indefinite horizon",
    rationale:
      "Indefinite programs use a rolling six-week planning horizon and preserve continuity at review points.",
    source: "Technical specification §§4.3–4.4",
    kind: "engineering_default",
  },
  "BASE-1": {
    id: "BASE-1",
    title: "Effort-adjusted e1RM",
    rationale:
      "Eligible 1–10 rep sets with 0–4 RIR estimate e1RM from load × (1 + (reps + RIR)/30).",
    source: "Technical specification §5.2",
    kind: "engineering_default",
  },
  "BASE-2": {
    id: "BASE-2",
    title: "Calibrate missing baselines",
    rationale:
      "Missing lift baselines use a submaximal calibration exposure rather than an assumed max or failure test.",
    source:
      "Technical specification §§5.2, 7.4; questionnaire calibration block",
    kind: "safety",
  },
  "DOSE-1": {
    id: "DOSE-1",
    title: "Goal-specific mandatory slots",
    rationale:
      "Specificity and minimum useful patterns are protected before accessory volume is allocated.",
    source: "Technical specification §§5.3–5.4",
    kind: "consensus",
  },
  "DOSE-2": {
    id: "DOSE-2",
    title: "Bounded specialization reallocation",
    rationale:
      "Direct and fractional indirect sets are counted per muscle; priority targets and session soft caps guide bounded dose decisions, with unmet targets disclosed.",
    source: "Research addendum §§4, 6.1; technical specification §12.2",
    kind: "consensus",
  },
  "INT-1": {
    id: "INT-1",
    title: "Powerlifting intensity bands",
    rationale:
      "Heavy competition work uses roughly 80–92% e1RM for 1–3 reps with 1–3 RIR; volume work uses 65–82% for 3–8 reps.",
    source: "Technical specification §7.3",
    kind: "consensus",
  },
  "INT-2": {
    id: "INT-2",
    title: "Hypertrophy rep and effort bands",
    rationale:
      "Compounds generally use 5–12 reps and stable accessories 8–30 reps, mostly 0–3 RIR.",
    source: "Technical specification §7.3; research addendum §§5–6",
    kind: "consensus",
  },
  "INT-3": {
    id: "INT-3",
    title: "Failure is optional and test-bounded",
    rationale:
      "Controlled AMRAPs stop at 1 RIR. A true max-effort AMRAP is used only with explicit permission and is limited to one planned final test; competition lifts are eligible only in a peak/test block.",
    source: "Technical specification §7.3; questionnaire v3 audit §8",
    kind: "safety",
  },
  "ACTION-1": {
    id: "ACTION-1",
    title: "One prescription, tolerance-aware interpretation",
    rationale:
      "Each workout gives one rep, effort, load procedure, and cardio target. Normal measurement error is handled when logs are evaluated; it is not passed to the user as a range of equally preferred actions.",
    source:
      "2026 actionability addendum; Steele et al. 2017 (PMID 29204323); Refalo et al. 2024 (PMID 37967832); Remmert et al. 2023 (PMID 37036795)",
    kind: "engineering_default",
  },
  "SPLIT-1": {
    id: "SPLIT-1",
    title: "Split selected for feasibility, not branding",
    rationale:
      "When volume is equated, split labels have no established universal superiority; days, time, spacing, and adherence decide.",
    source: "Research addendum §5",
    kind: "research",
  },
  "SPLIT-2": {
    id: "SPLIT-2",
    title: "Priority muscles distributed when feasible",
    rationale:
      "Priority muscle volume is normally distributed over at least two exposures and kept below a soft 6–8 set session cap.",
    source: "Research addendum §§5.3, 6.1",
    kind: "consensus",
  },
  "SUPERSET-1": {
    id: "SUPERSET-1",
    title: "Compatible supersets can improve time efficiency",
    rationale:
      "Selected antagonist or noncompeting accessory exercises may be alternated to shorten a session while preserving their prescribed sets, reps, and effort.",
    source:
      "Weakley et al. 2017 (PMID 28459792); Iversen et al. 2021 (PMID 33629972); 2026 superset research addendum",
    kind: "research",
  },
  "SUPERSET-2": {
    id: "SUPERSET-2",
    title: "Supersets must protect priority work and recovery",
    rationale:
      "Competition lifts, high-fatigue strength work, and AMRAPs remain separate. Paired work retains same-exercise recovery and can be unpaired for equipment or comfort without changing future weeks.",
    source:
      "Weakley et al. 2017 (PMID 28459792); Robbins et al. 2010 (PMID 20300030); 2026 superset research addendum",
    kind: "safety",
  },
  "EX-1": {
    id: "EX-1",
    title: "Purpose-valid exercise filtering",
    rationale:
      "Exercises must match purpose, pattern, muscle, equipment, fatigue budget, and exclusions.",
    source: "Research addendum §7.1; technical specification §§5.5, 7.5",
    kind: "consensus",
  },
  "EX-2": {
    id: "EX-2",
    title: "Specificity is not interchangeable",
    rationale:
      "Machines and dumbbells can preserve muscle-building slots but do not replace competition-lift skill.",
    source: "Research addendum §§7.2–7.3",
    kind: "research",
  },
  "EX-3": {
    id: "EX-3",
    title: "Substitutions preserve purpose, not load",
    rationale:
      "A substitute starts a separate performance series and receives its own load calibration.",
    source: "Technical specification §§7.5, 12.2",
    kind: "engineering_default",
  },
  "TIME-1": {
    id: "TIME-1",
    title: "Bottom-up duration model",
    rationale:
      "Duration is estimated from warm-up, sets, rest, transitions, and buffer; low-priority work is trimmed first when requested.",
    source: "Technical specification §6; research addendum §5.4",
    kind: "engineering_default",
  },
  "SCHED-1": {
    id: "SCHED-1",
    title: "Distribute demanding lifting sessions when feasible",
    rationale:
      "Training frequency mainly distributes weekly volume and skill practice; no exact weekday pattern is universally superior. When availability permits, powerlifting defaults avoid more than two consecutive lifting days and avoid placing high lower-body stress sessions on adjacent days.",
    source:
      "Grgic et al. 2018 (PMID 29470825); Yang et al. 2018 (PMID 29967584); Shaw et al. 2022 (PMID 32195767)",
    kind: "research",
  },
  "REC-1": {
    id: "REC-1",
    title: "Recovery changes starting conservatism",
    rationale:
      "Sleep, shift work, heavy labor, and sport lower optional starting dose and progression confidence, not the user’s worth or diagnosis.",
    source: "Research blueprint §§2.6, 4.5; technical specification §§3.1, 5.3",
    kind: "engineering_default",
  },
  "CARDIO-1": {
    id: "CARDIO-1",
    title: "Concurrent training by priority",
    rationale:
      "Strength/hypertrophy plans start with easy/moderate low-impact cardio; hard lower-body cardio is spaced from heavy lower lifting.",
    source: "Technical specification §9.2; research blueprint §6",
    kind: "research",
  },
  "CARDIO-2": {
    id: "CARDIO-2",
    title: "Cardio progresses from baseline",
    rationale:
      "Cardio dose grows gradually—usually duration before intensity—instead of jumping immediately to public-health targets.",
    source: "Technical specification §§9.2–9.3; research blueprint §6",
    kind: "consensus",
  },
  "MOVE-1": {
    id: "MOVE-1",
    title: "Daily movement starts near the user’s baseline",
    rationale:
      "Step or walking-time targets use small, age-aware changes. A single miss is treated as normal variation; repeated observations are required before adaptation.",
    source:
      "Paluch et al. 2022 (PMID 35247352); Ding et al. 2025 (Lancet Public Health, daily steps and health outcomes); 2026 movement-target implementation note",
    kind: "research",
  },
  "CARDIO-3": {
    id: "CARDIO-3",
    title: "Cardio-priority retains strength",
    rationale:
      "Cardio-priority plans retain two whole-body resistance sessions when feasible and use mostly easy work plus 1–2 quality sessions.",
    source: "Technical specification §9.2",
    kind: "consensus",
  },
  "CARDIO-4": {
    id: "CARDIO-4",
    title: "Running events use phase- and role-specific sessions",
    rationale:
      "Event plans progress from the athlete's recent running tolerance, distribute easy, long, and quality roles, and reduce work near the race rather than applying one generic cardio workout repeatedly.",
    source:
      "ACSM Guidelines for Exercise Testing and Prescription, 12th ed.; World Athletics endurance coaching principles; 2026 cardio implementation addendum",
    kind: "consensus",
  },
  "CARDIO-5": {
    id: "CARDIO-5",
    title: "VO₂max work is bounded and measurable",
    rationale:
      "A cardio-priority plan may include one or two interval sessions, but progression changes one repeat at a time and retains easy aerobic work around them.",
    source:
      "Milanović et al. 2015 (Sports Medicine 45:1469–1481); Buchheit & Laursen 2013 (Sports Medicine 43:313–338); 2026 cardio implementation addendum",
    kind: "research",
  },
  "HEALTH-1": {
    id: "HEALTH-1",
    title: "Minimum complete health plan",
    rationale:
      "A health plan covers knee, hinge, push, pull, and trunk/carry patterns plus gradual aerobic and daily movement work.",
    source: "Research blueprint §§4–5; technical specification §5.4",
    kind: "consensus",
  },
  "AGE-1": {
    id: "AGE-1",
    title: "Age-aware function and recovery",
    rationale:
      "Automated programming supports adults ages 18–100; function and recovery inform adult exercise selection. Youth require a separate supervised program.",
    source: "Research blueprint §5",
    kind: "consensus",
  },
  "WEIGHT-1": {
    id: "WEIGHT-1",
    title: "Optional bodyweight context",
    rationale:
      "Weight trend can contextualize performance and relative strength, but may be fully ignored after onboarding; this is not a diet prescription.",
    source:
      "Final questionnaire decisions; research blueprint nutrition section",
    kind: "engineering_default",
  },
  "ADAPT-1": {
    id: "ADAPT-1",
    title: "Two comparable observations for progression",
    rationale:
      "Routine future changes require repeated comparable evidence; safety and hard feasibility constraints act immediately.",
    source: "Technical specification §§8.3–8.9",
    kind: "engineering_default",
  },
  "ADAPT-2": {
    id: "ADAPT-2",
    title: "Reason-coded missed work",
    rationale:
      "Time and schedule misses change feasibility; attempted-too-hard work changes local prescription; no missed-work debt is created.",
    source: "Technical specification §§8.5–8.6, 12.2",
    kind: "engineering_default",
  },
  "ADAPT-3": {
    id: "ADAPT-3",
    title: "Bounded local change budget",
    rationale:
      "Routine reviews change load/reps before volume and normally alter at most one priority set or 10% of weekly hard sets.",
    source: "Technical specification §§8.5, 8.9, 12.2",
    kind: "engineering_default",
  },
  "ADAPT-4": {
    id: "ADAPT-4",
    title: "Completed history is immutable",
    rationale:
      "Adaptation creates a new future version and does not rewrite completed sessions.",
    source: "Technical specification §§10, 12.2",
    kind: "engineering_default",
  },
  "UNITS-1": {
    id: "UNITS-1",
    title: "Implement-aware load rounding",
    rationale:
      "Loads are rounded to the selected unit and available implement increment; reps absorb coarse jumps when needed.",
    source: "Technical specification §7.3; final questionnaire decisions",
    kind: "engineering_default",
  },
};

export interface RuleDefinition extends RuleText {
  status: "implemented" | "partial";
  population: string;
  reviewedOn: string;
  parameterBasis: "engineering_default" | "evidence_informed";
  evidenceUrls: string[];
  implementationPaths: string[];
  testPaths: string[];
}

const evidenceByFamily: Record<string, string[]> = {
  SAFE: ["https://pubmed.ncbi.nlm.nih.gov/28557860/"],
  GOAL: ["https://pubmed.ncbi.nlm.nih.gov/41843416/"],
  HORIZON: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC7552788/"],
  BASE: ["https://pubmed.ncbi.nlm.nih.gov/37792272/"],
  DOSE: ["https://pubmed.ncbi.nlm.nih.gov/41343037/"],
  INT: [
    "https://pubmed.ncbi.nlm.nih.gov/36334240/",
    "https://pubmed.ncbi.nlm.nih.gov/37414459/",
  ],
  ACTION: ["https://pubmed.ncbi.nlm.nih.gov/30747900/"],
  SPLIT: ["https://pubmed.ncbi.nlm.nih.gov/41343037/"],
  SUPERSET: ["https://pubmed.ncbi.nlm.nih.gov/39903375/"],
  EX: ["https://pubmed.ncbi.nlm.nih.gov/41843416/"],
  TIME: ["https://pubmed.ncbi.nlm.nih.gov/34125411/"],
  SCHED: ["https://pubmed.ncbi.nlm.nih.gov/34757594/"],
  REC: ["https://pubmed.ncbi.nlm.nih.gov/27535989/"],
  CARDIO: [
    "https://pubmed.ncbi.nlm.nih.gov/34757594/",
    "https://pubmed.ncbi.nlm.nih.gov/34478518/",
  ],
  MOVE: ["https://pubmed.ncbi.nlm.nih.gov/40713949/"],
  HEALTH: ["https://www.who.int/publications/i/item/9789240015128"],
  AGE: [
    "https://pubmed.ncbi.nlm.nih.gov/31343601/",
    "https://pubmed.ncbi.nlm.nih.gov/24055781/",
  ],
  WEIGHT: ["https://pubmed.ncbi.nlm.nih.gov/41843416/"],
  ADAPT: ["https://pubmed.ncbi.nlm.nih.gov/35038063/"],
  UNITS: ["https://pubmed.ncbi.nlm.nih.gov/36199287/"],
};

const implementationByFamily: Record<string, string> = {
  SAFE: "safety.ts",
  GOAL: "design.ts",
  HORIZON: "design.ts",
  BASE: "baselines.ts",
  DOSE: "dose.ts",
  INT: "generator.ts",
  ACTION: "generator.ts",
  SPLIT: "design.ts",
  SUPERSET: "set-blocks.ts",
  EX: "exercises.ts",
  TIME: "duration.ts",
  SCHED: "generator.ts",
  REC: "generator.ts",
  CARDIO: "generator.ts",
  MOVE: "generator.ts",
  HEALTH: "design.ts",
  AGE: "safety.ts",
  WEIGHT: "generator.ts",
  ADAPT: "adaptation.ts",
  UNITS: "load-policy.ts",
};

/** Sources support concepts, not the exact numeric defaults or integrated engine efficacy. */
export const RULES: Record<string, RuleDefinition> = Object.fromEntries(
  Object.entries(RULE_TEXT).map(([id, rule]) => {
    const family = id.split("-")[0];
    const evidenceUrls = evidenceByFamily[family] ?? [];
    return [
      id,
      {
        ...rule,
        source: evidenceUrls.join("; "),
        evidenceUrls,
        status: [
          "GOAL-1",
          "REC-1",
          "CARDIO-4",
          "AGE-1",
          "WEIGHT-1",
          "SPLIT-2",
        ].includes(id)
          ? "partial"
          : "implemented",
        population:
          "Generally healthy adults; unresolved medical restrictions require professional review",
        reviewedOn: "2026-09-02",
        parameterBasis:
          rule.kind === "engineering_default" || rule.kind === "safety"
            ? "engineering_default"
            : "evidence_informed",
        implementationPaths: [
          `src/lib/domain/${implementationByFamily[family]}`,
        ],
        testPaths: [
          family === "ADAPT"
            ? "src/lib/domain/tests/adaptation.test.ts"
            : "src/lib/domain/tests/generation.test.ts",
        ],
      } satisfies RuleDefinition,
    ];
  }),
);

export const POLICY = {
  version: POLICY_VERSION,
  rollingHorizonWeeks: 6,
  training: {
    onTrackSetCompletion: 0.85,
    progressionSetCompletion: 0.9,
    comparableObservations: 2,
    maximumRoutineSetChangeFraction: 0.1,
    maintenanceSetsPerMuscle: 4,
    highestPrioritySetBonus: 2,
    secondPrioritySetBonus: 1,
    perSessionMuscleSetSoftCap: 8,
    easyLoadIncreaseFraction: 0.025,
    hardLoadDecreaseFraction: 0.05,
  },
  duration: {
    warmupMinutes: 6,
    competitionSetMinutes: 4,
    compoundSetMinutes: 3,
    stableCompoundSetMinutes: 2.5,
    isolationSetMinutes: 2,
    trunkSetMinutes: 1.75,
    transitionMinutes: 2,
    minimumBufferMinutes: 3,
    bufferFraction: 0.05,
  },
  superset: {
    maximumPairsPerSession: 1,
    minimumCompatibilityScore: 5,
    transitionSeconds: 10,
    isolationInterRoundRestSeconds: 60,
    stableCompoundInterRoundRestSeconds: 90,
  },
  cardio: {
    strengthInitialBouts: 2,
    hypertrophyInitialBouts: 2,
    cardioPriorityMinimumBouts: 4,
    cardioPriorityMaximumBouts: 6,
    healthInitialBouts: 2,
    durationProgressionMinutes: 5,
    preferredSeparationHours: 6,
  },
} as const;
