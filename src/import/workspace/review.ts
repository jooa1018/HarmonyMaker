import { semanticDigest, canonicalJson } from "../../domain/digest/canonical";
import { addFractions, compareFractions, fraction } from "../../domain/fraction";
import { comparePitches, deriveFifths } from "../../domain/pitch";
import { validatePerformer } from "../../domain/performer";
import { clean, measures, requireMeasure } from "./edit";
import { __musicXmlParserInternals } from "../musicxml/parser-core";
import { workspaceSlurDependencies } from "./slur-dependencies";
import { createWorkspaceIssueDependencyProjector, resolveWorkspaceIssueDependencies, workspaceIssueDependencyProjection, type WorkspaceIssueDependency } from "./review-dependencies";
import type { WorkspaceAttestation, WorkspaceCapabilities, WorkspaceIssue, WorkspaceOrigin, WorkspaceScope, WorkspaceState } from "./model";

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
export function workspaceReviewFingerprint(state: WorkspaceState, scope: WorkspaceScope, evidenceDigest: string, dependencyVersion: 1 | 2 | 3 = 1, issueId?: string): Promise<string> {
  return fingerprintWithProjection(state,scope,evidenceDigest,dependencyVersion,issueId);
}
async function fingerprintWithProjection(state:WorkspaceState,scope:WorkspaceScope,evidenceDigest:string,dependencyVersion:1|2|3,issueId?:string,projectIssue?:(dependency:WorkspaceIssueDependency)=>unknown):Promise<string> {
  let projection: unknown;
  const dependency = dependencyVersion === 3 && issueId ? state.reviewIssueDependencies?.find(d => d.issueId === issueId) : undefined;
  if (dependency) projection = {issue:state.issues.find(i => i.id === issueId),fact:projectIssue?projectIssue(dependency):workspaceIssueDependencyProjection(state,dependency)};
  else if (scope.kind === "metadata") projection = { title: state.music?.title ?? "" };
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
    const slurDependencies=dependencyVersion>=2||state.slurReviewTracking?workspaceSlurDependencies(part,m.ordinal,selected,dependencyVersion!==3):[];
    const notationRemovals=state.notationRemovals?.filter(r=>notes.some(e=>e.workspaceEventId===r.eventId))??[];
    projection = { measureId: m.workspaceMeasureId, duration: m.duration, time: m.time, key: effectiveWorkspaceKey(state,scope.measureId) ?? null,
      observation: m.keyObservation ?? null, absoluteStart: start, notes, unknown: m.unresolvedEvents ?? [], chords: ownChords.map(chordMeaning), incoming,
      repeat: m.repeat, text: m.textEvents, previousTie: tieBoundary(part.measures[m.ordinal-1],"last"), nextTie: tieBoundary(part.measures[m.ordinal+1],"first"),
      ...(slurDependencies.length?{slurDependencies}:{}),...(notationRemovals.length?{notationRemovals}:{}) };
  }
  return semanticDigest({ schema: `hm-workspace-review-dependency-v${dependencyVersion}`, evidenceDigest, scope: clean(scope), projection: clean(projection) });
}
type FingerprintReader = (scope: WorkspaceScope, version: 1 | 2 | 3, issueId?: string) => Promise<string>;
// Independent checks share one immutable evaluation and return in input order.
// Bound pending digest buffers instead of starting one task for every issue.
async function reviewBatches<T,R>(values:readonly T[],evaluate:(value:T)=>Promise<R>):Promise<R[]> {
  const results:R[]=[];
  for(let offset=0;offset<values.length;offset+=8)
    results.push(...await Promise.all(values.slice(offset,offset+8).map(evaluate)));
  return results;
}
async function currentWithFingerprint(state: WorkspaceState, a: WorkspaceAttestation, evidenceDigest: string, fingerprint: FingerprintReader): Promise<boolean> {
  if (a.evidenceDigest !== evidenceDigest) return false;
  if(a.dependencyVersion===undefined&&state.invalidatedLegacyReviewIds?.includes(a.id))return false;
  try { return a.dependencyFingerprint === await fingerprint(a.scope,a.dependencyVersion??1,a.issueId); } catch { return false; }
}
export async function attestationCurrent(state: WorkspaceState, a: WorkspaceAttestation, evidenceDigest: string): Promise<boolean> {
  return currentWithFingerprint(state,a,evidenceDigest,(scope,version,issueId)=>workspaceReviewFingerprint(state,scope,evidenceDigest,version,issueId));
}
async function issueCurrentWithFingerprint(state: WorkspaceState, issue: WorkspaceIssue, evidenceDigest: string, fingerprint: FingerprintReader): Promise<boolean> {
  if (issue.requiredAction !== "compare") return false;
  for (const a of state.attestations) if (a.purpose === "issue" && a.issueId === issue.id && canonicalJson(a.scope) === canonicalJson(issue.scope)
    && await currentWithFingerprint(state,a,evidenceDigest,fingerprint)) return true;
  return false;
}
export async function issueCurrent(state: WorkspaceState, issue: WorkspaceIssue, evidenceDigest: string): Promise<boolean> {
  return issueCurrentWithFingerprint(state,issue,evidenceDigest,(scope,version,issueId)=>workspaceReviewFingerprint(state,scope,evidenceDigest,version,issueId));
}
/** Issues whose existing review record is still current for this exact state.
 * Used by the automatic draft to honour prior work records without requiring
 * them; the record's actor label is reported as-is, never upgraded. */
