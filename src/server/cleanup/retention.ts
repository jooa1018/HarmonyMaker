/** Retention policy: only add changes through an approved server policy PR. */
export const RETENTION = Object.freeze({ shareDays: 30, reportDays: 365, auditDays: 365 });
export const CLEANUP_MAX_BATCHES = 100;
export function retentionCutoff(now: string, days: number): string {
  return new Date(Date.parse(now) - days * 86_400_000).toISOString();
}
