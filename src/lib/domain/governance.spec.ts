import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RULES } from "./policy";
import { resolveQuestionEffects } from "./question-effects";
import { generateProgram } from "./generator";
import { baseInput } from "./tests/fixtures";

describe("evidence and questionnaire governance", () => {
  it("requires resolvable evidence, implementation, tests, and honest rule status", () => {
    for (const [id, rule] of Object.entries(RULES)) {
      expect(rule.id).toBe(id);
      expect(rule.evidenceUrls.length).toBeGreaterThan(0);
      rule.evidenceUrls.forEach((url) =>
        expect(new URL(url).protocol).toBe("https:"),
      );
      expect(rule.reviewedOn).toBe("2026-09-02");
      expect(["implemented", "partial"]).toContain(rule.status);
      [...rule.implementationPaths, ...rule.testPaths].forEach((path) =>
        expect(existsSync(path), path).toBe(true),
      );
    }
  });
  it("does not label metadata or deferred fields as programming decisions", () => {
    const effects = resolveQuestionEffects(baseInput());
    for (const effect of effects) {
      expect(effect.classification).toBeDefined();
      effect.ruleIds.forEach((id) => expect(RULES[id], id).toBeDefined());
      if (
        effect.classification === "metadata" ||
        effect.classification === "deferred"
      )
        expect(effect.used).toBe(false);
    }
  });
  it("proves exclusion inputs affect output rather than only audit text", () => {
    const input = baseInput();
    const first = generateProgram(input).program!;
    const target = first.weeks[0].sessions.flatMap(
      (session) => session.exercises,
    )[0];
    if (!target) throw new Error("Expected exercise");
    input.safety.excludedExercises = [target.exerciseId];
    const next = generateProgram(input).program!;
    expect(
      next.weeks
        .flatMap((week) => week.sessions)
        .flatMap((session) => session.exercises)
        .some((exercise) => exercise.exerciseId === target.exerciseId),
    ).toBe(false);
  });
  it("keeps the generic engine barrel on the current generator", () => {
    const barrel = readFileSync("src/lib/engine/index.ts", "utf8");
    expect(barrel).toContain("generateLegacyProgramV2");
    expect(barrel).toContain("$lib/domain/generator");
    expect(barrel).not.toContain('export * from "./generate"');
  });
});
