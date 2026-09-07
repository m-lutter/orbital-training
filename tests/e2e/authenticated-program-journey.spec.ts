import { questionnaireScenarioForm } from "../../src/lib/questionnaire/questionnaire.fixture";
import { expect, test, type Page } from "playwright/test";
import { provisionConfirmedLocalUser } from "./local-user-provisioning";

function stringEntries(form: FormData): [string, string][] {
  return [...form.entries()].map(([name, value]) => [name, String(value)]);
}

async function expectNoPageOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
}

async function authenticateLocalTestUser(page: Page): Promise<void> {
  const email = `phase5-mobile-${Date.now()}@example.com`;
  const password = "Phase5-local-browser-test";
  await provisionConfirmedLocalUser(email, password);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard(?:\?.*)?$/, { timeout: 8_000 });
}

test("a mobile user can authenticate, create, read, and reopen an exact program setup", async ({
  page,
}) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const programName = `Mobile contract ${unique}`;

  await page.goto("/login");
  await authenticateLocalTestUser(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectNoPageOverflow(page);

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

  await expect(page.getByRole("heading", { name: programName })).toBeVisible();
  await expectNoPageOverflow(page);
  await expect(page.locator("details.plan-summary")).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.getByText("This week's schedule")).toHaveCount(0);
  await expect(page.locator(".training-block table")).toHaveCount(0);
  await expect(page.locator(".exercise-row").first()).toBeVisible();
  await expect(page.locator("a.session-open-action").first()).toHaveAttribute(
    "href",
    /\/programs\/[0-9a-f-]+\/workouts\//i,
  );

  await page.getByRole("link", { name: "Edit plan setup" }).click();
  await expect(page).toHaveURL(/\/programs\/new\?edit=[0-9a-f-]+$/i);
  await expect(page.locator('input[name="name"]')).toHaveValue(programName);
  await expect(page.locator('select[name="primaryGoal"]')).toHaveValue(
    "health",
  );
  await expect(page.locator('select[name="secondaryGoal"]')).toHaveValue(
    "cardio",
  );
  await expectNoPageOverflow(page);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: programName })).toBeVisible();
  await expect(page.getByText("Daily movement", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("grid", { name: "Seven-day training plan" }),
  ).toBeVisible();
  await expect(
    page.locator(".calendar-grid.week-view .calendar-day"),
  ).toHaveCount(7);
  await expectNoPageOverflow(page);

  await expect(page.locator("html")).toHaveAttribute("data-theme", "orbital");
  await expect(
    page.getByRole("button", { name: "Switch to Cute appearance" }),
  ).not.toBeVisible();

  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { name: "Account and training data" }),
  ).toBeVisible();
  await expect(page.getByText("WHOOP", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to Cute appearance" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "cute");
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "cute");
  await expect
    .poll(() =>
      page
        .locator(".current-mission")
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe("rgb(50, 21, 35)");
  await expectNoPageOverflow(page);
});
