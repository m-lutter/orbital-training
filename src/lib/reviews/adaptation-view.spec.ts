import { describe, expect, it } from "vitest";
import { adaptProgram, generateProgram } from "$lib/domain";
import { meetPowerlifterInput } from "$lib/domain/tests/fixtures";
import { adaptationView } from "./adaptation-view";

describe("weekly adaptation presentation", () => {
  it("does not serialize the generated program into the review page", () => {
    const generated = generateProgram(meetPowerlifterInput());
    expect(generated.program).toBeDefined();
    const full = adaptProgram(generated.program!, [], { applyChanges: false });
    const view = adaptationView(full);
    const viewJson = JSON.stringify(view);

    expect("program" in view).toBe(false);
    expect(viewJson).not.toContain('"weeks"');
    expect(Buffer.byteLength(viewJson)).toBeLessThan(
      Buffer.byteLength(JSON.stringify(full)) * 0.1,
    );
  });
});
