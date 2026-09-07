import { page } from "vitest/browser";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ThemeToggle from "./ThemeToggle.svelte";
import { APP_THEME_STORAGE_KEY } from "./theme";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "orbital";
  });

  it("switches immediately and persists only a whitelisted theme name", async () => {
    render(ThemeToggle);

    await page
      .getByRole("button", { name: "Switch to Cute appearance" })
      .click();

    expect(document.documentElement.dataset.theme).toBe("cute");
    expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("cute");
    await expect
      .element(
        page.getByRole("button", {
          name: "Switch to Space appearance",
        }),
      )
      .toBeInTheDocument();
  });
});
