import { describe, expect, it } from "vitest";
import {
  appQuote,
  cuteQuotesForPlacement,
  cuteReviewQuotePlacement,
  cuteWorkoutQuotePlacement,
  freshAppQuote,
  freshCuteQuote,
  quotesForPlacement,
  randomAppQuote,
  randomReviewQuote,
  reviewQuote,
} from "./quotes";

describe("app quotes", () => {
  it("uses only public-domain quotations on the public login page", () => {
    expect(quotesForPlacement("login")).not.toHaveLength(0);
    expect(
      quotesForPlacement("login").every((quote) => quote.publicDomain),
    ).toBe(true);
  });

  it("selects a stable quote instead of changing during a render", () => {
    expect(appQuote("workout", "session-1")?.id).toBe(
      appQuote("workout", "session-1")?.id,
    );
  });

  it("draws a fresh quote from only the applicable page pool", () => {
    const available = quotesForPlacement("workout");
    expect(randomAppQuote("workout", () => 0)).toBe(available[0]);
    expect(randomAppQuote("workout", () => 0.999)).toBe(available.at(-1));
    expect(randomAppQuote("workout", () => 0)?.placement).toBe("workout");
  });

  it("does not repeat the immediately previous applicable quote", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const first = freshAppQuote("dashboard", {
      random: () => 0,
      storage,
    });
    const second = freshAppQuote("dashboard", {
      random: () => 0,
      storage,
    });
    expect(second?.id).not.toBe(first?.id);
  });

  it("does not put motivation copy beside a safety concern", () => {
    expect(reviewQuote("week-1", { safetyConcern: true })).toBeUndefined();
    expect(randomReviewQuote({ safetyConcern: true }, () => 0)).toBeUndefined();
  });

  it("ships only the 114 public-domain quotes cleared from the Cute slate", () => {
    const placements = [
      "program_overview_before_starting",
      "workout_general",
      "workout_strength_hypertrophy",
      "workout_cardio_health",
      "review_on_track",
      "review_exceeded_expectations",
      "review_partial_disrupted",
      "review_more_information",
      "review_adjusting_harder",
      "review_pain_recovery",
      "review_schedule_fit",
    ] as const;
    const quotes = placements.flatMap(cuteQuotesForPlacement);
    expect(quotes).toHaveLength(114);
    expect(quotes.every((quote) => quote.publicDomain)).toBe(true);
    expect(new Set(quotes.map((quote) => quote.id)).size).toBe(114);
  });

  it("rotates through a complete Cute category before repeating", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const available = cuteQuotesForPlacement("review_schedule_fit");
    const firstDeck = available.map(() =>
      freshCuteQuote("review_schedule_fit", { random: () => 0, storage }),
    );
    expect(new Set(firstDeck.map((quote) => quote?.id)).size).toBe(
      available.length,
    );
    expect(
      freshCuteQuote("review_schedule_fit", { random: () => 0, storage }),
    ).toBeDefined();
  });

  it("selects workout categories from the actual session contents", () => {
    expect(
      cuteWorkoutQuotePlacement({ hasStrength: true, hasCardio: false }),
    ).toBe("workout_strength_hypertrophy");
    expect(
      cuteWorkoutQuotePlacement({ hasStrength: false, hasCardio: true }),
    ).toBe("workout_cardio_health");
    expect(
      cuteWorkoutQuotePlacement({ hasStrength: true, hasCardio: true }),
    ).toBe("workout_general");
  });

  it("maps weekly outcomes to the matching Cute review context", () => {
    expect(cuteReviewQuotePlacement({ state: "on_track" })).toBe(
      "review_on_track",
    );
    expect(cuteReviewQuotePlacement({ state: "underloaded" })).toBe(
      "review_exceeded_expectations",
    );
    expect(
      cuteReviewQuotePlacement({
        state: "physiologically_overloaded",
      }),
    ).toBe("review_adjusting_harder");
    expect(
      cuteReviewQuotePlacement({
        state: "on_track",
        safetyConcern: true,
      }),
    ).toBe("review_pain_recovery");
    expect(
      cuteReviewQuotePlacement({
        state: "insufficient_data",
        hasLoggedWork: true,
      }),
    ).toBe("review_partial_disrupted");
    expect(
      cuteReviewQuotePlacement({
        state: "insufficient_data",
        hasLoggedWork: false,
      }),
    ).toBe("review_more_information");
  });
});
