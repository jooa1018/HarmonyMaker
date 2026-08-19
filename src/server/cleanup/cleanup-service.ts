import "server-only";

import type { CleanupResult, GovernanceStore } from "../persistence/store";
import type { OwnedObjectStore } from "../storage/owned-object-store";

export interface CleanupRunResult extends CleanupResult { readonly failures: readonly { readonly scope: string; readonly message: string }[] }

export class CleanupService {
  constructor(private readonly store: GovernanceStore, private readonly objects: OwnedObjectStore) {}
  async run(input: { readonly now?: Date; readonly batchSize?: number; readonly dryRun?: boolean } = {}): Promise<CleanupRunResult> {
    const batchSize = input.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new RangeError("CLEANUP_BATCH_INVALID");
    const now = input.now ?? new Date();
    const dryRun = input.dryRun ?? false;
    const result = await this.store.cleanup({ now: now.toISOString(), batchSize, dryRun });
    const failures: Array<{ readonly scope: string; readonly message: string }> = [];
    if (!dryRun) {
      for (const record of result.pendingObjectReferences) {
        try {
          if (this.objects.cleanup) await this.objects.cleanup(record.id, record.ownerSessionId, now);
          else await this.objects.delete(record.id, record.ownerSessionId, now);
        } catch (error) {
          failures.push({ scope: `object:${record.id}`, message: error instanceof Error ? error.message : "OBJECT_DELETE_FAILED" });
        }
      }
    }
    return { ...result, failures };
  }
}
