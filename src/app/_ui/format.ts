export type PartChoice = "alto" | "tenor" | "both";
export function formatMeasureList(measures: readonly number[]): string {
  const sorted = [...new Set(measures)].sort((a, b) => a - b);
  const groups: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    groups.push(end - i >= 2 ? `${start}–${sorted[end]}` : sorted.slice(i, end + 1).join("·"));
    i = end;
  }
  return groups.length ? `${groups.join("·")}번째` : "";
}
export function partialTitle(partLabel: string, missing: readonly number[]): string {
  return missing.length ? `${partLabel} ${formatMeasureList(missing)} 마디는 만들지 못했어요` : `${partLabel}를 만들지 못했어요`;
}
export function partsLabelKo(parts: readonly ("alto" | "tenor")[]): string {
  return (["alto", "tenor"] as const).filter(p => parts.includes(p)).map(p => p === "alto" ? "알토" : "테너").join("와 ");
}
export function ctaLabel(choice: PartChoice | undefined): string {
  return choice ? `${choice === "both" ? "알토·테너" : choice === "alto" ? "알토" : "테너"} 화음 만들기` : "화음 파트를 골라 주세요";
}
export function formatClock(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function formatSavedDate(iso: string, now: Date): string {
  const date = new Date(iso);
  return `${date.getFullYear() === now.getFullYear() ? "" : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일`;
}
export function titleFromFileName(fileName: string): string { return fileName.replace(/\.(musicxml|mxl|xml)$/i, ""); }
