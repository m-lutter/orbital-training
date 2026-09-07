import { describe, expect, it } from "vitest";
import { safeQuestionnaireAsOfDate, utcDate } from "./questionnaire-date";

const NOW = new Date("2026-08-17T23:30:00.000Z");

describe("questionnaire date boundary", () => {
  it("uses the server UTC date when no trustworthy client date is present", () => {
    expect(utcDate(NOW)).toBe("2026-08-17");
    expect(safeQuestionnaireAsOfDate(new FormData(), NOW)).toBe("2026-08-17");
  });

  it("accepts an adjacent local calendar date around midnight", () => {
    const form = new FormData();
    form.set("clientDate", "2026-08-18");
    expect(safeQuestionnaireAsOfDate(form, NOW)).toBe("2026-08-18");
  });

  it.each(["not-a-date", "2026-02-31", "2026-08-20", "2026-08-14"])(
    "rejects an implausible client date: %s",
    (candidate) => {
      const form = new FormData();
      form.set("clientDate", candidate);
      expect(safeQuestionnaireAsOfDate(form, NOW)).toBe("2026-08-17");
    },
  );

  it("rejects an impossible date even when JavaScript normalizes it near today", () => {
    const form = new FormData();
    form.set("clientDate", "2026-02-31");
    expect(
      safeQuestionnaireAsOfDate(form, new Date("2026-03-03T12:00:00.000Z")),
    ).toBe("2026-03-03");
  });
});
