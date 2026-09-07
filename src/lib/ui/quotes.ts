import type { WeeklyState } from "$lib/domain";
import { CUTE_QUOTES } from "./cute-quotes";

export type QuotePlacement = "login" | "dashboard" | "workout" | "review";

export type CuteQuotePlacement =
  | "program_overview_before_starting"
  | "workout_general"
  | "workout_strength_hypertrophy"
  | "workout_cardio_health"
  | "review_on_track"
  | "review_exceeded_expectations"
  | "review_partial_disrupted"
  | "review_more_information"
  | "review_adjusting_harder"
  | "review_pain_recovery"
  | "review_schedule_fit";

export type AppQuotePlacement = QuotePlacement | CuteQuotePlacement;

export interface AppQuote {
  id: string;
  text: string;
  author: string;
  source: string;
  sourceUrl?: string;
  placement: AppQuotePlacement;
  tone?: string;
  publicDomain: true;
}

const QUOTES: readonly AppQuote[] = [
  {
    id: "roosevelt-work-worth-doing",
    text: "Far and away the best prize that life offers is the chance to work hard at work worth doing.",
    author: "Theodore Roosevelt",
    source: "New York State Fair address, 1903",
    placement: "login",
    publicDomain: true,
  },
  {
    id: "emerson-new-day",
    text: "Finish each day and be done with it. You have done what you could.",
    author: "Ralph Waldo Emerson",
    source: "Letter to his daughter, 1854",
    placement: "login",
    publicDomain: true,
  },
  {
    id: "aurelius-dawn",
    text: "When you arise in the morning, think of what a privilege it is to be alive, to think, to enjoy, to love.",
    author: "Marcus Aurelius",
    source: "Meditations",
    placement: "login",
    publicDomain: true,
  },
  {
    id: "emerson-write-on-heart",
    text: "Write it on your heart that every day is the best day in the year.",
    author: "Ralph Waldo Emerson",
    source: "Society and Solitude",
    placement: "dashboard",
    publicDomain: true,
  },
  {
    id: "thoreau-direction",
    text: "Go confidently in the direction of your dreams. Live the life you have imagined.",
    author: "Henry David Thoreau",
    source: "Walden",
    placement: "dashboard",
    publicDomain: true,
  },
  {
    id: "epictetus-progress",
    text: "No great thing is created suddenly.",
    author: "Epictetus",
    source: "Discourses",
    placement: "dashboard",
    publicDomain: true,
  },
  {
    id: "emerson-enthusiasm",
    text: "Nothing great was ever achieved without enthusiasm.",
    author: "Ralph Waldo Emerson",
    source: "Circles",
    placement: "workout",
    publicDomain: true,
  },
  {
    id: "franklin-persistence",
    text: "Energy and persistence conquer all things.",
    author: "Benjamin Franklin",
    source: "Poor Richard's Almanack",
    placement: "workout",
    publicDomain: true,
  },
  {
    id: "tennyson-not-to-yield",
    text: "To strive, to seek, to find, and not to yield.",
    author: "Alfred, Lord Tennyson",
    source: "Ulysses",
    placement: "workout",
    publicDomain: true,
  },
  {
    id: "shakespeare-readiness",
    text: "The readiness is all.",
    author: "William Shakespeare",
    source: "Hamlet",
    placement: "workout",
    publicDomain: true,
  },
  {
    id: "virgil-possible",
    text: "They can because they think they can.",
    author: "Virgil",
    source: "The Aeneid",
    placement: "workout",
    publicDomain: true,
  },
  {
    id: "emerson-reward",
    text: "The reward of a thing well done is having done it.",
    author: "Ralph Waldo Emerson",
    source: "Essays",
    placement: "review",
    publicDomain: true,
  },
  {
    id: "roosevelt-do-what-you-can",
    text: "Do what you can, with what you have, where you are.",
    author: "Squire Bill Widener",
    source: "Quoted by Theodore Roosevelt in An Autobiography",
    placement: "review",
    publicDomain: true,
  },
  {
    id: "aurelius-quality",
    text: "The happiness of your life depends upon the quality of your thoughts.",
    author: "Marcus Aurelius",
    source: "Meditations",
    placement: "review",
    publicDomain: true,
  },
  {
    id: "confucius-moving-mountain",
    text: "The man who moves a mountain begins by carrying away small stones.",
    author: "Confucius",
    source: "Traditional attribution",
    placement: "review",
    publicDomain: true,
  },
];

function stableIndex(key: string, length: number): number {
  let hash = 0;
  for (const character of key)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return length === 0 ? 0 : hash % length;
}

export function appQuote(
  placement: QuotePlacement,
  key: string = placement,
): AppQuote | undefined {
  const available = QUOTES.filter((quote) => quote.placement === placement);
  return available[stableIndex(key, available.length)];
}

/** Chooses once per page load. Pass a seeded random function in tests. */
export function randomAppQuote(
  placement: QuotePlacement,
  random: () => number = Math.random,
): AppQuote | undefined {
  const available = quotesForPlacement(placement);
  if (available.length === 0) return undefined;
  const index = Math.min(
    available.length - 1,
    Math.max(0, Math.floor(random() * available.length)),
  );
  return available[index];
}