export async function currentlyReviewedIssueIds(state: WorkspaceState, evidenceDigest: string): Promise<ReadonlySet<string>> {
  const attested = new Set(state.attestations.filter(a => a.purpose === "issue" && a.issueId).map(a => a.issueId!));
  const candidates = state.issues.filter(i => attested.has(i.id));
  if (!candidates.length) return new Set();
  const projectIssue = createWorkspaceIssueDependencyProjector(state), fingerprints = new Map<string, Promise<string>>();
  const fingerprint: FingerprintReader = (scope, version, issueId) => {
    const key = `${version}:${canonicalJson(scope)}:${version === 3 ? issueId ?? "" : ""}`;
    let value = fingerprints.get(key);
    if (!value) { value = fingerprintWithProjection(state, scope, evidenceDigest, version, issueId, projectIssue); fingerprints.set(key, value); }
    return value;
  };
  const current = await reviewBatches(candidates, issue => issueCurrentWithFingerprint(state, issue, evidenceDigest, fingerprint));
  return new Set(candidates.filter((_, i) => current[i]).map(i => i.id));
}
/** Replay performs this once before the first v3 command. Only still-current
 * judgments may be retained under a narrower dependency rule. Original actor,
 * time, scope, targets and old fingerprint remain attributable; stale reviews
 * are not resurrected. The original journal is never rewritten. */
export async function retainWorkspaceReviewsV3(state: WorkspaceState, origin: WorkspaceOrigin, evidenceDigest: string, operationId: string, previousFingerprints?: ReadonlyMap<string,string>): Promise<WorkspaceState> {
  const dependencies = resolveWorkspaceIssueDependencies(state,origin);
  const next = {...state,...(dependencies.length ? {reviewIssueDependencies:dependencies} : {})};
  const projectIssue=createWorkspaceIssueDependencyProjector(next);
  // The journal may supply its private map for the exact pre-transition state.
  // Never populate this from imported proof fields or caller approval flags.
  // Snapshot the entries; new v3 fingerprints below are always recomputed.
  const fingerprints = new Map<string,Promise<string>>(
    [...previousFingerprints??[]].map(([key,value])=>[key,Promise.resolve(value)]),
  );
  const oldFingerprint: FingerprintReader = (scope,version,issueId) => {
    const key = `${version}:${canonicalJson(scope)}:${version === 3 ? issueId ?? "" : ""}`;
    let value = fingerprints.get(key);
    if (!value) { value = workspaceReviewFingerprint(state,scope,evidenceDigest,version,issueId); fingerprints.set(key,value); }
    return value;
  };
  const attestations = await reviewBatches(state.attestations,async(a):Promise<WorkspaceAttestation>=>{
    if (a.dependencyVersion === 3 || !await currentWithFingerprint(state,a,evidenceDigest,oldFingerprint)) return a;
    return {...a,dependencyVersion:3,dependencyFingerprint:await fingerprintWithProjection(next,a.scope,evidenceDigest,3,a.issueId,projectIssue),
      retainedReview:{previousVersion:a.dependencyVersion??1,previousFingerprint:a.dependencyFingerprint,transitionOperationId:operationId}};
  });
  return {...next,attestations};
}
/** Reviewed-Source gate: structural arrangement conditions plus every raw
 * issue and measure comparison. Unchanged contract for reviewed workspaces. */
