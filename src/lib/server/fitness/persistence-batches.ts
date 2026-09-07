const encoder = new TextEncoder();

/**
 * Splits an RPC JSON array by both its database row-count contract and a
 * conservative UTF-8 payload budget. Order is preserved so callers can stop
 * immediately on the first failed write and safely retry idempotent upserts.
 */
export function boundedJsonBatches<T>(
  values: readonly T[],
  maximumItems: number,
  maximumUtf8Bytes: number,
): T[][] {
  if (!Number.isInteger(maximumItems) || maximumItems <= 0)
    throw new RangeError("maximumItems must be a positive integer.");
  if (!Number.isInteger(maximumUtf8Bytes) || maximumUtf8Bytes < 2)
    throw new RangeError("maximumUtf8Bytes must fit a JSON array.");

  const batches: T[][] = [];
  let batch: T[] = [];
  let batchBytes = 2; // []

  for (const value of values) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      throw new TypeError("Fitness persistence values must be JSON values.");
    const valueBytes = encoder.encode(serialized).byteLength;
    if (valueBytes + 2 > maximumUtf8Bytes)
      throw new RangeError("One fitness persistence value is too large.");

    const nextBytes = batchBytes + valueBytes + (batch.length === 0 ? 0 : 1);
    if (batch.length >= maximumItems || nextBytes > maximumUtf8Bytes) {
      batches.push(batch);
      batch = [];
      batchBytes = 2;
    }
    batch.push(value);
    batchBytes += valueBytes + (batch.length === 1 ? 0 : 1);
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}
