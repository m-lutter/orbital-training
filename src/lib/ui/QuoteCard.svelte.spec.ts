import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import QuoteCard from "./QuoteCard.svelte";

describe("QuoteCard", () => {
  it("uses legible text and a light surface in Cute mode", () => {
    document.documentElement.dataset.theme = "cute";
    try {
      const result = render(QuoteCard, {
        quote: {
          id: "test-quote",
          text: "Small steps still move you forward.",
          author: "Test author",
          source: "Test source",
          placement: "dashboard",
          publicDomain: true,
        },
      });
      const card = result.container.querySelector("figure");
      const quote = result.container.querySelector("blockquote");
      expect(card).not.toBeNull();
      expect(quote).not.toBeNull();
      expect(getComputedStyle(card as HTMLElement).backgroundImage).toBe(
        "none",
      );
      expect(getComputedStyle(quote as HTMLElement).color).toBe(
        "rgb(50, 21, 35)",
      );
    } finally {
      document.documentElement.dataset.theme = "orbital";
    }
  });
});
