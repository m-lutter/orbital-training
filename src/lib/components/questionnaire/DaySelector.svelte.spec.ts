import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import DaySelector from "./DaySelector.svelte";

describe("DaySelector", () => {
  it("reports an individual day change using the stable day value", async () => {
    const ondaychange = vi.fn();
    render(DaySelector, {
      name: "preferredTrainingDays",
      legend: "Training days",
      values: [],
      ondaychange,
    });

    await page.getByRole("checkbox", { name: "Monday" }).click();
    expect(ondaychange).toHaveBeenCalledWith({
      day: "monday",
      checked: true,
    });
  });

  it("submits all days while collapsed and preserves them when reopened", async () => {
    render(DaySelector, {
      name: "cardioFocusedDays",
      legend: "Cardio days",
      values: ["monday"],
      selectAllLabel: "All days work",
      allSelected: false,
    });

    const selectAll = page.getByRole("checkbox", { name: "All days work" });
    // Keep the locator resolvable while the day grid is intentionally hidden.
    // Role locators exclude hidden elements unless includeHidden is explicit.
    const monday = page.getByRole("checkbox", {
      name: "Monday",
      includeHidden: true,
    });
    await selectAll.click();
    await expect.element(selectAll).toBeChecked();
    await expect.element(monday).not.toBeVisible();

    await selectAll.click();
    await expect.element(monday).toBeVisible();
    await expect.element(monday).toBeChecked();
    await expect
      .element(
        page.getByRole("checkbox", { name: "Sunday", includeHidden: true }),
      )
      .toBeChecked();
  });
});
