import { compareFractions } from "../../domain/fraction";
import type { ImportedPartDraft } from "../musicxml/types";

/** V2 reviews always include selected imported or edited slurs. Legacy v1
 * callers retain their original opt-in. Incomplete pairs have unknown reach. */
export function workspaceSlurDependencies(part:ImportedPartDraft, ordinal:number, selected:ReadonlySet<string>|undefined):unknown[] {
  const voices=new Set(part.measures.flatMap(m=>m.leadEvents.map(e=>e.candidateKey)).filter(v=>!selected||selected.has(v)));
  const result:unknown[]=[];
  for(const voice of [...voices].sort()) {
    const entries=part.measures.flatMap(m=>m.leadEvents.filter(e=>e.candidateKey===voice).sort((a,b)=>compareFractions(a.onset,b.onset)).map(event=>({measure:m.ordinal,event})));
    const starts=new Map<number,number>();
    const span=(number:number,start:number,end:number,complete:boolean)=>{
      const first=entries[start],last=entries[end];
      if(first.measure===last.measure||ordinal<first.measure||ordinal>last.measure)return;
      result.push({voice,number,complete,events:entries.slice(start,end+1)});
    };
    entries.forEach(({event},i)=>{
      if(event.kind==="rest")return;
      for(const mark of event.slurs??[]) {
        if(mark.type==="stop") {const start=starts.get(mark.number);span(mark.number,start??0,i,start!==undefined);starts.delete(mark.number);}
        if(mark.type==="start") {const previous=starts.get(mark.number);if(previous!==undefined)span(mark.number,previous,i,false);starts.set(mark.number,i);}
      }
    });
    for(const [number,start] of starts)span(number,start,entries.length-1,false);
  }
  return result;
}
