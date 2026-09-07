import { describe, expect, it } from "vitest";
import { programOverviewVisit } from "./program-overview-visit";

const programId = "13f850c4-6bb2-4a1b-b6c3-f6603b606dde";

describe("program overview visit state", () => {
  it("treats a program as new once, then recognizes it", () => {
    const first = programOverviewVisit(undefined, programId);
    expect(first).toEqual({ cookieValue: programId, firstVisit: true });
    expect(programOverviewVisit(first.cookieValue, programId)).toEqual({
      cookieValue: programId,
      firstVisit: false,
    });
  });

  it("ignores malformed values and keeps the cookie bounded", () => {
    const ids = Array.from({ length: 70 }, (_, index) => {
      const suffix = index.toString(16).padStart(12, "0");
      return `13f850c4-6bb2-4a1b-b6c3-${suffix}`;
    });
    const next = programOverviewVisit(`not-an-id.${ids.join(".")}`, programId);
    const retained = next.cookieValue.split(".");

    expect(retained).toHaveLength(64);
    expect(retained.at(-1)).toBe(programId);
    expect(retained).not.toContain("not-an-id");
  });
});