export async function deriveWorkspaceCapabilities(state: WorkspaceState, evidenceDigest: string): Promise<WorkspaceCapabilities> {
  const { policyNotes, ...capabilities } = await evaluateArrangement(state, evidenceDigest, "reviewed");
  void policyNotes;
  return capabilities;
}
/** Structural conditions only (meter, time, pitch, key, voices, request).
 * Shared by the reviewed gate above and the automatic-draft assessment, so a
 * workspace "ready" verdict and the Source validator use the same rules. Raw
 * OMR issues and source comparisons are classified by the caller instead. */
export async function deriveStructuralArrangementBlockers(state: WorkspaceState): Promise<{ blockers: WorkspaceCapabilities["blockers"]; policyNotes: readonly { id: string; messageKo: string; scope: WorkspaceScope }[] }> {
  const c = await evaluateArrangement(state, "", "structural");
  return { blockers: c.blockers, policyNotes: c.policyNotes };
}
async function evaluateArrangement(state: WorkspaceState, evidenceDigest: string, mode: "reviewed" | "structural"): Promise<WorkspaceCapabilities & { policyNotes: { id: string; messageKo: string; scope: WorkspaceScope }[] }> {
  // One immutable evaluation, not a cross-document or cross-revision cache.
  // Caller edits during an await cannot mix old and new dependency projections.
  state = structuredClone(state);
  const reviewed = mode === "reviewed";
  const policyNotes: { id: string; messageKo: string; scope: WorkspaceScope }[] = [];
  const projectIssue=createWorkspaceIssueDependencyProjector(state);
  const fingerprints = new Map<string,Promise<string>>();
  const fingerprint: FingerprintReader = (scope,version,issueId) => {
    const key = `${version}:${canonicalJson(scope)}:${version === 3 ? issueId ?? "" : ""}`;
    let value = fingerprints.get(key);
    if (!value) { value = fingerprintWithProjection(state,scope,evidenceDigest,version,issueId,projectIssue); fingerprints.set(key,value); }
    return value;
  };
  const blockers: { id: string; messageKo: string; scope: WorkspaceScope }[] = [];
  const add = (id: string, messageKo: string, scope: WorkspaceScope = { kind: "document" }) => blockers.push({ id,messageKo,scope });
  const part = selectedWorkspacePart(state), musicReviews: { measureId: string; current: boolean }[] = [];
  const pendingIssues: WorkspaceIssue[] = [];
  const issueReviews=reviewed?await reviewBatches(state.issues,issue=>issueCurrentWithFingerprint(state,issue,evidenceDigest,fingerprint)):state.issues.map(()=>true);
  state.issues.forEach((issue,index)=>{if(!issueReviews[index]){
    pendingIssues.push(issue);
    if (issue.impacts.includes("arrange") && workspaceScopeRelevant(state,issue.scope)) add(issue.id,issue.messageKo,issue.scope);
  }});
  if (!state.music) add("uninterpreted","안전하게 보존한 원시 자료가 있으나 현재 편집 모델로 음악을 해석하지 못했습니다.");
  if (!part) add("lead","편곡할 Lead 성부를 명시적으로 선택하세요.");
  const inspected = part?.measures ?? measures(state); // Meter capability is visible even before lead selection.
  const musicByScope=new Map<string,WorkspaceAttestation[]>();
  for(const a of state.attestations)if(a.purpose==="music"){
    const key=canonicalJson(a.scope),group=musicByScope.get(key)??[];group.push(a);musicByScope.set(key,group);
  }
  const reviewedMeasures=part&&reviewed?await reviewBatches(inspected,async m=>{
    const scope:WorkspaceScope={kind:"measure",measureId:m.workspaceMeasureId!,...(state.request.lead?{voiceKey:state.request.lead}:{})};
    for(const a of musicByScope.get(canonicalJson(scope))??[])
      if(await currentWithFingerprint(state,a,evidenceDigest,fingerprint))return true;
    return false;
  }):inspected.map(()=>true);
  for (const [measureIndex,m] of inspected.entries()) {
    const mid=m.workspaceMeasureId!, scope: WorkspaceScope={kind:"measure",measureId:mid,...(state.request.lead?{voiceKey:state.request.lead}:{})};
    const t=m.time;
    if (!((t.denominator===4 && [2,3,4].includes(t.numerator) && t.beatGroups.length===t.numerator && t.beatGroups.every(g=>g===1))
      || [6,12].includes(t.numerator) && t.denominator===8 && t.beatGroups.length===t.numerator/3 && t.beatGroups.every(g=>g===3))) add(`meter:${mid}`,`${m.number}마디 ${t.numerator}/${t.denominator}: 작업 공간에 보존할 수 있지만 현재 WAG 지원 밖입니다.`,scope);
    const selected = part ? new Set([state.request.lead!,...state.request.rhythmVoices]) : undefined;
    const events = m.leadEvents.filter(e=>!selected||selected.has(e.candidateKey));
    for (const e of events) {
      if (compareFractions(addFractions(e.onset,e.duration),m.duration)>0) add(`overfull:${e.workspaceEventId}`,`${m.number}마디: 이벤트가 마디 끝을 넘습니다.`,scope);
      if (e.fermata) {
        if (reviewed) add(`fermata:${e.workspaceEventId}`,`${m.number}마디의 페르마타를 대조하세요. 현재 엔진은 페르마타의 재생시간을 해석하지 않습니다.`,scope);
        // Source has no fermata field; the engine plays the written value.
        else policyNotes.push({id:`fermata:${e.workspaceEventId}`,messageKo:`${m.number}마디 페르마타: 늘임 길이를 해석하지 않고 표기 길이로 생성·재생합니다(연습용 정책).`,scope});
      }
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
      const current=reviewedMeasures[measureIndex];
      if(reviewed){musicReviews.push({measureId:mid,current});
        if(!current) add(`review:${mid}`,`${m.number}마디의 선택 성부·코드·기호를 원본과 대조하세요.`,scope);}
      if(m.chords.some(c=>c.parseResult.status==="failed")) add(`chord:${mid}`,`${m.number}마디 코드 해석을 교정하세요.`,scope);
    }
  }
  if(part) {
    const lead=state.music!.leadCandidates.find(c=>c.key===state.request.lead)!;
    for(const voice of state.request.rhythmVoices) {
      const rhythm=state.music!.leadCandidates.find(c=>c.key===voice);
      if(rhythm?.partOrdinal!==lead.partOrdinal||rhythm?.staffNumber!==lead.staffNumber)
        add(`rhythm-staff:${voice}`,"현재 리듬 투영은 Lead와 같은 파트·보표만 지원합니다. 선택한 다른 보표의 리듬은 원본에 보존되며 편곡은 차단합니다.");
    }
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
  else if(part) {
    // Same condition the Source validator applies (quick-review performer
    // issues): a specified Lead singer range must contain the source Lead.
    const leadRange=state.request.performers[0]?.profile?.hardRange;
    const outside=leadRange?part.measures.flatMap(m=>m.leadEvents).filter(e=>e.candidateKey===state.request.lead&&e.kind==="note"
      &&(comparePitches(e.pitch,leadRange.low)<0||comparePitches(e.pitch,leadRange.high)>0)).length:0;
    if(outside) add("performers:lead-range",`선택한 원본 Lead의 ${outside}개 음이 지정한 Lead 가수 hard 음역 밖입니다. 원본을 바꾸지 않으며, Lead 가수 제약을 조정하거나 해제해야 합니다.`);
  }
  if(!state.request.sections.length||state.request.sections.some(s=>s.confirmation!=="confirmed")) add("sections","편곡 구간을 확인하세요.");
  if(state.request.policy!=="existing-wag-v1"||state.request.range!=="whole-score") add("policy","이 편곡 정책/범위는 1차 작업 공간의 지원 밖입니다.");
  return {view:true,edit:!!state.music,saveDraft:true,exportWorkspace:true,arrange:blockers.length===0,playSource:false,exportSource:false,blockers,pendingIssues,musicReviews,policyNotes};
}
