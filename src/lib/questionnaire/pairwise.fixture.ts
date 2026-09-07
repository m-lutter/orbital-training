export type PairwiseFactors = Readonly<Record<string, readonly string[]>>;
export type PairwiseCase = Readonly<Record<string, string>>;

function pairKeys(row: PairwiseCase, names: readonly string[]): string[] {
  const keys: string[] = [];
  for (let left = 0; left < names.length; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const leftName = names[left]!;
      const rightName = names[right]!;
      keys.push(`${leftName}=${row[leftName]}|${rightName}=${row[rightName]}`);
    }
  }
  return keys;
}

function cartesianRows(
  factors: PairwiseFactors,
  names: readonly string[],
): PairwiseCase[] {
  let rows: PairwiseCase[] = [{}];
  for (const name of names) {
    const levels = factors[name];
    if (levels === undefined || levels.length === 0)
      throw new Error(`Pairwise factor ${name} has no levels.`);
    rows = rows.flatMap((row) =>
      levels.map((level) => ({ ...row, [name]: level })),
    );
  }
  return rows;
}

/**
 * Deterministic greedy covering array for test inputs. It evaluates the full
 * finite input space, then retains only rows needed to cover every two-factor
 * interaction. There is no random seed and no production dependency.
 */
export function buildPairwiseCases(factors: PairwiseFactors): PairwiseCase[] {
  const names = Object.keys(factors);
  if (names.length < 2)
    throw new Error("Pairwise coverage requires at least two factors.");

  const candidates = cartesianRows(factors, names);
  const uncovered = new Set(candidates.flatMap((row) => pairKeys(row, names)));
  const selected: PairwiseCase[] = [];
  const remaining = [...candidates];

  while (uncovered.size > 0) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const score = pairKeys(remaining[index]!, names).filter((key) =>
        uncovered.has(key),
      ).length;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    if (bestIndex < 0)
      throw new Error(
        `Unable to cover ${uncovered.size} questionnaire factor pairs.`,
      );
    const [best] = remaining.splice(bestIndex, 1);
    selected.push(best!);
    for (const key of pairKeys(best!, names)) uncovered.delete(key);
  }

  return selected;
}

export function missingPairwisePairs(
  factors: PairwiseFactors,
  cases: readonly PairwiseCase[],
): string[] {
  const names = Object.keys(factors);
  const required = new Set(
    cartesianRows(factors, names).flatMap((row) => pairKeys(row, names)),
  );
  for (const row of cases)
    for (const key of pairKeys(row, names)) required.delete(key);
  return [...required].sort();
}
