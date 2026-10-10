import { canonicalJson } from "../../domain/digest/canonical";
import { compareFractions } from "../../domain/fraction";
import { localCandidateEvidence } from "../../domain/omr/local-candidate";
import { workspaceSlurDependencies } from "./slur-dependencies";
import type { WorkspaceIssue, WorkspaceOrigin, WorkspaceState } from "./model";

export interface WorkspaceIssueDependency {
  readonly issueId: string;
  readonly field: "lyrics" | "chord" | "meter" | "rhythm-slash" | "timeline-extent" | "event" | "unknown";
  readonly measureIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly association: "event" | "measure" | "region" | "system";
}
const eventId = (id: unknown) => typeof id === "string" && /^(?:d0)?p\d+m\d+n\d+$/u.test(id) ? id.replace(/^d0/u, "") : undefined;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function box(value: unknown): readonly number[] | undefined {
  return Array.isArray(value)&&value.length===4&&value.every(n=>typeof n==="number"&&Number.isFinite(n))&&value[2]>value[0]&&value[3]>value[1] ? value : undefined;
}

/** Interpret provenance as a dependency, never as approval or a resolved OCR
 * fact. Raw issues and their original scopes remain untouched. Unknown or
 * contradictory locations keep their original conservative scope. */
export function resolveWorkspaceIssueDependencies(state: WorkspaceState, origin: Pick<WorkspaceOrigin,"localCandidate">): readonly WorkspaceIssueDependency[] {
  if (!origin.localCandidate || !state.music) return [];
  const evidence = localCandidateEvidence(origin.localCandidate), links = record(JSON.parse(origin.localCandidate.artifacts.links.text));
  const linkedMeasures: Record<string,unknown>[] = Array.isArray(links.measures) ? links.measures.map(entry => ({...record(record(entry).measure),physicalBox:record(entry).box})) : [];
  const measures = state.music.parts.flatMap(p => p.measures);
  const ids = new Set(measures.map(m => m.workspaceMeasureId));
  const result: WorkspaceIssueDependency[] = [];
  for (const issue of state.issues) {
    const match = /^candidate:(\d+)$/u.exec(issue.id);
    const candidate = match ? record(evidence.candidates[Number(match[1])]) : {};
    const association = record(candidate.association);
    const linkedId = issue.id.startsWith("link:") ? eventId(issue.id.slice(5)) : undefined;
    if(association.eventIds!==undefined&&!Array.isArray(association.eventIds)
      ||candidate.attachmentOptions!==undefined&&!Array.isArray(candidate.attachmentOptions)
      ||association.alternatives!==undefined&&(!Array.isArray(association.alternatives)||association.alternatives.some(a=>!Array.isArray(a)||!Number.isSafeInteger(a[0])||a[0]<0)))continue;
    const references = [...(linkedId?[linkedId]:[]),...(candidate.eventId!==undefined?[candidate.eventId]:[]),
      ...(Array.isArray(association.eventIds)?association.eventIds:[]),
      ...(Array.isArray(candidate.attachmentOptions)?candidate.attachmentOptions.map(option=>record(option).eventId):[])];
    // An unknown alternative must not disappear and turn several possible
    // targets into one apparently certain target.
    if(references.some(id=>!eventId(id)))continue;
    const targets = [...new Set(references.map(id=>eventId(id)!))].sort();
    const locations = new Set<string>();
    if (issue.scope.kind === "measure") locations.add(issue.scope.measureId);
    for (const id of targets) locations.add(id.replace(/n\d+$/u, ""));
    // An unqualified measure index is not evidence for the first part. Keep
    // every possible part, including missing targets (which force fallback).
    const partIndexes = Number.isSafeInteger(candidate.partIndex)
      ? [candidate.partIndex] : state.music.parts.map(part => part.partOrdinal);
    const addMeasureIndex = (index: unknown) => {
      if (Number.isSafeInteger(index) && Number(index) >= 0)
        for (const partIndex of partIndexes) locations.add(`p${partIndex}m${index}`);
    };
    for (const index of [candidate.measureIndex, association.measureIndex]) addMeasureIndex(index);
    // Competing associations are all dependencies, never a winner selected by
    // confidence or a copied answer. A missing alternative stays conservative.
    if(Array.isArray(association.alternatives))for(const alternative of association.alternatives) {
      if(Array.isArray(alternative))addMeasureIndex(alternative[0]);
    }
    let level: WorkspaceIssueDependency["association"] = targets.length ? "event" : "measure";
    if (!locations.size && Number.isSafeInteger(candidate.systemIndex)) {
      const area=box(candidate.sourceBox),system=linkedMeasures.filter(m=>m.systemIndex===candidate.systemIndex);
      // A text fragment without an event attachment is still physically local.
      // Use every intersected printed barline interval, only when those boxes
      // cover the entire fragment. This never assigns an onset, voice or lyric.
      if(area&&system.length&&system.every(m=>box(m.physicalBox))) {
        const intersected=system.filter(m=>{const b=box(m.physicalBox)!;return b[0]<area[2]&&b[2]>area[0];}).sort((a,b)=>box(a.physicalBox)![0]-box(b.physicalBox)![0]);
        let covered=area[0];
        for(const m of intersected){const b=box(m.physicalBox)!;if(b[0]>covered+0.000001)break;covered=Math.max(covered,b[2]);}
        if(covered>=area[2]){for(const m of intersected)if(typeof m.id==="string")locations.add(m.id);level="region";}
      }
    }
    if (!locations.size && Number.isSafeInteger(candidate.systemIndex)) {
      for (const m of linkedMeasures) if (m.systemIndex === candidate.systemIndex && typeof m.id === "string") locations.add(m.id);
      level = "system";
    }
    // A missing original target remains conservative; it is not discarded to
    // make an ambiguous association look uniquely local.
    if (!locations.size || [...locations].some(id => !ids.has(id))) continue;
    const feature = candidate.feature;
    const field: WorkspaceIssueDependency["field"] = feature === "lyric" ? "lyrics"
      : feature === "chord" || feature === "meter" || feature === "rhythm-slash" || feature === "timeline-extent" ? feature
      : linkedId ? "event" : "unknown";
    if (field === "unknown") continue;
    result.push({issueId:issue.id,field,measureIds:[...locations].sort(),eventIds:targets,association:level});
  }
  return result;
}

