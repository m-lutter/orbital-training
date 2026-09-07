<script lang="ts">
  import { applyAction, deserialize, enhance } from "$app/forms";
  import { afterNavigate, beforeNavigate } from "$app/navigation";
  import BarbellPlateDisplay from "$lib/ui/BarbellPlateDisplay.svelte";
  import WorkoutTimers from "$lib/components/workout/WorkoutTimers.svelte";
  import MovementCheckIn from "$lib/components/workout/MovementCheckIn.svelte";
  import CardioLogger from "$lib/components/workout/CardioLogger.svelte";
  import ShorterWorkoutOption from "$lib/components/workout/ShorterWorkoutOption.svelte";
  import type { WearableDay } from "$lib/fitness/contracts";
  import { importedStepsMeetingGoal } from "$lib/fitness/movement";
  import QuoteCard from "$lib/ui/QuoteCard.svelte";
  import {
    cuteWorkoutQuotePlacement,
    freshAppQuote,
    freshCuteQuote,
    type AppQuote,
  } from "$lib/ui/quotes";
  import {
    MISS_REASON_OPTIONS,
    autosaveWorkoutFormData,
    elapsedTimerSeconds,
    isSetEntrySufficient,
    movementProgressState,
    needsWorkoutMissReason,
    nextWorkoutAutosaveDelay,
    prescribedRepTarget,
    remainingTimerSeconds,
    suspiciousRirEstimate,
    shouldAutosaveWorkout,
    shouldAutoStartWorkoutTimer,
    shouldSendAutosaveBeacon,
    verbalEffortForTargetRir,
    workoutActionAvailability,
    workoutExplicitRetry,
    workoutFormFingerprint,
    workoutRequestsPermanentSubstitution,
    WORKOUT_AUTOSAVE_MIN_INTERVAL_MS,
    WORKOUT_AUTOSAVE_REQUEST_TIMEOUT_MS,
    WORKOUT_EXPLICIT_SAVE_REQUEST_TIMEOUT_MS,
    type LoadRecommendation,
    type LoggedCardio,
    type WorkoutFinishIntent,
  } from "$lib/workouts";
  import { onMount, untrack } from "svelte";
  import type { PageData } from "./$types";

  let {
    data,
    form,
  }: {
    data: PageData;
    form: { message?: string } | null;
  } = $props();

  type ExerciseView = (typeof data.exerciseViews)[number];
  type SetBlockView = (typeof data.setBlockViews)[number];
  type WearablePageData = PageData & { wearableDay?: WearableDay };
  let orbitalQuote = $state<AppQuote>();
  let cuteQuote = $state<AppQuote>();
  let wearableDay = $derived((data as WearablePageData).wearableDay);
  let importedMovementSteps = $derived(
    importedStepsMeetingGoal(wearableDay, data.movementTarget ?? {}),
  );

  function initialSetValues<T>(
    value: (view: ExerciseView, index: number) => T,
  ): Record<string, T> {
    return Object.fromEntries(
      data.exerciseViews.flatMap((view) =>
        Array.from({ length: view.prescription.sets }, (_, index) => [
          setKey(view.prescription.id, index),
          value(view, index),
        ]),
      ),
    );
  }

  let selectedExercises = $state<Record<string, string>>(
    untrack(() =>
      Object.fromEntries(
        data.exerciseViews.map((view) => [
          view.prescription.id,
          view.logged?.exerciseId ?? view.prescription.exerciseId,
        ]),
      ),
    ),
  );
  let substitutionScopes = $state<Record<string, "today" | "permanent">>(
    untrack(() =>
      Object.fromEntries(
        data.exerciseViews.map((view) => [
          view.prescription.id,
          view.logged?.performanceSeriesId.endsWith(":permanent-substitution")
            ? "permanent"
            : "today",
        ]),
      ),
    ),
  );
  let completedSets = $state<Record<string, boolean>>(
    untrack(() =>
      Object.fromEntries(
        data.exerciseViews.flatMap((view) =>
          Array.from({ length: view.prescription.sets }, (_, index) => [
            setKey(view.prescription.id, index),
            loggedSet(view.logged, index)?.completed ?? false,
          ]),
        ),
      ),
    ),
  );
  let touchedSets = $state<Record<string, boolean>>(
    untrack(() =>
      initialSetValues((view, index) => {
        const saved = loggedSet(view.logged, index);
        return (
          saved !== undefined &&
          (saved.completed ||
            saved.reps !== undefined ||
            saved.load !== undefined ||
            saved.rir !== undefined ||
            saved.rpe !== undefined ||
            saved.difficulty !== undefined ||
            saved.techniqueOkay !== undefined ||
            saved.pain !== undefined)
        );
      }),
    ),
  );
  let setLoads = $state<Record<string, number | undefined>>(
    untrack(() =>
      initialSetValues(
        (view, index) =>
          loggedSet(view.logged, index)?.load ??
          recommendation(view).load ??
          (view.addedBodyweightLoads[
            selectedExercises[view.prescription.id] ??
              view.prescription.exerciseId
          ]
            ? 0
            : undefined),
      ),
    ),
  );
  let setReps = $state<Record<string, number | undefined>>(
    untrack(() =>
      initialSetValues(
        (view, index) =>
          loggedSet(view.logged, index)?.reps ??
          prescribedRepTarget(view.prescription),
      ),
    ),
  );
  let setRirs = $state<Record<string, number | undefined>>(
    untrack(() =>
      initialSetValues(
        (view, index) =>
          loggedSet(view.logged, index)?.rir ?? effortTarget(view),
      ),
    ),
  );
  let setRpes = $state<Record<string, number | undefined>>(
    untrack(() =>
      initialSetValues(
        (view, index) =>
          loggedSet(view.logged, index)?.rpe ?? 10 - effortTarget(view),
      ),
    ),
  );
  let setDifficulties = $state<Record<string, string>>(
    untrack(() =>
      initialSetValues(
        (view, index) =>
          loggedSet(view.logged, index)?.difficulty ??
          verbalEffortForTargetRir(effortTarget(view)),
      ),
    ),
  );
  let feedbackSaved = $state<Record<string, boolean>>(
    untrack(() =>
      Object.fromEntries(
        data.exerciseViews.map((view) => [
          view.prescription.id,
          view.logged?.sets.some(
            (set) =>
              set.completed &&
              (set.techniqueOkay !== undefined || set.pain !== undefined),
          ) ?? false,
        ]),
      ),
    ),
  );
  let exerciseOpen = $state<Record<string, boolean>>(
    untrack(() => {
      const currentIndex = data.exerciseViews.findIndex(
        (view) => !hasSavedFeedback(view),
      );
      return Object.fromEntries(
        data.exerciseViews.map((view, index) => [
          view.prescription.id,
          index === currentIndex,
        ]),
      );
    }),
  );
  let blockOpen = $state<Record<string, boolean>>(
    untrack(() => {
      const currentIndex = data.setBlockViews.findIndex((blockView) =>
        blockView.exercises.some(({ view }) => !hasSavedFeedback(view)),
      );
      return Object.fromEntries(
        data.setBlockViews.map((blockView, index) => [
          blockView.block.id,
          index === currentIndex,
        ]),
      );
    }),
  );
  let unpairedBlocks = $state<Record<string, boolean>>(
    untrack(() =>
      Object.fromEntries(
        data.setBlockViews.map((blockView) => [
          blockView.block.id,
          blockView.exercises.some(
            ({ view }) => view.logged?.setBlockMode === "unpaired",
          ),
        ]),
      ),
    ),
  );
  let feedbackOpen = $state<Record<string, boolean>>({});
  let painAnswers = $state<Record<string, "no" | "yes">>(
    untrack(() =>
      Object.fromEntries(
        data.exerciseViews.map((view) => [
          view.prescription.id,
          view.logged?.painEvent !== undefined ||
          view.logged?.sets.some((set) => set.pain === true)
            ? "yes"
            : "no",
        ]),
      ),
    ),
  );
  let skipHelpOpen = $state<Record<string, boolean>>({});
  let rirWarnings = $state<Record<string, string>>({});
  let workoutSeconds = $state(0);
  let workoutRunning = $state(false);
  let workoutBaseSeconds = 0;
  let workoutStartedAtMs: number | undefined;
  let restSeconds = $state(0);
  let restRunning = $state(false);
  let restEndsAtMs: number | undefined;
  let cardioOnly = $derived(
    data.session.exercises.length === 0 && data.session.cardio !== undefined,
  );
  let durationMinutes = $state<number | undefined>(
    untrack(() => data.existing?.durationMinutes),
  );
  let durationAuto = $state(
    untrack(() => data.existing?.durationMinutes === undefined),
  );
  let cardioCompletedMinutes = $state<number | undefined>(
    untrack(
      () =>
        data.existing?.cardioLog?.completedMinutes ??
        data.session.cardio?.minutes,
    ),
  );
  let cardioModality = $state<LoggedCardio["modality"]>(
    untrack(
      () => data.existing?.cardioLog?.modality ?? data.session.cardio?.modality,
    ),
  );
  let cardioMinutesAuto = $state(
    untrack(() => data.existing?.cardioLog?.completedMinutes === undefined),
  );
  let cardioSessionRpe = $state<number | undefined>(
    untrack(
      () =>
        data.existing?.cardioLog?.sessionRpe ??
        (data.session.cardio === undefined
          ? undefined
          : pointTarget(
              data.session.cardio.sessionRpe.min,
              data.session.cardio.sessionRpe.max,
            )),
    ),
  );
  let cardioDistance = $state<number | undefined>(
    untrack(() => data.existing?.cardioLog?.distance),
  );
  let cardioSteps = $state<number | undefined>(
    untrack(() => data.existing?.cardioLog?.steps),
  );
  let cardioMovingMinutes = $state<number | undefined>(
    untrack(
      () =>
        data.existing?.cardioLog?.movingMinutes ??
        data.existing?.cardioLog?.completedMinutes ??
        data.session.cardio?.minutes,
    ),
  );
  let cardioCompletedIntervals = $state<number | undefined>(
    untrack(
      () =>
        data.existing?.cardioLog?.completedIntervals ??
        data.session.cardio?.intervals?.repeats,
    ),
  );
  let cardioAverageHeartRate = $state<number | undefined>(
    untrack(() => data.existing?.cardioLog?.averageHeartRate),
  );
  let cardioMaxHeartRate = $state<number | undefined>(
    untrack(() => data.existing?.cardioLog?.maxHeartRate),
  );
  let cardioElevationGain = $state<number | undefined>(
    untrack(() => data.existing?.cardioLog?.elevationGain),
  );
  let cardioSurface = $state<NonNullable<LoggedCardio["surface"]> | "">(
    untrack(
      () =>
        (data.existing?.cardioLog?.surface ?? data.cardioTracking.surface) as
          NonNullable<LoggedCardio["surface"]> | "",
    ),
  );
  let cardioSource = $state(
    untrack(() => data.existing?.cardioLog?.source ?? "manual"),
  );
  let movementAnswer = $state<"" | "yes" | "no" | "untracked">(
    untrack(() =>
      importedMovementSteps !== undefined
        ? "yes"
        : data.existing?.movementLog === undefined
          ? ""
          : data.existing.movementLog.met === true
            ? "yes"
            : data.existing.movementLog.met === false
              ? "no"
              : "untracked",
    ),
  );
  let movementActual = $state<number | undefined>(
    untrack(
      () =>
        importedMovementSteps ??
        data.existing?.movementLog?.actualSteps ??
        data.existing?.movementLog?.actualWalkingMinutes,
    ),
  );
  let movementCheckInOpen = $state(
    untrack(
      () => data.requiresMovementCheckIn && importedMovementSteps === undefined,
    ),
  );
  $effect(() => {
    // The root foreground sync invalidates page data after it completes. If
    // that happens after this workout rendered, immediately adopt a newly
    // qualifying previous-day import and remove the redundant prompt.
    if (importedMovementSteps === undefined) return;
    movementAnswer = "yes";
    movementActual = importedMovementSteps;
    movementCheckInOpen = false;
  });
  // svelte-ignore state_referenced_locally -- action data seeds this form instance.
  let workoutError = $state<string | undefined>(form?.message);
  let finishIntent = $state<WorkoutFinishIntent>("save");
  let showMissReason = $state(false);
  // svelte-ignore state_referenced_locally -- the saved log seeds this form instance.
  let missReason = $state(data.existing?.missReason ?? "");
  let workoutForm = $state<HTMLFormElement>();
  let saveState = $state<"dirty" | "saving" | "saved">(
    untrack(() => (data.existing === undefined ? "dirty" : "saved")),
  );
  // Visiting a workout must not create an empty in-progress log. This becomes
  // true only after the user changes a field or explicitly submits the form.
  let hasUserChanges = false;
  let editRevision = 0;
  let autosaveTimer: number | undefined;
  let autosaveInFlight = $state(false);
  let explicitSaveInFlight = $state(false);
  let activeAutosave: Promise<void> | undefined;
  let activeSaveRevision: number | undefined;
  let beaconedRevision = -1;
  let lastServerFingerprint: string | undefined;
  let lastAutosaveStartedAt = 0;
  let expectedRevision = $state(untrack(() => data.expectedRevision));
  let actionAvailability = $derived(
    workoutActionAvailability({
      saveState,
      explicitSaveInFlight,
    }),
  );

  afterNavigate(() => {
    orbitalQuote = freshAppQuote("workout");
    cuteQuote = freshCuteQuote(
      cuteWorkoutQuotePlacement({
        hasStrength: data.session.exercises.length > 0,
        hasCardio: data.session.cardio !== undefined,
      }),
    );
  });

  $effect(() => {
    if (
      !cardioOnly &&
      data.exerciseViews.length > 0 &&
      data.exerciseViews.every(allSetsDone) &&
      durationAuto
    ) {
      durationMinutes = Math.ceil(workoutSeconds / 60);
    }
  });

  onMount(() => {
    const update = () => updateTimers();
    const timer = window.setInterval(update, 1000);
    const visibilityChanged = () => {
      update();
      if (document.visibilityState === "hidden")
        void autosaveProgress("background");
    };
    const pageHidden = () => void autosaveProgress("leaving");
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHidden);
    return () => {
      window.clearInterval(timer);
      if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHidden);
    };
  });

  beforeNavigate(() => {
    void autosaveProgress("leaving");
  });

  function titleCase(value: string): string {
    return value
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function pointTarget(min: number, max: number): number {
    return Math.round(((min + max) / 2) * 2) / 2;
  }

  function setIndexes(count: number): number[] {
    return [...Array(count).keys()];
  }

  function setKey(prescriptionId: string, index: number): string {
    return `${prescriptionId}.${index + 1}`;
  }

  function loggedSet(logged: ExerciseView["logged"], index: number) {
    return logged?.sets.find((set) => set.setNumber === index + 1);
  }

  function hasSavedFeedback(view: ExerciseView): boolean {
    return (
      view.logged?.sets.some(
        (set) =>
          set.completed &&
          (set.techniqueOkay !== undefined || set.pain !== undefined),
      ) ?? false
    );
  }

  function selectedExercise(view: ExerciseView): string {
    return (
      selectedExercises[view.prescription.id] ?? view.prescription.exerciseId
    );
  }

  function exerciseChoiceChanged(view: ExerciseView): void {
    for (const index of setIndexes(view.prescription.sets)) {
      setLoads[setKey(view.prescription.id, index)] =
        loggedSet(view.logged, index)?.load ?? recommendation(view).load;
    }
    if (selectedExercise(view) === view.prescription.exerciseId) return;
    const blockView = blockForPrescription(view.prescription.id);
    if (blockView?.block.type === "paired_superset")
      unpairedBlocks[blockView.block.id] = true;
  }

  function recommendation(view: ExerciseView): LoadRecommendation {
    return (
      view.recommendations[selectedExercise(view)] ??
      view.recommendations[view.prescription.exerciseId]
    );
  }

  function addedToBodyweight(view: ExerciseView): boolean {
    return view.addedBodyweightLoads[selectedExercise(view)] === true;
  }

  function weightLabel(view: ExerciseView): string {
    return addedToBodyweight(view)
      ? `Added weight (${data.units})`
      : `Weight (${data.units})`;
  }

  function plateDisplayLoad(view: ExerciseView): number | undefined {
    const index = summarySetIndex(view);
    return (
      setLoads[setKey(view.prescription.id, index)] ?? recommendation(view).load
    );
  }

  function summarySetIndex(view: ExerciseView): number {
    const indexes = setIndexes(view.prescription.sets);
    const firstIncomplete = indexes.find(
      (index) => !completedSets[setKey(view.prescription.id, index)],
    );
    if (firstIncomplete !== undefined) return firstIncomplete;
    return indexes.reduce((best, index) => {
      const key = setKey(view.prescription.id, index);
      const volume = (setLoads[key] ?? 0) * (setReps[key] ?? 0);
      const bestKey = setKey(view.prescription.id, best);
      const bestVolume = (setLoads[bestKey] ?? 0) * (setReps[bestKey] ?? 0);
      return volume > bestVolume ? index : best;
    }, 0);
  }

  function compactLoad(view: ExerciseView): string {
    const load = plateDisplayLoad(view);
    if (addedToBodyweight(view))
      return load === undefined || load <= 0
        ? "Bodyweight"
        : `+${load}${data.units}`;
    if (load === undefined) return "";
    return `${load}${data.units}`;
  }

  function compactPrescription(view: ExerciseView): string {
    const index = summarySetIndex(view);
    const key = setKey(view.prescription.id, index);
    const load = compactLoad(view);
    const reps = setReps[key] ?? prescribedRepTarget(view.prescription);
    return [
      load,
      `${view.prescription.sets} × ${reps}`,
      effortPrescription(view),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function selectedReplacementTradeoff(view: ExerciseView): string | undefined {
    const selected = selectedExercise(view);
    if (selected === view.prescription.exerciseId) return undefined;
    const choice = view.prescription.alternativeChoices.find(
      (alternative) => alternative.exerciseId === selected,
    );
    if (choice === undefined) return undefined;
    return `This keeps the same training purpose, but ${choice.name} will use its own starting weight and progression history.`;
  }

  function effortTarget(view: ExerciseView): number {
    return pointTarget(
      view.prescription.targetRir.min,
      view.prescription.targetRir.max,
    );
  }

  function effortRange(view: ExerciseView): string {
    if (data.effortMode === "rpe") {
      const minimum = 10 - view.prescription.targetRir.max;
      const maximum = 10 - view.prescription.targetRir.min;
      return minimum === maximum ? String(minimum) : `${minimum}–${maximum}`;
    }
    const { min, max } = view.prescription.targetRir;
    return min === max ? String(min) : `${min}–${max}`;
  }

  function verbalTarget(view: ExerciseView): string {
    return verbalEffortForTargetRir(effortTarget(view));
  }

  function effortPrescription(view: ExerciseView): string {
    if (data.effortMode === "rpe") return `RPE ${effortRange(view)}`;
    if (data.effortMode === "verbal") return `${verbalTarget(view)} effort`;
    return `${effortRange(view)} RIR`;
  }

  function allSetsDone(view: ExerciseView): boolean {
    return setIndexes(view.prescription.sets).every(
      (index) => completedSets[setKey(view.prescription.id, index)] === true,
    );
  }

  function setEntrySufficient(view: ExerciseView, index: number): boolean {
    return isSetEntrySufficient(setEntry(view, index), data.effortMode);
  }

  function setEntry(view: ExerciseView, index: number) {
    const key = setKey(view.prescription.id, index);
    return {
      completed: completedSets[key] === true,
      reps: setReps[key],
      rir: setRirs[key],
      rpe: setRpes[key],
      difficulty: setDifficulties[key],
    };
  }

  function allSetEntriesSufficient(view: ExerciseView): boolean {
    return setIndexes(view.prescription.sets).every((index) =>
      setEntrySufficient(view, index),
    );
  }

  function movementProgress(
    view: ExerciseView,
  ): "not-started" | "partial" | "complete" {
    return movementProgressState(
      setIndexes(view.prescription.sets).map((index) => setEntry(view, index)),
      data.effortMode,
      feedbackSaved[view.prescription.id] === true,
    );
  }

  function blockProgress(
    blockView: SetBlockView,
  ): "not-started" | "partial" | "complete" {
    const progress = blockView.exercises.map(({ view }) =>
      movementProgress(view),
    );
    if (progress.every((value) => value === "complete")) return "complete";
    if (progress.some((value) => value !== "not-started")) return "partial";
    return "not-started";
  }

  function showFeedback(view: ExerciseView): boolean {
    return (
      allSetsDone(view) &&
      (!feedbackSaved[view.prescription.id] ||
        feedbackOpen[view.prescription.id] === true)
    );
  }

  function blockForPrescription(id: string): SetBlockView | undefined {
    return data.setBlockViews.find((blockView) =>
      blockView.exercises.some(({ view }) => view.prescription.id === id),
    );
  }

  function blockFeedbackComplete(blockView: SetBlockView): boolean {
    return blockView.exercises.every(
      ({ view }) => feedbackSaved[view.prescription.id] === true,
    );
  }

  function completedRounds(blockView: SetBlockView): number {
    return setIndexes(blockView.block.rounds).filter((index) =>
      blockView.exercises.every(({ view }) =>
        Boolean(completedSets[setKey(view.prescription.id, index)]),
      ),
    ).length;
  }

  function saveFeedback(id: string): void {
    const view = data.exerciseViews.find(
      (candidate) => candidate.prescription.id === id,
    );
    if (view === undefined || !allSetEntriesSufficient(view)) {
      workoutError =
        "Enter reps and effort for every completed set before saving this exercise check-in.";
      exerciseOpen[id] = true;
      const blockView = blockForPrescription(id);
      if (blockView !== undefined) blockOpen[blockView.block.id] = true;
      return;
    }
    workoutError = undefined;
    feedbackSaved[id] = true;
    feedbackOpen[id] = false;
    exerciseOpen[id] = false;
    const blockView = blockForPrescription(id);
    if (blockView !== undefined && blockFeedbackComplete(blockView)) {
      blockOpen[blockView.block.id] = false;
      const blockIndex = data.setBlockViews.findIndex(
        (candidate) => candidate.block.id === blockView.block.id,
      );
      const nextBlock = data.setBlockViews[blockIndex + 1];
      if (nextBlock !== undefined && !blockFeedbackComplete(nextBlock))
        blockOpen[nextBlock.block.id] = true;
    }
    const currentIndex = data.exerciseViews.findIndex(
      (view) => view.prescription.id === id,
    );
    const next = data.exerciseViews[currentIndex + 1];
    if (next !== undefined && !feedbackSaved[next.prescription.id]) {
      exerciseOpen[next.prescription.id] = true;
    }
    markDirty();
    void autosaveProgress("milestone");
  }

  function setDone(
    view: ExerciseView,
    index: number,
    checked: boolean,
    blockView?: SetBlockView,
    sequenceIndex = 0,
  ): void {
    touchSet(view, index);
    completedSets[setKey(view.prescription.id, index)] = checked;
    if (!checked) return;
    if (shouldAutoStartWorkoutTimer(checked, workoutRunning, workoutSeconds))
      toggleWorkoutTimer();
    if (
      blockView?.block.type === "paired_superset" &&
      !unpairedBlocks[blockView.block.id]
    ) {
      if (sequenceIndex === 0) {
        startRest(blockView.block.transitionSeconds);
      } else {
        startRest(blockView.block.interRoundRestSeconds);
      }
      return;
    }
    startRest(view.prescription.restSeconds);
  }

  function touchSet(view: ExerciseView, index: number): void {
    touchedSets[setKey(view.prescription.id, index)] = true;
  }

  function referenceEstimatedMax(view: ExerciseView): number | undefined {
    if (view.baselineEstimatedMax !== undefined)
      return view.baselineEstimatedMax;
    const suggestedLoad = recommendation(view).load;
    if (suggestedLoad === undefined) return undefined;
    return (
      suggestedLoad *
      (1 + (prescribedRepTarget(view.prescription) + effortTarget(view)) / 30)
    );
  }

  function checkRir(
    view: ExerciseView,
    index: number,
    row: Element | null,
  ): void {
    if (row === null) return;
    const value = (field: string) => {
      const input = row.querySelector<HTMLInputElement>(
        `input[data-field="${field}"]`,
      );
      const number = Number(input?.value ?? "");
      return Number.isFinite(number) ? number : undefined;
    };
    const load = value("load");
    const reps = value("reps");
    const rir = value("rir");
    const key = setKey(view.prescription.id, index);
    if (load === undefined || reps === undefined || rir === undefined) {
      delete rirWarnings[key];
      return;
    }
    const warning = suspiciousRirEstimate(
      load,
      reps,
      rir,
      referenceEstimatedMax(view),
    );
    if (warning === undefined) {
      delete rirWarnings[key];
      return;
    }
    rirWarnings[key] =
      `This entry estimates a one-rep max of about ${Math.round(warning.enteredEstimate)} ${data.units}, compared with your current estimate of about ${Math.round(warning.referenceEstimate)} ${data.units}. Check the RIR for a typo; you can keep it if it is correct.`;
  }

  function plainGuidance(view: ExerciseView): string {
    const reps = prescribedRepTarget(view.prescription);
    const effort = effortPrescription(view);
    if (view.prescription.progression.method === "calibration") {
      if (addedToBodyweight(view))
        return `Start with bodyweight for ${reps} clean reps. If that is easier than ${effort}, add a small amount of weight and try again after resting. Log only the weight added to your bodyweight; enter 0 when you use bodyweight alone.`;
      return `Start with a weight you know will be easy for ${reps} reps. Add weight in small steps until the set feels like ${effort}. Use that weight for your first work set and log it; next time, the app will make a recommendation from what you did.`;
    }
    return `Use the suggested weight and complete exactly ${reps} clean reps. Aim for ${effort}. If the first set is clearly harder than that, lower the weight by one available step for the remaining sets. If it feels easier, keep the same weight today and log the result so the next recommendation can increase.`;
  }

  function updateTimers(nowMs = Date.now()): void {
    if (workoutRunning && workoutStartedAtMs !== undefined) {
      workoutSeconds = elapsedTimerSeconds(
        workoutBaseSeconds,
        workoutStartedAtMs,
        nowMs,
      );
    }
    if (restRunning && restEndsAtMs !== undefined) {
      restSeconds = remainingTimerSeconds(restEndsAtMs, nowMs);
      if (restSeconds === 0) {
        restRunning = false;
        restEndsAtMs = undefined;
      }
    }
  }

  function toggleWorkoutTimer(): void {
    if (workoutRunning) {
      updateTimers();
      workoutRunning = false;
      workoutBaseSeconds = workoutSeconds;
      workoutStartedAtMs = undefined;
      return;
    }
    workoutBaseSeconds = workoutSeconds;
    workoutStartedAtMs = Date.now();
    workoutRunning = true;
  }

  function resetWorkoutTimer(): void {
    workoutRunning = false;
    workoutSeconds = 0;
    workoutBaseSeconds = 0;
    workoutStartedAtMs = undefined;
    if (cardioOnly && cardioMinutesAuto)
      cardioCompletedMinutes = data.session.cardio?.minutes;
  }

  function pauseWorkoutTimer(): void {
    if (!workoutRunning) return;
    updateTimers();
    workoutRunning = false;
    workoutBaseSeconds = workoutSeconds;
    workoutStartedAtMs = undefined;
  }

  function settleTimers(intent: WorkoutFinishIntent): void {
    clearRestTimer();
    if (intent === "save") pauseWorkoutTimer();
    else resetWorkoutTimer();
  }

  function markDirty(): void {
    if (data.historyFrozen) return;
    hasUserChanges = true;
    saveState = "dirty";
    editRevision += 1;
    if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(
      () => void autosaveProgress(),
      nextWorkoutAutosaveDelay(lastAutosaveStartedAt),
    );
  }

  function saveActionUrl(): string {
    return `${window.location.pathname}?/save`;
  }

  async function waitForRetry(delayMs: number): Promise<void> {
    if (delayMs <= 0) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
  }

  async function postWorkoutAction(action: URL, body: FormData) {
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(
      () => controller.abort(),
      WORKOUT_EXPLICIT_SAVE_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-sveltekit-action": "true",
        },
        body,
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      return deserialize(await response.text());
    } finally {
      window.clearTimeout(requestTimeout);
    }
  }

  async function autosaveProgress(
    mode: "normal" | "background" | "milestone" | "leaving" = "normal",
  ): Promise<void> {
    if (explicitSaveInFlight || autosaveInFlight) return;
    if (
      !shouldAutosaveWorkout(
        saveState,
        hasUserChanges,
        workoutForm !== undefined,
        data.historyFrozen,
      ) ||
      workoutForm === undefined
    )
      return;
    if (mode !== "leaving" && lastAutosaveStartedAt > 0) {
      const elapsed = Date.now() - lastAutosaveStartedAt;
      const remaining = WORKOUT_AUTOSAVE_MIN_INTERVAL_MS - elapsed;
      if (remaining > 0) {
        if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
        autosaveTimer = window.setTimeout(
          () => void autosaveProgress(),
          remaining,
        );
        return;
      }
    }
    const body = autosaveWorkoutFormData(new FormData(workoutForm));
    const fingerprint = workoutFormFingerprint(body);
    const permanentChangePending = workoutRequestsPermanentSubstitution(body);
    const savingRevision = editRevision;
    if (fingerprint === lastServerFingerprint) {
      saveState = permanentChangePending ? "dirty" : "saved";
      hasUserChanges = permanentChangePending;
      return;
    }
    if (mode === "leaving") {
      if (
        !shouldSendAutosaveBeacon(
          savingRevision,
          beaconedRevision,
          autosaveInFlight ? activeSaveRevision : undefined,
        )
      )
        return;
      if (navigator.sendBeacon?.(saveActionUrl(), body)) {
        beaconedRevision = savingRevision;
      }
      return;
    }
    autosaveInFlight = true;
    activeSaveRevision = savingRevision;
    lastAutosaveStartedAt = Date.now();
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(
      () => controller.abort(),
      WORKOUT_AUTOSAVE_REQUEST_TIMEOUT_MS,
    );
    const request = (async () => {
      try {
        const response = await fetch(saveActionUrl(), {
          method: "POST",
          headers: {
            accept: "application/json",
            "x-sveltekit-action": "true",
          },
          body,
          cache: "no-store",
          credentials: "same-origin",
          keepalive: true,
          signal: controller.signal,
        });
        const result = deserialize(await response.text());
        const responseData =
          result.type === "success" || result.type === "failure"
            ? (result.data as
                | {
                    message?: unknown;
                    updatedAt?: unknown;
                    conflict?: unknown;
                    conflictReason?: unknown;
                    currentRevision?: unknown;
                    revisionConflict?: unknown;
                    code?: unknown;
                  }
                | undefined)
            : undefined;
        if (response.ok && result.type === "success") {
          // A later edit may already be present, but every successful write
          // advances the optimistic revision used by the next request.
          if (typeof responseData?.updatedAt === "string")
            expectedRevision = responseData.updatedAt;
          if (editRevision === savingRevision) {
            lastServerFingerprint = fingerprint;
            saveState = permanentChangePending ? "dirty" : "saved";
            hasUserChanges = permanentChangePending;
          } else {
            saveState = "dirty";
          }
        } else {
          if (typeof responseData?.currentRevision === "string")
            expectedRevision = responseData.currentRevision;
          if (typeof responseData?.message === "string")
            workoutError = responseData.message;
          saveState = "dirty";
        }
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          workoutError =
            "The background save took too long. Your entries are still here, and you can use Finish or try saving again.";
        }
        saveState = "dirty";
      } finally {
        window.clearTimeout(requestTimeout);
        autosaveInFlight = false;
        activeSaveRevision = undefined;
      }
    })();
    activeAutosave = request;
    try {
      await request;
    } finally {
      if (activeAutosave === request) activeAutosave = undefined;
    }
  }

  function startRest(seconds: number): void {
    restSeconds = seconds;
    restEndsAtMs = Date.now() + seconds * 1000;
    restRunning = true;
  }

  function toggleRestTimer(): void {
    if (restRunning) {
      updateTimers();
      restRunning = false;
      restEndsAtMs = undefined;
      return;
    }
    if (restSeconds <= 0) return;
    restEndsAtMs = Date.now() + restSeconds * 1000;
    restRunning = true;
  }

  function clearRestTimer(): void {
    restRunning = false;
    restSeconds = 0;
    restEndsAtMs = undefined;
  }

  function requiredWorkComplete(): boolean {
    return data.exerciseViews
      .filter((view) => !view.prescription.optional)
      .every(allSetsDone);
  }

  function cardioWorkComplete(): boolean {
    const cardio = data.session.cardio;
    if (cardio === undefined) return true;
    const durationComplete =
      (cardioCompletedMinutes ?? 0) >= Math.max(1, cardio.minutes * 0.8);
    const intervalsComplete =
      cardio.intervals === undefined ||
      (cardioCompletedIntervals ?? 0) >= cardio.intervals.repeats;
    return durationComplete && intervalsComplete;
  }

  function prepareFinish(intent: WorkoutFinishIntent): void {
    if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    finishIntent = intent;
    workoutError = undefined;
    showMissReason = needsWorkoutMissReason(
      intent,
      requiredWorkComplete(),
      cardioWorkComplete(),
    );
  }

  function validateWorkoutSubmission(): boolean {
    if (finishIntent !== "skip") {
      for (const view of data.exerciseViews) {
        for (const index of setIndexes(view.prescription.sets)) {
          const key = setKey(view.prescription.id, index);
          if (completedSets[key] && !setEntrySufficient(view, index)) {
            workoutError = `Enter reps and effort for completed ${view.prescription.name} sets. Your current entries are still here.`;
            exerciseOpen[view.prescription.id] = true;
            const blockView = blockForPrescription(view.prescription.id);
            if (blockView !== undefined) blockOpen[blockView.block.id] = true;
            queueMicrotask(() => {
              workoutForm
                ?.querySelector<HTMLElement>(
                  `[name="exercise.${CSS.escape(view.prescription.id)}.set.${index + 1}.${data.effortMode === "verbal" ? "difficulty" : data.effortMode}"]`,
                )
                ?.focus();
            });
            return false;
          }
        }
      }
    }

    const reasonNeeded = needsWorkoutMissReason(
      finishIntent,
      requiredWorkComplete(),
      cardioWorkComplete(),
    );
    showMissReason = reasonNeeded;
    if (reasonNeeded && missReason === "") {
      workoutError =
        "Choose the main reason this workout is unfinished or skipped. Your current entries are still here.";
      queueMicrotask(() =>
        workoutForm?.querySelector<HTMLElement>(`[name="missReason"]`)?.focus(),
      );
      return false;
    }
    return true;
  }
</script>

{#snippet exerciseSetup(view: ExerciseView, orderLabel = "")}
  <div class:paired-exercise={orderLabel !== ""}>
    {#if orderLabel !== ""}
      <h3 class="paired-exercise-title">
        <span>{orderLabel}</span>{view.prescription.name}
      </h3>
      <p class="paired-target">
        {compactPrescription(view)}
      </p>
    {/if}

    <BarbellPlateDisplay
      exerciseId={selectedExercise(view)}
      targetLoad={plateDisplayLoad(view)}
      units={data.units}
      label={view.prescription.name}
    />

    {#if view.prescription.skipRule}
      <div class="skip-help">
        <button
          type="button"
          aria-expanded={skipHelpOpen[view.prescription.id] ?? false}
          onclick={() =>
            (skipHelpOpen[view.prescription.id] =
              !skipHelpOpen[view.prescription.id])}
          >When should I skip this exercise? <span aria-hidden="true">ⓘ</span
          ></button
        >
        {#if skipHelpOpen[view.prescription.id]}
          <p>{view.prescription.skipRule}</p>
        {/if}
      </div>
    {/if}

    {#if recommendation(view).kind === "calibrate"}
      <details class="calibration-help calibration-needed">
        <summary>Not sure how to find your starting weight?</summary>
        <ol>
          <li>
            Pick a light weight you are confident you can lift for
            {prescribedRepTarget(view.prescription)} clean reps.
          </li>
          <li>
            Do the reps, rest for the full rest time, and judge how many more
            good reps you could have completed.
          </li>
          <li>
            If it was much easier than {effortPrescription(view)}, add weight.
            If it was harder, remove weight. Use small changes as you get close.
          </li>
          <li>
            Stop after four tries. If you are unsure between two weights, use
            the lighter one today.
          </li>
        </ol>
      </details>
    {/if}

    {#if view.prescription.alternativeChoices.length > 0}
      <div class="substitution">
        <label>
          Exercise
          <select
            name={`exercise.${view.prescription.id}.choice`}
            value={selectedExercises[view.prescription.id]}
            onchange={(event) => {
              selectedExercises = {
                ...selectedExercises,
                [view.prescription.id]: event.currentTarget.value,
              };
              exerciseChoiceChanged(view);
              markDirty();
            }}
          >
            <option value={view.prescription.exerciseId}
              >{view.prescription.name}</option
            >
            {#each view.prescription.alternativeChoices as alternative}
              <option value={alternative.exerciseId}>{alternative.name}</option>
            {/each}
          </select>
          {#if selectedReplacementTradeoff(view)}
            <small class="replacement-tradeoff"
              >{selectedReplacementTradeoff(view)}</small
            >
          {/if}
        </label>
        {#if selectedExercise(view) !== view.prescription.exerciseId}
          {#if data.facilityMode === "secondary"}
            <input
              type="hidden"
              name={`exercise.${view.prescription.id}.scope`}
              value="today"
            />
            <small>Secondary-gym replacements apply only to this workout.</small
            >
          {:else}
            <label>
              How long should this replacement last?
              <select
                name={`exercise.${view.prescription.id}.scope`}
                value={substitutionScopes[view.prescription.id]}
                onchange={(event) => {
                  substitutionScopes = {
                    ...substitutionScopes,
                    [view.prescription.id]:
                      event.currentTarget.value === "permanent"
                        ? "permanent"
                        : "today",
                  };
                  markDirty();
                }}
              >
                <option value="today">Just this workout</option>
                <option value="permanent"
                  >This workout and future workouts</option
                >
              </select>
              <small>
                Future replacement weights are tracked separately. A permanent
                change starts after today's workout.
              </small>
            </label>
          {/if}
        {:else}
          <input
            type="hidden"
            name={`exercise.${view.prescription.id}.scope`}
            value="today"
          />
        {/if}
      </div>
    {:else}
      <input
        type="hidden"
        name={`exercise.${view.prescription.id}.choice`}
        value={view.prescription.exerciseId}
      />
      <input
        type="hidden"
        name={`exercise.${view.prescription.id}.scope`}
        value="today"
      />
    {/if}
  </div>
{/snippet}

{#snippet setRow(
  view: ExerciseView,
  index: number,
  setLabel: string,
  blockView?: SetBlockView,
  sequenceIndex = 0,
)}
  {@const prefix = `exercise.${view.prescription.id}.set.${index + 1}`}
  {@const key = setKey(view.prescription.id, index)}
  <div class="set-row">
    {#if touchedSets[key]}
      <input type="hidden" name={`${prefix}.touched`} value="true" />
    {/if}
    <strong class="set-number"
      ><span class="field-label">Set</span>{setLabel}</strong
    >
    <label>
      <span class="field-label">{weightLabel(view)}</span>
      <input
        aria-label={`${view.prescription.name} set ${index + 1} weight`}
        name={`${prefix}.load`}
        type="number"
        min="0"
        max="5000"
        step="any"
        data-field="load"
        bind:value={setLoads[key]}
        oninput={(event) => {
          touchSet(view, index);
          checkRir(view, index, event.currentTarget.closest(".set-row"));
        }}
      />
    </label>
    <label>
      <span class="field-label">Reps</span>
      <input
        aria-label={`${view.prescription.name} set ${index + 1} reps`}
        name={`${prefix}.reps`}
        type="number"
        min="0"
        max="100"
        step="1"
        data-field="reps"
        bind:value={setReps[key]}
        oninput={(event) => {
          touchSet(view, index);
          checkRir(view, index, event.currentTarget.closest(".set-row"));
        }}
      />
    </label>
    <label>
      <span class="field-label"
        >{data.effortMode === "verbal"
          ? "Effort"
          : data.effortMode.toUpperCase()}</span
      >
      {#if data.effortMode === "rpe"}
        <input
          aria-label={`${view.prescription.name} set ${index + 1} RPE; target ${effortRange(view)}`}
          name={`${prefix}.rpe`}
          type="number"
          min="1"
          max="10"
          step="0.5"
          bind:value={setRpes[key]}
          oninput={() => touchSet(view, index)}
        />
      {:else if data.effortMode === "rir"}
        <input
          aria-label={`${view.prescription.name} set ${index + 1} RIR; target ${effortRange(view)}`}
          name={`${prefix}.rir`}
          type="number"
          min="0"
          max="12"
          step="0.5"
          data-field="rir"
          bind:value={setRirs[key]}
          oninput={(event) => {
            touchSet(view, index);
            checkRir(view, index, event.currentTarget.closest(".set-row"));
          }}
        />
      {:else}
        <select
          aria-label={`${view.prescription.name} set ${index + 1} effort`}
          name={`${prefix}.difficulty`}
          bind:value={setDifficulties[key]}
          onchange={() => touchSet(view, index)}
        >
          <option value="">Select</option>
          {#each ["easy", "medium", "difficult", "impossible"] as effort}
            <option value={effort}>{titleCase(effort)}</option>
          {/each}
        </select>
      {/if}
    </label>
    <label class="done-field">
      <span class="field-label">Done</span>
      <input
        aria-label={`${view.prescription.name} set ${index + 1} completed`}
        name={`${prefix}.completed`}
        type="checkbox"
        checked={completedSets[key]}
        onchange={(event) =>
          setDone(
            view,
            index,
            event.currentTarget.checked,
            blockView,
            sequenceIndex,
          )}
      />
    </label>
    {#if rirWarnings[key]}
      <small class="rir-warning" role="status">
        {rirWarnings[key]}
      </small>
    {/if}
  </div>
{/snippet}

{#snippet painFields(view: ExerciseView)}
  {#if painAnswers[view.prescription.id] === "yes"}
    <div class="pain-fields">
      <p>
        Stop this exercise for today if pain changed your technique, range of
        motion, or ability to finish. Unrelated work can continue if it feels
        normal and you have no warning signs below.
      </p>
      <label>
        What happened?
        <select name={`exercise.${view.prescription.id}.painEvent.impact`}>
          <option
            value="noticed"
            selected={view.logged?.painEvent?.impact === "noticed"}
            >I noticed it but did not change the exercise</option
          >
          <option
            value="modified"
            selected={view.logged?.painEvent?.impact === "modified"}
            >I reduced or changed the exercise</option
          >
          <option
            value="stopped_exercise"
            selected={view.logged?.painEvent?.impact === "stopped_exercise"}
            >I stopped this exercise</option
          >
          <option
            value="stopped_workout"
            selected={view.logged?.painEvent?.impact === "stopped_workout"}
            >I stopped the whole workout</option
          >
        </select>
      </label>
      <label>
        Pain level when it happened (0–10, optional)
        <input
          name={`exercise.${view.prescription.id}.painEvent.severity`}
          type="number"
          min="0"
          max="10"
          step="1"
          value={view.logged?.painEvent?.severity ?? ""}
        />
      </label>
      <label>
        How did it begin?
        <select name={`exercise.${view.prescription.id}.painEvent.onset`}>
          <option
            value="unsure"
            selected={view.logged?.painEvent?.onset === undefined ||
              view.logged?.painEvent?.onset === "unsure"}>Not sure</option
          >
          <option
            value="gradual"
            selected={view.logged?.painEvent?.onset === "gradual"}
            >Built up gradually</option
          >
          <option
            value="sudden"
            selected={view.logged?.painEvent?.onset === "sudden"}
            >Came on suddenly</option
          >
          <option
            value="accident"
            selected={view.logged?.painEvent?.onset === "accident"}
            >A fall, pop, failed rep, or other accident</option
          >
        </select>
      </label>
      <label>
        Was this familiar?
        <select name={`exercise.${view.prescription.id}.painEvent.baseline`}>
          <option
            value="unsure"
            selected={view.logged?.painEvent?.baseline === undefined ||
              view.logged?.painEvent?.baseline === "unsure"}>Not sure</option
          >
          <option
            value="new"
            selected={view.logged?.painEvent?.baseline === "new"}>New</option
          >
          <option
            value="familiar"
            selected={view.logged?.painEvent?.baseline === "familiar"}
            >Familiar and about the usual level</option
          >
          <option
            value="familiar_worse"
            selected={view.logged?.painEvent?.baseline === "familiar_worse"}
            >Familiar but worse than usual</option
          >
        </select>
      </label>
      <label>
        Where did you feel it? (optional)
        <input
          name={`exercise.${view.prescription.id}.painEvent.bodyArea`}
          maxlength="120"
          value={view.logged?.painEvent?.bodyArea ?? ""}
          placeholder="For example: front of right knee"
        />
      </label>
      <label>
        How does it feel now?
        <select name={`exercise.${view.prescription.id}.painEvent.followUp`}>
          <option
            value="not_checked"
            selected={view.logged?.painEvent?.followUp === undefined ||
              view.logged?.painEvent?.followUp === "not_checked"}
            >I have not checked again yet</option
          >
          <option
            value="normal"
            selected={view.logged?.painEvent?.followUp === "normal"}
            >Back to normal</option
          >
          <option
            value="better"
            selected={view.logged?.painEvent?.followUp === "better"}
            >Better</option
          >
          <option
            value="same"
            selected={view.logged?.painEvent?.followUp === "same"}
            >About the same</option
          >
          <option
            value="worse"
            selected={view.logged?.painEvent?.followUp === "worse"}
            >Worse</option
          >
          <option
            value="affects_daily_life"
            selected={view.logged?.painEvent?.followUp === "affects_daily_life"}
            >It affects normal daily movement</option
          >
        </select>
      </label>
      <label class="warning-signs">
        <input
          name={`exercise.${view.prescription.id}.painEvent.urgentWarningSigns`}
          type="checkbox"
          checked={view.logged?.painEvent?.urgentWarningSigns === true}
        />
        <span
          >I had a fall or pop, major swelling, numbness or weakness, or could
          not use the area normally.</span
        >
      </label>
    </div>
  {/if}
{/snippet}

{#snippet exerciseFinish(view: ExerciseView)}
  {#if allSetsDone(view) && feedbackSaved[view.prescription.id] && !feedbackOpen[view.prescription.id]}
    <button
      class="edit-feedback"
      type="button"
      onclick={() => {
        feedbackOpen[view.prescription.id] = true;
        exerciseOpen[view.prescription.id] = true;
        const blockView = blockForPrescription(view.prescription.id);
        if (blockView !== undefined) blockOpen[blockView.block.id] = true;
      }}>Edit exercise feedback</button
    >
  {/if}
  <div class="exercise-feedback" class:feedback-hidden={!showFeedback(view)}>
    <h3>Quick exercise check-in</h3>
    <p>You finished the sets. Tell us how the exercise went.</p>
    <div class="feedback-grid">
      <label>
        Did your technique stay controlled?
        <select name={`exercise.${view.prescription.id}.technique`}>
          <option
            value="yes"
            selected={!view.logged?.sets.some(
              (set) => set.techniqueOkay === false,
            )}>Yes</option
          >
          <option
            value="no"
            selected={view.logged?.sets.some(
              (set) => set.techniqueOkay === false,
            )}>No</option
          >
        </select>
      </label>
      <label>
        Did pain change or stop this exercise?
        <select
          name={`exercise.${view.prescription.id}.pain`}
          bind:value={painAnswers[view.prescription.id]}
        >
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </label>
      <label>
        If you left sets unfinished, what was the main reason?
        <select name={`exercise.${view.prescription.id}.missReason`}>
          <option value="">Not applicable</option>
          {#each MISS_REASON_OPTIONS as option}
            <option
              value={option.value}
              selected={view.logged?.missReason === option.value}
              >{option.label}</option
            >
          {/each}
        </select>
      </label>
    </div>
    {@render painFields(view)}
    <button type="button" onclick={() => saveFeedback(view.prescription.id)}
      >Save exercise feedback</button
    >
  </div>

  {#if painAnswers[view.prescription.id] === "yes" && feedbackSaved[view.prescription.id]}
    <p class="pain-note">
      This report will adjust the affected exercise separately from the rest of
      your week. Seek appropriate care for severe, worsening, traumatic, or
      otherwise concerning symptoms.
    </p>
  {/if}

  <details class="weight-help">
    <summary>How should I choose and progress the weight?</summary>
    <p>{plainGuidance(view)}</p>
    {#if view.prescription.amrapStopRir !== undefined}
      <p>
        On the final AMRAP set, stop when you think you could still complete
        {view.prescription.amrapStopRir} more good reps.
      </p>
    {/if}
  </details>
{/snippet}

<svelte:head><title>{data.label} | {data.program.name}</title></svelte:head>

<main class="mission-page workout-page">
  <a class="overview-button" href={`/programs/${data.program.id}`}>
    <span>{data.program.name}</span><strong>Overview</strong>
  </a>
  <header>
    <div>
      <p class="eyebrow">Week {data.session.weekNumber}</p>
      <h1>{data.label}</h1>
      <p>{data.session.objective}</p>
    </div>
  </header>

  <QuoteCard quote={orbitalQuote} compact showIn="orbital" />
  <QuoteCard quote={cuteQuote} compact showIn="cute" />

  <section
    class="gym-switcher"
    class:gym-active={data.facilityMode === "secondary"}
    aria-label="Workout location"
  >
    <div>
      <span class="gym-label">Equipment today</span>
      <strong class="gym-name">
        {data.facilityMode === "secondary" ? "Secondary gym" : "Primary gym"}
      </strong>
      {#if data.facilityMode === "secondary"}<p>
          {data.hasAlternateGym
            ? "This workout uses the equipment saved for your secondary gym. Changes apply only today."
            : "No secondary gym is saved. Choose only replacements supported by the equipment available today."}
        </p>{/if}
    </div>
    <a
      class="gym-toggle"
      href={data.facilityMode === "secondary"
        ? `/programs/${data.program.id}/workouts/${encodeURIComponent(data.session.id)}`
        : `?gym=secondary`}
      >{data.facilityMode === "secondary"
        ? "Use primary gym"
        : "Use secondary gym"}</a
    >
    {#if data.facilityMode === "secondary" && data.facilityVariant}
      {#if data.facilityVariant.changes.length > 0}
        <ul>
          {#each data.facilityVariant.changes as change}
            <li>
              <strong>{change.before} → {change.after}</strong>
              <span>
                {change.competitionTradeoff
                  ? "This preserves the main strength pattern, but you will get less competition-lift practice today. The replacement starts with its own weight history."
                  : "This keeps the purpose of the exercise and starts a separate weight history."}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      {#each data.facilityVariant.warnings as warning}<p class="gym-warning">
          {warning}
        </p>{/each}
    {/if}
  </section>

  <ShorterWorkoutOption
    session={data.session}
    units={data.units}
    exerciseNames={Object.fromEntries(
      data.exerciseViews.map((view) => [
        view.prescription.id,
        view.prescription.alternativeChoices.find(
          (choice) => choice.exerciseId === selectedExercise(view),
        )?.name ?? view.prescription.name,
      ]),
    )}
    loadTargets={Object.fromEntries(
      data.exerciseViews.map((view) => [
        view.prescription.id,
        recommendation(view).load,
      ]),
    )}
  />

  {#if data.movementTarget}
    <section
      class="movement-checkin-summary"
      aria-label="Daily movement check-in"
    >
      <div>
        <span>Previous day’s movement</span>
        <strong>
          {movementAnswer === "yes"
            ? importedMovementSteps !== undefined
              ? "Target reached · imported"
              : "Target reached"
            : movementAnswer === "no"
              ? "Not reached yesterday"
              : movementAnswer === "untracked"
                ? "Not tracked"
                : "Not filled out yet"}
        </strong>
      </div>
      <button
        class="secondary"
        type="button"
        onclick={() => (movementCheckInOpen = true)}
      >
        {movementAnswer === ""
          ? "Fill out"
          : importedMovementSteps !== undefined
            ? "View"
            : "Edit"}
      </button>
    </section>
  {/if}

  {#if movementCheckInOpen && data.movementTarget}
    <MovementCheckIn
      target={data.movementTarget}
      bind:answer={movementAnswer}
      bind:actual={movementActual}
      {wearableDay}
      oncontinue={() => {
        movementCheckInOpen = false;
        markDirty();
      }}
    />
  {/if}

  <WorkoutTimers
    {cardioOnly}
    predictedMinutes={data.session.predictedMinutes}
    cardioMinutes={data.session.cardio?.minutes ?? 0}
    {workoutSeconds}
    {workoutRunning}
    {restSeconds}
    {restRunning}
    ontoggleworkout={toggleWorkoutTimer}
    onresetworkout={resetWorkoutTimer}
    ontogglerest={toggleRestTimer}
    onclearrest={clearRestTimer}
  />

  {#if !data.loggingReady}
    <section class="setup-callout">
      <h2>Workout logging needs one database update</h2>
      <p>
        Apply Supabase migration <code>20260807070000_workout_logging</code>,
        then reload. Detected status: <code>{data.loggingErrorCode}</code>.
      </p>
    </section>
  {:else}
    {#if workoutError}<p class="message" role="alert">{workoutError}</p>{/if}

    {#if data.historyFrozen}
      <section class="frozen-note">
        <h2>Week {data.session.weekNumber} is complete</h2>
        <p>
          This workout is read-only because its weekly review has been saved.
          Future changes are stored in a newer program version.
        </p>
      </section>
    {/if}

    <form
      method="POST"
      bind:this={workoutForm}
      oninput={() => {
        workoutError = undefined;
        markDirty();
      }}
      use:enhance={async ({ action, formData, cancel }) => {
        cancel();
        if (explicitSaveInFlight || !validateWorkoutSubmission()) return;
        explicitSaveInFlight = true;
        const submittedIntent = finishIntent;
        hasUserChanges = true;
        const savingRevision = editRevision;
        if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
        autosaveTimer = undefined;
        try {
          const pendingAutosave = activeAutosave;
          if (pendingAutosave !== undefined) await pendingAutosave;

          // FormData is captured at the click, so it remains the authoritative
          // workout even if a preceding autosave advanced the server revision.
          formData.set("expectedRevision", expectedRevision);
          formData.set("submissionMode", "explicit");
          if (submittedIntent !== "save") {
            if (!cardioOnly && durationMinutes !== undefined)
              formData.set("durationMinutes", String(durationMinutes));
          }
          if (submittedIntent === "save") saveState = "saving";

          let retries = 0;
          let result = await postWorkoutAction(action, formData);
          while (result.type === "failure") {
            const response = result.data as
              | {
                  message?: unknown;
                  conflict?: unknown;
                  conflictReason?: unknown;
                  currentRevision?: unknown;
                  retryAfterSeconds?: unknown;
                }
              | undefined;
            const retry = workoutExplicitRetry(response, retries);
            if (retry === undefined) break;
            retries += 1;
            if (retry.expectedRevision !== undefined) {
              expectedRevision = retry.expectedRevision;
              formData.set("expectedRevision", retry.expectedRevision);
            }
            await waitForRetry(retry.delayMs);
            result = await postWorkoutAction(action, formData);
          }

          if (result.type === "failure") {
            const response = result.data as
              { message?: unknown; currentRevision?: unknown } | undefined;
            if (typeof response?.currentRevision === "string") {
              expectedRevision = response.currentRevision;
            }
            workoutError =
              typeof response?.message === "string"
                ? response.message
                : "The workout could not be saved. Your entries are still here; you can try again without reloading.";
            saveState = "dirty";
            return;
          }
          if (result.type === "error") {
            workoutError =
              "The workout could not be saved. Your entries are still here; you can try again without reloading.";
            saveState = "dirty";
            return;
          }

          workoutError = undefined;
          if (result.type === "redirect") {
            settleTimers(submittedIntent);
            await applyAction(result);
            return;
          }

          const response = result.data as { updatedAt?: unknown } | undefined;
          if (typeof response?.updatedAt === "string")
            expectedRevision = response.updatedAt;
          settleTimers(submittedIntent);
          saveState = editRevision === savingRevision ? "saved" : "dirty";
          if (saveState === "saved") {
            hasUserChanges = false;
            if (workoutForm !== undefined) {
              lastServerFingerprint = workoutFormFingerprint(
                autosaveWorkoutFormData(new FormData(workoutForm)),
              );
            }
          }
        } catch (caughtError) {
          workoutError =
            caughtError instanceof DOMException &&
            caughtError.name === "AbortError"
              ? "The workout save took too long. Your entries are still here; try Finish again without reloading."
              : "The workout could not be saved. Your entries are still here; try again without reloading.";
          saveState = "dirty";
        } finally {
          explicitSaveInFlight = false;
        }
      }}
    >
      <input type="hidden" name="facilityMode" value={data.facilityMode} />
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      <input type="hidden" name="submissionMode" value="explicit" />
      <input type="hidden" name="movement.answer" value={movementAnswer} />
      {#if data.movementTarget?.steps !== undefined}
        <input
          type="hidden"
          name="movement.actualSteps"
          value={movementActual ?? ""}
        />
      {:else if data.movementTarget?.walkingMinutes !== undefined}
        <input
          type="hidden"
          name="movement.actualWalkingMinutes"
          value={movementActual ?? ""}
        />
      {/if}
      <fieldset disabled={data.historyFrozen}>
        {#each data.setBlockViews as blockView (blockView.block.id)}
          {#if blockView.block.type === "straight"}
            {@const item = blockView.exercises[0]}
            {#if item !== undefined}
              <details
                class="exercise-card"
                class:progress-partial={movementProgress(item.view) ===
                  "partial"}
                class:progress-complete={movementProgress(item.view) ===
                  "complete"}
                bind:open={blockOpen[blockView.block.id]}
              >
                <summary class="exercise-summary">
                  <div>
                    <h2>{item.view.prescription.name}</h2>
                    <p>
                      {compactPrescription(item.view)}
                    </p>
                  </div>
                  <div class="summary-meta">
                    {#if item.view.prescription.optional}<span class="optional"
                        >Accessory</span
                      >{/if}
                    <strong
                      >{Math.round(item.view.prescription.restSeconds / 6) / 10} min
                      rest</strong
                    >
                  </div>
                </summary>
                <div class="exercise-body">
                  {@render exerciseSetup(item.view)}
                  <div class="set-table">
                    <div class="set-row set-header">
                      <span>Set</span><span>Load</span><span>Reps</span><span
                        >{data.effortMode === "verbal"
                          ? "Effort"
                          : data.effortMode.toUpperCase()}</span
                      ><span>Done</span>
                    </div>
                    {#each setIndexes(item.view.prescription.sets) as index}
                      {@render setRow(
                        item.view,
                        index,
                        String(index + 1),
                        blockView,
                      )}
                    {/each}
                  </div>
                  {@render exerciseFinish(item.view)}
                </div>
              </details>
            {/if}
          {:else}
            <details
              class="exercise-card superset-card"
              class:progress-partial={blockProgress(blockView) === "partial"}
              class:progress-complete={blockProgress(blockView) === "complete"}
              bind:open={blockOpen[blockView.block.id]}
            >
              <summary class="exercise-summary superset-summary">
                <div>
                  <p class="superset-kicker">Superset</p>
                  <h2>
                    {blockView.exercises
                      .map(
                        ({ orderLabel, view }) =>
                          `${orderLabel} ${view.prescription.name}`,
                      )
                      .join(" + ")}
                  </h2>
                  <p>
                    {blockView.block.rounds} rounds · {Math.round(
                      blockView.block.interRoundRestSeconds / 6,
                    ) / 10} min after A2
                  </p>
                </div>
                <div class="round-progress" aria-label="Superset progress">
                  <strong
                    >{completedRounds(blockView)}/{blockView.block
                      .rounds}</strong
                  >
                  <span>rounds</span>
                </div>
              </summary>
              <div class="exercise-body">
                <input
                  type="hidden"
                  name={`block.${blockView.block.id}.mode`}
                  value={unpairedBlocks[blockView.block.id]
                    ? "unpaired"
                    : "paired"}
                />
                <div class="superset-instruction">
                  <div>
                    <strong>How to do it</strong>
                    <p>{blockView.block.instruction}</p>
                  </div>
                  <div class="superset-controls">
                    <button
                      type="button"
                      onclick={() =>
                        startRest(blockView.block.interRoundRestSeconds)}
                      >Start shared rest</button
                    >
                    <button
                      type="button"
                      onclick={() =>
                        (unpairedBlocks[blockView.block.id] =
                          !unpairedBlocks[blockView.block.id])}
                      >{unpairedBlocks[blockView.block.id]
                        ? "Use the prescribed superset"
                        : "Do separately today"}</button
                    >
                  </div>
                </div>
                {#if blockView.block.stopRule}
                  <details class="superset-help">
                    <summary>When should I do these separately?</summary>
                    <p>{blockView.block.stopRule}</p>
                  </details>
                {/if}

                {#each blockView.exercises as item}
                  {@render exerciseSetup(item.view, item.orderLabel)}
                {/each}

                {#if unpairedBlocks[blockView.block.id]}
                  <p class="mode-note">
                    Complete each exercise on its own today. This does not
                    change future workouts.
                  </p>
                  {#each blockView.exercises as item}
                    <div class="unpaired-exercise">
                      <h3>{item.orderLabel} · {item.view.prescription.name}</h3>
                      <div class="set-table">
                        <div class="set-row set-header">
                          <span>Set</span><span>Load</span><span>Reps</span
                          ><span
                            >{data.effortMode === "verbal"
                              ? "Effort"
                              : data.effortMode.toUpperCase()}</span
                          ><span>Done</span>
                        </div>
                        {#each setIndexes(item.view.prescription.sets) as index}
                          {@render setRow(
                            item.view,
                            index,
                            String(index + 1),
                            blockView,
                            0,
                          )}
                        {/each}
                      </div>
                      {@render exerciseFinish(item.view)}
                    </div>
                  {/each}
                {:else}
                  <div class="superset-rounds">
                    {#each setIndexes(blockView.block.rounds) as index}
                      <div
                        class="superset-round"
                        class:round-complete={blockView.exercises.every(
                          ({ view }) =>
                            completedSets[
                              setKey(view.prescription.id, index)
                            ] === true,
                        )}
                      >
                        <h3>
                          Round {index + 1}
                          {#if blockView.exercises.every(({ view }) => completedSets[setKey(view.prescription.id, index)] === true)}<span
                              >Complete ✓</span
                            >{/if}
                        </h3>
                        {#each blockView.exercises as item, sequenceIndex}
                          <p class="superset-set-name">
                            <strong>{item.orderLabel}</strong>
                            {item.view.prescription.name} · {prescribedRepTarget(
                              item.view.prescription,
                            )} reps · {effortPrescription(item.view)}
                          </p>
                          {@render setRow(
                            item.view,
                            index,
                            item.orderLabel,
                            blockView,
                            sequenceIndex,
                          )}
                        {/each}
                      </div>
                    {/each}
                  </div>
                  <div class="paired-feedback">
                    {#each blockView.exercises as item}
                      <div>
                        <h3>
                          {item.orderLabel} · {item.view.prescription.name}
                        </h3>
                        {@render exerciseFinish(item.view)}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </details>
          {/if}
        {/each}

        {#if data.setBlockViews.length === 0}
          {#each data.exerciseViews as view (view.prescription.id)}
            <details
              class="exercise-card"
              class:progress-partial={movementProgress(view) === "partial"}
              class:progress-complete={movementProgress(view) === "complete"}
              bind:open={exerciseOpen[view.prescription.id]}
            >
              <summary class="exercise-summary">
                <div>
                  <h2>{view.prescription.name}</h2>
                  <p>{compactPrescription(view)}</p>
                </div>
                <div class="summary-meta">
                  {#if view.prescription.optional}
                    <span class="optional">Accessory</span>
                  {/if}
                  <strong
                    >{Math.round(view.prescription.restSeconds / 6) / 10} min rest</strong
                  >
                </div>
              </summary>
              <div class="exercise-body">
                {@render exerciseSetup(view)}
                <div class="set-table">
                  <div class="set-row set-header">
                    <span>Set</span><span>Load</span><span>Reps</span><span
                      >{data.effortMode === "verbal"
                        ? "Effort"
                        : data.effortMode.toUpperCase()}</span
                    ><span>Done</span>
                  </div>
                  {#each setIndexes(view.prescription.sets) as index}
                    {@render setRow(view, index, String(index + 1))}
                  {/each}
                </div>
                {@render exerciseFinish(view)}
              </div>
            </details>
          {/each}
        {/if}

        {#if data.session.cardio}
          <CardioLogger
            cardio={data.session.cardio}
            availableModalities={data.cardioTracking.availableModalities}
            runningEvent={data.cardioTracking.runningEvent}
            bind:selectedModality={cardioModality}
            distanceUnit={data.cardioTracking.distanceUnit === "km"
              ? "km"
              : "mi"}
            elevationUnit={data.cardioTracking.elevationUnit === "m"
              ? "m"
              : "ft"}
            hasHeartRateDevice={data.cardioTracking.hasHeartRateDevice}
            bind:completedMinutes={cardioCompletedMinutes}
            bind:movingMinutes={cardioMovingMinutes}
            bind:sessionRpe={cardioSessionRpe}
            bind:distance={cardioDistance}
            bind:steps={cardioSteps}
            bind:completedIntervals={cardioCompletedIntervals}
            bind:averageHeartRate={cardioAverageHeartRate}
            bind:maxHeartRate={cardioMaxHeartRate}
            bind:elevationGain={cardioElevationGain}
            bind:surface={cardioSurface}
            bind:source={cardioSource}
            oncompletedminutesinput={() => (cardioMinutesAuto = false)}
          />
        {/if}

        <section class="finish-card">
          {#if !cardioOnly}
            <label>
              Total workout time (minutes)
              <input
                name="durationMinutes"
                type="number"
                min="0"
                max="1440"
                bind:value={durationMinutes}
                oninput={() => (durationAuto = false)}
              />
              <small
                >Expected: about {data.session.predictedMinutes} minutes. Plan for
                up to {Math.max(
                  data.session.predictedMinutes,
                  data.session.targetMinutes,
                )} minutes. This fills from the workout timer after all exercises
                are complete, and you can change it.</small
              >
            </label>
          {/if}
          {#if showMissReason}
            <label class="miss-reason">
              Main reason this workout is unfinished or skipped
              <select name="missReason" bind:value={missReason} required>
                <option value="">Select only if needed</option>
                {#each MISS_REASON_OPTIONS as option}
                  <option
                    value={option.value}
                    selected={data.existing?.missReason === option.value}
                    >{option.label}</option
                  >
                {/each}
              </select>
              <small>
                This helps the weekly check-in tell the difference between a
                hard workout, a time problem, and a schedule problem.
              </small>
            </label>
          {/if}
          {#if !data.historyFrozen}
            <div class="actions">
              <button
                type="submit"
                formaction="?/save"
                disabled={actionAvailability.saveDisabled}
                class:saved-progress={saveState === "saved"}
                onclick={() => prepareFinish("save")}
                >{saveState === "saved"
                  ? "Saved progress"
                  : saveState === "saving"
                    ? "Saving…"
                    : "Save progress"}</button
              >
              <button
                class="primary"
                type="submit"
                formaction="?/complete"
                disabled={actionAvailability.finishDisabled}
                onclick={() => prepareFinish("complete")}
                >{explicitSaveInFlight && finishIntent === "complete"
                  ? "Finishing…"
                  : "Finish and go to next workout"}</button
              >
              <button
                class="skip"
                type="submit"
                formaction="?/skip"
                disabled={actionAvailability.finishDisabled}
                onclick={() => prepareFinish("skip")}
                >{explicitSaveInFlight && finishIntent === "skip"
                  ? "Skipping…"
                  : "Skip this workout"}</button
              >
            </div>
            {#if autosaveInFlight && !explicitSaveInFlight}
              <p class="action-status" role="status">
                Saving your latest entries in the background. You can still save
                or finish the workout when you are ready.
              </p>
            {/if}
          {/if}
          <small>
            If required work is unfinished, the workout is recorded as partial
            so the weekly check-in can respond.
          </small>
        </section>
      </fieldset>
    </form>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--color-canvas);
    color: var(--color-text);
    font-family: var(--font-sans);
  }
  main {
    width: min(860px, calc(100% - 1.25rem));
    margin: 0 auto;
    padding: 1.25rem 0 6rem;
  }
  a {
    color: var(--color-primary);
  }
  .overview-button {
    align-items: center;
    background: linear-gradient(180deg, #213d5c, #10263f);
    border: 2px solid #6e9fc4;
    border-radius: 0.6rem;
    box-shadow: inset 0 1px rgb(255 255 255 / 16%);
    color: var(--color-text);
    display: inline-flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.6rem 0.8rem;
    text-decoration: none;
  }
  .overview-button strong {
    color: var(--color-primary);
  }
  header {
    align-items: start;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  header h1 {
    margin: 0.15rem 0 0.35rem;
  }
  header p {
    color: #5d687c;
    margin: 0;
  }
  .eyebrow {
    color: #3158a6 !important;
    font-weight: 750;
    text-transform: uppercase;
  }
  .gym-switcher {
    align-items: center;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
    display: grid;
    gap: 0.35rem;
    grid-template-columns: minmax(0, 1fr) auto;
    margin: 0.3rem 0 0.6rem;
    padding: 0.15rem 0.1rem;
  }
  .gym-switcher.gym-active {
    background: rgb(11 24 41 / 78%) !important;
    border: 1px solid #314b64 !important;
    border-radius: 0.65rem;
    padding: 0.55rem 0.7rem;
  }
  .gym-switcher p {
    font-size: 0.78rem;
    margin: 0.2rem 0 0;
  }
  .gym-switcher > div {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.55rem;
  }
  .gym-label {
    color: var(--color-text-muted);
    font-size: 0.72rem;
  }
  .gym-name {
    font-size: 0.9rem;
  }
  .gym-switcher > ul,
  .gym-switcher > .gym-warning {
    grid-column: 1 / -1;
  }
  .gym-switcher li {
    display: grid;
    gap: 0.2rem;
    margin: 0.55rem 0;
  }
  .gym-switcher li span,
  .gym-switcher > div > p:last-child {
    color: var(--color-text-muted);
  }
  .gym-toggle {
    background: rgb(21 42 67 / 42%);
    border: 1px solid #52789a;
    border-radius: 999px;
    color: var(--color-text-muted);
    font-size: 0.72rem;
    font-weight: 700;
    min-height: 1.9rem;
    padding: 0.3rem 0.55rem;
    text-align: center;
    text-decoration: none;
  }
  .movement-checkin-summary {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    padding: 0.7rem 0.8rem;
  }
  .movement-checkin-summary > div {
    display: grid;
    gap: 0.12rem;
  }
  .movement-checkin-summary span {
    color: var(--color-text-muted);
    font-size: 0.72rem;
  }
  .movement-checkin-summary strong {
    font-size: 0.88rem;
  }
  .movement-checkin-summary button {
    min-height: 2.4rem;
    padding: 0.42rem 0.75rem;
  }
  .gym-warning {
    background: rgb(255 200 87 / 9%);
    border-left: 3px solid var(--color-warning);
    color: #ffe6ad;
    padding: 0.65rem;
  }
  section,
  details.exercise-card {
    background: white;
    border: 1px solid #dce1e9;
    border-radius: 0.8rem;
    margin: 1rem 0;
  }
  details.exercise-card.progress-partial {
    border-color: #d7ad3c;
  }
  details.exercise-card.progress-complete {
    border-color: #69a981;
  }
  details.exercise-card:not([open]).progress-partial {
    box-shadow: 0 0 0 3px rgb(211 155 19 / 14%);
  }
  details.exercise-card:not([open]).progress-partial > .exercise-summary {
    background: #fff9e8;
    border-radius: 0.8rem;
  }
  details.exercise-card:not([open]).progress-complete {
    box-shadow: 0 0 0 3px rgb(33 134 83 / 14%);
  }
  details.exercise-card:not([open]).progress-complete > .exercise-summary {
    background: #edf8f1;
    border-radius: 0.8rem;
  }
  section {
    padding: 1rem;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  fieldset:disabled {
    opacity: 0.78;
  }
  .setup-callout,
  .frozen-note {
    border-left: 5px solid #3158a6;
  }
  .message {
    background: #fff6df;
    border: 1px solid #dcbf68;
    border-radius: 0.55rem;
    color: #6d520d;
    padding: 0.8rem;
  }
  .exercise-summary {
    align-items: center;
    cursor: pointer;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    list-style-position: outside;
    padding: 1rem;
  }
  .exercise-summary h2 {
    font-size: clamp(1.25rem, 3vw, 1.55rem);
    margin: 0;
  }
  .exercise-summary p {
    color: #5d687c;
    margin: 0.3rem 0 0;
  }
  .summary-meta {
    align-items: end;
    display: grid;
    flex: 0 0 auto;
    gap: 0.4rem;
    text-align: right;
  }
  .optional {
    align-items: center;
    background: #eef2f8;
    border-radius: 2rem;
    display: inline-flex;
    font-size: 0.8rem;
    justify-content: center;
    margin: 0;
    padding: 0.3rem 0.55rem;
  }
  .superset-card {
    border-color: #9bb3df !important;
    box-shadow: 0 4px 16px rgb(49 88 166 / 8%);
  }
  .superset-summary {
    background: linear-gradient(135deg, #f4f7ff, #fff);
  }
  .superset-kicker {
    color: #3158a6 !important;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    margin: 0 0 0.2rem !important;
    text-transform: uppercase;
  }
  .round-progress {
    background: #3158a6;
    border-radius: 0.65rem;
    color: white;
    display: grid;
    flex: 0 0 auto;
    justify-items: center;
    min-width: 4.4rem;
    padding: 0.55rem;
  }
  .round-progress strong {
    font-size: 1.15rem;
  }
  .round-progress span {
    font-size: 0.72rem;
  }
  .superset-instruction {
    align-items: center;
    background: #edf3ff;
    border-left: 4px solid #3158a6;
    display: grid;
    gap: 0.75rem;
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 0.8rem;
  }
  .superset-instruction p {
    line-height: 1.45;
    margin: 0.25rem 0 0;
  }
  .superset-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .superset-help {
    background: #f7f9fc;
    border-radius: 0.55rem;
    margin: 0.7rem 0;
    padding: 0.65rem;
  }
  .superset-help p {
    color: #465268;
    line-height: 1.45;
  }
  .paired-exercise {
    border-bottom: 1px solid #e2e7ee;
    padding: 0.85rem 0;
  }
  .paired-exercise-title {
    align-items: center;
    display: flex;
    font-size: 1.18rem;
    gap: 0.55rem;
    margin: 0 0 0.25rem;
  }
  .paired-exercise-title span {
    background: #3158a6;
    border-radius: 0.35rem;
    color: white;
    font-size: 0.82rem;
    padding: 0.25rem 0.4rem;
  }
  .paired-target {
    color: #5d687c;
    margin: 0 0 0.7rem;
  }
  .mode-note {
    background: #fff6df;
    border-left: 3px solid #c28a20;
    padding: 0.65rem;
  }
  .unpaired-exercise {
    border-top: 2px solid #e2e7ee;
    margin-top: 1rem;
    padding-top: 0.35rem;
  }
  .superset-rounds {
    display: grid;
    gap: 0.8rem;
    margin: 1rem 0;
  }
  .superset-round {
    background: #f8faff;
    border: 1px solid #d7e0f1;
    border-radius: 0.7rem;
    padding: 0.75rem;
  }
  .superset-round.round-complete {
    background: #eef8f2;
    border-color: #8ab99d;
  }
  .superset-round > h3 {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin: 0 0 0.5rem;
  }
  .superset-round > h3 span {
    color: #247046;
    font-size: 0.82rem;
  }
  .superset-set-name {
    color: #34445d;
    margin: 0.65rem 0 0;
  }
  .superset-set-name strong {
    color: #3158a6;
  }
  .paired-feedback {
    display: grid;
    gap: 0.8rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .exercise-body {
    border-top: 1px solid #e2e7ee;
    padding: 1rem;
  }
  .skip-help {
    margin: 0.8rem 0;
  }
  .skip-help button {
    background: transparent;
    color: #344d78;
    padding: 0.35rem 0;
    text-align: left;
  }
  .skip-help p {
    background: #f7f9fc;
    border-left: 3px solid #8290a8;
    color: #465268;
    line-height: 1.45;
    margin: 0.35rem 0;
    padding: 0.65rem 0.8rem;
  }
  .calibration-help,
  .weight-help {
    background: #f7f9fc;
    border-radius: 0.55rem;
    margin: 0.8rem 0;
    padding: 0.7rem;
  }
  .calibration-needed {
    border: 2px solid var(--color-warning);
    box-shadow: 0 0 16px rgb(255 200 87 / 14%);
  }
  .replacement-tradeoff {
    color: var(--color-text-muted);
    line-height: 1.4;
  }
  .calibration-help li {
    margin: 0.45rem 0;
  }
  summary {
    cursor: pointer;
    font-weight: 700;
  }
  .substitution {
    background: #f7f9fc;
    border-radius: 0.6rem;
    display: grid;
    gap: 0.75rem;
    margin: 0.8rem 0;
    padding: 0.75rem;
  }
  label,
  .finish-card label {
    display: grid;
    font-weight: 650;
    gap: 0.35rem;
  }
  label small,
  .finish-card small {
    color: #5d687c;
    font-weight: 400;
    line-height: 1.4;
  }
  input,
  select,
  button {
    box-sizing: border-box;
    font: inherit;
  }
  input,
  select {
    border: 1px solid #bfc7d3;
    border-radius: 0.45rem;
    min-width: 0;
    padding: 0.58rem;
    width: 100%;
  }
  button {
    background: white;
    border: 1px solid #3158a6;
    border-radius: 0.5rem;
    color: #3158a6;
    cursor: pointer;
    font-weight: 750;
    padding: 0.65rem 0.8rem;
  }
  button:disabled {
    cursor: default;
    opacity: 0.45;
  }
  button.saved-progress {
    background: #344454 !important;
    border-color: #607183 !important;
    color: #c4d0dc !important;
  }
  .set-table {
    margin: 1rem 0;
    width: 100%;
  }
  .set-row {
    align-items: end;
    display: grid;
    gap: 0.5rem;
    grid-template-columns: 42px repeat(3, minmax(0, 1fr)) 52px;
    padding: 0.4rem 0;
    width: 100%;
  }
  .set-header {
    border-bottom: 1px solid #dce1e9;
    color: #5d687c;
    font-size: 0.86rem;
    font-weight: 700;
  }
  .field-label {
    display: none;
  }
  .set-number {
    padding-bottom: 0.65rem;
  }
  .done-field {
    align-items: center;
    justify-items: center;
    padding-bottom: 0.6rem;
  }
  .done-field input {
    height: 1.3rem;
    width: 1.3rem;
  }
  .rir-warning {
    background: #fff6df;
    border-left: 3px solid #c28a20;
    color: #664b12;
    grid-column: 2 / -1;
    line-height: 1.4;
    padding: 0.55rem 0.65rem;
  }
  .exercise-feedback {
    background: #eef4ff;
    border: 1px solid #b9c9e6;
    border-radius: 0.65rem;
    margin: 0.9rem 0;
    padding: 0.8rem;
  }
  .exercise-feedback h3,
  .exercise-feedback p {
    margin-top: 0;
  }
  .feedback-grid {
    display: grid;
    gap: 0.7rem;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    margin-bottom: 0.75rem;
  }
  .pain-fields {
    background: #fffaf0;
    border-left: 4px solid #c28a20;
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0.75rem 0;
    padding: 0.8rem;
  }
  .pain-fields > p,
  .pain-fields .warning-signs {
    grid-column: 1 / -1;
  }
  .pain-fields > p {
    line-height: 1.45;
    margin: 0;
  }
  .warning-signs {
    align-items: start;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
  }
  .warning-signs input {
    height: 1.2rem;
    margin-top: 0.15rem;
    width: 1.2rem;
  }
  .feedback-hidden {
    display: none;
  }
  .edit-feedback {
    margin-bottom: 0.7rem;
  }
  .pain-note {
    background: #fff2f0;
    border-left: 4px solid #a64b43;
    color: #7b332d;
    padding: 0.7rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin: 1rem 0 0.7rem;
  }
  .action-status {
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
    border-radius: 0.65rem;
    margin: 0 0 0.8rem;
    padding: 0.75rem;
  }
  button.primary {
    background: #3158a6;
    color: white;
  }
  button.skip {
    border-color: #a64b43;
    color: #8a3730;
  }
  code {
    overflow-wrap: anywhere;
  }
  .workout-page header p,
  .workout-page .exercise-summary p,
  .workout-page .paired-target,
  .workout-page label small,
  .workout-page .finish-card small,
  .workout-page .field-label {
    color: var(--color-text-muted);
  }
  .workout-page .eyebrow,
  .workout-page .superset-kicker {
    color: var(--color-primary) !important;
  }
  .workout-page button {
    background: #152a43;
    border-color: #47749a;
    color: var(--color-text);
  }
  .workout-page button.primary {
    background: linear-gradient(180deg, #66e2ff, #32b9dc);
    border-color: #94edff;
    color: #04131d;
  }
  .workout-page section,
  .workout-page details.exercise-card {
    background:
      linear-gradient(115deg, rgb(255 255 255 / 3%), transparent 25%),
      linear-gradient(180deg, rgb(17 29 46 / 88%), rgb(9 17 30 / 88%));
    backdrop-filter: blur(3px);
    border-color: #314b64;
    box-shadow: var(--shadow-card);
  }
  .workout-page details.exercise-card.progress-partial {
    border-color: var(--color-warning);
  }
  .workout-page details.exercise-card.progress-complete {
    border-color: var(--color-positive);
  }
  .workout-page details.exercise-card:not([open]).progress-partial {
    box-shadow: 0 0 18px rgb(255 200 87 / 24%);
  }
  .workout-page
    details.exercise-card:not([open]).progress-partial
    > .exercise-summary {
    background: rgb(255 200 87 / 11%);
  }
  .workout-page details.exercise-card:not([open]).progress-complete {
    box-shadow: 0 0 20px rgb(59 227 162 / 24%);
  }
  .workout-page
    details.exercise-card:not([open]).progress-complete
    > .exercise-summary {
    background: rgb(59 227 162 / 11%);
  }
  .workout-page .exercise-body,
  .workout-page .paired-exercise,
  .workout-page .unpaired-exercise,
  .workout-page .set-header,
  .workout-page .set-row {
    border-color: #29425f;
  }
  .workout-page .optional {
    background: rgb(154 124 255 / 14%);
    border: 1px solid rgb(154 124 255 / 35%);
    color: #d8cfff;
  }
  .workout-page .superset-card {
    border-color: rgb(154 124 255 / 58%) !important;
    box-shadow: 0 0 18px rgb(154 124 255 / 12%);
  }
  .workout-page .superset-summary,
  .workout-page .superset-instruction,
  .workout-page .superset-help,
  .workout-page .superset-round,
  .workout-page .substitution,
  .workout-page .calibration-help,
  .workout-page .weight-help,
  .workout-page .skip-help p {
    background: rgb(8 17 30 / 78%);
    border-color: #304a63;
    color: var(--color-text);
  }
  .workout-page .superset-instruction {
    border-left-color: var(--color-violet);
  }
  .workout-page .round-progress,
  .workout-page .paired-exercise-title span {
    background: var(--color-violet);
  }
  .workout-page .superset-round.round-complete {
    background: rgb(59 227 162 / 9%);
    border-color: rgb(59 227 162 / 48%);
  }
  .workout-page .set-header {
    color: var(--color-text-muted);
  }
  .workout-page input,
  .workout-page select {
    background: #07101e;
    border-color: #3a526e;
    color: var(--color-text);
  }
  .workout-page .exercise-feedback {
    background: rgb(78 219 255 / 8%);
    border-color: rgb(78 219 255 / 35%);
  }
  .workout-page .pain-fields,
  .workout-page .mode-note,
  .workout-page .rir-warning {
    background: rgb(255 200 87 / 9%);
    border-color: var(--color-warning);
    color: #ffe6ad;
  }
  .workout-page .pain-note {
    background: rgb(255 93 108 / 10%);
    border-color: var(--color-danger);
    color: #ffd8dc;
  }
  .workout-page button.skip {
    border-color: var(--color-danger);
    color: #ffb0b8;
  }
  :global(html[data-theme="cute"]) .workout-page .overview-button,
  :global(html[data-theme="cute"]) .workout-page .gym-toggle {
    background: #fff;
    border-color: #a20e52;
    box-shadow: 0 3px 0 #5a1a36;
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .workout-page section,
  :global(html[data-theme="cute"]) .workout-page details.exercise-card {
    background: #fff9fc;
    border-color: #5a1a36;
    box-shadow: 3px 4px 0 rgb(162 14 82 / 16%);
    color: #321523;
  }
  :global(html[data-theme="cute"])
    .workout-page
    details.exercise-card:not([open]).progress-partial
    > .exercise-summary {
    background: #fff3d1;
  }
  :global(html[data-theme="cute"])
    .workout-page
    details.exercise-card.progress-partial {
    border-color: #946000;
  }
  :global(html[data-theme="cute"])
    .workout-page
    details.exercise-card:not([open]).progress-partial {
    box-shadow: none;
  }
  :global(html[data-theme="cute"]) .workout-page .calibration-needed {
    border-color: #946000;
    box-shadow: none;
  }
  :global(html[data-theme="cute"])
    .workout-page
    details.exercise-card:not([open]).progress-complete
    > .exercise-summary {
    background: #e5f5ed;
  }
  :global(html[data-theme="cute"])
    .workout-page
    details.exercise-card.progress-complete {
    border-color: #1e7a55;
  }
  :global(html[data-theme="cute"])
    .workout-page
    details.exercise-card:not([open]).progress-complete {
    box-shadow: none;
  }
  :global(html[data-theme="cute"]) .workout-page .optional {
    background: #f0eafb;
    border-color: #6b4ba1;
    color: #4d3674;
  }
  :global(html[data-theme="cute"]) .workout-page .superset-card {
    border-color: #6b4ba1 !important;
    box-shadow: none;
  }
  :global(html[data-theme="cute"]) .workout-page .superset-summary,
  :global(html[data-theme="cute"]) .workout-page .superset-instruction,
  :global(html[data-theme="cute"]) .workout-page .superset-help,
  :global(html[data-theme="cute"]) .workout-page .superset-round,
  :global(html[data-theme="cute"]) .workout-page .substitution,
  :global(html[data-theme="cute"]) .workout-page .calibration-help,
  :global(html[data-theme="cute"]) .workout-page .weight-help,
  :global(html[data-theme="cute"]) .workout-page .skip-help p {
    background: #fff;
    border-color: #5a1a36;
    color: #321523;
  }
  :global(html[data-theme="cute"])
    .workout-page
    .superset-round.round-complete {
    background: #e5f5ed;
    border-color: #1e7a55;
  }
  :global(html[data-theme="cute"]) .workout-page .round-progress,
  :global(html[data-theme="cute"]) .workout-page .paired-exercise-title span {
    background: #6b4ba1;
    color: white;
  }
  :global(html[data-theme="cute"]) .workout-page .exercise-body,
  :global(html[data-theme="cute"]) .workout-page .paired-exercise,
  :global(html[data-theme="cute"]) .workout-page .unpaired-exercise,
  :global(html[data-theme="cute"]) .workout-page .set-header,
  :global(html[data-theme="cute"]) .workout-page .set-row {
    border-color: #5a1a36;
  }
  :global(html[data-theme="cute"]) .workout-page .exercise-feedback {
    background: #ffe2ed;
    border-color: #a20e52;
  }
  :global(html[data-theme="cute"]) .workout-page .pain-fields,
  :global(html[data-theme="cute"]) .workout-page .mode-note,
  :global(html[data-theme="cute"]) .workout-page .rir-warning,
  :global(html[data-theme="cute"]) .workout-page .gym-warning {
    background: #fff3d1;
    border-color: #946000;
    color: #674300;
  }
  :global(html[data-theme="cute"]) .workout-page .message {
    background: #ffe2ed;
    border-color: #a20e52;
    color: #321523;
  }
  :global(html[data-theme="cute"]) .workout-page .pain-note {
    background: #fff0f3;
    border-color: #b4233c;
    color: #762035;
  }
  :global(html[data-theme="cute"]) .workout-page button.skip {
    color: #7a093d;
  }
  :global(html[data-theme="cute"]) .workout-page button.primary {
    background: #a20e52 !important;
    border-color: #5a1a36 !important;
    box-shadow: 0 3px 0 #5a1a36 !important;
    color: #fff !important;
  }
  :global(html[data-theme="cute"]) .workout-page button.saved-progress {
    background: #ead6df !important;
    border-color: #a88796 !important;
    color: #694052 !important;
  }
  @media (max-width: 680px) {
    header,
    .exercise-summary {
      display: grid;
    }
    .gym-switcher {
      grid-template-columns: 1fr;
    }
    .gym-switcher > ul,
    .gym-switcher > .gym-warning {
      grid-column: 1;
    }
    .gym-toggle {
      justify-self: start;
      width: auto;
    }
    .summary-meta {
      align-items: start;
      display: flex;
      text-align: left;
    }
    .superset-instruction,
    .paired-feedback {
      grid-template-columns: 1fr;
    }
    .superset-controls,
    .superset-instruction button {
      width: 100%;
    }
    .set-header {
      display: none;
    }
    .set-row {
      align-items: end;
      border-bottom: 1px solid #e3e7ed;
      grid-template-columns: 42px repeat(2, minmax(0, 1fr));
      padding: 0.7rem 0;
    }
    .set-row > label:nth-of-type(3) {
      grid-column: 2;
    }
    .done-field {
      grid-column: 3;
      justify-items: start;
      padding: 0;
    }
    .field-label {
      color: #59657a;
      display: block;
      font-size: 0.78rem;
      font-weight: 700;
    }
    .set-number {
      align-self: center;
      grid-row: 1 / span 2;
      padding: 0;
    }
    input,
    select {
      font-size: 16px;
    }
    .pain-fields {
      grid-template-columns: 1fr;
    }
    .pain-fields > p,
    .pain-fields .warning-signs {
      grid-column: auto;
    }
    .actions button {
      width: 100%;
    }
  }
</style>