interface QuoteHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Draws on page mount and avoids the immediately previous quote in this tab
 * when the placement has more than one applicable option.
 */
export function freshAppQuote(
  placement: QuotePlacement,
  options: {
    random?: () => number;
    storage?: QuoteHistoryStorage;
  } = {},
): AppQuote | undefined {
  const storage =
    options.storage ??
    (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
  const storageKey = `orbital-training:last-quote:${placement}`;
  const previousId = storage?.getItem(storageKey);
  const available = quotesForPlacement(placement);
  const candidates =
    available.length > 1
      ? available.filter((quote) => quote.id !== previousId)
      : available;
  if (candidates.length === 0) return undefined;
  const random = options.random ?? Math.random;
  const index = Math.min(
    candidates.length - 1,
    Math.max(0, Math.floor(random() * candidates.length)),
  );
  const selected = candidates[index];
  if (selected) storage?.setItem(storageKey, selected.id);
  return selected;
}

export function reviewQuote(
  key: string,
  options: { safetyConcern?: boolean } = {},
): AppQuote | undefined {
  if (options.safetyConcern) return undefined;
  return appQuote("review", key);
}

export function randomReviewQuote(
  options: { safetyConcern?: boolean } = {},
  random: () => number = Math.random,
): AppQuote | undefined {
  if (options.safetyConcern) return undefined;
  return randomAppQuote("review", random);
}

export function freshReviewQuote(
  options: {
    safetyConcern?: boolean;
    random?: () => number;
    storage?: QuoteHistoryStorage;
  } = {},
): AppQuote | undefined {
  if (options.safetyConcern) return undefined;
  return freshAppQuote("review", options);
}

export function quotesForPlacement(placement: QuotePlacement): AppQuote[] {
  return QUOTES.filter((quote) => quote.placement === placement);
}

export function cuteQuotesForPlacement(
  placement: CuteQuotePlacement,
): AppQuote[] {
  return CUTE_QUOTES.filter((quote) => quote.placement === placement).map(
    (quote) => ({ ...quote }),
  );
}

/**
 * Draws every quote in a Cute-theme category once before starting a new deck.
 * The history is per browser tab so categories rotate independently and do not
 * create account data or database writes.
 */
export function freshCuteQuote(
  placement: CuteQuotePlacement,
  options: {
    random?: () => number;
    storage?: QuoteHistoryStorage;
  } = {},
): AppQuote | undefined {
  const storage =
    options.storage ??
    (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
  const available = cuteQuotesForPlacement(placement);
  if (available.length === 0) return undefined;

  const storageKey = `orbital-training:cute-quote-deck:${placement}`;
  let seen: string[] = [];
  try {
    const parsed = JSON.parse(storage?.getItem(storageKey) ?? "[]");
    if (Array.isArray(parsed))
      seen = parsed.filter(
        (value): value is string => typeof value === "string",
      );
  } catch {
    // A malformed or unavailable session value simply starts a fresh deck.
  }

  const categoryIds = new Set(available.map((quote) => quote.id));
  seen = seen.filter((id) => categoryIds.has(id));
  let candidates = available.filter((quote) => !seen.includes(quote.id));
  if (candidates.length === 0) {
    seen = [];
    candidates = available;
  }

  const random = options.random ?? Math.random;
  const index = Math.min(
    candidates.length - 1,
    Math.max(0, Math.floor(random() * candidates.length)),
  );
  const selected = candidates[index];
  if (selected) {
    try {
      storage?.setItem(storageKey, JSON.stringify([...seen, selected.id]));
    } catch {
      // Quote display is nonessential and must survive disabled storage.
    }
  }
  return selected;
}

export function cuteWorkoutQuotePlacement(options: {
  hasStrength: boolean;
  hasCardio: boolean;
}): CuteQuotePlacement {
  if (options.hasStrength && options.hasCardio) return "workout_general";
  if (options.hasCardio) return "workout_cardio_health";
  if (options.hasStrength) return "workout_strength_hypertrophy";
  return "workout_general";
}

export function cuteReviewQuotePlacement(options: {
  state: WeeklyState;
  safetyConcern?: boolean;
  hasLoggedWork?: boolean;
}): CuteQuotePlacement {
  if (options.safetyConcern || options.state === "safety_constrained")
    return "review_pain_recovery";

  const placements: Partial<Record<WeeklyState, CuteQuotePlacement>> = {
    on_track: "review_on_track",
    underloaded: "review_exceeded_expectations",
    physiologically_overloaded: "review_adjusting_harder",
    time_infeasible: "review_partial_disrupted",
    schedule_infeasible: "review_schedule_fit",
    exercise_mismatch: "review_schedule_fit",
  };
  return (
    placements[options.state] ??
    (options.hasLoggedWork
      ? "review_partial_disrupted"
      : "review_more_information")
  );
}
