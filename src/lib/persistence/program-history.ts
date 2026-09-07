import type { Json } from "$lib/database.types";
import type { ProgramDraftV3 } from "$lib/engine";
import { parseProgramDraft } from "$lib/engine/parse";
import { jsonByteLength } from "./limits";

export const PROGRAM_HISTORY_STORAGE_VERSION = 1 as const;
export const MAX_REVERSE_PATCH_BYTES = 262_144;

type HistoryPath = Array<string | number>;
type RestoreOperation = [0, HistoryPath, Json];
type RemoveOperation = [1, HistoryPath];

/**
 * A reverse patch transforms a newer JSON value back into the immediately
 * preceding value. Numeric opcodes and tokenized paths keep durable history
 * substantially smaller than another complete generated program.
 */
export type ProgramReversePatch = Array<RestoreOperation | RemoveOperation>;

export interface ProgramHistoryRow {
  versionNumber: number;
  storageFormat: "full_v3" | "reverse_patch_v1" | "current_anchor_v1";
  payload?: ProgramDraftV3 | null;
  reversePatch?: Json | null;
}

const FORBIDDEN_PATH_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Validate the frozen snapshot without presentation normalization or migration.
 * Legacy V3 remains governed by its supported read schema. Compact history has
 * always stored V3 envelopes; V1/V2 general reads stay in parseProgramDraft.
 * This is schema/relational validation, not verification of the database's
 * md5(jsonb::text) payload hash (which is not JavaScript JSON.stringify).
 */
function validateHistorySnapshot(value: unknown): ProgramDraftV3 {
  try {
    const parsed = parseProgramDraft(value);
    if (parsed.schemaVersion !== 3) {
      throw new Error("Compact program history requires a schema-v3 snapshot.");
    }
    return parsed;
  } catch (cause) {
    throw new Error("Program history snapshot failed schema verification.", {
      cause,
    });
  }
}

function isJsonRecord(value: Json): value is Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T extends Json>(value: T): T {
  return structuredClone(value);
}

function assertSafePath(path: HistoryPath): void {
  if (path.length > 64) throw new Error("Program history path is too deep.");
  for (const token of path) {
    if (typeof token === "string") {
      if (FORBIDDEN_PATH_KEYS.has(token))
        throw new Error("Program history path contains an unsafe key.");
      continue;
    }
    if (!Number.isInteger(token) || token < 0)
      throw new Error("Program history path contains an invalid array index.");
  }
}

function diffReverse(
  previous: Json,
  next: Json,
  path: HistoryPath,
  operations: ProgramReversePatch,
): void {
  if (Object.is(previous, next)) return;

  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) {
      operations.push([0, path, cloneJson(previous)]);
      return;
    }
    for (let index = 0; index < previous.length; index += 1) {
      diffReverse(previous[index], next[index], [...path, index], operations);
    }
    return;
  }

  if (isJsonRecord(previous) && isJsonRecord(next)) {
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
      .filter((key) => previous[key] !== undefined || next[key] !== undefined)
      .sort();
    for (const key of keys) {
      if (FORBIDDEN_PATH_KEYS.has(key))
        throw new Error("Program history cannot contain unsafe object keys.");
      const hadPrevious = previous[key] !== undefined;
      const hasNext = next[key] !== undefined;
      if (hadPrevious && !hasNext) {
        operations.push([0, [...path, key], cloneJson(previous[key] as Json)]);
      } else if (!hadPrevious && hasNext) {
        operations.push([1, [...path, key]]);
      } else if (hadPrevious && hasNext) {
        diffReverse(
          previous[key] as Json,
          next[key] as Json,
          [...path, key],
          operations,
        );
      }
    }
    return;
  }

  operations.push([0, path, cloneJson(previous)]);
}

export function createProgramReversePatch(
  previous: ProgramDraftV3,
  next: ProgramDraftV3,
): ProgramReversePatch {
  const operations: ProgramReversePatch = [];
  diffReverse(
    previous as unknown as Json,
    next as unknown as Json,
    [],
    operations,
  );
  return operations;
}

/**
 * Oversized patches fall back to one full historical snapshot. This keeps a
 * save reliable even when a future engine version changes most of a program.
 */
export function programReversePatchForWrite(
  previous: ProgramDraftV3,
  next: ProgramDraftV3,
): ProgramReversePatch | null {
  const patch = createProgramReversePatch(previous, next);
  return jsonByteLength(patch) <= MAX_REVERSE_PATCH_BYTES ? patch : null;
}