/** Current fact projection. Voice/verse ambiguity keeps all competing events at
 * the anchored onset; moving or deleting an anchor changes the projection too. */
type DependencyPart=NonNullable<WorkspaceState["music"]>["parts"][number];
type DependencyEvent=DependencyPart["measures"][number]["leadEvents"][number];
function connectionReader() {
  const slurs=new WeakMap<DependencyPart,Map<number,unknown[]>>();
  const ties=new WeakMap<DependencyPart,Map<string,DependencyEvent[][]>>();
  return {
    slurs(part:DependencyPart,ordinal:number) {
      let byMeasure=slurs.get(part);if(!byMeasure){byMeasure=new Map();slurs.set(part,byMeasure);}
      let value=byMeasure.get(ordinal);if(!value){value=workspaceSlurDependencies(part,ordinal,undefined,false,true);byMeasure.set(ordinal,value);}
      return value;
    },
    ties(part:DependencyPart,voice:string) {
      let byVoice=ties.get(part);if(!byVoice){byVoice=new Map();ties.set(part,byVoice);}
      let value=byVoice.get(voice);if(value)return value;
      const ordered=part.measures.flatMap(measure=>[...measure.leadEvents].filter(e=>e.candidateKey===voice).sort((a,b)=>compareFractions(a.onset,b.onset)));
      value=[];
      for(let start=0;start<ordered.length;) {
        let end=start;
        while(end+1<ordered.length) {
          const a=ordered[end],b=ordered[end+1];
          if(!(a.kind!=="rest"&&a.tieStart||b.kind!=="rest"&&b.tieStop))break;
          end++;
        }
        if(end>start)value.push(ordered.slice(start,end+1));
        start=end+1;
      }
      byVoice.set(voice,value);return value;
    },
  };
}
/** Private immutable evaluation only. The reader lives for one capability or
 * replay transition; never store it across caller edits or documents. */
