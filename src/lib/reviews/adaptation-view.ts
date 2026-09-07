import type { AdaptationResult } from "$lib/domain";

export type AdaptationView = Omit<AdaptationResult, "program">;

/** A weekly review never needs to serialize the next full program. */
export function adaptationView(result: AdaptationResult): AdaptationView {
  return {
    state: result.state,
    confidence: result.confidence,
    reviewedWeeks: result.reviewedWeeks,
    changes: result.changes,
    safetySignals: result.safetySignals,
    explanation: result.explanation,
    warnings: result.warnings,
    triggeredRuleIds: result.triggeredRuleIds,
  };
}