function parsePath(value: Json | undefined): HistoryPath {
  if (!Array.isArray(value))
    throw new Error("Program history operation has no valid path.");
  const path = value.map((token) => {
    if (typeof token !== "string" && typeof token !== "number")
      throw new Error("Program history path token is invalid.");
    return token;
  });
  assertSafePath(path);
  return path;
}

export function parseProgramReversePatch(value: Json): ProgramReversePatch {
  if (!Array.isArray(value))
    throw new Error("Program history patch must be an array.");
  return value.map((item) => {
    if (!Array.isArray(item) || (item.length !== 2 && item.length !== 3))
      throw new Error("Program history operation is malformed.");
    const opcode = item[0];
    const path = parsePath(item[1]);
    if (opcode === 0 && item.length === 3)
      return [0, path, cloneJson(item[2] as Json)] as RestoreOperation;
    if (opcode === 1 && item.length === 2) return [1, path] as RemoveOperation;
    throw new Error("Program history operation has an unknown opcode.");
  });
}

function parentAtPath(root: Json, path: HistoryPath): [Json, string | number] {
  if (path.length === 0)
    throw new Error("A root history operation has no parent.");
  let current = root;
  for (const token of path.slice(0, -1)) {
    if (typeof token === "number") {
      if (!Array.isArray(current) || token >= current.length)
        throw new Error("Program history array path does not exist.");
      current = current[token];
    } else {
      if (!isJsonRecord(current) || current[token] === undefined)
        throw new Error("Program history object path does not exist.");
      current = current[token] as Json;
    }
  }
  return [current, path.at(-1) as string | number];
}

export function applyProgramReversePatch(
  next: ProgramDraftV3,
  patchValue: Json,
): ProgramDraftV3 {
  const patch = parseProgramReversePatch(patchValue);
  let restored = cloneJson(next as unknown as Json);

  for (const operation of patch) {
    const [, path] = operation;
    if (path.length === 0) {
      if (operation[0] !== 0)
        throw new Error("Program history cannot remove the root value.");
      restored = cloneJson(operation[2]);
      continue;
    }

    const [parent, key] = parentAtPath(restored, path);
    if (typeof key === "number") {
      if (!Array.isArray(parent) || key >= parent.length)
        throw new Error("Program history array target does not exist.");
      if (operation[0] === 1)
        throw new Error("Program history cannot remove an array slot.");
      parent[key] = cloneJson(operation[2]);
    } else {
      if (!isJsonRecord(parent))
        throw new Error("Program history object target does not exist.");
      if (operation[0] === 1) delete parent[key];
      else parent[key] = cloneJson(operation[2]);
    }
  }

  return validateHistorySnapshot(restored);
}

export function reconstructProgramHistoryVersion(
  current: ProgramDraftV3,
  rows: ProgramHistoryRow[],
  targetVersion: number,
): ProgramDraftV3 {
  const verifiedCurrent = validateHistorySnapshot(current);
  const currentVersion = verifiedCurrent.program.version;
  if (
    !Number.isInteger(targetVersion) ||
    targetVersion < 1 ||
    targetVersion > currentVersion
  )
    throw new Error("Requested program history version is out of range.");
  if (targetVersion === currentVersion) return verifiedCurrent;

  const byVersion = new Map(rows.map((row) => [row.versionNumber, row]));
  if (byVersion.size !== rows.length)
    throw new Error("Program history contains duplicate version rows.");
  let restored = verifiedCurrent;
  for (
    let version = currentVersion - 1;
    version >= targetVersion;
    version -= 1
  ) {
    const row = byVersion.get(version);
    if (row === undefined)
      throw new Error(`Program history version ${version} is missing.`);
    if (row.storageFormat === "full_v3") {
      if (row.payload == null)
        throw new Error(
          `Full program history version ${version} has no payload.`,
        );
      restored = validateHistorySnapshot(row.payload);
    } else if (row.storageFormat === "reverse_patch_v1") {
      if (row.reversePatch == null)
        throw new Error(
          `Program history version ${version} has no reverse patch.`,
        );
      restored = applyProgramReversePatch(restored, row.reversePatch);
    } else {
      throw new Error(
        `Program history version ${version} is not reconstructable.`,
      );
    }
    if (restored.program.version !== version)
      throw new Error(
        `Program history version ${version} failed verification.`,
      );
  }
  return restored;
}
