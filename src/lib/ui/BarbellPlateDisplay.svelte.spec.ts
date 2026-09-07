import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import BarbellPlateDisplay from "./BarbellPlateDisplay.svelte";

describe("BarbellPlateDisplay", () => {
  it("shows compact per-side labels and cycles to kilogram loading", async () => {
    render(BarbellPlateDisplay, {
      exerciseId: "competition_bench",
      targetLoad: 225,
      units: "lb",
      label: "Competition bench press",
    });

    const display = page.getByRole("button", {
      name: /Competition bench press: 225 lb shown with iron plates/,
    });
    await expect.element(display).toBeVisible();
    await expect.element(page.getByText("Per side")).toBeVisible();
    await expect.element(page.getByText("45lb").first()).toBeVisible();

    await display.click();
    await page.getByRole("button", { name: /color-coded lb plates/ }).click();
    await expect
      .element(page.getByRole("button", { name: /kilogram plates/ }))
      .toBeVisible();
    await expect.element(page.getByText(/kg/).first()).toBeVisible();
  });

  it("keeps the complete loading graphic inside a 320 px phone viewport", async () => {
    await page.viewport(320, 800);
    const result = await render(BarbellPlateDisplay, {
      exerciseId: "competition_squat",
      targetLoad: 495,
      units: "lb",
      label: "Competition squat",
    });

    expect(result.container.scrollWidth).toBeLessThanOrEqual(
      result.container.clientWidth,
    );
  });

  it("shows only the plates, without a bar, sleeve, or collar", () => {
    const result = render(BarbellPlateDisplay, {
      exerciseId: "competition_bench",
      targetLoad: 225,
      units: "lb",
      label: "Competition bench press",
    });

    expect(result.container.querySelector("#bar-steel")).toBeNull();
    expect(result.container.querySelectorAll(".default-plate")).toHaveLength(2);
  });
});
