import "server-only";

import type { CleanupResult, GovernanceStore } from "../persistence/store";

export interface CleanupRunResult extends CleanupResult { readonly failures: readonly { readonly scope: string; readonly message: string }[] }

export class CleanupService {
  constructor(private readonly store: GovernanceStore) {}
  async run(input: { readonly now?: Date; readonly batchSize?: number; readonly dryRun?: boolean } = {}): Promise<CleanupRunResult> {
    const batchSize = input.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new RangeError("CLEANUP_BATCH_INVALID");
    const result = await this.store.cleanup({ now: (input.now ?? new Date()).toISOString(), batchSize, dryRun: input.dryRun ?? false });
    return { ...result, failures: [] };
  }
}
