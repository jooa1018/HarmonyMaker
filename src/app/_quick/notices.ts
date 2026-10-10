/** Display-only grouping; keep engine notices and their diagnostic details intact. */
export function uniqueNotices<T extends { messageKo: string; actionKo: string }>(notices: readonly T[]): T[] {
  const seen = new Set<string>();
  return notices.filter(notice => {
    const key = JSON.stringify([notice.messageKo, notice.actionKo]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
