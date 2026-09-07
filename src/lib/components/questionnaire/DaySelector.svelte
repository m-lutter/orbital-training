<script lang="ts">
  import {
    QUESTIONNAIRE_DAY_OPTIONS,
    allQuestionnaireDays,
  } from "$lib/questionnaire/contracts";
  import type { DayOfWeek } from "$lib/domain";

  type DayChange = { day: DayOfWeek; checked: boolean };
  const componentId = $props.id();
  const helpId = `${componentId}-help`;

  let {
    name,
    legend,
    help,
    values = $bindable<DayOfWeek[]>([]),
    selectAllLabel,
    allSelected = $bindable(false),
    ondaychange,
    onselectall,
  }: {
    name: string;
    legend: string;
    help?: string;
    values?: DayOfWeek[];
    selectAllLabel?: string;
    allSelected?: boolean;
    ondaychange?: (change: DayChange) => void;
    onselectall?: (checked: boolean) => void;
  } = $props();

  function toggleAll(checked: boolean): void {
    allSelected = checked;
    if (checked) values = allQuestionnaireDays();
    onselectall?.(checked);
  }
</script>

<fieldset aria-describedby={help === undefined ? undefined : helpId}>
  <legend>{legend}</legend>
  <div class="check-grid" class:hidden={allSelected}>
    {#each QUESTIONNAIRE_DAY_OPTIONS as [value, label]}
      <label>
        <input
          {name}
          type="checkbox"
          {value}
          bind:group={values}
          onchange={(event) =>
            ondaychange?.({ day: value, checked: event.currentTarget.checked })}
        />
        {label}
      </label>
    {/each}
  </div>
  {#if selectAllLabel !== undefined}
    <label class="select-all-option">
      <input
        type="checkbox"
        checked={allSelected}
        onchange={(event) => toggleAll(event.currentTarget.checked)}
      />
      {selectAllLabel}
    </label>
  {/if}
  {#if help}<small id={helpId}>{help}</small>{/if}
</fieldset>

<style>
  fieldset {
    border: 1px solid #d9dee7;
    border-radius: 0.75rem;
    padding: 1rem;
    margin: 1.2rem 0;
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
  .hidden {
    display: none;
  }
  .check-grid label,
  .select-all-option {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .check-grid label {
    font-weight: 550;
  }
  input {
    width: auto;
    flex: 0 0 auto;
  }
  .select-all-option {
    width: fit-content;
    margin-top: 1rem;
    padding-top: 0.85rem;
    border-top: 1px solid #d9dee7;
    font-weight: 700;
  }
  small {
    display: block;
    margin-top: 0.55rem;
    color: var(--color-text-muted, #5d687c);
    font-weight: 400;
    line-height: 1.45;
  }
</style>
