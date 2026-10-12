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

/** Blocked part cards show only the reason, so equal reasons share one card. */
export function uniquePartReasons<T extends { reasonKo: string }>(parts: readonly T[]): T[] {
  const seen = new Set<string>();
  return parts.filter(part => {
    if (seen.has(part.reasonKo)) return false;
    seen.add(part.reasonKo);
    return true;
  });
}
