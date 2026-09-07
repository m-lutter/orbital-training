<script lang="ts">
  import type { QuestionnaireStep } from "$lib/questionnaire/contracts";

  let {
    editingProgram,
    step,
    stepPosition,
    steps,
    labels,
    visitedSteps,
    validating = false,
    flightStatus,
    cuteStatus,
    onstepchange,
  }: {
    editingProgram: boolean;
    step: QuestionnaireStep;
    stepPosition: number;
    steps: QuestionnaireStep[];
    labels: Record<QuestionnaireStep, string>;
    visitedSteps: QuestionnaireStep[];
    validating?: boolean;
    flightStatus: string;
    cuteStatus: string;
    onstepchange: (step: QuestionnaireStep) => void | Promise<void>;
  } = $props();

  function stepDisabled(candidate: QuestionnaireStep): boolean {
    const currentIndex = steps.indexOf(step);
    return (
      validating ||
      (steps.indexOf(candidate) > currentIndex + 1 &&
        !visitedSteps.includes(candidate))
    );
  }
</script>

<header class="questionnaire-header">
  <div>
    <a class="back-dashboard" href="/dashboard">Back to dashboard</a>
    <h1>
      {editingProgram
        ? "Review or change your program"
        : "Create your personalized program"}
    </h1>
    <p>
      Answer the questions you see. Optional expert controls stay tucked away
      unless you choose to open them.
    </p>
  </div>
  <div
    class="questionnaire-progress"
    aria-label={`Step ${stepPosition} of ${steps.length}`}
  >
    <strong>Step {stepPosition} of {steps.length}</strong>
    <span>{labels[step]}</span>
    <small>
      <i aria-hidden="true"></i>
      <span class="orbital-only">{flightStatus}</span>
      <span class="cute-only">{cuteStatus}</span>
    </small>
  </div>
</header>

<nav class="questionnaire-step-nav" aria-label="Questionnaire sections">
  {#each steps as sectionStep}
    <button
      type="button"
      class:current={step === sectionStep}
      aria-current={step === sectionStep ? "step" : undefined}
      disabled={stepDisabled(sectionStep)}
      onclick={() => void onstepchange(sectionStep)}
    >
      {labels[sectionStep]}
    </button>
  {/each}
</nav>

<style>
  .questionnaire-header,
  .questionnaire-header *,
  .questionnaire-step-nav,
  .questionnaire-step-nav * {
    box-sizing: border-box;
  }

  .questionnaire-header {
    align-items: end;
    display: flex;
    gap: 2rem;
    justify-content: space-between;
    margin-bottom: 1.5rem;
    max-width: 100%;
    min-width: 0;
    width: 100%;
  }

  .questionnaire-header > div:first-child {
    min-width: 0;
  }

  .questionnaire-header a {
    color: var(--color-primary);
  }
  .questionnaire-header .back-dashboard {
    align-items: center;
    background: linear-gradient(180deg, #233e5d, #142b47);
    border: 2px solid #78a9d0;
    border-radius: var(--radius-sm);
    color: var(--color-text);
    display: inline-flex;
    font-weight: 800;
    min-height: 2.6rem;
    padding: 0.5rem 0.75rem;
    text-decoration: none;
  }

  .questionnaire-header h1 {
    font-size: clamp(1.8rem, 4vw, 2.7rem);
    margin: 0.35rem 0;
  }

  .questionnaire-header p {
    color: var(--color-text-muted);
    margin-bottom: 0;
    max-width: 45rem;
  }

  .questionnaire-progress {
    background: var(--color-surface-subtle);
    border: 2px solid var(--color-warning);
    border-radius: 0.75rem;
    box-shadow: 0 0 18px rgb(255 200 87 / 12%);
    display: grid;
    flex: 0 0 auto;
    gap: 0.2rem;
    max-width: 100%;
    min-width: 9.375rem;
    padding: 0.8rem 1rem;
  }

  .questionnaire-progress > span {
    color: var(--color-text-muted);
    text-transform: capitalize;
  }

  .questionnaire-progress small {
    align-items: center;
    color: var(--color-text-muted);
    display: flex;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    gap: 0.45rem;
    line-height: 1.3;
  }

  .questionnaire-progress small i {
    background: var(--color-warning);
    border-radius: 50%;
    box-shadow: 0 0 10px rgb(255 200 87 / 65%);
    flex: 0 0 0.5rem;
    height: 0.5rem;
  }
  :global(html[data-theme="cute"]) .questionnaire-progress {
    box-shadow: none;
  }
  :global(html[data-theme="cute"]) .questionnaire-progress small i {
    box-shadow: none;
  }
  :global(html[data-theme="cute"]) .questionnaire-step-nav button.current {
    background: #a20e52;
    border-color: #5a1a36;
    box-shadow: 0 3px 0 #5a1a36;
    color: #fff;
  }
  :global(html[data-theme="cute"]) .questionnaire-header .back-dashboard {
    background: #fff;
    border-color: #a20e52;
    box-shadow: 0 3px 0 #5a1a36;
    color: #7a093d;
  }

  .questionnaire-step-nav {
    display: flex;
    gap: 0.45rem;
    margin: 0 0 1rem;
    max-width: 100%;
    overflow-x: auto;
    padding: 0.15rem 0 0.55rem;
    scrollbar-gutter: stable;
    width: 100%;
  }

  .questionnaire-step-nav button {
    background: var(--color-surface-subtle);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    flex: 0 0 auto;
    min-height: var(--touch-target);
    padding: 0.55rem 0.8rem;
  }

  .questionnaire-step-nav button.current {
    background: var(--color-anodized);
    border-color: var(--color-primary);
    box-shadow: 0 0 14px rgb(78 219 255 / 17%);
    color: var(--color-text);
  }

  .questionnaire-step-nav button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (max-width: 650px) {
    .questionnaire-header {
      display: grid;
      gap: 1rem;
    }

    .questionnaire-progress {
      width: 100%;
    }
  }
</style>
