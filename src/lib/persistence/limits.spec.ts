import { describe, expect, it } from "vitest";
import {
  PersistenceLimitError,
  assertJsonSize,
  jsonByteLength,
} from "./limits";

describe("persistence limits", () => {
  it("measures UTF-8 JSON bytes instead of JavaScript character count", () => {
    expect(jsonByteLength({ value: "🚀" })).toBe(
      new TextEncoder().encode('{"value":"🚀"}').byteLength,
    );
  });

  it("accepts a payload at the configured boundary", () => {
    expect(() => assertJsonSize("Test", { ok: true }, 11)).not.toThrow();
  });

  it("rejects an oversized payload with actionable metadata", () => {
    expect(() => assertJsonSize("Test", { message: "too large" }, 8)).toThrow(
      PersistenceLimitError,
    );
    try {
      assertJsonSize("Test", { message: "too large" }, 8);
    } catch (error) {
      expect(error).toMatchObject({ field: "Test", maximumBytes: 8 });
    }
  });
});
