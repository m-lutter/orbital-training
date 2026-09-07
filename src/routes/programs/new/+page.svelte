<script lang="ts">
  import DaySelector from "$lib/components/questionnaire/DaySelector.svelte";
  import QuestionnaireProgress from "$lib/components/questionnaire/QuestionnaireProgress.svelte";
  import type { GoalDomain } from "$lib/domain";
  import { defaultLiftSessionMinutes } from "$lib/questionnaire/defaults";
  import {
    questionnaireCuteStatus,
    questionnaireFlightStatus,
  } from "$lib/questionnaire/flight-status";
  import InfoButton from "$lib/ui/InfoButton.svelte";
  import ProgramIcon from "$lib/ui/ProgramIcon.svelte";
  import {
    programIconName,
    selectableProgramIcons,
    type ProgramIconName,
  } from "$lib/ui/program-icons";
  import {
    allQuestionnaireDays,
    goalSpecificQuestionnaireSteps,
    isAllQuestionnaireDays,
    normalizeQuestionnaireDays,
    questionnaireControlForField,
    questionnaireStepForField,
    visibleQuestionnaireSteps,
  } from "$lib/questionnaire/contracts";
  import type { QuestionnaireStep } from "$lib/questionnaire/contracts";
  import { onMount, tick, untrack } from "svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type ReturnedForm = {
    values?: Record<string, string | string[]>;
    message?: string;
    field?: string;
  };

  // svelte-ignore state_referenced_locally -- form values intentionally seed the first render.
  const returned = form as ReturnedForm | undefined;
  const submitted = returned?.values !== undefined;
  // svelte-ignore state_referenced_locally -- load/action data seeds this form instance.
  const seededValues = returned?.values ?? data.initialValues ?? {};
  // svelte-ignore state_referenced_locally -- this distinguishes a seeded edit/retry from a new form.
  const hasSeededValues =
    returned?.values !== undefined || data.initialValues !== undefined;

  function initial(name: string, fallback: string): string {
    const value = seededValues[name];
    if (Array.isArray(value)) return value[0] ?? fallback;
    return value === undefined || value === "" ? fallback : value;
  }

  function initialNumber(name: string, fallback: number): number {
    const value = Number(initial(name, String(fallback)));
    return Number.isFinite(value) ? value : fallback;
  }

  function initialOptionalNumber(name: string): number | undefined {
    const raw = initial(name, "").trim();
    if (raw === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  function initialList(name: string, fallback: string[]): string[] {
    const value = seededValues[name];
    if (value === undefined) return hasSeededValues ? [] : fallback;
    return Array.isArray(value) ? value : [value];
  }

  function initialYes(name: string, fallback = false): boolean {
    const value = seededValues[name];
    if (value === undefined) return hasSeededValues ? false : fallback;
    return (Array.isArray(value) ? value : [value]).includes("yes");
  }

  function initialStep(field?: string): QuestionnaireStep {
    return field ? questionnaireStepForField(field) : 1;
  }

  function initialDays(
    name: string,
    fallback: ReturnType<typeof allQuestionnaireDays>,
  ) {
    return normalizeQuestionnaireDays(initialList(name, fallback));
  }

  const equipmentOptions = [
    ["bodyweight", "Bodyweight exercises / floor space"],
    ["barbell", "Barbell"],
    ["rack", "Squat rack"],
    ["bench", "Bench"],
    ["plates", "Weight plates"],
    ["dumbbells", "Dumbbells"],
    ["cables", "Cable station"],
    ["machines", "Resistance machines"],
    ["smith_machine", "Smith machine"],
    ["pullup_bar", "Pull-up bar"],
    ["bands", "Bands"],
    ["cardio_bike", "Stationary bike"],
    ["treadmill", "Treadmill"],
    ["rower", "Rower"],
    ["elliptical", "Elliptical"],
    ["outdoors", "Outdoor routes"],
    ["pool", "Swimming pool access"],
  ] as const;

  const muscleOptions = [
    ["chest", "Chest"],
    ["upper_chest", "Upper chest"],
    ["lats", "Lats"],
    ["upper_back", "Upper back"],
    ["quads", "Quadriceps"],
    ["hamstrings", "Hamstrings"],
    ["glutes", "Glutes"],
    ["calves", "Calves"],
    ["biceps", "Biceps"],
    ["triceps", "Triceps"],
    ["front_delts", "Front delts"],
    ["side_delts", "Side delts"],
    ["rear_delts", "Rear delts"],
    ["trunk", "Trunk/core"],
  ] as const;

  const movementRestrictionOptions = [
    ["squat", "Squatting or knee-bending exercises"],
    ["hinge", "Deadlifts, hip hinges, or similar exercises"],
    ["horizontal_push", "Bench press, push-ups, or chest pressing"],
    ["vertical_push", "Overhead pressing"],
    ["horizontal_pull", "Rows"],
    ["vertical_pull", "Pull-ups or pulldowns"],
    ["knee_flexion", "Leg curls"],
    ["elbow_flexion", "Biceps exercises"],
    ["elbow_extension", "Triceps exercises"],
    ["lateral_raise", "Lateral raises"],
    ["calf_raise", "Calf raises"],
    ["trunk", "Direct core exercises"],
    ["carry", "Loaded carries"],
    ["locomotion", "Walking, running, or balance work"],
  ] as const;

  const splitOptions: Record<number, [string, string][]> = {
    1: [
      ["auto", "Choose for me"],
      ["full_body", "Full body"],
    ],
    2: [
      ["auto", "Choose for me"],
      ["full_body", "Full body"],
      ["upper_lower", "Upper/lower"],
      ["push_pull", "Push/pull"],
    ],
    3: [
      ["auto", "Choose for me"],
      ["full_body", "Full body"],
      ["upper_lower", "Rotating upper/lower"],
      ["ppl", "Push/pull/legs"],
      ["arnold", "Arnold split"],
      ["torso_limbs", "Torso/limbs"],
    ],
    4: [
      ["auto", "Choose for me"],
      ["upper_lower", "Upper/lower"],
      ["torso_limbs", "Torso/limbs"],
      ["full_body", "Full body"],
      ["ppl", "Rotating PPL"],
    ],
    5: [
      ["auto", "Choose for me"],
      ["ppl_upper_lower", "PPL + upper/lower"],
      ["priority_hybrid", "Upper/lower + priority day"],
      ["body_part", "Body-part split"],
      ["torso_limbs", "Torso/limbs + priority"],
    ],
    6: [
      ["auto", "Choose for me"],
      ["ppl", "PPL repeated"],
      ["arnold", "Arnold split repeated"],
      ["upper_lower", "Upper/lower repeated"],
      ["body_part", "Body-part split"],
      ["full_body", "Full body"],
    ],
  };

  const splitDescriptions: Record<string, string> = {
    auto: "Chooses a split that fits your available days, workout length, equipment, and muscle priorities.",
    full_body:
      "Trains most major regions each session. It is especially efficient at 1–3 days per week; at higher frequencies each session uses fewer sets per muscle.",
    upper_lower:
      "Alternates upper- and lower-body sessions. It is straightforward, distributes fatigue well, and usually fits moderate session lengths.",
    push_pull:
      "Groups pushing muscles separately from pulling and posterior-chain work. On two days it provides broad coverage but each workout may be relatively long.",
    ppl: "Push/pull/legs organizes related muscles together. It works most cleanly at 3 or 6 days; rotating versions spread the sequence across weeks at other frequencies.",
    ppl_upper_lower:
      "Uses push/pull/legs plus upper/lower days. This gives five distinct sessions and room for both broad coverage and extra priority work.",
    arnold:
      "Uses chest/back, shoulders/arms, and legs. It is an organizational preference—not inherently more effective than other splits when weekly work is matched.",
    torso_limbs:
      "Separates torso work from arms and legs. It can prioritize limbs without turning every upper-body session into a long workout.",
    body_part:
      "Concentrates more work for a region into each session. It can suit experienced lifters who prefer focused days, but missed sessions affect that region more.",
    priority_hybrid:
      "Uses upper/lower sessions plus a dedicated day for selected priority muscles while maintaining the rest of the body.",
  };

  const sportOptions = [
    ["basketball", "Basketball"],
    ["soccer", "Soccer"],
    ["american_football", "American football"],
    ["baseball_softball", "Baseball or softball"],
    ["hockey", "Hockey"],
    ["rugby", "Rugby"],
    ["tennis_racquet", "Tennis or another racquet sport"],
    ["combat", "Combat sport"],
    ["running_endurance", "Running or endurance racing"],
    ["cycling", "Cycling"],
    ["swimming", "Swimming"],
    ["strength_sport", "Another strength sport"],
    ["golf", "Golf"],
    ["other", "Other sport"],
  ] as const;

  const stepLabels: Record<QuestionnaireStep, string> = {
    1: "Goals",
    2: "Schedule",
    3: "Experience",
    4: "Equipment",
    5: "Powerlifting",
    6: "Hypertrophy",
    7: "Cardio",
    8: "Review",
  };

  const powerliftingGoalDescriptions: Record<string, string> = {
    general_powerlifting:
      "Emphasizes the squat, bench press, and deadlift equally.",
    return_to_powerlifting:
      "Reintroduces regular squat, bench press, and deadlift practice at a manageable workload before harder strength work.",
    meet_prep:
      "Prepares you for a meet with more competition-lift practice, heavier work, and a taper before meet day.",
    peak_or_test:
      "Focuses on expressing your current strength at a mock meet or test while reducing fatigue beforehand.",
    work_capacity:
      "Builds your ability to complete more useful powerlifting work without making every session maximal.",
    powerlifting_hypertrophy:
      "Keeps the main lifts in the program while putting more emphasis on muscle growth that supports them.",
    squat_specialization:
      "Gives the squat extra practice and supporting work while maintaining bench press and deadlift strength.",
    bench_specialization:
      "Gives the bench press extra practice and upper-body work while maintaining squat and deadlift strength.",
    deadlift_specialization:
      "Gives the deadlift extra practice and supporting work while managing lower-body fatigue.",
    lower_specialization:
      "Emphasizes squat, deadlift, and lower-body development while maintaining upper-body strength.",
    upper_specialization:
      "Emphasizes bench press and upper-body development while maintaining squat and deadlift strength.",
  };

  const cardioPurposeDescriptions: Record<string, string> = {
    health: "Builds a practical amount of aerobic activity for health.",
    aerobic_base:
      "Builds endurance so steady cardio feels easier and can be sustained longer.",
    performance:
      "Improves cardio performance while respecting your lifting priorities.",
    lifting_support:
      "Improves conditioning without making your lifting sessions harder to recover from.",
    recovery:
      "Uses easy movement to add activity without creating another demanding workout.",
    sport_support:
      "Supports the repeated efforts and recovery demands of your sport.",
  };

  let step = $state(initialStep(returned?.field));
  let primaryGoal = $state<GoalDomain>(
    initial("primaryGoal", "powerlifting") as GoalDomain,
  );
  let programIcon = $state<ProgramIconName | undefined>(
    hasSeededValues
      ? programIconName(initial("programIcon", "orbital_strength"))
      : undefined,
  );
  const programIconOptions = $derived(
    selectableProgramIcons(data.lunarCompletionUnlocked),
  );
  const seededSecondaryGoal = initial("secondaryGoal", "none");
  let secondaryGoal = $state(seededSecondaryGoal);
  let primaryWeight = $state(
    seededSecondaryGoal === "none" ? "100" : initial("primaryWeight", "80"),
  );
  let horizonKind = $state(initial("horizonKind", "fixed"));
  let hasEvent = $state(initialYes("hasEvent"));
  let bodyweightTracking = $state(initial("bodyweightTracking", "ignore"));
  let planningStyle = $state(initial("planningStyle", "calendar_days"));
  let liftingDays = $state(initialNumber("liftingDaysPerWeek", 4));
  // svelte-ignore state_referenced_locally -- saved/new form values intentionally seed this instance.
  let targetLiftMinutes = $state(
    initialNumber(
      "targetLiftMinutes",
      defaultLiftSessionMinutes(
        initial("primaryGoal", "powerlifting") as GoalDomain,
      ),
    ),
  );
  let targetLiftMinutesTouched = $state(hasSeededValues);
  let preferredDays = $state(
    initialDays("preferredTrainingDays", [
      "monday",
      "tuesday",
      "thursday",
      "saturday",
    ]),
  );
  let unavailableDays = $state(initialDays("unavailableDays", []));
  let cardioDays = $state(
    initialDays("cardioFocusedDays", ["wednesday", "sunday"]),
  );
  let splitSessionDays = $state(
    initialDays("splitSessionDays", allQuestionnaireDays()),
  );
  let allPreferredDays = $state(
    untrack(() => isAllQuestionnaireDays(preferredDays)),
  );
  let allCardioDays = $state(untrack(() => isAllQuestionnaireDays(cardioDays)));
  let allSplitSessionDays = $state(
    untrack(() => isAllQuestionnaireDays(splitSessionDays)),
  );
  let primaryEquipment = $state(
    initialList("primaryEquipment", [
      "bodyweight",
      "barbell",
      "rack",
      "bench",
      "plates",
      "dumbbells",
      "cables",
      "machines",
      "smith_machine",
      "pullup_bar",
      "cardio_bike",
      "treadmill",
    ]),
  );
  let alternateEquipment = $state(
    initialList("alternateEquipment", [
      "bodyweight",
      "dumbbells",
      "bench",
      "smith_machine",
      "treadmill",
    ]),
  );
  let usesAlternateGym = $state(initialYes("usesAlternateGym"));
  let hasMovementRestrictions = $state(initialYes("hasMovementRestrictions"));
  let excludedMovements = $state(initialList("excludedMovements", []));
  let playsSport = $state(initialYes("playsSport"));
  let stepTrackingMethod = $state(
    initial(
      "stepTrackingMethod",
      initial("baselineSteps", "") === "" ? "none" : "other_pedometer",
    ),
  );
  let baselineStepBand = $state(initial("baselineStepBand", "unknown"));
  let hypertrophyBalance = $state(initial("hypertrophyBalance", "balanced"));
  let hypertrophySplit = $state(initial("hypertrophySplit", "auto"));
  let useSupersets = $state(initialYes("useSupersets"));
  let powerliftingGoal = $state(
    initial("powerliftingGoal", "general_powerlifting"),
  );
  let currentEasySessions = $state<number | undefined>(
    initialOptionalNumber("currentEasySessions"),
  );
  let currentModerateSessions = $state<number | undefined>(
    initialOptionalNumber("currentModerateSessions"),
  );
  let currentHardSessions = $state<number | undefined>(
    initialOptionalNumber("currentHardSessions"),
  );
  let cardioFrequencyBand = $state(
    initial("cardioFrequencyBand", "one_to_two"),
  );
  let cardioDurationBand = $state(initial("cardioDurationBand", "15_to_30"));
  let cardioTypicalEffort = $state(
    initial("cardioTypicalEffort", "mostly_easy"),
  );
  let heartRateDevice = $state(initial("heartRateDevice", "none"));
  let primaryCardioModality = $state(
    initial("primaryCardioModality", "walking"),
  );
  let cardioPurpose = $state(initial("cardioPurpose", "health"));
  let cardioPlanType = $state(initial("cardioPlanType", "general"));
  let runningEventDistance = $state(initial("runningEventDistance", "5k"));
  let runningGoalOutcome = $state(initial("runningGoalOutcome", "finish"));
  let runningBenchmarkType = $state(initial("runningBenchmarkType", "none"));
  let vo2maxBenchmarkType = $state(initial("vo2maxBenchmarkType", "none"));
  let vo2maxModality = $state(initial("vo2maxModality", "running"));
  let effortFamiliarity = $state(initial("effortFamiliarity", ""));
  let effortInfoOpen = $state(false);
  let acceptableCardioModalities = $state(
    initialList("acceptableCardioModalities", []),
  );
  let units = $state(initial("units", "lb"));
  // svelte-ignore state_referenced_locally -- server date is only the no-JS initial value.
  let clientDate = $state(initial("clientDate", data.today));
  let timeZone = $state(initial("timeZone", "UTC"));
  // svelte-ignore state_referenced_locally -- server date is only the no-JS initial value.
  let startDate = $state(initial("startDate", data.today));

  let scheduleAdvanced = $state(initialYes("scheduleAdvancedEnabled"));
  let historyAdvanced = $state(initialYes("historyAdvancedEnabled"));
  let facilityAdvanced = $state(initialYes("facilityAdvancedEnabled"));
  let powerliftingAdvanced = $state(initialYes("powerliftingAdvancedEnabled"));
  let hypertrophyAdvanced = $state(initialYes("hypertrophyAdvancedEnabled"));
  let cardioAdvanced = $state(initialYes("cardioAdvancedEnabled"));
  let adaptationAdvanced = $state(initialYes("adaptationAdvancedEnabled"));
  let squatObservation1 = $state(initialYes("squatObservation1Enabled"));
  let squatObservation2 = $state(initialYes("squatObservation2Enabled"));
  let benchObservation1 = $state(initialYes("benchObservation1Enabled"));
  let benchObservation2 = $state(initialYes("benchObservation2Enabled"));
  let deadliftObservation1 = $state(initialYes("deadliftObservation1Enabled"));
  let deadliftObservation2 = $state(initialYes("deadliftObservation2Enabled"));
  let questionnaireForm: HTMLFormElement;

  $effect(() => {
    if (effortFamiliarity === "none") effortInfoOpen = true;
  });
  $effect(() => {
    if (cardioPlanType === "running_event") primaryCardioModality = "running";
    if (cardioPlanType === "vo2max") primaryCardioModality = vo2maxModality;
  });

  let needsPowerlifting = $derived(
    primaryGoal === "powerlifting" || secondaryGoal === "powerlifting",
  );
  let needsHypertrophy = $derived(
    primaryGoal === "hypertrophy" || secondaryGoal === "hypertrophy",
  );
  let needsHealth = $derived(
    primaryGoal === "health" || secondaryGoal === "health",
  );
  let availableSplits = $derived(
    splitOptions[Math.max(1, Math.min(6, liftingDays))] ?? splitOptions[3],
  );
  let visibleSteps = $derived(
    visibleQuestionnaireSteps(primaryGoal, secondaryGoal),
  );
  let stepPosition = $derived(Math.max(1, visibleSteps.indexOf(step) + 1));
  let flightStatus = $derived(
    questionnaireFlightStatus(step, stepPosition - 1),
  );
  let cuteStatus = $derived(questionnaireCuteStatus(step, stepPosition - 1));
  // svelte-ignore state_referenced_locally -- these snapshots support canceling a branch change.
  let previousPrimaryGoal = primaryGoal;
  // svelte-ignore state_referenced_locally -- these snapshots support canceling a branch change.
  let previousPrimaryWeight = primaryWeight;
  // svelte-ignore state_referenced_locally -- these snapshots support canceling a branch change.
  let previousSecondaryGoal = secondaryGoal;
  // svelte-ignore state_referenced_locally -- this snapshot supports canceling an incompatible split change.
  let previousLiftingDays = liftingDays;
  let visitedSteps = $state<QuestionnaireStep[]>(untrack(() => [step]));
  let clientError = $state<{ message: string; field?: string } | undefined>();
  let validatingStep = $state(false);

  $effect(() => {
    if (!availableSplits.some(([value]) => value === hypertrophySplit))
      hypertrophySplit = "auto";
  });

  function firstInvalidControl():
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined {
    const section = questionnaireForm.querySelector(
      `[data-questionnaire-step="${step}"]`,
    );
    if (!(section instanceof HTMLElement)) return undefined;
    for (const control of section.querySelectorAll("input, select, textarea")) {
      if (
        (control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement) &&
        control.willValidate &&
        !control.checkValidity()
      )
        return control;
    }
    return undefined;
  }

  function focusValidationField(field?: string): void {
    if (!field) return;
    const name = questionnaireControlForField(field);
    if (name === undefined) return;
    const control = questionnaireForm.querySelector(
      `[name="${CSS.escape(name)}"]`,
    );
    if (!(control instanceof HTMLElement)) return;
    control.focus({ preventScroll: true });
    (
      control.closest("fieldset, label, .field-group") ?? control
    ).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  async function currentStepIsValid(): Promise<boolean> {
    clientError = undefined;
    const invalidControl = firstInvalidControl();
    if (invalidControl !== undefined) {
      invalidControl.reportValidity();
      invalidControl.focus();
      return false;
    }

    validatingStep = true;
    try {
      const formData = new FormData(questionnaireForm);
      formData.set("questionnaireStep", String(step));
      const response = await fetch("/programs/new/validate", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        valid: boolean;
        message?: string;
        field?: string;
      };
      if (!response.ok || !result.valid) {
        clientError = {
          message:
            result.message ??
            "This page could not be validated. Review the answers and try again.",
          field: result.field,
        };
        focusValidationField(result.field);
        return false;
      }
      return true;
    } catch {
      clientError = {
        message:
          "The app could not validate this page. Check your connection and try Continue again.",
      };
      return false;
    } finally {
      validatingStep = false;
    }
  }

  async function moveStep(direction: -1 | 1): Promise<void> {
    if (direction === 1 && !(await currentStepIsValid())) return;
    const current = Math.max(0, visibleSteps.indexOf(step));
    const next = Math.max(
      0,
      Math.min(visibleSteps.length - 1, current + direction),
    );
    step = visibleSteps[next] ?? 1;
    if (!visitedSteps.includes(step)) visitedSteps = [...visitedSteps, step];
    await scrollQuestionnaireToTop();
  }

  async function saveAndRebuildFromCurrentStep(): Promise<void> {
    if (!(await currentStepIsValid())) return;
    questionnaireForm.requestSubmit();
  }

  async function goToStep(nextStep: QuestionnaireStep): Promise<void> {
    if (!visibleSteps.includes(nextStep)) return;
    const current = visibleSteps.indexOf(step);
    const next = visibleSteps.indexOf(nextStep);
    if (next > current + 1 && !visitedSteps.includes(nextStep)) return;
    if (next > current && !(await currentStepIsValid())) return;
    step = nextStep;
    if (!visitedSteps.includes(step)) visitedSteps = [...visitedSteps, step];
    await scrollQuestionnaireToTop();
  }

  async function scrollQuestionnaireToTop(): Promise<void> {
    // Wait for the newly visible section to be painted. iOS Safari may ignore
    // a scroll issued in the same task that hides the previous form section.
    await tick();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    document.scrollingElement?.scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function resetHiddenGoalAnswers(): void {
    if (!needsPowerlifting) {
      powerliftingGoal = "general_powerlifting";
      powerliftingAdvanced = false;
      squatObservation1 = false;
      squatObservation2 = false;
      benchObservation1 = false;
      benchObservation2 = false;
      deadliftObservation1 = false;
      deadliftObservation2 = false;
    }
    if (!needsHypertrophy) {
      hypertrophyBalance = "balanced";
      hypertrophySplit = "auto";
      useSupersets = false;
      hypertrophyAdvanced = false;
    }
  }

  function confirmGoalBranchChange(): void {
    const previousBranches = goalSpecificQuestionnaireSteps(
      previousPrimaryGoal,
      previousSecondaryGoal,
    );
    const nextBranches = goalSpecificQuestionnaireSteps(
      primaryGoal,
      secondaryGoal,
    );
    const removesBranch = previousBranches.some(
      (branch) => !nextBranches.includes(branch),
    );
    const hiddenVisitedBranch = previousBranches.some(
      (branch) =>
        !nextBranches.includes(branch) && visitedSteps.includes(branch),
    );
    const shouldWarn =
      hiddenVisitedBranch ||
      ((data.editingProgram || submitted) && removesBranch);
    const accepted =
      !shouldWarn ||
      window.confirm(
        "Changing this answer will hide a section you already reviewed. Answers that no longer apply will be cleared. Continue?",
      );
    if (!accepted) {
      primaryGoal = previousPrimaryGoal;
      primaryWeight = previousPrimaryWeight;
      secondaryGoal = previousSecondaryGoal;
      return;
    }
    previousPrimaryGoal = primaryGoal;
    previousPrimaryWeight = primaryWeight;
    previousSecondaryGoal = secondaryGoal;
    resetHiddenGoalAnswers();
    if (!visibleSteps.includes(step)) step = 1;
  }

  function handlePrimaryGoalChange(): void {
    if (secondaryGoal === primaryGoal) {
      secondaryGoal = "none";
      primaryWeight = "100";
    }
    confirmGoalBranchChange();
    if (!targetLiftMinutesTouched)
      targetLiftMinutes = defaultLiftSessionMinutes(primaryGoal);
  }

  function handleSecondaryGoalChange(): void {
    if (secondaryGoal === "none") primaryWeight = "100";
    else if (primaryWeight === "100") primaryWeight = "80";
    confirmGoalBranchChange();
  }

  function confirmProgramReplacement(event: SubmitEvent): void {
    if (!data.editingProgram) return;
    const accepted = window.confirm(
      "Save these changes and rebuild the program? This will delete completed workout logs, weekly reviews, and past adaptations for this program.",
    );
    if (!accepted) event.preventDefault();
  }

  function confirmLiftingDayChange(): void {
    if (hypertrophySplit === "auto") {
      previousLiftingDays = liftingDays;
      return;
    }
    const accepted = window.confirm(
      "Changing your lifting days may make the hypertrophy split you chose unavailable. Continue and let the app reset that split if needed?",
    );
    if (!accepted) {
      liftingDays = previousLiftingDays;
      return;
    }
    previousLiftingDays = liftingDays;
    if (!availableSplits.some(([value]) => value === hypertrophySplit))
      hypertrophySplit = "auto";
  }

  let activeQuestionElement: HTMLElement | undefined;

  function activateQuestion(event: Event): void {
    if (!(event.target instanceof Element)) return;
    const label = event.target.closest("label");
    const fieldset = event.target.closest("fieldset");
    const fieldGroup = event.target.closest(".field-group");
    const labelHasHelp =
      label !== null && label.querySelector("small") !== null;
    const fieldsetHasHelp =
      fieldset !== null && fieldset.querySelector(":scope > small") !== null;
    const next = fieldGroup
      ? fieldGroup
      : labelHasHelp
        ? label
        : fieldsetHasHelp
          ? fieldset
          : (label ?? fieldset);
    if (!(next instanceof HTMLElement) || next === activeQuestionElement)
      return;
    activeQuestionElement?.classList.remove("question-active");
    next.classList.add("question-active");
    activeQuestionElement = next;
  }

  function restoreReturnedFormValues(): void {
    if (Object.keys(seededValues).length === 0) return;
    for (const [name, rawValue] of Object.entries(seededValues)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const controls = questionnaireForm.querySelectorAll(
        `[name="${CSS.escape(name)}"]`,
      );
      for (const control of controls) {
        if (control instanceof HTMLInputElement) {
          if (control.type === "checkbox" || control.type === "radio") {
            control.checked = values.includes(control.value);
          } else {
            control.value = values[0] ?? "";
          }
        } else if (control instanceof HTMLSelectElement && control.multiple) {
          for (const option of control.options) {
            option.selected = values.includes(option.value);
          }
        } else if (control instanceof HTMLSelectElement) {
          control.value = values[0] ?? "";
        }
      }
    }
  }

  onMount(() => {
    if (submitted || data.editingProgram) {
      restoreReturnedFormValues();
      return;
    }
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const now = new Date();
    clientDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (startDate < clientDate) startDate = clientDate;
  });
</script>

<svelte:head>
  <title
    >{data.editingProgram ? "Edit" : "Create"} Program | Powerlifting App</title
  >
</svelte:head>

<main class="mission-page questionnaire-page">
  <QuestionnaireProgress
    editingProgram={data.editingProgram !== undefined}
    {step}
    {stepPosition}
    steps={visibleSteps}
    labels={stepLabels}
    {visitedSteps}
    validating={validatingStep}
    {flightStatus}
    {cuteStatus}
    onstepchange={goToStep}
  />

  {#if !data.storageReady}
    <div class="migration-warning" role="alert">
      <strong>Supabase is not ready to save questionnaire-v3 programs.</strong>
      <span>
        Apply migrations through
        <code>20260819220000_phase4_compact_program_history</code>, then reload
        this page. Detected status:
        <code>{data.storageErrorCode ?? "unavailable"}</code>.
      </span>
      <small
        >You can review the questions now, but generation is disabled so you do
        not lose another completed questionnaire.</small
      >
    </div>
  {/if}

  {#if returned?.message}
    <div class="error" role="alert">
      <strong>Please review this answer:</strong>
      {returned.message}
      {#if returned.field}<small>Field: {returned.field}</small>{/if}
    </div>
  {/if}

  {#if clientError}
    <div class="error" role="alert">
      <strong>Please review this page:</strong>
      {clientError.message}
      {#if clientError.field}<small>Field: {clientError.field}</small>{/if}
    </div>
  {/if}

  <form
    method="POST"
    action={data.editingProgram
      ? `?edit=${data.editingProgram.id}&/create`
      : "?/create"}
    bind:this={questionnaireForm}
    onsubmit={confirmProgramReplacement}
    onfocusin={activateQuestion}
    oninput={() => (clientError = undefined)}
    onchange={activateQuestion}
  >
    {#if data.editingProgram}
      <input type="hidden" name="programId" value={data.editingProgram.id} />
    {/if}
    <input type="hidden" name="clientDate" value={clientDate} />
    <input type="hidden" name="timeZone" value={timeZone} />
    <input type="hidden" name="units" value={units} />

    <section
      class:hidden={step !== 1}
      data-questionnaire-step="1"
      aria-labelledby="goals-heading"
    >
      <h2 id="goals-heading">Goals and basic setup</h2>
      <div class="grid two">
        <label
          >Program name
          <input
            name="name"
            maxlength="100"
            value={initial("name", "My training program")}
          />
        </label>
        <label
          >Age
          <input
            name="age"
            type="number"
            min="18"
            max="100"
            value={initial("age", "30")}
          />
        </label>
        <label
          >Primary training goal
          <select
            name="primaryGoal"
            bind:value={primaryGoal}
            onchange={handlePrimaryGoalChange}
          >
            <option value="powerlifting">Powerlifting strength</option>
            <option value="hypertrophy">Muscle growth</option>
            <option value="health">General health and fitness</option>
            <option value="cardio">Cardio performance</option>
          </select>
        </label>
        <label
          >Secondary goal
          <select
            name="secondaryGoal"
            bind:value={secondaryGoal}
            onchange={handleSecondaryGoalChange}
          >
            <option value="none">No secondary goal</option>
            <option
              value="powerlifting"
              disabled={primaryGoal === "powerlifting"}>Powerlifting</option
            >
            <option value="hypertrophy" disabled={primaryGoal === "hypertrophy"}
              >Muscle growth</option
            >
            <option value="health" disabled={primaryGoal === "health"}
              >General health</option
            >
            <option value="cardio" disabled={primaryGoal === "cardio"}
              >Cardio performance</option
            >
          </select>
        </label>
        {#if secondaryGoal !== "none"}
          <label
            >Goal priority: Primary / Secondary (%)
            <select
              name="primaryWeight"
              bind:value={primaryWeight}
              onchange={confirmGoalBranchChange}
            >
              <option value="90">90 / 10</option>
              <option value="80">80 / 20</option><option value="70"
                >70 / 30</option
              >
              <option value="60">60 / 40</option><option value="50"
                >50 / 50</option
              >
            </select>
          </label>
        {:else}
          <input type="hidden" name="primaryWeight" value="100" />
        {/if}
        <label
          >Program start date
          <input
            name="startDate"
            type="date"
            min={data.editingProgram ? undefined : clientDate}
            bind:value={startDate}
          />
        </label>
      </div>

      <fieldset class="program-icon-picker">
        <legend>Choose a program icon</legend>
        <div class="program-icon-options">
          {#each programIconOptions as option (option.name)}
            <label
              class:selected={programIcon === option.name}
              class:achievement={option.name === "lunar_completion"}
            >
              <input
                type="radio"
                name="programIcon"
                value={option.name}
                bind:group={programIcon}
              />
              <span class="program-icon-preview"
                ><ProgramIcon name={option.name} /></span
              >
              <span class="icon-name orbital-only">{option.label}</span>
              <span class="icon-name cute-only">{option.cuteLabel}</span>
            </label>
          {/each}
        </div>
      </fieldset>

      <label class="toggle"
        ><input
          name="hasEvent"
          type="checkbox"
          value="yes"
          bind:checked={hasEvent}
        /> Is this program building towards a scheduled meet, strength test, race,
        or sport event?</label
      >
      {#if hasEvent}
        <div class="grid three inset">
          <label
            >Event type<select name="eventType"
              ><option value="powerlifting_meet">Powerlifting meet</option
              ><option value="mock_meet">Mock meet or strength test</option
              ><option value="race">Race</option><option value="sport_event"
                >Sport event</option
              ><option value="other">Other dated endpoint</option></select
            ></label
          >
          <label
            >Event date<input
              name="eventDate"
              type="date"
              min={startDate}
              value={initial("eventDate", "")}
            /></label
          >
          <label
            >Certainty<select name="eventCertainty"
              ><option value="confirmed">Confirmed</option><option
                value="likely">Likely</option
              ><option value="tentative">Tentative</option></select
            ></label
          >
        </div>
        <p class="help">
          Your plan will build toward this date and, when appropriate, reduce
          fatigue before the event.
        </p>
      {/if}

      {#if !hasEvent}
        <div class="grid two inset">
          <label
            >How long should this program block run?
            <select name="horizonKind" bind:value={horizonKind}>
              <option value="fixed">A specific number of weeks</option>
              <option value="indefinite">Indefinite rolling program</option>
            </select>
          </label>
          {#if horizonKind === "fixed"}
            <label
              >Number of weeks
              <input
                name="horizonWeeks"
                type="number"
                min="2"
                max="16"
                value={initial("horizonWeeks", "4")}
              />
              <small
                >Choose 2–16 weeks. Four weeks is recommended for a first
                program: it gives you time to learn the app and creates useful
                training history for the program that follows.</small
              >
            </label>
          {/if}
        </div>
      {/if}

      {#if needsHealth}
        <fieldset class="inset">
          <legend>General fitness priorities</legend>
          <label
            >Main emphasis<select name="generalFitnessEmphasis"
              ><option value="balanced">Balanced health</option><option
                value="strength">Strength</option
              ><option value="aerobic">Aerobic fitness</option><option
                value="mobility">Mobility</option
              ><option value="function">Everyday function</option></select
            ><small
              >Your plan will put more attention here while still including
              strength, cardio, and everyday movement.</small
            ></label
          >
          <div class="check-grid">
            <label
              ><input
                name="chairStandConcern"
                type="checkbox"
                value="yes"
                checked={initialYes("chairStandConcern")}
              /> Chair-stand ability is a priority</label
            >
            <label
              ><input
                name="balanceConcern"
                type="checkbox"
                value="yes"
                checked={initialYes("balanceConcern")}
              /> Balance is a priority</label
            >
            <label
              ><input
                name="floorTransferConcern"
                type="checkbox"
                value="yes"
                checked={initialYes("floorTransferConcern")}
              /> Getting to/from the floor is a priority</label
            >
          </div>
          {#if !needsPowerlifting && !needsHypertrophy}
            <label
              >Would you like a small amount of squat, bench press, and deadlift
              practice?<select name="preserveCompetitionLiftsHealth"
                ><option value="no">No</option><option value="yes"
                  >Yes—keep some practice with all three lifts</option
                ></select
              ><small
                >Choose yes if you enjoy these lifts or want to keep the skills
                while general fitness remains the main goal.</small
              ></label
            >
          {/if}
        </fieldset>
      {/if}

      <fieldset class="inset">
        <legend>Optional bodyweight context</legend>
        <p class="help">
          This is not a diet app. Weight can contextualize training performance,
          but it can be ignored entirely after onboarding.
        </p>
        <div class="grid two">
          <label
            >Current bodyweight (optional, {units})<input
              name="initialBodyWeight"
              type="number"
              min="20"
              max="1500"
              step="0.1"
              value={initial("initialBodyWeight", "")}
            /></label
          >
          <label
            >Should bodyweight be considered after the program starts?<select
              name="bodyweightTracking"
              bind:value={bodyweightTracking}
              ><option value="ignore">No—do not ask about it again</option
              ><option value="track"
                >Yes—use optional trends as training context</option
              ></select
            ><small
              >Choosing no means bodyweight will not appear in weekly reviews or
              be used when adjusting your training.</small
            ></label
          >
          {#if bodyweightTracking === "track"}
            <label
              >What is your separate bodyweight goal during this program?<select
                name="dietGoal"
                ><option value="no_goal">No goal / prefer not to answer</option
                ><option value="gain">Intentionally gain weight</option><option
                  value="maintain">Maintain roughly the same weight</option
                ><option value="lose">Intentionally lose weight</option></select
              ><small
                >This is separate from your training goal. It only helps
                interpret performance and recovery trends; the app does not set
                calories or provide a diet plan.</small
              ></label
            >
            <label
              >Do you want one optional bodyweight check-in each week?<select
                name="weeklyWeightCheckIns"
                ><option value="no">No</option><option value="yes">Yes</option
                ></select
              ><small
                >A weekly trend can help distinguish a training problem from a
                large change in bodyweight. It is never required to continue the
                program.</small
              ></label
            >
          {/if}
        </div>
      </fieldset>
    </section>

    <section
      class:hidden={step !== 2}
      data-questionnaire-step="2"
      aria-labelledby="schedule-heading"
    >
      <h2 id="schedule-heading">Schedule and time</h2>
      <div class="grid two">
        <label
          >How many days per week do you want to lift?<input
            name="liftingDaysPerWeek"
            type="number"
            min="1"
            max="6"
            bind:value={liftingDays}
            onchange={confirmLiftingDayChange}
          /></label
        >
        <label
          >Target lifting-session length<select
            name="targetLiftMinutes"
            bind:value={targetLiftMinutes}
            onchange={() => (targetLiftMinutesTouched = true)}
          >
            {#each [30, 45, 60, 75, 90, 105, 120, 150] as minutes}<option
                value={minutes}>{minutes} minutes</option
              >{/each}
          </select><small
            >Use the amount of time you normally have available. Powerlifting
            sessions often need longer rests.</small
          ></label
        >
        <label
          >Would you like workouts assigned to days of the week?<select
            name="planningStyle"
            bind:value={planningStyle}
            ><option value="calendar_days"
              >Yes—give each workout a recommended day</option
            ><option value="flexible_sequence"
              >No—show the order and let me choose the days</option
            ></select
          ><small
            >Even with recommended days, you can move a workout when life gets
            in the way. A flexible plan still shows where rest and cardio-only
            days fit best.</small
          ></label
        >
      </div>

      <DaySelector
        name="preferredTrainingDays"
        legend="Which days normally work for training?"
        help={planningStyle === "calendar_days"
          ? "Workouts will be placed on these days. Select at least as many days as the number of lifting days you chose."
          : "Select at least as many days as the number of lifting days you chose. The app uses them to suggest a balanced rhythm, but you can still move workouts while keeping their order."}
        selectAllLabel="All days normally work"
        bind:values={preferredDays}
        bind:allSelected={allPreferredDays}
        ondaychange={({ day, checked }) => {
          if (checked)
            unavailableDays = unavailableDays.filter(
              (unavailable) => unavailable !== day,
            );
        }}
        onselectall={(checked) => {
          if (checked) unavailableDays = [];
        }}
      />
      <DaySelector
        name="unavailableDays"
        legend="Which days can you definitely not train?"
        help="The plan will not place a workout on these days."
        bind:values={unavailableDays}
        ondaychange={({ day, checked }) => {
          if (checked) {
            allPreferredDays = false;
            preferredDays = preferredDays.filter(
              (preferred) => preferred !== day,
            );
          }
        }}
      />
      <DaySelector
        name="cardioFocusedDays"
        legend="Which days would you prefer to do cardio?"
        help="Select any that work. This does not mean every selected day becomes a full cardio session—the program chooses frequency and may use only a walking or movement target on lower-priority days."
        selectAllLabel="All days work for cardio"
        bind:values={cardioDays}
        bind:allSelected={allCardioDays}
      />

      <label class="advanced-toggle"
        ><input
          name="scheduleAdvancedEnabled"
          type="checkbox"
          value="yes"
          bind:checked={scheduleAdvanced}
        /> Show advanced schedule settings</label
      >
      {#if scheduleAdvanced}
        <div class="advanced">
          <label
            >If the ideal week is disrupted, what is the fewest lifting days you
            would still complete?<input
              name="minimumTrainingDays"
              type="number"
              min="1"
              max={liftingDays}
              value={initial(
                "minimumTrainingDays",
                String(Math.max(1, liftingDays - 1)),
              )}
            /><small
              >This creates a shorter fallback week instead of asking you to
              restart the program after a disruption.</small
            ></label
          >
          <DaySelector
            name="splitSessionDays"
            legend="Select the days where cardio and lifting can be scheduled on the same day"
            help="Select only days when you are comfortable doing both parts. The plan will clearly show lifting and cardio together."
            selectAllLabel="All days can include both"
            bind:values={splitSessionDays}
            bind:allSelected={allSplitSessionDays}
          />
        </div>
      {/if}
    </section>

    <section
      class:hidden={step !== 3}
      data-questionnaire-step="3"
      aria-labelledby="experience-heading"
    >
      <h2 id="experience-heading">Experience and recovery context</h2>
      <div class="grid two">
        <label
          >Years of resistance training<input
            name="resistanceTrainingYears"
            type="number"
            min="0"
            max="80"
            step="0.5"
            value={initial("resistanceTrainingYears", "2")}
          /></label
        >
        <label
          >During the last 8 weeks, how consistently have you lifted?<select
            name="recentConsistency"
            ><option value="none">No resistance-training sessions</option
            ><option value="sporadic"
              >Some sessions, but no consistent pattern</option
            ><option value="one_to_two">Usually 1–2 sessions per week</option
            ><option value="three_plus"
              >Usually 3 or more sessions per week</option
            ></select
          ></label
        >
        <div class="field-group">
          <div class="label-with-info">
            <label for="effort-familiarity"
              >How familiar are you with rating sets using RPE or RIR?</label
            >
            <InfoButton
              label="What RPE and RIR mean"
              bind:open={effortInfoOpen}
            >
              <strong>RIR (reps in reserve)</strong> is how many good reps you
              think you could still do. For example, 2 RIR means you stopped
              with about two reps left.<br /><br />
              <strong>RPE</strong> uses a 1–10 effort scale. In lifting, RPE 10 means
              no reps left, RPE 9 is about 1 RIR, and RPE 8 is about 2 RIR. These
              are useful estimates, not a test you need to get perfectly right.
            </InfoButton>
          </div>
          <select
            id="effort-familiarity"
            name="effortFamiliarity"
            bind:value={effortFamiliarity}
            required
            ><option value="" disabled>Select one</option><option value="none"
              >Not familiar</option
            ><option value="basic">Basic familiarity</option><option
              value="confident">Confident and consistent</option
            ></select
          >
        </div>
        <label
          >Which effort system would you prefer to use?<select
            name="effortReporting"
            ><option value="auto">Choose for me</option><option value="rpe"
              >RPE</option
            ><option value="rir">RIR</option><option value="verbal"
              >Easy / medium / difficult / impossible</option
            ></select
          ></label
        >
        <label
          >Typical nightly sleep<select name="typicalSleepHours"
            >{#each ["6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10"] as hours}<option
                value={hours}
                selected={initial("typicalSleepHours", "7.5") === hours}
                >{hours} hours</option
              >{/each}</select
          ></label
        >
        <label
          >Nights below 6 hours in a typical week<input
            name="nightsBelowSixPerWeek"
            type="number"
            min="0"
            max="7"
            value={initial("nightsBelowSixPerWeek", "0")}
          /><small>Used as recovery context, not a medical evaluation.</small
          ></label
        >
        <label
          >Physical demand of work/daily life<select name="workActivity"
            ><option value="sedentary">Mostly seated</option><option
              value="light"
              >Mostly standing or walking, with little lifting</option
            ><option value="moderate"
              >Frequent walking, lifting, or manual tasks</option
            ><option value="heavy"
              >Sustained physical labor or frequent heavy carrying</option
            ></select
          ><small
            >Consider your job and regular daily activities, not your planned
            workouts.</small
          ></label
        >
        <label class="toggle"
          ><input
            name="rotatingOrNightShifts"
            type="checkbox"
            value="yes"
            checked={initialYes("rotatingOrNightShifts")}
          /> I regularly work rotating or night shifts</label
        >
      </div>

      <label class="toggle"
        ><input
          name="playsSport"
          type="checkbox"
          value="yes"
          bind:checked={playsSport}
        /> I regularly practice or compete in a sport</label
      >
      {#if playsSport}
        <div class="grid three inset">
          <label
            >Primary sport<select name="sport"
              >{#each sportOptions as [value, label]}<option {value}
                  >{label}</option
                >{/each}</select
            ></label
          >
          <label
            >Hours per week<input
              name="sportHoursPerWeek"
              type="number"
              min="0.5"
              max="40"
              step="0.5"
              value={initial("sportHoursPerWeek", "2")}
            /></label
          >
          <label
            >Lower-body-demanding sport sessions/week<input
              name="sportLowerBodyDemandSessions"
              type="number"
              min="0"
              max="14"
              value={initial("sportLowerBodyDemandSessions", "1")}
            /></label
          >
        </div>
      {/if}

      <fieldset class="inset">
        <legend>Daily movement</legend>
        <p class="help">
          Every plan includes a small daily movement target. Choose how you can
          measure it; a watch is not required.
        </p>
        <label>
          How can you track daily movement?
          <select name="stepTrackingMethod" bind:value={stepTrackingMethod}>
            <option value="wearable">Fitness watch or activity tracker</option>
            <option value="phone">Phone step counter</option>
            <option value="other_pedometer">Another pedometer</option>
            <option value="none">I cannot reliably count steps</option>
          </select>
        </label>
        {#if stepTrackingMethod === "none"}
          <label>
            About how many minutes do you walk on a typical day?
            <input
              name="dailyWalkingMinutes"
              type="number"
              min="0"
              max="600"
              step="1"
              value={initial("dailyWalkingMinutes", "15")}
            />
            <small>
              Your plan will use a walking-time target instead of a step count.
            </small>
          </label>
        {:else}
          <label>
            About how many steps do you average per day?
            <select name="baselineStepBand" bind:value={baselineStepBand}>
              <option value="unknown">I am not sure yet</option>
              <option value="under_3000">Fewer than 3,000</option>
              <option value="3000_4999">3,000–4,999</option>
              <option value="5000_7499">5,000–7,499</option>
              <option value="7500_9999">7,500–9,999</option>
              <option value="10000_plus">10,000 or more</option>
            </select>
          </label>
          <details>
            <summary>Enter an exact average instead</summary>
            <label>
              Average daily steps (optional)
              <input
                name="baselineSteps"
                type="number"
                min="0"
                max="100000"
                step="100"
                value={initial("baselineSteps", "")}
                placeholder="Leave blank to use the range above"
              />
            </label>
          </details>
        {/if}
        <small>
          The first target stays close to your current activity. One missed day
          will not lower your training or count as a failed workout.
        </small>
      </fieldset>

      <label class="advanced-toggle"
        ><input
          name="historyAdvancedEnabled"
          type="checkbox"
          value="yes"
          bind:checked={historyAdvanced}
        /> Show advanced recent-training inputs</label
      >
      {#if historyAdvanced}
        <div class="advanced">
          <label
            >Recent resistance-training sessions per week<input
              name="recentSessionsPerWeek"
              type="number"
              min="0"
              max="14"
              value={initial("recentSessionsPerWeek", "")}
            /><small
              >Helps the first week resemble what you are currently used to.</small
            ></label
          >
          <details>
            <summary>Super-advanced: recent weekly hard sets by muscle</summary>
            <p class="help">
              Optional. These answers help the first week match your recent
              training. Leave them blank if you do not track them.
            </p>
            <div class="grid three">
              {#each muscleOptions as [value, label]}<label
                  >{label}<input
                    name={`hardSets_${value}`}
                    type="number"
                    min="0"
                    max="40"
                    value={initial(`hardSets_${value}`, "")}
                  /></label
                >{/each}
            </div>
          </details>
        </div>
      {/if}
    </section>

    <section
      class:hidden={step !== 4}
      data-questionnaire-step="4"
      aria-labelledby="equipment-heading"
    >
      <h2 id="equipment-heading">Equipment and gym access</h2>
      <fieldset>
        <legend>Equipment at your primary gym</legend>
        <div class="check-grid">
          {#each equipmentOptions as [value, label]}<label
              ><input
                name="primaryEquipment"
                type="checkbox"
                {value}
                bind:group={primaryEquipment}
              />
              {label}</label
            >{/each}
        </div>
        <small
          >The program will use only the equipment selected here. It will
          clearly note when a standard competition-lift setup is unavailable.</small
        >
      </fieldset>

      <label class="toggle"
        ><input
          name="usesAlternateGym"
          type="checkbox"
          value="yes"
          bind:checked={usesAlternateGym}
        /> I sometimes train at a secondary or limited-equipment gym</label
      >
      {#if usesAlternateGym}
        <fieldset class="inset">
          <legend>Equipment at the alternate gym</legend>
          <div class="check-grid">
            {#each equipmentOptions as [value, label]}<label
                ><input
                  name="alternateEquipment"
                  type="checkbox"
                  {value}
                  bind:group={alternateEquipment}
                />
                {label}</label
              >{/each}
          </div>
          <small
            >The program can offer alternate-gym replacements that train the
            same purpose. Each replacement keeps its own weight history.</small
          >
        </fieldset>
      {/if}

      <label class="toggle">
        <input
          name="hasMovementRestrictions"
          type="checkbox"
          value="yes"
          bind:checked={hasMovementRestrictions}
        />
        There are movement types I need the program to avoid right now
      </label>
      {#if hasMovementRestrictions}
        <fieldset class="inset">
          <legend>Which movement types should be left out?</legend>
          <div class="check-grid">
            {#each movementRestrictionOptions as [value, label]}
              <label>
                <input
                  name="excludedMovements"
                  type="checkbox"
                  {value}
                  bind:group={excludedMovements}
                />
                {label}
              </label>
            {/each}
          </div>
          <small>
            The program will choose other exercises where possible. You can
            still replace a specific exercise from the workout screen.
          </small>
        </fieldset>
      {/if}

      <p class="notice">
        The default substitution behavior is “recommend a valid substitute,
        explain the trade-off, and ask.” The app will later support both planned
        limited-gym days and one-off replacement days.
      </p>
      <label class="advanced-toggle"
        ><input
          name="facilityAdvancedEnabled"
          type="checkbox"
          value="yes"
          bind:checked={facilityAdvanced}
        /> Show advanced loading increments</label
      >
      {#if facilityAdvanced}
        <div class="advanced grid two">
          <label
            >Smallest plate available ({units}, per side)<input
              name="barbellIncrement"
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={initial("barbellIncrement", units === "lb" ? "2.5" : "1")}
            /><small
              >A 2.5 lb plate changes the total barbell load by 5 lb.</small
            ></label
          >
          <label
            >Smallest dumbbell change ({units})<input
              name="dumbbellIncrement"
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={initial("dumbbellIncrement", units === "lb" ? "2.5" : "1")}
            /><small
              >If the next dumbbell is a large jump, the program will usually
              add repetitions before adding weight.</small
            ></label
          >
        </div>
      {/if}
    </section>

    <section
      class:hidden={step !== 5}
      data-questionnaire-step="5"
      aria-labelledby="powerlifting-heading"
    >
      <h2 id="powerlifting-heading">Powerlifting programming</h2>
      <div class="grid two">
        <label
          >What should this powerlifting block prioritize?<select
            name="powerliftingGoal"
            bind:value={powerliftingGoal}
            ><option value="general_powerlifting"
              >Balanced powerlifting strength</option
            ><option value="return_to_powerlifting"
              >Return to consistent powerlifting training</option
            ><option value="meet_prep">Upcoming meet preparation</option><option
              value="peak_or_test">Peak for a mock meet or test</option
            ><option value="work_capacity"
              >Increase powerlifting work capacity</option
            ><option value="powerlifting_hypertrophy"
              >Powerlifting-specific hypertrophy</option
            ><option value="squat_specialization">Squat specialization</option
            ><option value="bench_specialization">Bench specialization</option
            ><option value="deadlift_specialization"
              >Deadlift specialization</option
            ><option value="lower_specialization"
              >Lower-body specialization</option
            ><option value="upper_specialization"
              >Upper-body specialization</option
            ></select
          ><small>{powerliftingGoalDescriptions[powerliftingGoal]}</small
          ></label
        >
      </div>

      <h3>Recent performance calibration</h3>
      <p class="help">
        Optional. Enter up to two recent sets per lift that were completed with
        consistent technique. These sets help estimate your current strength. If
        you leave a lift blank, your first week will include a controlled
        calibration set rather than a max test.
      </p>
      {#each [["squat", "Squat"], ["bench", "Bench press"], ["deadlift", "Deadlift"]] as [lift, label]}
        <article class="observation-card">
          <h4>{label}</h4>
          {#each [1, 2] as index}
            {@const stateName = `${lift}${index}`}
            {@const isEnabled =
              stateName === "squat1"
                ? squatObservation1
                : stateName === "squat2"
                  ? squatObservation2
                  : stateName === "bench1"
                    ? benchObservation1
                    : stateName === "bench2"
                      ? benchObservation2
                      : stateName === "deadlift1"
                        ? deadliftObservation1
                        : deadliftObservation2}
            <label class="toggle"
              ><input
                name={`${lift}Observation${index}Enabled`}
                type="checkbox"
                value="yes"
                checked={isEnabled}
                onchange={(event) => {
                  const checked = event.currentTarget.checked;
                  if (stateName === "squat1") squatObservation1 = checked;
                  else if (stateName === "squat2") squatObservation2 = checked;
                  else if (stateName === "bench1") benchObservation1 = checked;
                  else if (stateName === "bench2") benchObservation2 = checked;
                  else if (stateName === "deadlift1")
                    deadliftObservation1 = checked;
                  else deadliftObservation2 = checked;
                }}
              />
              Add recent set {index}</label
            >
            {#if isEnabled}
              <div class="grid six compact">
                <label
                  >Load ({units})<input
                    name={`${lift}Observation${index}Load`}
                    type="number"
                    min={units === "lb" ? "5" : "2.5"}
                    max="5000"
                    step={units === "lb" ? "5" : "2.5"}
                    value={initial(`${lift}Observation${index}Load`, "")}
                  /></label
                >
                <label
                  >Reps<input
                    name={`${lift}Observation${index}Reps`}
                    type="number"
                    min="1"
                    max="10"
                    value={initial(`${lift}Observation${index}Reps`, "3")}
                  /></label
                >
                <label
                  >Effort after the set<select
                    name={`${lift}Observation${index}EffortRating`}
                    ><optgroup label="Repetitions in reserve (RIR)">
                      {#each [4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0] as value}<option
                          value={`rir_${value}`}
                          selected={initial(
                            `${lift}Observation${index}EffortRating`,
                            "rir_2",
                          ) === `rir_${value}`}>{value} RIR</option
                        >{/each}
                    </optgroup><optgroup
                      label="Rating of perceived exertion (RPE)"
                    >
                      {#each [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10] as value}<option
                          value={`rpe_${value}`}
                          selected={initial(
                            `${lift}Observation${index}EffortRating`,
                            "rir_2",
                          ) === `rpe_${value}`}>RPE {value}</option
                        >{/each}
                    </optgroup></select
                  ><small
                    >Choose the scale you actually used for this set.</small
                  ></label
                >
                <label
                  >Date<input
                    name={`${lift}Observation${index}Date`}
                    type="date"
                    max={clientDate}
                    value={initial(
                      `${lift}Observation${index}Date`,
                      clientDate,
                    )}
                  /></label
                >
                <label
                  >Stable technique?<select
                    name={`${lift}Observation${index}StableTechnique`}
                    ><option value="yes">Yes</option><option value="no"
                      >No</option
                    ></select
                  ></label
                >
              </div>
            {/if}
          {/each}
        </article>
      {/each}

      <label class="advanced-toggle"
        ><input
          name="powerliftingAdvancedEnabled"
          type="checkbox"
          value="yes"
          bind:checked={powerliftingAdvanced}
        /> Show advanced powerlifting settings</label
      >
      {#if powerliftingAdvanced}
        <div class="advanced grid two">
          <label
            >Displayed load units<select bind:value={units}
              ><option value="lb">Pounds (default)</option><option value="kg"
                >Kilograms</option
              ></select
            ><small
              >Clearly displayed in the program overview and used for load
              rounding.</small
            ></label
          >
          <label
            >Squat style<select name="squatStyle"
              ><option value="low_bar">Low bar (default)</option><option
                value="high_bar">High bar</option
              ></select
            ></label
          >
          <label
            >Bench style<select name="benchStyle"
              ><option value="standard">Standard grip</option><option
                value="close_grip">Close grip</option
              ><option value="wide_grip">Wide grip</option></select
            ></label
          >
          <label
            >Deadlift style<select name="deadliftStyle"
              ><option value="conventional">Conventional</option><option
                value="sumo">Sumo</option
              ></select
            ></label
          >
          <label
            >Competition equipment<select name="competitionStyle"
              ><option value="raw_sleeves"
                >Raw with knee sleeves (default)</option
              ><option value="raw_wraps">Raw with knee wraps</option><option
                value="equipped">Equipped</option
              ></select
            ></label
          >
          <label
            >Training-max cap (%)<input
              name="trainingMaxPercent"
              type="number"
              min="80"
              max="100"
              step="0.5"
              value={initial("trainingMaxPercent", "")}
            /><small
              >Optionally bases working weights on a percentage of your
              estimated current strength.</small
            ></label
          >
          <label
            >Preferred squat exposures/week<input
              name="squatFrequencyPreference"
              type="number"
              min="1"
              max={liftingDays}
              value={initial("squatFrequencyPreference", "")}
            /></label
          >
          <label
            >Preferred bench exposures/week<input
              name="benchFrequencyPreference"
              type="number"
              min="1"
              max={liftingDays}
              value={initial("benchFrequencyPreference", "")}
            /></label
          >
          <label
            >Preferred deadlift exposures/week<input
              name="deadliftFrequencyPreference"
              type="number"
              min="1"
              max={liftingDays}
              value={initial("deadliftFrequencyPreference", "")}
            /></label
          >
        </div>
      {/if}
    </section>

    <section
      class:hidden={step !== 6}
      data-questionnaire-step="6"
      aria-labelledby="hypertrophy-heading"
    >
      <h2 id="hypertrophy-heading">Hypertrophy programming</h2>
      <p class="notice">
        Available splits are filtered to your selected {liftingDays}-day
        schedule. A split mainly organizes your week; no split is automatically
        better when the same useful work gets completed.
      </p>
      <div class="grid two">
        <label
          >Preferred split<select
            name="hypertrophySplit"
            bind:value={hypertrophySplit}
            >{#each availableSplits as [value, label]}<option {value}
                >{label}</option
              >{/each}</select
          ><small
            >Only splits that can work with your selected number of days are
            shown.</small
          ></label
        >
        {#if hypertrophySplit !== "auto"}
          <label
            >How strongly do you prefer this split?<select
              name="splitPreferenceStrength"
              ><option value="slight">Use it when practical</option><option
                value="strong">Strong preference</option
              ></select
            ><small
              >A strong preference will be followed unless it conflicts with
              your equipment or available workout time.</small
            ></label
          >
        {:else}
          <input
            type="hidden"
            name="splitPreferenceStrength"
            value="engine_decide"
          />
        {/if}
        <label
          >Development balance<select
            name="hypertrophyBalance"
            bind:value={hypertrophyBalance}
            ><option value="balanced">Balanced development</option><option
              value="prioritized">Prioritize specific muscles</option
            ></select
          ></label
        >
        <label
          >Exercise selection<select name="exerciseSelection"
            ><option value="offer_choices"
              >Recommend exercises and show valid alternatives</option
            ><option value="engine_decide"
              >Choose for me without extra questions</option
            ><option value="user_selects"
              >Recommend a default, but let me review every exercise</option
            ></select
          ><small
            >Alternatives use your available equipment and train the same target
            muscles, but they may require a different weight. If you select
            every exercise, the program still starts with a specific
            recommendation; you can replace it before logging the workout.</small
          ></label
        >
        {#if !needsPowerlifting}
          <label
            >Would you like a small amount of squat, bench press, and deadlift
            practice?<select name="preserveCompetitionLiftsHypertrophy"
              ><option value="no">No</option><option value="yes"
                >Yes—keep some practice with all three lifts</option
              ></select
            ><small
              >Choose yes if you enjoy these lifts or want to keep the skills
              while muscle growth remains the main goal.</small
            ></label
          >
        {/if}
      </div>
      <p class="split-detail">
        <strong>What this split means:</strong>
        {splitDescriptions[hypertrophySplit]}
      </p>
      <label class="toggle superset-choice"
        ><input
          name="useSupersets"
          type="checkbox"
          value="yes"
          bind:checked={useSupersets}
        />
        <span
          ><strong>Include compatible supersets</strong><small
            >The program may pair selected exercises as A1 and A2 to save time.
            Competition lifts and demanding strength work stay separate, and
            exercises will not be paired just to make the workout harder.</small
          ></span
        ></label
      >
      {#if hypertrophyBalance === "prioritized"}
        <div class="inset grid two">
          <label
            >Priority 1<select name="musclePriority1"
              ><option value="">Select muscle</option
              >{#each muscleOptions as [value, label]}<option {value}
                  >{label}</option
                >{/each}</select
            ></label
          >
          <label
            >Priority 2 (optional)<select name="musclePriority2"
              ><option value="">None</option
              >{#each muscleOptions as [value, label]}<option {value}
                  >{label}</option
                >{/each}</select
            ></label
          >
          <label
            >Priority 3 (optional)<select name="musclePriority3"
              ><option value="">None</option
              >{#each muscleOptions as [value, label]}<option {value}
                  >{label}</option
                >{/each}</select
            ></label
          >
          <label
            >Broad specialization bias (optional)<select
              name="specializationBias"
              ><option value="">None</option><option value="arms">Arms</option
              ><option value="chest">Chest</option><option value="back"
                >Back</option
              ><option value="legs">Legs</option><option value="delts"
                >Delts</option
              ></select
            ><small
              >Adds extra attention to this area while continuing to train the
              rest of your body.</small
            ></label
          >
        </div>
      {/if}
      <label class="advanced-toggle"
        ><input
          name="hypertrophyAdvancedEnabled"
          type="checkbox"
          value="yes"
          bind:checked={hypertrophyAdvanced}
        /> Show advanced hypertrophy settings</label
      >
      {#if hypertrophyAdvanced}<div class="advanced">
          <label
            >Preferred exposures per muscle per week<input
              name="targetFrequencyPerMuscle"
              type="number"
              min="1"
              max={liftingDays}
              value={initial("targetFrequencyPerMuscle", "")}
            /><small
              >The program may use a lower frequency if your available days or
              workout length cannot support this preference.</small
            ></label
          >
        </div>{/if}
    </section>

    <section
      class:hidden={step !== 7}
      data-questionnaire-step="7"
      aria-labelledby="cardio-heading"
    >
      <h2 id="cardio-heading">Cardio baseline and preferences</h2>
      <p class="help">
        <strong>Cardio session:</strong> a planned bout of continuous or interval
        aerobic work. Easy means conversational pace; moderate means short sentences;
        hard means only a few words during work intervals. Ordinary daily steps are
        tracked separately.
      </p>
      <div class="grid two">
        <label class="field-group full-width"
          >Which kind of cardio plan do you want?<select
            name="cardioPlanType"
            bind:value={cardioPlanType}
            ><option value="general">General conditioning or health</option
            ><option value="running_event"
              >Train for a 5K, 10K, half marathon, or marathon</option
            ><option value="vo2max">Improve VO₂max / aerobic power</option
            ></select
          ><small
            >Choose the result you want. The plan will still account for your
            lifting goal and current cardio level.</small
          ></label
        >
        {#if cardioPlanType === "general"}
          <label
            >What do you want cardio to do for you?<select
              name="cardioPurpose"
              bind:value={cardioPurpose}
              ><option value="health">General health</option><option
                value="aerobic_base">Build an aerobic base</option
              ><option value="performance">Improve cardio performance</option
              ><option value="lifting_support"
                >Support lifting with minimal interference</option
              ><option value="recovery">Low-fatigue recovery support</option
              ><option value="sport_support">Support a sport</option></select
            ><small>{cardioPurposeDescriptions[cardioPurpose]}</small></label
          >
          <label
            >Modality you would most like to do<select
              name="primaryCardioModality"
              bind:value={primaryCardioModality}
              ><option value="walking">Walking/incline walking</option><option
                value="running">Running</option
              ><option value="cycling">Cycling</option><option value="rowing"
                >Rowing</option
              ><option value="elliptical">Elliptical</option><option
                value="swimming">Swimming</option
              ><option value="rucking">Rucking</option><option value="sport"
                >Sport</option
              ></select
            ><small
              >This will make up most of your cardio. You can list other choices
              below for variety.</small
            ></label
          >
        {:else if cardioPlanType === "running_event"}
          <input type="hidden" name="cardioPurpose" value="performance" />
          <input type="hidden" name="primaryCardioModality" value="running" />
          <label
            >Race distance<select
              name="runningEventDistance"
              bind:value={runningEventDistance}
              ><option value="5k">5K</option><option value="10k">10K</option
              ><option value="half_marathon">Half marathon</option><option
                value="marathon">Marathon</option
              ></select
            ></label
          >
          <label
            >What would make this race successful for you?<select
              name="runningGoalOutcome"
              bind:value={runningGoalOutcome}
              ><option value="finish">Finish the event</option><option
                value="comfortable_finish">Finish feeling in control</option
              ><option value="improve_pb">Improve my personal best</option
              ><option value="target_time">Reach a target time</option></select
            ></label
          >
          {#if runningGoalOutcome === "target_time"}
            <label
              >Target finish time (minutes)<input
                name="runningTargetTimeMinutes"
                type="number"
                min="10"
                max="1440"
                step="0.1"
                value={initial("runningTargetTimeMinutes", "")}
                required
              /><small>For example, enter 24.5 for 24 minutes 30 seconds.</small
              ></label
            >
          {/if}
          <label
            >Recent best time for this distance (minutes, optional)<input
              name="runningRecentBestMinutes"
              type="number"
              min="5"
              max="1440"
              step="0.1"
              value={initial("runningRecentBestMinutes", "")}
            /></label
          >
          <label
            >Expected race surface<select name="runningSurface"
              ><option value="road">Road</option><option value="track"
                >Track</option
              ><option value="trail">Trail</option><option value="treadmill"
                >Treadmill / virtual</option
              ><option value="mixed">Mixed surfaces</option></select
            ></label
          >
          <label
            >Expected course profile<select name="runningRouteProfile"
              ><option value="flat">Mostly flat</option><option value="rolling"
                >Rolling hills</option
              ><option value="hilly">Hilly</option><option value="unknown"
                >I do not know</option
              ></select
            ></label
          >
          {#if !hasEvent}
            <p class="field-note full-width" role="note">
              Add the race date on the Goals page before building the program.
              The date determines how the plan builds and tapers.
            </p>
          {/if}
        {:else}
          <input type="hidden" name="cardioPurpose" value="performance" />
          <input
            type="hidden"
            name="primaryCardioModality"
            value={vo2maxModality}
          />
          <label
            >Preferred VO₂max workout type<select
              name="vo2maxModality"
              bind:value={vo2maxModality}
              ><option value="running">Running</option><option value="cycling"
                >Cycling</option
              ><option value="rowing">Rowing</option><option value="elliptical"
                >Elliptical</option
              ><option value="swimming">Swimming</option></select
            ><small
              >Hard intervals will use this option so your results are easier to
              compare from week to week.</small
            ></label
          >
          <label
            >Do you have a recent VO₂max benchmark?<select
              name="vo2maxBenchmarkType"
              bind:value={vo2maxBenchmarkType}
              ><option value="none">No / not sure</option><option
                value="timed_distance">Timed distance effort</option
              ><option value="twelve_minute">12-minute test</option><option
                value="wearable_vo2max">Estimate from my watch</option
              ></select
            ></label
          >
          {#if vo2maxBenchmarkType !== "none"}
            <label
              >Benchmark date (optional)<input
                name="vo2maxBenchmarkDate"
                type="date"
                value={initial("vo2maxBenchmarkDate", "")}
              /></label
            >
            {#if vo2maxBenchmarkType === "wearable_vo2max"}
              <label
                >Watch VO₂max estimate<input
                  name="vo2maxBenchmarkVo2max"
                  type="number"
                  min="10"
                  max="100"
                  step="0.1"
                  value={initial("vo2maxBenchmarkVo2max", "")}
                  required
                /></label
              >
            {:else}
              <label
                >Distance covered<input
                  name="vo2maxBenchmarkDistance"
                  type="number"
                  min="0.1"
                  max="100000"
                  step="0.01"
                  value={initial("vo2maxBenchmarkDistance", "")}
                  required
                /></label
              >
              <label
                >Distance unit<select name="vo2maxBenchmarkDistanceUnit"
                  ><option
                    value="km"
                    selected={initial("vo2maxBenchmarkDistanceUnit", "km") ===
                      "km"}>Kilometres</option
                  ><option
                    value="mi"
                    selected={initial("vo2maxBenchmarkDistanceUnit", "km") ===
                      "mi"}>Miles</option
                  ><option
                    value="m"
                    selected={initial("vo2maxBenchmarkDistanceUnit", "km") ===
                      "m"}>Metres</option
                  ><option
                    value="yd"
                    selected={initial("vo2maxBenchmarkDistanceUnit", "km") ===
                      "yd"}>Yards</option
                  ></select
                ></label
              >
              <label
                >Time (minutes)<input
                  name="vo2maxBenchmarkMinutes"
                  type="number"
                  min="1"
                  max="1440"
                  step="0.1"
                  value={initial(
                    "vo2maxBenchmarkMinutes",
                    vo2maxBenchmarkType === "twelve_minute" ? "12" : "",
                  )}
                  required
                /></label
              >
            {/if}
          {/if}
        {/if}
        <label
          >How often have you done planned cardio during the last 4 weeks?<select
            name="cardioFrequencyBand"
            bind:value={cardioFrequencyBand}
            ><option value="none">None</option><option value="occasional"
              >Less than once per week</option
            ><option value="one_to_two">1–2 times per week</option><option
              value="three_to_four">3–4 times per week</option
            ><option value="five_plus">5 or more times per week</option></select
          ><small
            >Walking for transportation or daily steps does not count unless you
            treated it as a workout.</small
          ></label
        >
        {#if cardioFrequencyBand !== "none"}
          <label
            >How long is a typical cardio workout?<select
              name="cardioDurationBand"
              bind:value={cardioDurationBand}
              ><option value="under_15">Less than 15 minutes</option><option
                value="15_to_30">15–30 minutes</option
              ><option value="31_to_45">31–45 minutes</option><option
                value="46_to_60">46–60 minutes</option
              ><option value="over_60">More than 60 minutes</option></select
            ></label
          >
          <label
            >What does most of your cardio feel like?<select
              name="cardioTypicalEffort"
              bind:value={cardioTypicalEffort}
              ><option value="mostly_easy"
                >Mostly easy—I can speak in full sentences</option
              ><option value="easy_moderate_mix"
                >A mix of easy and moderate work</option
              ><option value="mostly_moderate"
                >Mostly moderate—I can speak in short sentences</option
              ><option value="includes_hard"
                >It regularly includes hard intervals or efforts</option
              ></select
            ></label
          >
          {#if cardioTypicalEffort === "includes_hard"}
            <label
              >How often do you currently do hard cardio?<select
                name="hardCardioFrequency"
                ><option value="less_than_weekly"
                  >Less than once per week</option
                ><option value="once_weekly">About once per week</option><option
                  value="twice_or_more">Twice or more per week</option
                ></select
              ><small
                >Hard means intervals or sustained work around RPE 7–9, when
                saying more than a few words is difficult.</small
              ></label
            >
          {:else}
            <input type="hidden" name="hardCardioFrequency" value="none" />
          {/if}
        {:else}
          <input type="hidden" name="cardioDurationBand" value="15_to_30" />
          <input type="hidden" name="cardioTypicalEffort" value="mostly_easy" />
          <input type="hidden" name="hardCardioFrequency" value="none" />
        {/if}
        {#if cardioPlanType === "running_event" || primaryCardioModality === "running" || (cardioPlanType === "vo2max" && vo2maxModality === "running")}
          <div class="field-group full-width running-baseline">
            <h3>Your recent running</h3>
            <p>
              Use your last four weeks. These answers keep the opening week
              close to what your body is already used to.
            </p>
            <div class="grid two">
              <label
                >Runs per week<input
                  name="runningSessionsPerWeek"
                  type="number"
                  min="0"
                  max="14"
                  step="1"
                  value={initial("runningSessionsPerWeek", "0")}
                  required
                /></label
              >
              <label
                >Distance unit<select name="runningDistanceUnit"
                  ><option value="mi">Miles</option><option value="km"
                    >Kilometres</option
                  ></select
                ></label
              >
              <label
                >Usual weekly distance (optional)<input
                  name="runningWeeklyDistance"
                  type="number"
                  min="0"
                  max="300"
                  step="0.1"
                  value={initial("runningWeeklyDistance", "")}
                /></label
              >
              <label
                >Usual weekly running minutes (optional)<input
                  name="runningWeeklyMinutes"
                  type="number"
                  min="0"
                  max="3000"
                  step="1"
                  value={initial("runningWeeklyMinutes", "")}
                /></label
              >
              <label
                >Longest recent run (distance, optional)<input
                  name="longestRunDistance"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={initial("longestRunDistance", "")}
                /></label
              >
              <label
                >Longest recent run (minutes, optional)<input
                  name="longestRunMinutes"
                  type="number"
                  min="0"
                  max="1440"
                  step="1"
                  value={initial("longestRunMinutes", "")}
                /></label
              >
              <label
                >How long can you run continuously at an easy effort? (minutes)<input
                  name="continuousRunMinutes"
                  type="number"
                  min="0"
                  max="1440"
                  step="1"
                  value={initial("continuousRunMinutes", "0")}
                /><small
                  >Enter 0 if you would currently use a run/walk approach.</small
                ></label
              >
              <label
                >Recent running benchmark (optional)<select
                  name="runningBenchmarkType"
                  bind:value={runningBenchmarkType}
                  ><option value="none">None / not sure</option><option
                    value="timed_distance">Timed distance effort</option
                  ><option value="twelve_minute">12-minute test</option><option
                    value="wearable_vo2max">Watch VO₂max estimate</option
                  ></select
                ></label
              >
              {#if runningBenchmarkType !== "none"}
                <label
                  >Benchmark date (optional)<input
                    name="runningBenchmarkDate"
                    type="date"
                    value={initial("runningBenchmarkDate", "")}
                  /></label
                >
                {#if runningBenchmarkType === "wearable_vo2max"}
                  <label
                    >Watch VO₂max estimate<input
                      name="runningBenchmarkVo2max"
                      type="number"
                      min="10"
                      max="100"
                      step="0.1"
                      value={initial("runningBenchmarkVo2max", "")}
                      required
                    /></label
                  >
                {:else}
                  <label
                    >Benchmark distance<input
                      name="runningBenchmarkDistance"
                      type="number"
                      min="0.1"
                      max="100"
                      step="0.01"
                      value={initial("runningBenchmarkDistance", "")}
                      required
                    /></label
                  >
                  <label
                    >Benchmark time (minutes)<input
                      name="runningBenchmarkMinutes"
                      type="number"
                      min="1"
                      max="1440"
                      step="0.1"
                      value={initial(
                        "runningBenchmarkMinutes",
                        runningBenchmarkType === "twelve_minute" ? "12" : "",
                      )}
                      required
                    /></label
                  >
                {/if}
              {/if}
            </div>
          </div>
        {/if}
        <label
          >How much cardio variety would you like?<select name="cardioVariety"
            ><option value="mostly_primary"
              >Keep almost all sessions in my main modality</option
            ><option
              value="regular_variety"
              selected={initial("cardioVariety", "regular_variety") ===
                "regular_variety"}
              >Mostly my main modality, with some variety</option
            ><option value="broad_mix"
              >Use as much variety as possible while keeping my main modality
              the majority</option
            ></select
          ><small
            >Hard or performance-specific sessions stay with your main modality
            unless it is unavailable.</small
          ></label
        >
        <label
          >Heart-rate device<select
            name="heartRateDevice"
            bind:value={heartRateDevice}
            ><option value="none">None</option><option value="smartwatch"
              >Smartwatch/fitness watch</option
            ><option value="chest_strap">Chest strap</option><option
              value="other">Other heart-rate device</option
            ></select
          ><small
            >Includes smartwatches. Talk test and session RPE remain available
            even with a device.</small
          ></label
        >
      </div>
      <fieldset>
        <legend
          >Other cardio modalities you are willing to use (optional)</legend
        >
        <div class="check-grid">
          {#each [["walking", "Walking"], ["running", "Running"], ["cycling", "Cycling"], ["rowing", "Rowing"], ["elliptical", "Elliptical"], ["swimming", "Swimming"], ["rucking", "Rucking"], ["sport", "Sport"]] as [value, label]}<label
              ><input
                name="acceptableCardioModalities"
                type="checkbox"
                {value}
                bind:group={acceptableCardioModalities}
              />
              {label}</label
            >{/each}
        </div>
      </fieldset>
      {#if cardioPlanType !== "running_event"}<label class="toggle"
          ><input
            name="avoidRunning"
            type="checkbox"
            value="yes"
            checked={initialYes("avoidRunning")}
          /> Do not prescribe running</label
        >{:else}<input type="hidden" name="avoidRunning" value="no" />{/if}

      <label class="advanced-toggle"
        ><input
          name="cardioAdvancedEnabled"
          type="checkbox"
          value="yes"
          bind:checked={cardioAdvanced}
        /> Show advanced cardio settings</label
      >
      {#if cardioAdvanced}
        <div class="advanced grid two">
          <label
            >Easy sessions per week<input
              name="currentEasySessions"
              type="number"
              min="0"
              max="14"
              bind:value={currentEasySessions}
            /><small>Easy: you can speak comfortably in full sentences.</small
            ></label
          >
          {#if (currentEasySessions ?? 0) > 0}
            <label
              >Typical easy-session minutes<input
                name="typicalEasyMinutes"
                type="number"
                min="5"
                max="600"
                value={initial("typicalEasyMinutes", "")}
              /></label
            >
          {/if}
          <label
            >Moderate sessions per week<input
              name="currentModerateSessions"
              type="number"
              min="0"
              max="14"
              bind:value={currentModerateSessions}
            /><small
              >Moderate: you can speak, but only in short sentences.</small
            ></label
          >
          {#if (currentModerateSessions ?? 0) > 0}
            <label
              >Typical moderate-session minutes<input
                name="typicalModerateMinutes"
                type="number"
                min="5"
                max="600"
                value={initial("typicalModerateMinutes", "")}
              /></label
            >
          {/if}
          <label
            >Hard sessions per week<input
              name="currentHardSessions"
              type="number"
              min="0"
              max="7"
              bind:value={currentHardSessions}
            /><small
              >Hard: RPE 7–9 intervals or sustained work where talking is
              difficult.</small
            ></label
          >
          {#if (currentHardSessions ?? 0) > 0}
            <label
              >Typical hard-session minutes<input
                name="typicalHardMinutes"
                type="number"
                min="5"
                max="300"
                value={initial("typicalHardMinutes", "")}
              /></label
            >
          {/if}
          <label
            >Longest cardio session in the last month (minutes)<input
              name="longestRecentSessionMinutes"
              type="number"
              min="0"
              max="600"
              value={initial("longestRecentSessionMinutes", "")}
            /><small
              >Use this only when you know the number. Otherwise the ranges
              above are enough.</small
            ></label
          >
          <label
            >Recent total cardio minutes/week<input
              name="cardioWeeklyMinutes"
              type="number"
              min="0"
              max="3000"
              value={initial("cardioWeeklyMinutes", "")}
            /><small
              >Optional. Enter this only if you already track your weekly total;
              otherwise, leave it blank.</small
            ></label
          >
          <label
            >Maximum hard sessions/week<input
              name="maxHardSessions"
              type="number"
              min="0"
              max="3"
              value={initial("maxHardSessions", "")}
            /><small
              >Leave blank to let the program choose. Most lifting-focused plans
              begin with no more than one hard cardio session per week.</small
            ></label
          >
          {#if heartRateDevice !== "none"}
            <label
              >Known measured maximum heart rate (optional)<input
                name="knownMaxHeartRate"
                type="number"
                min="80"
                max="240"
                value={initial("knownMaxHeartRate", "")}
              /></label
            >
            <label
              >Resting heart rate (optional)<input
                name="restingHeartRate"
                type="number"
                min="25"
                max="150"
                value={initial("restingHeartRate", "")}
              /></label
            >
          {/if}
          <label
            >Intensity method<select name="cardioIntensityMethod"
              ><option value="talk_test_rpe"
                >Talk test and session RPE (default)</option
              ><option value="heart_rate_reserve">Heart-rate reserve</option
              ><option value="pace_power">Pace or power</option></select
            ></label
          >
        </div>
      {/if}
    </section>

    <section
      class:hidden={step !== 8}
      data-questionnaire-step="8"
      aria-labelledby="review-heading"
    >
      <h2 id="review-heading">Review and program behavior</h2>
      <div class="summary-grid">
        <div>
          <strong>Primary goal</strong><span
            >{primaryGoal.replace("_", " ")}</span
          >
        </div>
        <div>
          <strong>Lifting schedule</strong><span>{liftingDays} days/week</span>
        </div>
        <div>
          <strong>Planning</strong><span
            >{planningStyle === "calendar_days"
              ? "Recommended days of the week"
              : "Flexible order with a suggested rhythm"}</span
          >
        </div>
        <div>
          <strong>Units</strong><span
            >{units === "lb" ? "Pounds" : "Kilograms"}</span
          >
        </div>
        <div><strong>Time zone</strong><span>{timeZone}</span></div>
      </div>
      <label
        >How may the program use AMRAP sets?<select name="amrapPolicy"
          ><option value="none">Do not program AMRAP sets</option><option
            value="controlled">Controlled AMRAPs—stop with 1 rep left</option
          ><option value="max_effort"
            >True max-effort AMRAPs—may reach RPE 10 when specifically
            programmed</option
          ></select
        ><small
          >AMRAP means “as many reps as possible.” This permission does not make
          every set an AMRAP; it tells the program which stopping point it may
          use when an AMRAP has a clear purpose.</small
        ></label
      >

      <label class="advanced-toggle"
        ><input
          name="adaptationAdvancedEnabled"
          type="checkbox"
          value="yes"
          bind:checked={adaptationAdvanced}
        /> Show advanced adaptation defaults</label
      >
      {#if adaptationAdvanced}
        <div class="advanced grid two">
          <label
            >Weekly changes<select name="applyChanges"
              ><option value="automatic"
                >Apply small changes automatically (default)</option
              ><option value="ask_first">Ask before applying changes</option
              ></select
            ></label
          >
          <label
            >Missed-workout default<select name="missedWorkoutPolicy"
              ><option value="preserve_weekdays_drop_low_priority"
                >Keep the planned days and drop lower-priority work (default)</option
              ><option value="reflow_week">Reflow the remaining week</option
              ></select
            ></label
          >
          <label
            >Session-duration default<select name="adaptationDurationPolicy"
              ><option value="allow_exceed"
                >Allow the session to exceed the target (default)</option
              ><option value="trim_low_priority"
                >Trim lower-priority work</option
              ><option value="offer_shorter">Offer a shorter session</option
              ></select
            ></label
          >
        </div>
      {/if}

      <p class="help">
        Exercise substitutions always default to: recommend a valid replacement,
        explain the trade-off, and ask before changing the plan.
      </p>

      <div class="disclaimer">
        <h3>Training disclaimer</h3>
        <p>
          This software provides general exercise programming, not medical
          diagnosis, treatment, rehabilitation, or individualized medical
          advice. Do not use a movement you cannot perform safely. Seek
          appropriate professional guidance for pain, injury, pregnancy,
          cardiovascular concerns, or clinician-imposed restrictions.
        </p>
        <label class="toggle"
          ><input
            name="disclaimerAccepted"
            type="checkbox"
            value="yes"
            required
            checked={initialYes("disclaimerAccepted")}
          /> I understand and want the app to generate a general training program.</label
        >
      </div>
    </section>

    <nav class="form-nav" aria-label="Questionnaire navigation">
      <button
        type="button"
        class="secondary"
        onclick={() => void moveStep(-1)}
        disabled={stepPosition === 1 || validatingStep}>Back</button
      >
      <div class="form-actions">
        {#if stepPosition < visibleSteps.length}
          <button
            type="button"
            onclick={() => void moveStep(1)}
            disabled={validatingStep}
            >{validatingStep ? "Checking this page…" : "Continue"}</button
          >
          {#if data.editingProgram && data.storageReady}
            <button
              type="button"
              class="retry-build"
              disabled={validatingStep || clientError !== undefined}
              onclick={() => void saveAndRebuildFromCurrentStep()}
              >Save changes and rebuild program</button
            >
          {:else if submitted && data.storageReady}
            <button type="submit" class="retry-build"
              >Save answers and build program</button
            >
          {/if}
        {:else}
          <button type="submit" disabled={!data.storageReady || validatingStep}
            >{data.storageReady
              ? data.editingProgram
                ? "Save changes and rebuild program"
                : "Create my program"
              : "Apply Supabase migration before saving"}</button
          >
        {/if}
      </div>
    </nav>
  </form>
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--color-canvas);
    color: var(--color-text);
    font-family: var(--font-sans);
  }
  main {
    width: min(var(--content-width), calc(100% - 2rem));
    margin: 0 auto;
    padding: 2rem 0 5rem;
  }
  h2 {
    margin-top: 0;
  }
  h3 {
    margin-top: 1.8rem;
  }
  form > section {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: clamp(1rem, 3vw, 2rem);
    box-shadow: var(--shadow-card);
  }
  .hidden {
    display: none;
  }
  .grid {
    display: grid;
    gap: 1rem;
  }
  .grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .grid.six {
    grid-template-columns: repeat(6, minmax(90px, 1fr));
  }
  .compact {
    gap: 0.65rem;
  }
  label {
    display: grid;
    gap: 0.4rem;
    font-weight: 650;
  }
  label small,
  small,
  .help {
    color: #5d687c;
    font-weight: 400;
    line-height: 1.45;
  }
  label > small,
  fieldset > small {
    border-left: 3px solid transparent;
    border-radius: 0.25rem;
    padding: 0.55rem 0.65rem;
  }
  :global(label.question-active) small,
  :global(fieldset.question-active > small) {
    background: #f3f6fc;
    border-left-color: #345db2;
    color: #111827;
    font-weight: 700;
  }
  :global(label.question-active),
  :global(fieldset.question-active > legend) {
    color: #111827;
  }
  input,
  select {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #aeb7c7;
    border-radius: 0.55rem;
    padding: 0.7rem 0.75rem;
    background: white;
    color: inherit;
    font: inherit;
  }
  input:focus,
  select:focus {
    outline: 3px solid rgba(52, 93, 178, 0.18);
    border-color: #345db2;
  }
  fieldset {
    border: 1px solid #d9dee7;
    border-radius: 0.75rem;
    padding: 1rem;
    margin: 1.2rem 0;
  }
  .program-icon-picker {
    margin-top: 1rem;
  }
  .program-icon-options {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(4.5rem, 1fr));
  }
  .program-icon-options label {
    background: #f6f8fc;
    border: 2px solid #c8d0dc;
    border-radius: 0.65rem;
    cursor: pointer;
    display: block;
    padding: 0.45rem;
  }
  .program-icon-options label.selected {
    border-color: #345db2;
    box-shadow: 0 0 0 3px rgb(52 93 178 / 14%);
  }
  .program-icon-options label.achievement {
    border-color: #9d7927;
    box-shadow: inset 0 1px rgb(255 229 153 / 14%);
  }
  .program-icon-options label.achievement.selected {
    border-color: #f0bd42;
    box-shadow: 0 0 0 3px rgb(240 189 66 / 16%);
  }
  .program-icon-options input {
    height: 1px;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    width: 1px;
  }
  .program-icon-preview {
    aspect-ratio: 1;
    display: block;
    width: 100%;
  }
  .icon-name {
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
  legend {
    font-weight: 750;
    padding: 0 0.35rem;
  }
  .check-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.7rem 1rem;
  }
  .check-grid label,
  .toggle,
  .advanced-toggle {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-weight: 550;
  }
  .check-grid input,
  .toggle input,
  .advanced-toggle input {
    width: auto;
    flex: 0 0 auto;
  }
  .toggle,
  .advanced-toggle {
    margin: 1rem 0;
    padding: 0.65rem 0;
  }
  .advanced-toggle {
    color: #294d98;
  }
  .superset-choice {
    align-items: flex-start;
    background: #f7f9fc;
    border: 1px solid #d9dee7;
    border-radius: 0.7rem;
    padding: 0.8rem;
  }
  .superset-choice span {
    display: grid;
    gap: 0.25rem;
  }
  .superset-choice small {
    color: #5d687c;
    font-weight: 400;
    line-height: 1.4;
  }
  .inset,
  .advanced {
    padding: 1rem;
    border-radius: 0.75rem;
    background: #f6f8fc;
    border: 1px solid #dce3ef;
    margin: 1rem 0;
  }
  .notice {
    padding: 0.9rem 1rem;
    border-left: 4px solid #4e70b9;
    background: #eef3fc;
    border-radius: 0.3rem;
    color: #34415a;
  }
  .error {
    background: #fff0f0;
    color: #7f2020;
    border: 1px solid #e4aaaa;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-bottom: 1rem;
    display: grid;
    gap: 0.3rem;
  }
  .migration-warning {
    background: #fff7df;
    color: #684d08;
    border: 1px solid #dfc36e;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-bottom: 1rem;
    display: grid;
    gap: 0.4rem;
  }
  .migration-warning code {
    font-size: 0.9em;
  }
  .split-detail {
    padding: 0.85rem 1rem;
    background: #eef3fc;
    border-radius: 0.6rem;
    color: #34415a;
    line-height: 1.5;
  }
  .observation-card {
    border: 1px solid #d9dee7;
    border-radius: 0.75rem;
    padding: 1rem;
    margin: 1rem 0;
  }
  .observation-card h4 {
    margin: 0 0 0.5rem;
  }
  details {
    margin: 1rem 0;
  }
  summary {
    cursor: pointer;
    font-weight: 700;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.8rem;
    margin: 1rem 0 1.5rem;
  }
  .summary-grid div {
    background: #f3f6fb;
    border-radius: 0.6rem;
    padding: 0.8rem;
    display: grid;
    gap: 0.25rem;
  }
  .summary-grid span {
    color: #536077;
    text-transform: capitalize;
  }
  .disclaimer {
    border: 2px solid #c5cddd;
    border-radius: 0.8rem;
    padding: 1rem;
    margin-top: 1.5rem;
  }
  .disclaimer h3 {
    margin-top: 0;
  }
  .form-nav {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1rem;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .retry-build {
    background: var(--color-positive);
  }
  button {
    border: 0;
    border-radius: 0.65rem;
    padding: 0.8rem 1.2rem;
    background: #3159ad;
    color: white;
    font: inherit;
    font-weight: 750;
    cursor: pointer;
  }
  button.secondary {
    background: #dfe5f0;
    color: #2c3b58;
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .field-group {
    display: grid;
    gap: 0.4rem;
  }
  .full-width {
    grid-column: 1 / -1;
  }
  .field-note,
  .running-baseline {
    border: 1px solid #314a63;
    border-radius: 0.75rem;
    padding: 1rem;
  }
  .field-note {
    background: rgb(255 200 87 / 8%);
    color: #ffe6ad;
  }
  .running-baseline h3,
  .running-baseline p {
    margin-top: 0;
  }
  .label-with-info {
    align-items: center;
    display: flex;
    gap: 0.55rem;
    justify-content: space-between;
  }
  .label-with-info label {
    display: block;
  }
  .questionnaire-page label small,
  .questionnaire-page small,
  .questionnaire-page .help,
  .questionnaire-page .superset-choice small,
  .questionnaire-page .summary-grid span {
    color: var(--color-text-muted);
  }
  .questionnaire-page input,
  .questionnaire-page select {
    background: #07101e;
    border-color: #3a526e;
    color: var(--color-text);
  }
  .questionnaire-page input:focus,
  .questionnaire-page select:focus {
    border-color: var(--color-primary);
    outline-color: rgb(78 219 255 / 18%);
  }
  .questionnaire-page fieldset,
  .questionnaire-page .observation-card,
  .questionnaire-page .disclaimer {
    border-color: #314a63;
  }
  .questionnaire-page .inset,
  .questionnaire-page .advanced,
  .questionnaire-page .superset-choice,
  .questionnaire-page .summary-grid div {
    background: rgb(7 15 27 / 68%);
    border-color: #314a63;
  }
  .questionnaire-page .program-icon-options label {
    background: rgb(7 15 27 / 68%);
    border-color: #38536e;
  }
  .questionnaire-page .program-icon-options label.selected {
    background: rgb(78 219 255 / 9%);
    border-color: var(--color-primary);
    box-shadow: 0 0 16px rgb(78 219 255 / 15%);
  }
  .questionnaire-page .program-icon-options label.achievement {
    border-color: #9d7927;
  }
  .questionnaire-page .program-icon-options label.achievement.selected {
    background: rgb(255 200 87 / 9%);
    border-color: #f0bd42;
    box-shadow: 0 0 16px rgb(255 200 87 / 15%);
  }
  :global(html[data-theme="cute"])
    .questionnaire-page
    .program-icon-options
    label {
    background: #ffe2ed;
    border-color: #5a1a36;
    overflow: hidden;
    padding: 0;
  }
  :global(html[data-theme="cute"])
    .questionnaire-page
    .program-icon-options
    label.selected {
    background: #fff;
    border-color: #a20e52;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 5px #68183d;
  }
  :global(html[data-theme="cute"])
    .questionnaire-page
    .program-icon-options
    label.achievement {
    background: #fff3d1;
    border-color: #946000;
  }
  :global(html[data-theme="cute"])
    .questionnaire-page
    .program-icon-options
    label.achievement.selected {
    background: #fff;
    border-color: #946000;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 5px #68183d;
  }
  :global(html[data-theme="cute"]) .questionnaire-page .field-note,
  :global(html[data-theme="cute"]) .questionnaire-page .migration-warning {
    background: #fff3d1;
    border-color: #946000;
    color: #674300;
  }
  :global(html[data-theme="cute"]) .questionnaire-page .notice,
  :global(html[data-theme="cute"]) .questionnaire-page .split-detail {
    background: #ffe2ed;
    border-color: #a20e52;
    color: #321523;
  }
  :global(html[data-theme="cute"] .questionnaire-page .question-active > small),
  :global(
    html[data-theme="cute"] .questionnaire-page .question-active > .help
  ) {
    background: #ffe2ed;
    border-left-color: #a20e52;
    color: #321523;
  }
  :global(html[data-theme="cute"] .questionnaire-page input:focus),
  :global(html[data-theme="cute"] .questionnaire-page select:focus) {
    border-color: #68183d;
    outline-color: #68183d;
  }
  .questionnaire-page .advanced-toggle {
    color: var(--color-primary);
  }
  .questionnaire-page .notice,
  .questionnaire-page .split-detail {
    background: rgb(78 219 255 / 9%);
    border-color: var(--color-primary);
    color: #d5e5f5;
  }
  .questionnaire-page .error {
    background: rgb(255 93 108 / 10%);
    border-color: rgb(255 93 108 / 60%);
    color: #ffd8dc;
  }
  .questionnaire-page .migration-warning {
    background: rgb(255 200 87 / 10%);
    border-color: rgb(255 200 87 / 55%);
    color: #ffe6ad;
  }
  :global(.questionnaire-page label.question-active) small,
  :global(.questionnaire-page fieldset.question-active > small),
  :global(.questionnaire-page .field-group.question-active > small) {
    background: rgb(78 219 255 / 11%);
    border-left-color: var(--color-primary);
    color: var(--color-text);
    font-weight: 700;
  }
  :global(.questionnaire-page label.question-active),
  :global(.questionnaire-page fieldset.question-active > legend),
  :global(.questionnaire-page .field-group.question-active label) {
    color: var(--color-text);
    font-weight: 800;
  }
  .questionnaire-page button.secondary {
    background: #152a43;
    color: var(--color-text);
  }
  @media (max-width: 850px) {
    .grid.six {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 650px) {
    .grid.two,
    .grid.three {
      grid-template-columns: 1fr;
    }
    .program-icon-options {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    input,
    select {
      font-size: 16px;
    }
  }
</style>
