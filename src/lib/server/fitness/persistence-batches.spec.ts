import { describe, expect, it } from "vitest";
import { boundedJsonBatches } from "./persistence-batches";

describe("boundedJsonBatches", () => {
  it("preserves order while enforcing the RPC row limit", () => {
    const values = Array.from({ length: 7 }, (_, index) => ({ index }));
    expect(boundedJsonBatches(values, 3, 1024)).toEqual([
      values.slice(0, 3),
      values.slice(3, 6),
      values.slice(6),
    ]);
  });

  it("uses UTF-8 bytes rather than JavaScript character count", () => {
    const values = [{ value: "🏋️" }, { value: "🏋️" }];
    const oneValueBytes = new TextEncoder().encode(
      JSON.stringify([values[0]]),
    ).byteLength;
    expect(boundedJsonBatches(values, 10, oneValueBytes)).toEqual([
      [values[0]],
      [values[1]],
    ]);
  });

  it("rejects an individual value that cannot fit safely", () => {
    expect(() => boundedJsonBatches([{ value: "too large" }], 10, 5)).toThrow(
      RangeError,
    );
  });
});
