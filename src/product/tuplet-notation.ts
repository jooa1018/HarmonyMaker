import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import type { ArrangementRenderDocument } from "../domain/generation/model";
import type { SourceTuplet } from "../domain/source/tuplets";
import { canonicalRangeDuration } from "./timing";

export interface NotationTupletEvent {
  readonly measureIndex: number;
  readonly offset: Fraction;
  readonly duration: Fraction;
  readonly tuplets?: readonly SourceTuplet[];
  readonly tupletCount?: number;
}

/** Display-only groups, including generated rests. A sustained whole-group note
 * keeps ordinary notation; no new attack is added to any musical plan. */
export function withTupletNotation<T extends NotationTupletEvent>(events: readonly T[], document: ArrangementRenderDocument, rest: (measureIndex: number, offset: Fraction, duration: Fraction) => T): readonly T[] {
  if (!document.sourceLeadTrack.atoms.some(a=>a.tuplets)) return events;
  const starts: Fraction[] = [fraction(0)];
  for (const measure of document.measures) starts.push(addFractions(starts.at(-1)!,measure.duration));
  const at = (index: number, offset: Fraction) => addFractions(starts[index],offset);
  const groups: {start:Fraction;end:Fraction;mark:SourceTuplet}[]=[];
  let open: {start:Fraction;mark:SourceTuplet} | undefined;
  for (const atom of document.sourceLeadTrack.atoms) {
    const mark=atom.tuplets?.[0]; if (!mark) continue;
    const start=at(atom.range.start.performanceMeasureIndex,atom.range.start.offset);
    if (mark.start) open={start,mark};
    if (mark.stop && open) {groups.push({...open,end:addFractions(start,canonicalRangeDuration(document.measures,atom.range))});open=undefined;}
  }
  const filled:T[]=[];
  for (const [index,measure] of document.measures.entries()) {
    let cursor=fraction(0);
    for (const event of events.filter(e=>e.measureIndex===index).sort((a,b)=>compareFractions(a.offset,b.offset))) {
      if (compareFractions(cursor,event.offset)<0) filled.push(rest(index,cursor,subtractFractions(event.offset,cursor)));
      filled.push(event); cursor=addFractions(event.offset,event.duration);
    }
    if (compareFractions(cursor,measure.duration)<0) filled.push(rest(index,cursor,subtractFractions(measure.duration,cursor)));
  }
  const replacements=new Map<T,T>();
  for (const group of groups) {
    const members=filled.filter(e=>compareFractions(at(e.measureIndex,e.offset),group.start)>=0 && compareFractions(addFractions(at(e.measureIndex,e.offset),e.duration),group.end)<=0);
    if (members.length<2 || compareFractions(at(members[0].measureIndex,members[0].offset),group.start)!==0
      || compareFractions(addFractions(at(members.at(-1)!.measureIndex,members.at(-1)!.offset),members.at(-1)!.duration),group.end)!==0) continue;
    for (const [index,event] of members.entries()) {
      const {start,stop,...mark}=group.mark; void start; void stop;
      replacements.set(event,{...event,tuplets:[{...mark,...(index===0?{start:true as const}:{}),...(index===members.length-1?{stop:true as const}:{})}],...(index===0?{tupletCount:members.length}:{})});
    }
  }
  return filled.map(event=>replacements.get(event)??event);
}
