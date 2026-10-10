import type { ArrangementRenderDocument } from "../domain/generation/model";
import type { LyricToken } from "../domain/source/model";
import { comparePositions } from "../domain/time";

/** Display all recorded verses without changing the engine's selected-verse atoms. */
export function displayLyricsByAtom(document: ArrangementRenderDocument): ReadonlyMap<string, readonly LyricToken[]> {
  const byId=new Map(document.lyricTokens.map(token=>[token.id,token]));
  const bySourceEvent=new Map<string,LyricToken[]>();
  for(const token of document.lyricTokens){
    const tokens=bySourceEvent.get(token.leadEventId) ?? [];
    tokens.push(token);bySourceEvent.set(token.leadEventId,tokens);
  }
  return new Map(document.sourceLeadTrack.atoms.map((atom,index)=>{
    const previous=document.sourceLeadTrack.atoms[index-1];
    const continuation=previous?.sourceEventId===atom.sourceEventId && atom.tiedFromPrevious
      && comparePositions(previous.range.end,atom.range.start)===0;
    const tokens=continuation ? [] : bySourceEvent.get(atom.sourceEventId)
      ?? atom.lyricTokenIds.flatMap(id=>byId.get(id) ? [byId.get(id)!] : []);
    return [atom.id,tokens];
  }));
}
