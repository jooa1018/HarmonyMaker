"use client";
import Link from "next/link";
import { useRouter,useSearchParams } from "next/navigation";
import { useEffect,useMemo,useRef,useState } from "react";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../algorithm-version-registry";
import { PerformerEditor,RightsEditor } from "../import/ImportReviewClient";
import { LocalCandidateReviewEvidence } from "../import/LocalCandidateReviewEvidence";
import { fraction,type Fraction } from "../../domain/fraction";
import { canonicalJson } from "../../domain/digest/canonical";
import type { KeySignature,SpelledPitch } from "../../domain/pitch";
import type { LocalCandidateBundle } from "../../domain/omr/local-candidate";
import { deriveQuickReview } from "../../import";
import type { ImportedLeadEventDraft,ImportedMeasureDraft } from "../../import/musicxml/types";
import { originFromMusicXml,originFromLocalCandidate,originFromLegacyBundle,workspaceEvidenceDigest,workspaceOriginalImages } from "../../import/workspace/input";
import { createScoreWorkspace,parseScoreWorkspace,exportScoreWorkspace,replayScoreWorkspace,applyWorkspaceCommand } from "../../import/workspace/journal";
import { deriveWorkspaceCapabilities,effectiveWorkspaceKey } from "../../import/workspace/review";
import { projectScoreWorkspace } from "../../import/workspace/projection";
import { ScoreWorkspaceStore,generatedWorkspaceResultIsCurrent,type StoredScoreWorkspace } from "../../import/workspace/store";
import type { ScoreWorkspace,WorkspaceState,WorkspaceCapabilities,WorkspaceCommand } from "../../import/workspace/model";
import { createProjectFromQuickReview } from "../../product/workspace";
import { IndexedDbProjectStore } from "../../product/local-project-store";
import styles from "./score-workspace.module.css";
import { WorkspaceEventTools, WorkspaceMeasureTools } from "./WorkspaceEventTools";
import { remainingWorkspaceNotation } from "../../import/workspace/notation";

