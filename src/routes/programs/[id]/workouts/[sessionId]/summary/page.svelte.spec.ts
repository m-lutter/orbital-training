import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import SummaryPage from "./+page.svelte";
import type { PageData } from "./$types";

describe("workout summary page", () => {
  it("confirms the save without exposing live workout capture", async () => {
    render(SummaryPage, {
      props: {
        data: {
          nextHref: "/programs/program-1/workout",
        } as PageData,
      },
    });

    await expect
      .element(page.getByRole("heading", { name: "Your workout was saved" }))
      .toBeVisible();
    await expect
      .element(page.getByText(/weekly review when available/))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Continue to next workout" }))
      .toHaveAttribute("href", "/programs/program-1/workout");
    await expect
      .element(page.getByText("Heart-rate summary"))
      .not.toBeInTheDocument();
  });
});
