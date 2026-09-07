import type { QuestionnaireInput, ValidationIssue } from "./types.js";

/** Fitness programming only. Unknown medical instructions must never be interpreted as clearance. */
export function programmingSafetyIssues(
  input: QuestionnaireInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(input.age) || input.age < 18 || input.age > 100) {
    issues.push({
      path: "age",
      severity: "blocking",
      message:
        "Automated programming supports adults ages 18–100. Youth training requires an age-appropriate program and qualified supervision; existing workout history remains available.",
      ruleIds: ["AGE-1", "SAFE-2"],
    });
  }
  for (const field of [
    "restrictedBodyAreas",
    "clinicianRestrictions",
  ] as const) {
    if (
      input.safety[field].some((restriction) => restriction.trim().length > 0)
    ) {
      issues.push({
        path: `safety.${field}`,
        severity: "blocking",
        message:
          "This restriction needs professional clarification before automated programming or progression. Free-text restrictions are not interpreted as exercise clearance; consent does not bypass this review.",
        ruleIds: ["SAFE-1", "SAFE-2"],
      });
    }
  }
  return issues;
}