export function createWorkspaceIssueDependencyProjector(state:WorkspaceState) {
  const connections=connectionReader();
  return (dependency:WorkspaceIssueDependency)=>dependencyProjection(state,dependency,connections);
}
export function workspaceIssueDependencyProjection(state:WorkspaceState,dependency:WorkspaceIssueDependency):unknown {
  return dependencyProjection(state,dependency,connectionReader());
}
function dependencyProjection(state: WorkspaceState, dependency: WorkspaceIssueDependency, connections:ReturnType<typeof connectionReader>): unknown {
  const parts = state.music?.parts ?? [];
  const all = parts.flatMap(p => p.measures);
  const anchors = all.flatMap(m => m.leadEvents.filter(e => dependency.eventIds.includes(e.workspaceEventId!)).map(e => ({measureId:m.workspaceMeasureId,event:e})));
  const mids = new Set([...dependency.measureIds, ...anchors.map(a => a.measureId)]);
  return {
    dependency,
    missingEvents: dependency.eventIds.filter(id => !anchors.some(a => a.event.workspaceEventId === id)),
    measures: parts.flatMap(part => part.measures.filter(m => mids.has(m.workspaceMeasureId)).map(m => {
      const local = anchors.filter(a => a.measureId === m.workspaceMeasureId);
      const events = m.leadEvents.filter(e => !dependency.eventIds.length || !local.length || local.some(a => compareFractions(a.event.onset,e.onset) === 0));
      const timing = (e: typeof events[number]) => ({id:e.workspaceEventId,voice:e.candidateKey,kind:e.kind,onset:e.onset,duration:e.duration,...(e.tuplets ? {tuplets:e.tuplets} : {})});
      switch (dependency.field) {
        case "lyrics": {
          const slurDependencies=connections.slurs(part,m.ordinal).filter(span=>{
            const entries=record(span).events;
            return Array.isArray(entries)&&entries.some(entry=>events.some(e=>e.workspaceEventId===record(record(entry).event).workspaceEventId));
          });
          const tieDependencies: unknown[]=[];
          for(const voice of new Set(events.map(e=>e.candidateKey))) {
            for(const chain of connections.ties(part,voice))
              if(chain.some(n=>events.some(e=>e.workspaceEventId===n.workspaceEventId)))tieDependencies.push(chain);
          }
          return {id:m.workspaceMeasureId,events:events.map(e => ({...timing(e),...(e.kind !== "rest" ? {lyrics:e.lyrics,tieStart:e.tieStart,tieStop:e.tieStop,slurs:e.slurs??[]} : {})})),slurDependencies,tieDependencies};
        }
        case "chord": return {id:m.workspaceMeasureId,time:m.time,duration:m.duration,chords:m.chords.map(c => ({id:c.key,onset:c.onset,text:c.sourceText,parseResult:c.parseResult})),events:events.map(timing)};
        case "meter": return {id:m.workspaceMeasureId,time:m.time};
        case "timeline-extent": return {id:m.workspaceMeasureId,time:m.time,duration:m.duration,implicit:m.implicit,events:m.leadEvents.map(timing),unknown:m.unresolvedEvents??[]};
        case "rhythm-slash": return {id:m.workspaceMeasureId,events:events.map(e=>({...timing(e),...(e.kind === "note" ? {pitch:e.pitch} : {})})),unknown:m.unresolvedEvents??[]};
        default: return {id:m.workspaceMeasureId,events,unknown:m.unresolvedEvents??[]};
      }
    })),
  };
}

/** One question may expose several raw alternatives. It never chooses or
 * approves them: the caller must show every covered issue and current field. */
export function workspaceReviewQuestionKey(issue: WorkspaceIssue, dependency?: WorkspaceIssueDependency, observation?: unknown): string {
  if (!dependency) return `issue:${issue.id}`;
  const sourceBox=box(record(observation).sourceBox??record(observation).box);
  // A shared invalidation interval is not proof that two unanchored glyphs are
  // the same question. Only exact source-region duplicates may share that UI
  // question; otherwise retain individual unknown-location observations.
  if(!dependency.eventIds.length&&!sourceBox)return `issue:${issue.id}`;
  return canonicalJson({field:dependency.field,measures:dependency.measureIds,events:dependency.eventIds,association:dependency.association,
    // Image coordinates may be fractional. Preserve exact numeric identity as
    // strings for this presentation key; the musical codec accepts integers only.
    ...(!dependency.eventIds.length?{sourceBox:sourceBox!.map(String)}:{})});
}