interface Loaded {record:StoredScoreWorkspace;state:WorkspaceState;caps:WorkspaceCapabilities}
type Commit=(command:WorkspaceCommand,note:string)=>Promise<void>;
const f=(v:Fraction)=>v.d===1?String(v.n):`${v.n}/${v.d}`;
const p=(v:SpelledPitch)=>`${v.step}${v.alter===1?"#":v.alter===-1?"b":""}${v.octave}`;
const keyText=(k:KeySignature|undefined)=>k?`${k.tonic.step}${k.tonic.alter===1?"#":k.tonic.alter===-1?"b":""} ${k.mode}`:"";
const KEYS=["Cb","Gb","Db","Ab","Eb","Bb","F","C","G","D","A","E","B","F#","C#"].map(k=>`${k} major`).concat(["Ab","Eb","Bb","F","C","G","D","A","E","B","F#","C#","G#","D#","A#"].map(k=>`${k} minor`));
function parseKey(text:string):KeySignature {const m=/^([A-G])([b#]?) (major|minor)$/u.exec(text);if(!m)throw Error("조성을 선택하세요.");return {tonic:{step:m[1] as SpelledPitch["step"],alter:m[2]==="b"?-1:m[2]==="#"?1:0},mode:m[3] as KeySignature["mode"]};}
function parseFraction(text:string):Fraction {if(!/^\d+(\/\d+)?$/u.test(text))throw Error("시간은 0 또는 1/3 같은 분수로 입력하세요.");const [n,d="1"]=text.split("/");return fraction(Number(n),Number(d));}
function parsePitch(text:string):SpelledPitch {const m=/^([A-G])([#b]?)(-?\d+)$/u.exec(text);if(!m)throw Error("음높이는 C4, F#4처럼 입력하세요.");return {step:m[1] as SpelledPitch["step"],alter:m[2]==="#"?1:m[2]==="b"?-1:0,octave:Number(m[3])};}
function download(name:string,text:string) {const u=URL.createObjectURL(new Blob([text],{type:"application/json"}));const a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}

function ChordForm({m,chord,commit}:{m:ImportedMeasureDraft;chord?:ImportedMeasureDraft["chords"][number];commit:Commit}) {
  const [text,setText]=useState(chord?.sourceText??""),[onset,setOnset]=useState(f(chord?.onset??fraction(0))),[error,setError]=useState(""),[evidence,setEvidence]=useState("");
  return <form className={styles.row} onSubmit={e=>{e.preventDefault();try{void commit({kind:"chord",measureId:m.workspaceMeasureId!,...(chord?{chordId:chord.key}:{}),text,onset:parseFraction(onset)},`${m.number}마디 코드 ${chord?.sourceText??"없음"} → ${text}; ${evidence||"원본 대조에 따른 교정"}`);}catch(err){setError(String(err));}}}>
    <label>코드<input aria-label={chord?`코드 ${chord.key}`:`${m.number}마디 새 코드`} value={text} onChange={e=>setText(e.target.value)}/></label>
    <label>시작(4분음표 단위)<input aria-label={`${m.number}마디 코드 시작 ${chord?.key??"new"}`} value={onset} onChange={e=>setOnset(e.target.value)}/></label>
    <label>코드 원본 위치·근거<input aria-label="코드 원본 위치·근거" value={evidence} onChange={e=>setEvidence(e.target.value)}/></label><button type="submit">{chord?"코드 수정 저장":"코드 추가 저장"}</button>{chord&&<button type="button" disabled={evidence.trim().length<8} onClick={()=>void commit({kind:"remove-chord",chordId:chord.key},`${chord.key}: ${evidence}`)}>이 코드 제거 저장</button>}{error&&<span role="alert">{error}</span>}
  </form>;
}
type EditableEvent=ImportedLeadEventDraft|{kind:"unknown";workspaceEventId:string;candidateKey:string;onset:Fraction;duration:Fraction};
function NoteForm({event,commit}:{event:EditableEvent;commit:Commit}) {
  const [kind,setKind]=useState<"note"|"rest"|"rhythm">(event.kind==="unknown"?"note":event.kind),[pitch,setPitch]=useState(event.kind==="note"?p(event.pitch):""),[onset,setOnset]=useState(f(event.onset)),[duration,setDuration]=useState(f(event.duration)),[start,setStart]=useState((event.kind==="note"||event.kind==="rhythm")&&event.tieStart),[stop,setStop]=useState((event.kind==="note"||event.kind==="rhythm")&&event.tieStop),[error,setError]=useState(""),[evidence,setEvidence]=useState("");
  return <details><summary>음·시간·tie 교정</summary><form className={styles.row} onSubmit={e=>{e.preventDefault();try{void commit({kind:"note",eventId:event.workspaceEventId!,value:{kind,...(kind==="note"?{pitch:parsePitch(pitch)}:{}),onset:parseFraction(onset),duration:parseFraction(duration),tieStart:start,tieStop:stop}},`${event.workspaceEventId}: ${evidence||"원본 대조 후 음·시간·tie 교정"}`);}catch(err){setError(String(err));}}}>
    <label>종류<select aria-label="이벤트 종류" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="note">note · 음높이 있음</option><option value="rest">rest · 쉼표</option><option value="rhythm">rhythm · 리듬 슬래시</option></select></label>
    {kind==="note"&&<label>음높이<input value={pitch} onChange={e=>setPitch(e.target.value)}/></label>}<label>시작<input value={onset} onChange={e=>setOnset(e.target.value)}/></label><label>길이<input value={duration} onChange={e=>setDuration(e.target.value)}/></label>
    <label><input type="checkbox" checked={start} onChange={e=>setStart(e.target.checked)}/>tie 시작</label><label><input type="checkbox" checked={stop} onChange={e=>setStop(e.target.checked)}/>tie 끝</label><label>음·시간 원본 위치·근거<input aria-label="음·시간 원본 위치·근거" value={evidence} onChange={e=>setEvidence(e.target.value)}/></label><button>이벤트 교정 저장</button>{error&&<span role="alert">{error}</span>}
  </form></details>;
}
function MeasurePanel({m,state,current,features,commit}:{m:ImportedMeasureDraft;state:WorkspaceState;current:boolean;features:Readonly<Record<string,readonly string[]>>;commit:Commit}) {
  const [split,setSplit]=useState(""),[meter,setMeter]=useState(`${m.time.numerator}/${m.time.denominator}`),[error,setError]=useState(""),[contextEvidence,setContextEvidence]=useState("");
  const selected=[state.request.lead,...state.request.rhythmVoices];
  return <section className={styles.measure} data-measure-id={m.workspaceMeasureId}><h3>{m.number}마디 · {m.time.numerator}/{m.time.denominator} · {current?"대조 유지":"대조 필요"}</h3>
    <p>유효 조성: {keyText(effectiveWorkspaceKey(state,m.workspaceMeasureId!))||"미확정"} · 길이 {f(m.duration)} · 코드 {m.chords.map(c=>c.sourceText).join(" / ")||"이 마디에 새 코드 없음"}</p>
    <div className={styles.table}><table><thead><tr><th>원본 성부</th><th>시작</th><th>길이</th><th>현재 후보</th><th>기호·가사·교정</th></tr></thead><tbody>{m.leadEvents.map(e=><tr key={e.workspaceEventId} data-event-id={e.workspaceEventId}><td>{e.candidateKey}<small>{selected.includes(e.candidateKey)?"편곡 선택":"보존 · 선택 밖"}</small></td><td>{f(e.onset)}</td><td>{f(e.duration)}</td><td>{e.kind==="note"?p(e.pitch):e.kind==="rest"?"쉼표":"리듬 슬래시"}</td><td>{e.kind!=="rest"&&<small>{e.tieStart?"tie 시작 ":""}{e.tieStop?"tie 끝 ":""}{e.slurs?.length?`slur ${JSON.stringify(e.slurs)} `:""}{e.lyrics.map(l=>l.text).join(" / ")}</small>}{e.fermata&&<><strong>페르마타 후보 𝄐</strong> <button onClick={()=>void commit({kind:"fermata",eventId:e.workspaceEventId!,value:false},`${e.workspaceEventId}: 원본에 없는 페르마타 제거; 음높이·길이·ID 유지`)}>이 페르마타 제거</button></>}<NoteForm key={JSON.stringify(e)} event={e} commit={commit}/><WorkspaceEventTools event={e} state={state} features={features[e.workspaceEventId!]??[]} commit={commit}/></td></tr>)}</tbody></table></div>
    {m.unresolvedEvents?.map(e=><div key={e.id}><p role="status">음높이 미확정 · {e.id} · {f(e.onset)} / {f(e.duration)}. 원시 XML 보존됨. 임의 쉼표로 대체하지 않았습니다.</p><NoteForm event={{...e,workspaceEventId:e.id}} commit={commit}/></div>)}
    {m.chords.map(c=><ChordForm key={`${c.key}:${c.sourceText}:${f(c.onset)}`} m={m} chord={c} commit={commit}/>)}<details><summary>누락 코드 추가</summary><ChordForm m={m} commit={commit}/></details>
    <details><summary>마디·박자 교정</summary><p>박자 교정은 이 마디에서 시작하는 문맥을 바꿉니다. 마디 분리는 경계에 걸친 이벤트를 자동 잘라 붙이지 않습니다.</p><div className={styles.row}><label>박자 원본 위치·근거<input aria-label="박자 원본 위치·근거" value={contextEvidence} onChange={e=>setContextEvidence(e.target.value)}/></label><label>이 마디의 박자<input value={meter} onChange={e=>setMeter(e.target.value)}/></label><button onClick={()=>{try{const [n,d]=meter.split("/").map(Number);const part=state.music!.parts.find(p=>p.measures.some(x=>x.workspaceMeasureId===m.workspaceMeasureId))!;void commit({kind:"meter",startMeasureId:m.workspaceMeasureId!,endMeasureIdExclusive:part.measures[m.ordinal+1]?.workspaceMeasureId,time:{numerator:n,denominator:d as 4|8,beatGroups:n===6&&d===8?[3,3]:Array(n).fill(1)}},`${m.number}마디 박자 ${meter} 명시적 교정; ${contextEvidence}`);}catch(err){setError(String(err));}}}>박자 저장</button><label>분리 위치<input value={split} onChange={e=>setSplit(e.target.value)}/></label><button onClick={()=>{try{void commit({kind:"split",measureId:m.workspaceMeasureId!,at:parseFraction(split)},`${m.number}마디 ${split} 위치 분리`);}catch(err){setError(String(err));}}}>마디 분리</button>{error&&<span role="alert">{error}</span>}</div></details>
    <WorkspaceMeasureTools key={`${m.workspaceMeasureId}:${f(m.duration)}:${m.implicit}`} m={m} commit={commit}/>
    <button disabled={!state.request.lead||current} onClick={()=>void commit({kind:"attest",purpose:"music",scope:{kind:"measure",measureId:m.workspaceMeasureId!,voiceKey:state.request.lead!}},`${m.number}마디 선택 성부의 음높이·길이·기호·가사·코드 및 연결 후보를 원본과 대조`)}>{current?`${m.number}마디 대조 유지`:`${m.number}마디 원본 대조 확인`}</button>
  </section>;
}
function RequestPanel({state,commit}:{state:WorkspaceState;commit:Commit}) {
  const req=state.request,music=state.music!,contexts=[...new Set(music.parts.flatMap(p=>p.measures.map(m=>m.keyObservation?.contextId)).filter((x):x is string=>!!x))];
  const [lead,setLead]=useState(req.lead??""),[rhythms,setRhythms]=useState<readonly string[]>(req.rhythmVoices);
  const [tempo,setTempo]=useState(req.tempo?String(req.tempo.bpm):""),[beat,setBeat]=useState(req.tempo?`${req.tempo.dotted?"d":""}${req.tempo.beatUnit}`:"d4");
  const [keys,setKeys]=useState<Record<string,string>>({}),[title,setTitle]=useState(music.title),[error,setError]=useState("");
  return <section className="panel"><h2>편곡 요청 · 전곡</h2><p>아래 선택은 원본 전체와 별개입니다. 다른 성부는 작업 공간에 남습니다. 현재 정책은 기존 WAG v1이며 자동 부분 편곡은 지원하지 않습니다.</p>
    <div className={styles.row}><label>제목<input value={title} onChange={e=>setTitle(e.target.value)}/></label><button onClick={()=>void commit({kind:"title",title},"음악 의미를 바꾸지 않는 제목 수정")}>제목 저장</button></div>
    <label>편곡 Lead<select aria-label="편곡 Lead" value={lead} onChange={e=>setLead(e.target.value)}><option value="">선택하세요</option>{music.leadCandidates.map(c=><option key={c.key} value={c.key}>{c.displayPartName} · {c.key} · 음표 {c.noteCount}개</option>)}</select></label>
    {music.leadCandidates.filter(c=>c.key!==lead).map(c=><label key={c.key} className={styles.check}><input type="checkbox" checked={rhythms.includes(c.key)} onChange={e=>setRhythms(e.target.checked?[...rhythms,c.key]:rhythms.filter(v=>v!==c.key))}/>{c.key} 리듬 입력으로 사용 (pitched 성부를 리듬으로 바꾸지는 않음)</label>)}
    <button disabled={!lead} onClick={()=>void commit({kind:"lead",lead,rhythmVoices:rhythms.filter(v=>v!==lead)},`Lead ${lead}, 리듬 ${rhythms.join(",")||"없음"} 명시적 선택; 나머지 원본 보존`)}>편곡 대상 저장</button>
    <h3>조표와 유효 조성</h3>{contexts.map(id=>{const ms=music.parts.flatMap(p=>p.measures).filter(m=>m.keyObservation?.contextId===id),obs=ms[0].keyObservation!,effective=effectiveWorkspaceKey(state,ms[0].workspaceMeasureId!);return <div key={id} className={styles.context}><p>{id} · 마디 {ms.map(m=>m.number).join(", ")} · 관찰 fifths={obs.fifths} · XML mode={obs.explicitMode??"없음"} · importer 해석={obs.interpretation=== "explicit-source-mode"?"명시된 mode":"장조 기본 추정 (확정 아님)"}</p><label>문맥 유효 조성<select aria-label={`조성 ${id}`} value={keys[id]??keyText(effective)} onChange={e=>setKeys({...keys,[id]:e.target.value})}><option value="">확인할 조성 선택</option>{KEYS.map(k=><option key={k}>{k}</option>)}</select></label><button onClick={()=>{try{void commit({kind:"key",contextId:id,key:parseKey(keys[id]??keyText(effective))},`${id} 원본 조표·음악 대조 후 ${keys[id]??keyText(effective)} 확인; 관찰 조표 보존`);}catch(err){setError(String(err));}}}>이 문맥 조성 확인</button></div>;})}
    <h3>템포</h3><p>저장한 템포: {req.tempo?`${req.tempo.dotted?"점":""}${req.tempo.beatUnit}분음표=${req.tempo.bpm} · quarter BPM=${req.tempo.bpm*(4/req.tempo.beatUnit)*(req.tempo.dotted?1.5:1)}`:"미확정"}. 원본 기호를 확인해 입력합니다.</p><div className={styles.row}><label>템포 기준<select aria-label="템포 기준" value={beat} onChange={e=>setBeat(e.target.value)}><option value="4">4분음표</option><option value="d4">점4분음표</option><option value="8">8분음표</option><option value="d8">점8분음표</option></select></label><label>BPM<input aria-label="원본 BPM" type="number" min={20} max={300} value={tempo} onChange={e=>setTempo(e.target.value)}/></label><button onClick={()=>void commit({kind:"tempo",tempo:{beatUnit:beat.endsWith("4")?4:8,dotted:beat.startsWith("d"),bpm:Number(tempo)}},`원본 템포 명시적 확인: ${beat} = ${tempo}; 자동 인식 결과 아님`)}>템포 확인 저장</button></div>
    <h3>가수 음역</h3><label>가수 수<select aria-label="가수 수" value={req.singerCount} onChange={e=>{const count=Number(e.target.value) as 1|2|3;void commit({kind:"performers",count,slots:Array.from({length:count},(_,i)=>req.performers[i]??{id:`pf:${i}`,displayName:`Singer ${i+1}`})},`가수 ${count}명 선택; 미입력 음역은 편곡 차단`);}}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
    {req.performers.map((slot,i)=><PerformerEditor key={`${slot.id}:${JSON.stringify(slot.profile)}`} ordinal={i} slot={slot} onSave={(ordinal,value)=>void commit({kind:"performers",count:req.singerCount,slots:req.performers.map((s,index)=>index!==ordinal?s:{...s,displayName:value.displayName,profile:{...value,id:s.id}})},`${slot.id}: 가수 음역 명시적 확인`)}/>)}
    <h3>구간과 권리</h3>{req.sections.map(s=><div className={styles.row} key={s.key}><span>{s.label} · {s.startMeasureOrdinal+1}–{s.endMeasureOrdinalExclusive}마디 · {s.confirmation}</span><label>구간 종류<select aria-label={`구간 종류 ${s.key}`} value={s.type} onChange={e=>void commit({kind:"sections",sections:req.sections.map(x=>x.key===s.key?{...x,type:e.target.value as typeof s.type,confirmation:"suggested"}:x),lyricVerses:req.lyricVerses},`${s.key} 구간 종류 수정`)}>{["intro","verse","pre-chorus","chorus","bridge","tag","ending","other"].map(t=><option key={t}>{t}</option>)}</select></label><button disabled={s.confirmation==="confirmed"} onClick={()=>void commit({kind:"sections",sections:req.sections.map(x=>x.key===s.key?{...x,confirmation:"confirmed"}:x),lyricVerses:req.lyricVerses},`${s.key}: 원본의 구간 범위·종류 확인`)}>이 구간 확인</button></div>)}
    <p>저장한 권리: {req.rights?`${req.rights.basis} · ${req.rights.allowedUses.join(", ")}`:"미확인"}</p><RightsEditor onConfirm={rights=>void commit({kind:"rights",rights},"편곡 생성 입력 사용 권리를 명시적으로 확인")}/>{error&&<p role="alert">{error}</p>}
  </section>;
}

export function ScoreWorkspaceClient() {
  const search=useSearchParams(),router=useRouter(),id=search.get("id")??"";
  const store=useMemo(()=>new ScoreWorkspaceStore(),[]),[loaded,setLoaded]=useState<Loaded>(),[list,setList]=useState<readonly {id:string;updatedAt:string}[]>([]),[status,setStatus]=useState("파일을 열거나 저장한 초안을 선택하세요."),[busy,setBusy]=useState(false),[diagnostics,setDiagnostics]=useState("");
  const current=useRef<Loaded|undefined>(undefined),gate=useRef(false),loadToken=useRef(0);
  const hydrate=async(record:StoredScoreWorkspace):Promise<Loaded>=>{const state=await replayScoreWorkspace(record.workspace);return {record,state,caps:await deriveWorkspaceCapabilities(state,await workspaceEvidenceDigest(record.workspace.origin))};};
  const publish=(value:Loaded)=>{current.current=value;setLoaded(value);};
  useEffect(()=>{let active=true;const token=++loadToken.current;current.current=undefined;void(async()=>{try{const items=await store.list();if(active)setList(items);if(!id){if(active)setLoaded(undefined);return;}const record=await store.load(id);if(!record)throw Error("이 브라우저에 해당 초안이 없습니다.");const value=await hydrate(record);if(active&&loadToken.current===token){current.current=value;setLoaded(value);setDiagnostics("");setStatus(`저장본 복구 · revision ${record.workspace.revision}`);}}catch(err){if(active){setLoaded(undefined);setStatus(String(err));}}})();return()=>{active=false;loadToken.current=token+1;};},[id,store]);
  const run=async(action:(ensureCurrent:()=>void)=>Promise<void>)=>{if(gate.current)return;gate.current=true;setBusy(true);const token=loadToken.current;const ensureCurrent=()=>{if(loadToken.current!==token)throw Error("WORKSPACE_VIEW_CHANGED");};try{await action(ensureCurrent);}catch(err){if(loadToken.current===token)setStatus(`저장/검증 실패: ${err instanceof Error?err.message:String(err)} · 성공으로 처리하지 않았습니다.`);}finally{gate.current=false;setBusy(false);}};
  const persist=async(workspace:ScoreWorkspace,ensureCurrent:()=>void,previous?:StoredScoreWorkspace,generation?:StoredScoreWorkspace["generation"])=>{
    const record:StoredScoreWorkspace={workspace,storageRevision:previous?previous.storageRevision+1:0,updatedAt:new Date().toISOString(),...(generation??previous?.generation?{generation:generation??previous?.generation}:{})};
    const value=await hydrate(record);ensureCurrent();await store.save(record,previous?.storageRevision);const items=await store.list();ensureCurrent();publish(value);setList(items);return record;
  };
  const commit:Commit=async(command,note)=>run(async ensureCurrent=>{const old=current.current;if(!old)throw Error("초안을 먼저 여세요.");const next=await applyWorkspaceCommand(old.record.workspace,old.record.workspace,command,{id:crypto.randomUUID(),note,actor:navigator.webdriver?"ui-test":"user",at:new Date().toISOString()});await persist(next,ensureCurrent,old.record);setDiagnostics("");setStatus(`저장 완료 · revision ${next.revision} · ${note}`);});
  const openFile=async(file:File)=>run(async ensureCurrent=>{
    if(file.size>64_000_000)throw Error("입력 크기 제한 64 MB를 넘었습니다.");let workspace:ScoreWorkspace;
    if(/\.(json|hm-workspace)$/iu.test(file.name)){const text=await file.text(),value=JSON.parse(text);if(value.version==="hm-score-workspace-v1")workspace=await parseScoreWorkspace(text);else {const origin=value.version==="hm-local-candidate-v1"?await originFromLocalCandidate(value as LocalCandidateBundle,file.name):await originFromLegacyBundle(text,file.name);workspace=await createScoreWorkspace(origin,V,crypto.randomUUID());}}
    else workspace=await createScoreWorkspace(await originFromMusicXml(new Uint8Array(await file.arrayBuffer()),file.name),V,crypto.randomUUID());
    ensureCurrent();const existing=await store.load(workspace.id);if(existing){if(existing.workspace.digest!==workspace.digest||existing.workspace.historyDigest!==workspace.historyDigest)throw Error("같은 ID의 다른 저장 revision이 있습니다. 저장 초안에서 재개하세요.");const value=await hydrate(existing);ensureCurrent();publish(value);}else await persist(workspace,ensureCurrent);
    router.replace(`/score-workspace?id=${encodeURIComponent(workspace.id)}`);setStatus(`원본·후보·근거 저장 완료 · ${workspace.origin.fileName} · revision ${workspace.revision}`);
  });
  const generateSource=()=>run(async ensureCurrent=>{const old=current.current;if(!old)throw Error("초안을 먼저 여세요.");const draft=await projectScoreWorkspace(old.record.workspace),analysis=await deriveQuickReview(draft,V);ensureCurrent();setDiagnostics(analysis.diagnostics.map(d=>`${d.code}: ${d.messageKo}`).join("\n"));if(!analysis.state.readyForPlanning)throw Error("기존 최종 Validator가 편곡 입력을 차단했습니다. 아래 진단을 확인하세요.");const project=await createProjectFromQuickReview(draft,analysis,old.state.request.preset);
    // Each input revision receives a distinct local project; previous results survive.
    const projectId=`${old.record.workspace.id}:r${old.record.workspace.revision}`,projects=new IndexedDbProjectStore();
    const existingProject=await projects.load(projectId);ensureCurrent();
    if(existingProject&&canonicalJson(existingProject.project.source)!==canonicalJson(project.source))throw Error("저장한 프로젝트의 확정 입력이 이 초안과 다릅니다. 기존 자료를 보존했으며 연결하지 않았습니다.");
    if(!existingProject)await projects.saveNew({projectId,updatedAt:new Date().toISOString(),project});
    await persist(old.record.workspace,ensureCurrent,old.record,{projectId,workspaceRevision:old.record.workspace.revision,workspaceDigest:old.record.workspace.digest});router.push(`/workspace?project=${encodeURIComponent(projectId)}`);
  });
  const w=loaded?.record.workspace,s=loaded?.state,c=loaded?.caps;
  const notationFeatures=useMemo(()=>{
    const byEvent:Record<string,string[]>={};
    if(w&&s&&w.origin.kind!=="legacy-recovery")for(const item of remainingWorkspaceNotation(s,w.origin))(byEvent[item.eventId]??=[]).push(item.feature);
    return byEvent;
  },[w,s]);
  return <><section className="panel"><div className={styles.row}><label>원본·후보·초안 파일<input aria-label="작업 공간 파일 열기" disabled={busy} type="file" accept=".json,.xml,.musicxml,.mxl,.hm-workspace" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void openFile(file);}}/></label><Link href="/import">기존 Quick Review 열기</Link></div><p>MusicXML/MXL, 로컬 후보 묶음, 구형 recovery bundle, 새 작업 공간 파일을 읽습니다. 가져온 원본과 구형 이력은 덮어쓰지 않습니다.</p><details><summary>저장한 초안 {list.length}개</summary>{list.map(x=><p key={x.id}><Link href={`/score-workspace?id=${encodeURIComponent(x.id)}`}>{x.id}</Link> · {x.updatedAt}</p>)}</details></section>
    <p role="status" aria-live="polite" data-testid="workspace-status">{busy?"검증·저장 중…":status}</p>
    {w&&s&&c&&<><section className="panel"><h2>현재 가능한 작업</h2><p>보기 가능 · 교정 {c.edit?"가능":"원시 자료만 보존"} · 초안 저장 가능 · 편곡 {c.arrange?"최종 Validator 확인 가능":"차단"} · 재생/편곡 내보내기는 Source 확정 이후</p><p>현재 revision {w.revision} · 출처 {w.origin.kind} · {navigator.webdriver?"자동화 시험 결정 (사용자 실제 승인 아님)":"사용자 교정"}</p><div className={styles.row}><button disabled={busy||!w.operations.length} onClick={()=>void commit({kind:"undo"},"최근 음악·요청 교정 실행 취소; 현재 의미로 대조 상태 재계산")}>실행 취소</button><button disabled={busy} onClick={()=>void commit({kind:"redo"},"교정 다시 실행; 현재 의미로 대조 상태 재계산")}>다시 실행</button><button disabled={busy} onClick={()=>void run(async ensureCurrent=>{await persist(w,ensureCurrent,loaded.record);setStatus(`저장 완료 · revision ${w.revision}`);})}>초안 저장</button><button disabled={busy} onClick={()=>void run(async ensureCurrent=>{const encoded=await exportScoreWorkspace(w);ensureCurrent();download(`score-workspace-${w.id}.json`,encoded);})}>작업 공간 내보내기</button><button className="primary" disabled={busy||!c.arrange} onClick={generateSource}>확인한 입력으로 Source 확정</button></div>
    {loaded.record.generation&&<p data-testid="generation-binding">{generatedWorkspaceResultIsCurrent(loaded.record)?"현재 입력의 프로젝트":"이전 revision 결과 · 현재 교정에는 stale"} · <Link href={`/workspace?project=${encodeURIComponent(loaded.record.generation.projectId)}`}>저장한 결과 열기</Link></p>}
    <details open><summary>편곡 전 확인할 항목 {c.blockers.length}개</summary><ul>{c.blockers.map((b,i)=><li key={`${b.id}:${i}`}>{b.messageKo}</li>)}</ul></details>{diagnostics&&<pre className={styles.wrap}>{diagnostics}</pre>}</section>
    <fieldset disabled={busy} className={styles.editor}>{w.origin.localCandidate?<LocalCandidateReviewEvidence bundle={w.origin.localCandidate}/>:workspaceOriginalImages(w.origin).map((src,i)=><a key={i} href={src} target="_blank" rel="noreferrer">보존한 원본 이미지 {i+1} 열기</a>)}
    {s.music&&<RequestPanel key={w.id} state={s} commit={commit}/>}
    <section className="panel"><h2>원본과 현재 후보 대조</h2><p>시간은 4분음표=1인 정확한 분수입니다. 음표 삭제 없이 페르마타만 제거할 수 있습니다. 확인 버튼은 이 마디와 실제 문맥 의존성에 기록됩니다.</p>{s.music?.parts.map(part=><div key={part.partOrdinal}><h3>{part.displayPartName} · 보존한 파트 {part.partOrdinal+1}</h3>{part.measures.map(m=><MeasurePanel key={m.workspaceMeasureId} m={m} state={s} features={notationFeatures} current={c.musicReviews.find(r=>r.measureId===m.workspaceMeasureId)?.current??false} commit={commit}/>)}</div>)}</section>
    <section className="panel"><h2>별도 미확정 항목</h2><p>영향을 알 수 없는 음악 기호는 자동으로 무시하지 않습니다. 대조로 해결 가능한 항목만 명시적으로 확인할 수 있습니다. 실제 수정은 위 교정 도구로 먼저 저장하세요.</p>{c.pendingIssues.map(issue=><div key={issue.id} className={styles.context}><p>{issue.messageKo} · {issue.scope.kind==="measure"?issue.scope.measureId:issue.scope.kind}</p><small>{issue.kind} · 필요 작업 {issue.requiredAction} · 근거 {issue.evidenceRef}</small>{issue.requiredAction==="compare"&&<IssueReview issueId={issue.id} commit={commit} scope={issue.scope}/>}</div>)}</section></fieldset>
    <details className="panel"><summary>자동 기록 · 원본과 변경 이력</summary><p>원본 XML SHA-256 {w.origin.xmlDigest} · {w.operations.length}개 작업. 음악적 정확성을 해시로 인증하지 않습니다.</p><pre className={styles.wrap}>{JSON.stringify(w.operations.map(o=>({id:o.id,command:o.command,affectedIds:o.affectedIds,note:o.note,actor:o.actor,at:o.at})),null,2)}</pre><details><summary>불변 원시 XML</summary><pre className={styles.wrap}>{w.origin.xml}</pre></details></details></>}
  </>;
}
function IssueReview({issueId,scope,commit}:{issueId:string;scope:import("../../import/workspace/model").WorkspaceScope;commit:Commit}) {
  const [note,setNote]=useState("");return <div className={styles.row}><label>대조 결과<input aria-label={`미확정 대조 ${issueId}`} value={note} onChange={e=>setNote(e.target.value)} placeholder="원본에서 확인한 내용과 적용한 교정"/></label><button disabled={note.trim().length<3} onClick={()=>void commit({kind:"attest",purpose:"issue",issueId,scope},note)}>이 항목 대조 확인</button></div>;
}
