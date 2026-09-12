import { semanticDigest, canonicalJson } from "../../domain/digest/canonical";
import { addFractions, compareFractions, fraction } from "../../domain/fraction";
import { deriveFifths } from "../../domain/pitch";
import { validatePerformer } from "../../domain/performer";
import { clean, measures, requireMeasure } from "./edit";
import { __musicXmlParserInternals } from "../musicxml/parser-core";
import type { WorkspaceAttestation, WorkspaceCapabilities, WorkspaceIssue, WorkspaceScope, WorkspaceState } from "./model";

export function effectiveWorkspaceKey(state: WorkspaceState, measureId: string) {
  const m = requireMeasure(state, measureId), o = m.keyObservation;
  return o ? state.request.keys[o.contextId] ?? (o.interpretation === "explicit-source-mode" && (o.explicitMode === "major" || o.explicitMode === "minor") ? __musicXmlParserInternals.keyFromFifths(o.fifths,o.explicitMode) : undefined) : undefined;
}
export function selectedWorkspacePart(state: WorkspaceState) {
  const lead = state.music?.leadCandidates.find(c => c.key === state.request.lead);
  return state.music?.parts.find(p => p.partOrdinal === lead?.partOrdinal);
}
export function workspaceScopeRelevant(state: WorkspaceState, scope: WorkspaceScope): boolean {
  if (scope.kind === "metadata") return false;
  if (scope.kind === "document") return true;
  const part = selectedWorkspacePart(state);
  if (!part) return true;
  // Unknown/global musical influence stays blocking. Only an explicitly scoped
  // independent voice can be excluded by the request.
  if (!part.measures.some(m => m.workspaceMeasureId === scope.measureId)) return true;
  return !scope.voiceKey || [state.request.lead, ...state.request.rhythmVoices].includes(scope.voiceKey);
}

/** Carry-in chords, absolute time, inherited key/meter and tie neighbors are real
 * dependencies. A title, performer form or unrelated chord is not one. */
