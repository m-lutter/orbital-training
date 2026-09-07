import { questionnaireScenarioForm } from "../../src/lib/questionnaire/questionnaire.fixture";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";
import { provisionConfirmedLocalUser } from "./local-user-provisioning";

const SCREENSHOT_DIR = "test-results/cute-theme";

function stringEntries(form: FormData): [string, string][] {
  return [...form.entries()].map(([name, value]) => [name, String(value)]);
}

async function authenticateLocalTestUser(page: Page): Promise<void> {
  const email = `cute-theme-${Date.now()}@example.com`;
  const password = "Cute-theme-local-test";
  await provisionConfirmedLocalUser(email, password);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard(?:\?.*)?$/, { timeout: 8_000 });
}

async function expectCuteSurface(page: Page, label: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "cute");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  expect(
    await page
      .locator("body")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(255, 177, 208)");

  const audit = await page.evaluate(() => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const actionSelector = [
      "button",
      "a.button-link",
      "a.primary-action",
      "a.secondary-action",
      "a.dashboard-button",
      "a.overview-button",
      "a.day-button",
      "a.session-open-action",
      "summary.overview-info-toggle",
      "summary.session-card-header",
      "summary.delete-trigger",
    ].join(",");
    const undersized = [...document.querySelectorAll(actionSelector)]
      .filter(visible)
      .flatMap((element) => {
        const height = element.getBoundingClientRect().height;
        return height < 43
          ? [
              `${element.tagName.toLowerCase()}.${element.className}: ${height.toFixed(1)}px`,
            ]
          : [];
      });
    const orbitalColorFragments = [
      "rgb(23, 60, 99)",
      "rgb(10, 27, 49)",
      "rgb(7, 17, 31)",
      "rgb(9, 22, 39)",
      "rgb(17, 29, 46)",
      "rgb(7, 16, 30)",
    ];
    const orbitalLeaks = [
      ...document.querySelectorAll("main *, dialog, dialog *"),
    ]
      .filter(visible)
      .flatMap((element) => {
        const style = getComputedStyle(element);
        const paint = `${style.backgroundColor} ${style.backgroundImage}`;
        return orbitalColorFragments.some((color) => paint.includes(color))
          ? [
              `${element.tagName.toLowerCase()}.${(element as HTMLElement).className}`,
            ]
          : [];
      });
    const gradientLeaks = [
      ...document.querySelectorAll("main *, dialog, dialog *"),
    ]
      .filter(visible)
      .flatMap((element) =>
        getComputedStyle(element).backgroundImage === "none"
          ? []
          : [
              `${element.tagName.toLowerCase()}.${(element as HTMLElement).className}`,
            ],
      );
    return { undersized, orbitalLeaks, gradientLeaks };
  });

  expect(audit.undersized, `${label}: undersized actions`).toEqual([]);
  expect(audit.orbitalLeaks, `${label}: Space-theme paint leaks`).toEqual([]);
  expect(audit.gradientLeaks, `${label}: retired gradient paint`).toEqual([]);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/${name}.png`,
    fullPage: true,
  });
}

async function finishCurrentWorkout(
  page: Page,
  programId: string,
): Promise<void> {
  const movementDialog = page.getByRole("dialog", {
    name: "Yesterday’s movement",
  });
  const movementPrompt = page.getByRole("button", { name: "Fill out" });
  if (await movementPrompt.isVisible().catch(() => false)) {
    await movementPrompt.click();
    await expect(movementDialog).toBeVisible();
  }
  if (await movementDialog.isVisible().catch(() => false)) {
    await movementDialog
      .getByRole("button", { name: "I couldn’t track it", exact: true })
      .click();
    await expect(movementDialog).not.toBeVisible();
  }

  await page
    .locator('input[name$=".reps"], input[name$=".rir"], input[name$=".rpe"]')
    .evaluateAll((inputs) => {
      for (const input of inputs as HTMLInputElement[]) {
        if (input.name.endsWith(".reps")) input.value = "10";
        if (input.name.endsWith(".rir")) input.value = "3";
        if (input.name.endsWith(".rpe")) input.value = "7";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  await page.locator('select[name$=".difficulty"]').evaluateAll((selects) => {
    for (const element of selects) {
      if (!(element instanceof HTMLSelectElement)) continue;
      const select = element;
      select.value = "medium";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  const completedSets = page.locator(
    'input[type="checkbox"][name$=".completed"]',
  );
  if ((await completedSets.count()) > 0) {
    await completedSets.evaluateAll((inputs) => {
      for (const element of inputs) {
        const input = element as HTMLInputElement;
        if (input.checked) continue;
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await expect(
      page.locator('input[type="checkbox"][name$=".completed"]:not(:checked)'),
    ).toHaveCount(0);
  }

  const cardioMinutes = page.locator('input[name="cardio.completedMinutes"]');
  if ((await cardioMinutes.count()) > 0) await cardioMinutes.fill("20");
  const cardioRpe = page.locator('input[name="cardio.sessionRpe"]');
  if ((await cardioRpe.count()) > 0) await cardioRpe.fill("3");

  const duration = page.locator('input[name="durationMinutes"]');
  if ((await duration.count()) > 0) await duration.fill("45");

  const previousUrl = page.url();
  await page
    .getByRole("button", { name: "Finish and go to next workout" })
    .click();
  await expect
    .poll(() => page.url(), { timeout: 15_000 })
    .not.toBe(previousUrl);
  expect(page.url()).toMatch(
    new RegExp(`/programs/${programId}/(?:workouts/|reviews/|$)`),
  );
}

test("Cute mode covers every public and authenticated product surface", async ({
  page,
}) => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("powerlifting-app-theme", "cute");
  });

  await page.goto("/");
  await expectCuteSurface(page, "landing");
  await screenshot(page, "01-landing");

  await page.goto("/onboarding");
  await expectCuteSurface(page, "onboarding");
  await screenshot(page, "02-onboarding");

  await page.goto("/login");
  await expectCuteSurface(page, "login");
  await expect(page.locator("figure.orbital-quote")).not.toBeVisible();
  await screenshot(page, "03-login");
  await authenticateLocalTestUser(page);

  await expectCuteSurface(page, "empty dashboard");
  await screenshot(page, "04-dashboard-empty");

  await page.getByRole("button", { name: "Open beta feedback" }).click();
  const feedbackDialog = page.getByRole("dialog", {
    name: "Help improve Pretty Strong Training",
  });
  await expect(feedbackDialog).toBeVisible();
  await expectCuteSurface(page, "feedback dialog");
  await screenshot(page, "04a-feedback-dialog");
  const cancelFeedback = feedbackDialog.getByRole("button", { name: "Cancel" });
  await cancelFeedback.scrollIntoViewIfNeeded();
  await expect(cancelFeedback).toBeVisible();
  await expect(
    feedbackDialog.getByRole("button", { name: "Send feedback" }),
  ).toBeVisible();
  await expectCuteSurface(page, "feedback dialog actions");
  await screenshot(page, "04b-feedback-dialog-actions");
  await cancelFeedback.click();
  await expect(feedbackDialog).not.toBeVisible();

  await page.goto("/account");
  await expectCuteSurface(page, "account");
  await expect(
    page.getByRole("button", { name: "Switch to Space appearance" }),
  ).toBeVisible();
  await screenshot(page, "05-account");

  await page.goto("/programs/new");
  await expectCuteSurface(page, "program builder");
  await screenshot(page, "06-program-builder");

  const programName = `Cute surface ${Date.now()}`;
  const form = questionnaireScenarioForm({
    label: programName,
    primary: "health",
    secondary: "cardio",
    liftingDays: 3,
    planningStyle: "calendar_days",
    advancedSchedule: true,
    cardioPlan: "general",
  });
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  form.set("clientDate", today);
  form.set("startDate", tomorrow);
  await Promise.all([
    page.waitForURL(/\/programs\/[0-9a-f-]+$/i),
    page.evaluate((entries) => {
      const questionnaire = document.createElement("form");
      questionnaire.method = "POST";
      questionnaire.action = "/programs/new?/create";
      for (const [name, value] of entries) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        questionnaire.appendChild(input);
      }
      document.body.appendChild(questionnaire);
      questionnaire.submit();
    }, stringEntries(form)),
  ]);

  const programUrl = new URL(page.url());
  const programId = programUrl.pathname.split("/").at(-1);
  if (programId === undefined) throw new Error("Program id was not created");
  expect(programId).toMatch(/^[0-9a-f-]+$/i);
  await expectCuteSurface(page, "program overview");
  await expect(
    page.locator(
      'figure.cute-quote[data-quote-placement="program_overview_before_starting"]',
    ),
  ).toBeVisible();
  await expect(page.getByText("This week's schedule")).toHaveCount(0);
  await expect(page.locator(".training-block table")).toHaveCount(0);
  await expect(page.locator(".exercise-row").first()).toBeVisible();
  await expect(page.locator("details.plan-summary")).toHaveAttribute(
    "open",
    "",
  );
  expect(
    await page
      .locator("details.plan-summary, section.training-block")
      .evaluateAll((elements) => elements.map((element) => element.className)),
  ).toEqual([
    expect.stringContaining("plan-summary"),
    expect.stringContaining("training-block"),
  ]);
  const sessionCards = page.locator("details.session-card");
  expect(await sessionCards.count()).toBeGreaterThan(1);
  await expect(sessionCards.first()).toHaveAttribute("open", "");
  await expect(sessionCards.nth(1)).not.toHaveAttribute("open", "");
  await sessionCards.nth(1).locator("summary").click();
  await expect(sessionCards.nth(1)).toHaveAttribute("open", "");
  await sessionCards.nth(1).locator("summary").click();
  await screenshot(page, "07-program-overview");

  await page.goto(`/programs/new?edit=${programId}`);
  await expectCuteSurface(page, "program editor");
  await screenshot(page, "08-program-editor");

  await page.goto(`/programs/${programId}/movement/${tomorrow}`);
  await expectCuteSurface(page, "movement check-in");
  await expect(page).toHaveTitle(new RegExp(`^Daily movement \\|`));
  await screenshot(page, "09-movement-check-in");

  await page.goto(`/programs/${programId}/workout`);
  let completedWorkouts = 0;
  while (/\/workouts\//.test(new URL(page.url()).pathname)) {
    const weekLabel =
      (await page
        .locator(".workout-page > header .eyebrow")
        .first()
        .textContent()) ?? "";
    if (completedWorkouts > 0 && !weekLabel.includes("Week 1")) break;

    await expectCuteSurface(page, `week-one workout ${completedWorkouts + 1}`);
    await expect(
      page.locator('figure.cute-quote[data-quote-placement^="workout_"]'),
    ).toBeVisible();
    if (completedWorkouts === 0) {
      await screenshot(page, "10-active-workout");
      await page.getByRole("button", { name: "Fill out" }).click();
      const movementDialog = page.getByRole("dialog", {
        name: "Yesterday’s movement",
      });
      await expect(movementDialog).toBeVisible();
      await expectCuteSurface(page, "previous-day movement dialog");
      await screenshot(page, "10a-previous-day-movement-dialog");
      await movementDialog
        .getByRole("button", { name: "I couldn’t track it", exact: true })
        .click();
      await expect(movementDialog).not.toBeVisible();
    }

    await finishCurrentWorkout(page, programId);
    completedWorkouts += 1;
    expect(completedWorkouts).toBeLessThan(8);
  }
  expect(completedWorkouts).toBeGreaterThan(0);

  await page.goto(`/programs/${programId}/reviews/1`);
  await expectCuteSurface(page, "weekly review");
  await expect(
    page.locator('figure.cute-quote[data-quote-placement^="review_"]'),
  ).toBeVisible();
  await screenshot(page, "11-weekly-review");

  await page.goto("/dashboard");
  await expectCuteSurface(page, "populated dashboard");
  await screenshot(page, "12-dashboard-populated");

  await page.goto("/this-page-does-not-exist");
  await expectCuteSurface(page, "error page");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await screenshot(page, "13-error-page");

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/dashboard");
  await expectCuteSurface(page, "320px dashboard");
  await screenshot(page, "14-dashboard-320");

  await page.goto(`/programs/${programId}`);
  await expectCuteSurface(page, "320px program overview");
  await expect(page.locator(".training-block table")).toHaveCount(0);
  expect(
    await page
      .locator("section.training-block, details.plan-summary")
      .evaluateAll((elements) => elements.map((element) => element.className)),
  ).toEqual([
    expect.stringContaining("training-block"),
    expect.stringContaining("plan-summary"),
  ]);
  const returningPlan = page.locator("details.plan-summary");
  await expect(returningPlan).not.toHaveAttribute("open", "");
  await returningPlan.locator("summary").click();
  await expect(returningPlan).toHaveAttribute("open", "");
  await expectCuteSurface(page, "expanded 320px plan at a glance");
  await returningPlan.locator("summary").click();
  await screenshot(page, "15-program-overview-320");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/programs/${programId}`);
  await expectCuteSurface(page, "desktop program overview");
  await screenshot(page, "16-program-overview-desktop");
});
