import { addFractions, compareFractions, fraction, type Fraction } from "../fraction";
import { hasExactKeys, isPlainRecord } from "../validation";

/** Written 3:2 group membership. Absent on every pre-triplet source. */
export interface SourceTuplet {
  readonly number: number;
  readonly actualNotes: 3;
  readonly normalNotes: 2;
  readonly normalType: "quarter" | "eighth" | "16th";
  readonly start?: true;
  readonly stop?: true;
}
export function tupletUnit(type: SourceTuplet["normalType"]): Fraction {
  return fraction(1, type === "quarter" ? 1 : type === "eighth" ? 2 : 4);
}
export function isSourceTuplets(value: unknown): value is readonly SourceTuplet[] {
  return Array.isArray(value) && value.length === 1 && value.every(mark => isPlainRecord(mark)
    && hasExactKeys(mark,["number","actualNotes","normalNotes","normalType"],["start","stop"])
    && Number.isSafeInteger(mark.number) && (mark.number as number) >= 1 && (mark.number as number) <= 16
    && mark.actualNotes === 3 && mark.normalNotes === 2 && ["quarter","eighth","16th"].includes(String(mark.normalType))
    && (mark.start === undefined || mark.start === true) && (mark.stop === undefined || mark.stop === true));
}

/** Whole source/share sequences, including rests. The caller supplies absolute
 * quarter positions; no floating point rounding or inferred missing members. */
export function validTupletSequence(events: readonly { start: Fraction; duration: Fraction; tuplets?: readonly SourceTuplet[] }[]): boolean {
  let active: SourceTuplet | undefined, end = fraction(0), sum = fraction(0);
  for (const event of events) {
    const mark = event.tuplets?.[0];
    if (!mark) { if (active) return false; continue; }
    if (!isSourceTuplets(event.tuplets)) return false;
    if (mark.start) {
      if (active) return false;
      active = mark; sum = fraction(0); end = event.start;
    }
    if (!active || mark.number !== active.number || mark.normalType !== active.normalType || compareFractions(end,event.start) !== 0) return false;
    sum = addFractions(sum,event.duration); end = addFractions(event.start,event.duration);
    const unit = tupletUnit(mark.normalType), expected = fraction(unit.n * 2,unit.d);
    if (compareFractions(sum,expected) > 0) return false;
    if (mark.stop) { if (compareFractions(sum,expected) !== 0) return false; active = undefined; }
  }
  return active === undefined;
}
