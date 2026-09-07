import { deduplicateRecords } from "../health/normalize";
import { selectedHealthDataTypes } from "../health/permissions";
import type {
  HealthDeletion,
  HealthPermissionSelection,
  HealthProvider,
  NormalizedHealthRecord,
  SyncTrigger,
} from "../health/types";
import type { HealthStateStore } from "../storage/storage";
import {
  buildActiveWorkoutReadWindow,
  buildReadWindow,
  shouldRunSync,
} from "./policy";
import type { HealthSyncTransport } from "./transport";

const MAX_RECORDS_PER_RUN = 2_000;
const MAX_ITEMS_PER_REQUEST = 2_000;

export interface SyncOptions {
  readonly extraRecords?: readonly NormalizedHealthRecord[];
  readonly selection?: HealthPermissionSelection;
  /** Bypass the normal daily/staleness gate, e.g. for an active workout. */
  readonly force?: boolean;
  /** Restricts provider reads to an incremental active-workout window. */
  readonly activeWorkoutStartedAt?: string;
  readonly activeWorkoutSourceSessionKey?: string;
}

function resolvedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export interface SyncResult {
  readonly status: "completed" | "skipped";
  readonly reason?: "not_due" | "no_permissions" | "unavailable";
  readonly records: number;
  readonly deletions: number;
  readonly truncated: boolean;
  readonly workoutCapture?: {
    readonly endedAt?: string;
    readonly sourceSessionKey: string;
  };
}

function createRunId(now: Date): string {
  return `health-${now.getTime().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

export class HealthSyncEngine {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dependencies: {
      userId: string;
      provider: HealthProvider;
      store: HealthStateStore;
      transport: HealthSyncTransport;
      now?: () => Date;
      timeZone?: () => string;
    },
  ) {}

  sync(trigger: SyncTrigger, options: SyncOptions = {}): Promise<SyncResult> {
    const operation = this.queue.then(() => this.performSync(trigger, options));
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async performSync(
    trigger: SyncTrigger,
    options: SyncOptions,
  ): Promise<SyncResult> {
    const now = this.dependencies.now?.() ?? new Date();
    const provider = this.dependencies.provider;
    const userId = this.dependencies.userId;
    const selection =
      options.selection ??
      (await this.dependencies.store.getPermissions(userId, provider.name));
    const [lastSuccessAt, catchUpNeededAt] = await Promise.all([
      this.dependencies.store.getLastSuccess(userId, provider.name),
      this.dependencies.store.getCatchUpNeeded(userId, provider.name),
    ]);

    if (
      !options.force &&
      !shouldRunSync({ trigger, now, lastSuccessAt, catchUpNeededAt }) &&
      !options.extraRecords?.length
    )
      return {
        status: "skipped",
        reason: "not_due",
        records: 0,
        deletions: 0,
        truncated: false,
      };

    if (
      selectedHealthDataTypes(selection).length === 0 &&
      !options.extraRecords?.length
    )
      return {
        status: "skipped",
        reason: "no_permissions",
        records: 0,
        deletions: 0,
        truncated: false,
      };

    const availability = await provider.getAvailability();
    if (!availability.available)
      return {
        status: "skipped",
        reason: "unavailable",
        records: 0,
        deletions: 0,
        truncated: false,
      };

    const cursor = await this.dependencies.store.getCursor(
      userId,
      provider.name,
    );
    const window = options.activeWorkoutStartedAt
      ? buildActiveWorkoutReadWindow({
          now,
          startedAt: options.activeWorkoutStartedAt,
          ...(cursor ? { cursor } : {}),
        })
      : buildReadWindow({
          now,
          ...(cursor ? { cursor } : {}),
          allowHistoryOlderThan30Days: selection.allowHistoryOlderThan30Days,
        });
    const extraRecords = deduplicateRecords(options.extraRecords ?? []);
    const read =
      selectedHealthDataTypes(selection).length === 0
        ? {
            records: [] as readonly NormalizedHealthRecord[],
            deletions: [] as readonly HealthDeletion[],
            truncated: false,
            nextCursor:
              cursor ??
              ({
                schemaVersion: 1,
                provider: provider.name,
                lastWindowEndAt: window.endAt,
              } as const),
          }
        : await provider.read({
            selection,
            ...(cursor ? { cursor } : {}),
            window,
            limit: Math.max(1, MAX_RECORDS_PER_RUN - extraRecords.length),
            mode: options.activeWorkoutStartedAt ? "workout" : "daily",
          });
    const allRecords = deduplicateRecords([...extraRecords, ...read.records]);
    const records = allRecords.slice(0, MAX_ITEMS_PER_REQUEST);
    const deletions = read.deletions.slice(0, MAX_ITEMS_PER_REQUEST);
    const truncated =
      read.truncated ||
      records.length < allRecords.length ||
      deletions.length < read.deletions.length;
    if (truncated && read.nextCursor.lastWindowEndAt === window.endAt) {
      await this.dependencies.store.markCatchUpNeeded(userId, provider.name);
      throw new Error(
        "The health provider did not return a resumable cursor for its partial read.",
      );
    }
    const syncRunId = createRunId(now);

    try {
      if (
        records.length > 0 ||
        deletions.length > 0 ||
        lastSuccessAt === null ||
        options.activeWorkoutStartedAt !== undefined
      ) {
        const acknowledgement = await this.dependencies.transport.send({
          schemaVersion: 1,
          syncRunId,
          trigger,
          userId,
          provider: provider.name,
          timeZone: this.dependencies.timeZone?.() || resolvedTimeZone(),
          window,
          batch: { index: 0, count: 1 },
          permissions: selection,
          records,
          deletions,
          proposedCursor: read.nextCursor,
          generatedAt: now.toISOString(),
          truncated,
          ...(options.activeWorkoutStartedAt
            ? {
                activeWorkout: {
                  startedAt: options.activeWorkoutStartedAt,
                  ...(options.activeWorkoutSourceSessionKey
                    ? {
                        sourceSessionKey: options.activeWorkoutSourceSessionKey,
                      }
                    : {}),
                },
              }
            : {}),
        });
        await this.dependencies.store.commitSuccess({
          userId,
          provider: provider.name,
          cursor: read.nextCursor,
          at: now.toISOString(),
        });
        if (truncated)
          await this.dependencies.store.markCatchUpNeeded(
            userId,
            provider.name,
          );
        return {
          status: "completed",
          records: records.length,
          deletions: deletions.length,
          truncated,
          ...(acknowledgement.workoutCapture
            ? { workoutCapture: acknowledgement.workoutCapture }
            : {}),
        };
      }
      await this.dependencies.store.commitSuccess({
        userId,
        provider: provider.name,
        cursor: read.nextCursor,
        at: now.toISOString(),
      });
      if (truncated)
        await this.dependencies.store.markCatchUpNeeded(userId, provider.name);
    } catch (error) {
      await this.dependencies.store.markCatchUpNeeded(userId, provider.name);
      throw error;
    }

    return {
      status: "completed",
      records: records.length,
      deletions: deletions.length,
      truncated,
    };
  }
}
