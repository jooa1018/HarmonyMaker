import { hasExactKeys, isPlainRecord } from "../validation";

export interface SourceSlurMark { readonly number: number; readonly type: "start" | "stop" | "continue" }
export function isSourceSlurMarks(value: unknown): value is readonly SourceSlurMark[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16
    && value.every((mark) => isPlainRecord(mark) && hasExactKeys(mark, ["number", "type"])
      && Number.isSafeInteger(mark.number) && (mark.number as number) >= 1 && (mark.number as number) <= 16
      && ["start", "stop", "continue"].includes(String(mark.type)))
    && new Set(value.map((mark) => `${mark.number}:${mark.type}`)).size === value.length;
}