export async function workspaceReviewFingerprint(state: WorkspaceState, scope: WorkspaceScope, evidenceDigest: string): Promise<string> {
  let projection: unknown;
  if (scope.kind === "metadata") projection = { title: state.music?.title ?? "" };
  else if (scope.kind === "document") projection = { parts: state.music?.parts ?? [], keys: state.request.keys, issues: state.issues };
  else {
    const m = requireMeasure(state, scope.measureId);
    const part = state.music!.parts.find(p => p.measures.includes(m))!;
    const chordPart = part.measures.some(m=>m.chords.length)?part:state.music!.parts.find(p => p.measures.some(x => x.chords.length)) ?? part;
    const selected = scope.voiceKey ? new Set([scope.voiceKey, ...state.request.rhythmVoices]) : undefined;
    const notes = m.leadEvents.filter(e => !selected || selected.has(e.candidateKey));
    const tieBoundary = (other: typeof m | undefined, edge: "first" | "last") => {
      if (!other) return null;
      return [...new Set([...notes.map(e => e.candidateKey), ...(selected ?? [])])].sort().map(v => {
        const ordered = other.leadEvents.filter(e => e.candidateKey === v).sort((a,b) => compareFractions(a.onset,b.onset));
        const e = edge === "first" ? ordered[0] : ordered.at(-1);
        const own = [...notes].filter(n => n.candidateKey === v).sort((a,b) => compareFractions(a.onset,b.onset));
        const neighbor = edge === "first" ? own.at(-1) : own[0];
        const active = e && e.kind !== "rest" && (edge === "first" ? e.tieStop : e.tieStart)
          || neighbor && neighbor.kind !== "rest" && (edge === "first" ? neighbor.tieStart : neighbor.tieStop);
        return active ? e ?? null : { voice: v, tied: false };
      });
    };
    let start = fraction(0);
    for (const x of part.measures.slice(0,m.ordinal)) start = addFractions(start,x.duration);
    const priorChords = chordPart.measures.slice(0,m.ordinal).flatMap(x => [...x.chords].sort((a,b) => compareFractions(a.onset,b.onset)));
    const ownChords = chordPart.measures[m.ordinal]?.chords ?? [];
    const chordMeaning = (c: typeof ownChords[number]) => ({ id:c.key, onset:c.onset, text:c.sourceText, parseResult:c.parseResult });
    const previous = priorChords.at(-1);
    const incoming = ownChords.some(c => c.onset.n === 0) || !previous ? null : chordMeaning(previous);
    projection = { measureId: m.workspaceMeasureId, duration: m.duration, time: m.time, key: effectiveWorkspaceKey(state,scope.measureId) ?? null,
      observation: m.keyObservation ?? null, absoluteStart: start, notes, unknown: m.unresolvedEvents ?? [], chords: ownChords.map(chordMeaning), incoming,
      repeat: m.repeat, text: m.textEvents, previousTie: tieBoundary(part.measures[m.ordinal-1],"last"), nextTie: tieBoundary(part.measures[m.ordinal+1],"first") };
  }
  return semanticDigest({ schema: "hm-workspace-review-dependency-v1", evidenceDigest, scope: clean(scope), projection: clean(projection) });
}
export async function attestationCurrent(state: WorkspaceState, a: WorkspaceAttestation, evidenceDigest: string): Promise<boolean> {
  if (a.evidenceDigest !== evidenceDigest) return false;
  try { return a.dependencyFingerprint === await workspaceReviewFingerprint(state,a.scope,evidenceDigest); } catch { return false; }
}
export async function issueCurrent(state: WorkspaceState, issue: WorkspaceIssue, evidenceDigest: string): Promise<boolean> {
  if (issue.requiredAction !== "compare") return false;
  for (const a of state.attestations) if (a.purpose === "issue" && a.issueId === issue.id && canonicalJson(a.scope) === canonicalJson(issue.scope)
    && await attestationCurrent(state,a,evidenceDigest)) return true;
  return false;
}
export async function deriveWorkspaceCapabilities(state: WorkspaceState, evidenceDigest: string): Promise<WorkspaceCapabilities> {
  const blockers: { id: string; messageKo: string; scope: WorkspaceScope }[] = [];
  const add = (id: string, messageKo: string, scope: WorkspaceScope = { kind: "document" }) => blockers.push({ id,messageKo,scope });
  const part = selectedWorkspacePart(state), musicReviews: { measureId: string; current: boolean }[] = [];
  const pendingIssues: WorkspaceIssue[] = [];
  for (const issue of state.issues) if (!await issueCurrent(state,issue,evidenceDigest)) {
    pendingIssues.push(issue);
    if (issue.impacts.includes("arrange") && workspaceScopeRelevant(state,issue.scope)) add(issue.id,issue.messageKo,issue.scope);
  }
  if (!state.music) add("uninterpreted","안전하게 보존한 원시 자료가 있으나 현재 편집 모델로 음악을 해석하지 못했습니다.");
  if (!part) add("lead","편곡할 Lead 성부를 명시적으로 선택하세요.");
  const inspected = part?.measures ?? measures(state); // Meter capability is visible even before lead selection.
  for (const m of inspected) {
    const mid=m.workspaceMeasureId!, scope: WorkspaceScope={kind:"measure",measureId:mid,...(state.request.lead?{voiceKey:state.request.lead}:{})};
    const t=m.time;
    if (!((t.denominator===4 && [2,4].includes(t.numerator) && t.beatGroups.length===t.numerator && t.beatGroups.every(g=>g===1))
      || t.numerator===6 && t.denominator===8 && canonicalJson(t.beatGroups)==="[3,3]")) add(`meter:${mid}`,`${m.number}마디 ${t.numerator}/${t.denominator}: 작업 공간에 보존할 수 있지만 현재 WAG 지원 밖입니다.`,scope);
    const selected = part ? new Set([state.request.lead!,...state.request.rhythmVoices]) : undefined;
    const events = m.leadEvents.filter(e=>!selected||selected.has(e.candidateKey));
    for (const e of events) {
      if (compareFractions(addFractions(e.onset,e.duration),m.duration)>0) add(`overfull:${e.workspaceEventId}`,`${m.number}마디: 이벤트가 마디 끝을 넘습니다.`,scope);
      if (e.fermata) add(`fermata:${e.workspaceEventId}`,`${m.number}마디의 페르마타를 대조하세요. 현재 엔진은 페르마타의 재생시간을 해석하지 않습니다.`,scope);
    }
    for (const v of new Set(events.map(e=>e.candidateKey))) {
      const ordered=events.filter(e=>e.candidateKey===v).sort((a,b)=>compareFractions(a.onset,b.onset));
      for(let i=1;i<ordered.length;i++) if(compareFractions(addFractions(ordered[i-1].onset,ordered[i-1].duration),ordered[i].onset)>0) add(`overlap:${mid}:${v}`,`${m.number}마디: 선택한 성부에 겹치는 이벤트가 있습니다.`,scope);
    }
    if(m.unresolvedEvents?.some(e=>!selected||selected.has(e.candidateKey))) add(`pitch:${mid}`,`${m.number}마디에 음높이가 미확정인 이벤트가 있습니다.`,scope);
    if(part) {
      const key=effectiveWorkspaceKey(state,mid);
      if(!key) add(`key:${mid}`,`${m.number}마디 조표의 유효 조성을 확인하세요. mode가 없는 조표는 장조 확정이 아닙니다.`,scope);
      else if(deriveFifths(key)!==m.keyObservation?.fifths) add(`fifths:${mid}`,`${m.number}마디: 확인 조성과 관찰 조표가 일치하지 않습니다. 원본 조표를 덮어쓰지 않았습니다.`,scope);
      let current=false;
      for(const a of state.attestations) if(a.purpose==="music"&&canonicalJson(a.scope)===canonicalJson(scope)&&await attestationCurrent(state,a,evidenceDigest)) current=true;
      musicReviews.push({measureId:mid,current});
      if(!current) add(`review:${mid}`,`${m.number}마디의 선택 성부·코드·기호를 원본과 대조하세요.`,scope);
      if(m.chords.some(c=>c.parseResult.status==="failed")) add(`chord:${mid}`,`${m.number}마디 코드 해석을 교정하세요.`,scope);
    }
  }
  if(part) {
    const chordPart=part.measures.some(m=>m.chords.length)?part:state.music!.parts.find(p=>p.measures.some(m=>m.chords.length));
    if(chordPart&&chordPart.partOrdinal!==part.partOrdinal) add("separate-chord-part","현재 1차 투영은 선택한 Lead 파트의 코드만 지원합니다. 다른 파트의 코드는 원본에 보존하며 자동 확인하지 않습니다.");
    const keys=part.measures.map(m=>effectiveWorkspaceKey(state,m.workspaceMeasureId!));
    if(keys[0]&&keys.some(k=>k&&canonicalJson(k)!==canonicalJson(keys[0]))) add("modulation","실제 유효 조성의 변화는 현재 WAG가 지원하지 않습니다.");
    for(const voice of state.request.rhythmVoices) if(!part.measures.some(m=>m.leadEvents.some(e=>e.candidateKey===voice&&e.kind==="rhythm"))
      ||part.measures.some(m=>m.leadEvents.some(e=>e.candidateKey===voice&&(e.kind==="note"||e.kind==="rhythm"&&e.lyrics.length>0)))) add(`rhythm:${voice}`,"리듬 입력에는 현재 엔진이 지원하는 rhythm/rest 성부만 선택할 수 있습니다.");
  }
  if(!state.request.tempo) add("tempo","원본 템포를 확인하고 명시적으로 저장하세요.");
  if(!state.request.rights?.allowedUses.includes("generation")) add("rights","편곡 권리 확인이 필요합니다.");
  if(state.request.performers.length!==state.request.singerCount||state.request.performers.some(s=>!s.profile||!validatePerformer(s.profile))) add("performers","가수별 실제 음역을 설정하세요.");
  if(!state.request.sections.length||state.request.sections.some(s=>s.confirmation!=="confirmed")) add("sections","편곡 구간을 확인하세요.");
  if(state.request.policy!=="existing-wag-v1"||state.request.range!=="whole-score") add("policy","이 편곡 정책/범위는 1차 작업 공간의 지원 밖입니다.");
  return {view:true,edit:!!state.music,saveDraft:true,exportWorkspace:true,arrange:blockers.length===0,playSource:false,exportSource:false,blockers,pendingIssues,musicReviews};
}
