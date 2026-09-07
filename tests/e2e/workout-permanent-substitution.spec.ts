import { questionnaireScenarioForm } from "../../src/lib/questionnaire/questionnaire.fixture";
import { expect, test, type Page } from "playwright/test";
import { provisionConfirmedLocalUser } from "./local-user-provisioning";

function stringEntries(form: FormData): [string, string][] {
  return [...form.entries()].map(([name, value]) => [name, String(value)]);
}

async function authenticate(page: Page): Promise<void> {
  const email = `permanent-substitution-${Date.now()}@example.com`;
  const password = "Permanent-substitution-test";
  await page.goto("/login");
  await provisionConfirmedLocalUser(email, password);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard(?:\?.*)?$/, { timeout: 8_000 });
}

async function createProgram(page: Page): Promise<string> {
  const form = questionnaireScenarioForm({
    label: `Permanent substitution ${Date.now()}`,
    primary: "powerlifting",
    liftingDays: 4,
    planningStyle: "flexible_sequence",
    supersets: true,
  });
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  form.set("clientDate", new Date().toISOString().slice(0, 10));
  form.set("startDate", tomorrow);
  form.set("facilityAdvancedEnabled", "yes");
  form.set("barbellIncrement", "2.5");
  form.set("dumbbellIncrement", "5");
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
  const programId = new URL(page.url()).pathname.split("/").at(-1);
  if (programId === undefined) throw new Error("Program id was not created");
  return programId;
}

async function permanentlySubstituteTwoMovements(page: Page): Promise<void> {
  const choices = page.locator('select[name^="exercise."][name$=".choice"]');
  const candidateNames: string[] = [];
  for (let index = 0; index < (await choices.count()); index += 1) {
    const choice = choices.nth(index);
    if ((await choice.locator("option").count()) < 2) continue;
    const name = await choice.getAttribute("name");
    if (name !== null) candidateNames.push(name);
  }
  expect(candidateNames.length).toBeGreaterThanOrEqual(2);

  for (const name of candidateNames.slice(-2)) {
    const choice = page.locator(`[name="${name}"]`);
    const card = choice.locator(
      'xpath=ancestor::details[contains(concat(" ", normalize-space(@class), " "), " exercise-card ")][1]',
    );
    if (!(await card.evaluate((element) => element.hasAttribute("open"))))
      await card.locator(":scope > summary").click();
    await expect(choice).toBeVisible();
    const replacement = await choice
      .locator("option")
      .nth(1)
      .getAttribute("value");
    if (replacement === null)
      throw new Error("Replacement option has no value");
    const original = await choice
      .locator("option")
      .first()
      .getAttribute("value");
    expect(replacement).not.toBe(original);
    await choice.selectOption(replacement);
    await expect(choice).toHaveValue(replacement);
    const scopeName = name.replace(/\.choice$/u, ".scope");
    const scope = page.locator(`select[name="${scopeName}"]`);
    await expect(scope).toBeVisible();
    await scope.selectOption("permanent");
    await expect(scope).toHaveValue("permanent");
  }
}

async function completeEveryMovement(page: Page): Promise<void> {
  await page
    .locator('input[name$=".reps"], input[name$=".rir"], input[name$=".rpe"]')
    .evaluateAll((inputs) => {
      for (const input of inputs as HTMLInputElement[]) {
        if (input.name.endsWith(".reps")) input.value = "8";
        if (input.name.endsWith(".rir")) input.value = "3";
        if (input.name.endsWith(".rpe")) input.value = "7";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  await page.locator('select[name$=".difficulty"]').evaluateAll((selects) => {
    for (const element of selects) {
      if (!(element instanceof HTMLSelectElement)) continue;
      element.value = "medium";
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page
    .locator('input[type="checkbox"][name$=".completed"]')
    .evaluateAll((checkboxes) => {
      for (const checkbox of checkboxes as HTMLInputElement[]) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  await expect(
    page.locator('input[type="checkbox"][name$=".completed"]:not(:checked)'),
  ).toHaveCount(0);
}

async function saveEveryExerciseCheckIn(page: Page): Promise<void> {
  const buttons = page.getByRole("button", { name: "Save exercise feedback" });
  for (;;) {
    let clicked = false;
    for (let index = 0; index < (await buttons.count()); index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible())) continue;
      await button.click();
      clicked = true;
      break;
    }
    if (!clicked) return;
  }
}

test("an off-increment superset load and permanent substitutions never block finishing an all-green workout", async ({
  page,
}) => {
  await authenticate(page);
  const programId = await createProgram(page);
  await page.goto(`/programs/${programId}/workout`);
  await expect(page).toHaveURL(/\/workouts\//);
  await expect(page.locator("figure.orbital-quote")).toBeVisible();

  await permanentlySubstituteTwoMovements(page);
  await completeEveryMovement(page);

  const supersetCard = page.locator("details.superset-card").first();
  await expect(supersetCard).toBeAttached();
  const offIncrementLoad = supersetCard.locator('input[name$=".load"]').first();
  await offIncrementLoad.fill("12.5");
  expect(
    await offIncrementLoad.evaluate((element) => {
      if (!(element instanceof HTMLInputElement))
        throw new Error("Expected a load input");
      return {
        step: element.step,
        stepMismatch: element.validity.stepMismatch,
      };
    }),
  ).toEqual({ step: "any", stepMismatch: false });

  let releaseAutosave!: () => void;
  let markAutosaveSeen!: () => void;
  const autosaveRelease = new Promise<void>((resolve) => {
    releaseAutosave = resolve;
  });
  const autosaveSeen = new Promise<void>((resolve) => {
    markAutosaveSeen = resolve;
  });
  let heldAutosave = false;
  await page.route(/\/workouts\/[^/?]+\?\/save$/u, async (route) => {
    const body = route.request().postData() ?? "";
    if (!heldAutosave && body.includes("autosave")) {
      heldAutosave = true;
      markAutosaveSeen();
      await autosaveRelease;
    }
    await route.continue();
  });

  await saveEveryExerciseCheckIn(page);
  await autosaveSeen;
  expect(
    await supersetCard.evaluate(
      (element) => element instanceof HTMLDetailsElement && element.open,
    ),
  ).toBe(false);
  const cards = page.locator("details.exercise-card");
  await expect(cards).not.toHaveCount(0);
  await expect(
    page.locator("details.exercise-card:not(.progress-complete)"),
  ).toHaveCount(0);

  const save = page.getByRole("button", { name: "Save progress" });
  const finish = page.getByRole("button", {
    name: "Finish and go to next workout",
  });
  const skip = page.getByRole("button", { name: "Skip this workout" });
  await expect(save).toBeEnabled();
  await expect(finish).toBeEnabled();
  await expect(skip).toBeEnabled();

  const originalUrl = page.url();
  await finish.click();
  await expect(page.getByRole("button", { name: "Finishing…" })).toBeDisabled();
  releaseAutosave();
  await expect
    .poll(() => page.url(), { timeout: 20_000 })
    .not.toBe(originalUrl);
  expect(page.url()).toContain(`/programs/${programId}/`);
});
