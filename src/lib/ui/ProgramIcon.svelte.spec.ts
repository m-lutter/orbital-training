import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ProgramIcon from "./ProgramIcon.svelte";

describe("ProgramIcon", () => {
  afterEach(() => {
    document.documentElement.dataset.theme = "orbital";
  });

  it.each([
    ["orbital_strength", "♥"],
    ["launch_vector", "cat"],
    ["orbital_relay", "✿"],
    ["solar_forge", "flower"],
    ["atlas_lifter", "dog"],
    ["mission_control", "cat_silhouette"],
    ["deep_space_pathfinder", "barbell"],
  ] as const)("renders the %s Cute artwork", (name, mark) => {
    document.documentElement.dataset.theme = "cute";
    const result = render(ProgramIcon, { name });
    const icon = result.container.querySelector(".cute-program-icon");

    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-cute-icon")).toBe(mark);
    expect(icon?.querySelector("svg")).not.toBeNull();
  });

  it("fills a small archive-sized host with the Princess Pop frame", () => {
    document.documentElement.dataset.theme = "cute";
    const result = render(ProgramIcon, { name: "launch_vector" });
    const icon = result.container.querySelector(
      ".cute-program-icon",
    ) as HTMLElement;

    expect(getComputedStyle(icon).borderTopWidth).toBe("2px");
    expect(getComputedStyle(icon).width).toBe(
      getComputedStyle(icon.parentElement!).width,
    );
  });
});
