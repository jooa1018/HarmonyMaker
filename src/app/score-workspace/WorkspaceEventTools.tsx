"use client";
import { useState } from "react";
import { fraction, type Fraction } from "../../domain/fraction";
import type { SpelledPitch } from "../../domain/pitch";
import type { SourceSlurMark } from "../../domain/source/notation";
import type { ImportedLeadEventDraft, ImportedLyricDraft, ImportedMeasureDraft } from "../../import/musicxml/types";
import type { WorkspaceCommand, WorkspaceState } from "../../import/workspace/model";
import styles from "./score-workspace.module.css";

type Commit = (command: WorkspaceCommand, note: string) => Promise<void>;
const f = (v: Fraction) => v.d === 1 ? String(v.n) : `${v.n}/${v.d}`;
function time(value: string): Fraction {
  if (!/^\d+(\/\d+)?$/u.test(value)) throw Error("시간은 0 또는 1/4 같은 분수로 입력하세요.");
  const [n, d = "1"] = value.split("/"); return fraction(Number(n), Number(d));
}
function pitch(value: string): SpelledPitch {
  const m = /^([A-G])([b#]?)(-?\d+)$/u.exec(value);
  if (!m) throw Error("음높이는 C4, Eb5처럼 입력하세요.");
  return { step: m[1] as SpelledPitch["step"], alter: m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0, octave: Number(m[3]) };
}
function Evidence({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  return <label>원본 위치·교정 근거<input aria-label="원본 위치·교정 근거" value={value} onChange={e=>onChange(e.target.value)} placeholder="원본 시스템·마디·좌표와 확인한 기호" maxLength={1500}/></label>;
}

export function WorkspaceEventTools({event,state,features,commit}:{event:ImportedLeadEventDraft;state:WorkspaceState;features:readonly string[];commit:Commit}) {
  const [open,setOpen]=useState(false);
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>기호·성부·가사·이동 교정</summary>{open&&<EventTools key={JSON.stringify(event)+features.join(",")} event={event} state={state} features={features} commit={commit}/>}</details>;
}
function EventTools({event,state,features,commit}:{event:ImportedLeadEventDraft;state:WorkspaceState;features:readonly string[];commit:Commit}) {
  const candidate=state.music!.leadCandidates.find(c=>c.key===event.candidateKey)!;
  const [evidence,setEvidence]=useState(""),[staff,setStaff]=useState(String(candidate.staffNumber)),[voice,setVoice]=useState(candidate.voiceKey),[error,setError]=useState("");
  const [lyrics,setLyrics]=useState<readonly ImportedLyricDraft[]>(event.kind==="rest"?[]:event.lyrics);
  const [slurs,setSlurs]=useState<readonly SourceSlurMark[]>(event.kind==="rest"?[]:event.slurs??[]);
  const [destination,setDestination]=useState(""),[onset,setOnset]=useState(f(event.onset)),[remove,setRemove]=useState(false);
  const allowed=evidence.trim().length>=8;
  const save=(make:()=>WorkspaceCommand)=>{try{if(!allowed)throw Error("원본 위치와 교정 근거를 입력하세요.");void commit(make(),`${event.workspaceEventId}: ${evidence}`);}catch(e){setError(String(e));}};
  const measures=state.music!.parts.find(p=>p.partOrdinal===candidate.partOrdinal)!.measures;
  return <div className={styles.context}>
    <p>대상 {event.workspaceEventId}. 원시 기호와 이전 이벤트는 원본·이력에 보존됩니다.</p>
    <Evidence value={evidence} onChange={setEvidence}/>
    {features.length>0&&<div><strong>원시 미지원 기호</strong>{features.map(feature=><p key={feature}>{feature} <button disabled={!allowed} onClick={()=>save(()=>({kind:"remove-notation",eventId:event.workspaceEventId!,feature}))}>이 기호만 제거 · {feature}</button></p>)}</div>}
    <div className={styles.row}><label>보표 번호<input aria-label="보표 번호" value={staff} onChange={e=>setStaff(e.target.value)}/></label><label>원본 성부 번호<input aria-label="원본 성부 번호" value={voice} onChange={e=>setVoice(e.target.value)}/></label><button disabled={!allowed} onClick={()=>save(()=>({kind:"event-voice",eventId:event.workspaceEventId!,staffNumber:Number(staff),voice}))}>성부 교정 저장</button></div>
    {event.kind!=="rest"&&<>
      <h4>이 음표의 가사</h4><p>각 행은 한 절의 음절입니다. 이어 부르기는 해당 음절의 연결이며, 다음 음표의 새 음절과 구분합니다.</p>
      {lyrics.map((lyric,i)=><div className={styles.row} key={i} data-lyric-index={i}>
        <label>음절<input aria-label={`가사 음절 ${i+1}`} value={lyric.text} onChange={e=>setLyrics(lyrics.map((l,j)=>j===i?{...l,text:e.target.value}:l))}/></label>
        <label>절<input aria-label={`가사 절 ${i+1}`} type="number" min={1} value={lyric.verse} onChange={e=>setLyrics(lyrics.map((l,j)=>j===i?{...l,verse:Number(e.target.value)}:l))}/></label>
        <label>음절 연결<select aria-label={`가사 연결 ${i+1}`} value={lyric.syllabic} onChange={e=>setLyrics(lyrics.map((l,j)=>j===i?{...l,syllabic:e.target.value as ImportedLyricDraft["syllabic"]}:l))}><option value="single">독립</option><option value="begin">시작</option><option value="middle">중간</option><option value="end">끝</option></select></label>
        <label><input aria-label={`가사 이어 부르기 ${i+1}`} type="checkbox" checked={lyric.extend} onChange={e=>setLyrics(lyrics.map((l,j)=>j===i?{...l,extend:e.target.checked}:l))}/>이어 부르기</label>
        <label><input aria-label={`가사 악센트 ${i+1}`} type="checkbox" checked={lyric.musicXmlAccent} onChange={e=>setLyrics(lyrics.map((l,j)=>j===i?{...l,musicXmlAccent:e.target.checked}:l))}/>원본 악센트</label>
        <button onClick={()=>setLyrics(lyrics.filter((_,j)=>j!==i))}>이 가사 행 제거</button>
      </div>)}
      <button disabled={lyrics.length>=8} onClick={()=>setLyrics([...lyrics,{text:"",verse:lyrics.length+1,syllabic:"single",extend:false,musicXmlAccent:false}])}>가사 행 추가</button> <button disabled={!allowed} onClick={()=>save(()=>({kind:"event-lyrics",eventId:event.workspaceEventId!,lyrics}))}>가사 교정 저장</button>
      <h4>Slur 연결</h4><p>동음 tie는 음·시간·tie 교정에서 편집합니다. Slur 번호가 같은 시작과 끝을 각각 저장하세요.</p>
      {slurs.map((slur,i)=><div className={styles.row} key={i}><label>Slur 번호<input aria-label={`Slur 번호 ${i+1}`} type="number" min={1} value={slur.number} onChange={e=>setSlurs(slurs.map((s,j)=>j===i?{...s,number:Number(e.target.value)}:s))}/></label><label>Slur 끝점<select aria-label={`Slur 끝점 ${i+1}`} value={slur.type} onChange={e=>setSlurs(slurs.map((s,j)=>j===i?{...s,type:e.target.value as SourceSlurMark["type"]}:s))}><option value="start">시작</option><option value="continue">계속</option><option value="stop">끝</option></select></label><button onClick={()=>setSlurs(slurs.filter((_,j)=>j!==i))}>이 Slur 행 제거</button></div>)}
      <button onClick={()=>setSlurs([...slurs,{number:1,type:"start"}])}>Slur 행 추가</button> <button disabled={!allowed} onClick={()=>save(()=>({kind:"event-slurs",eventId:event.workspaceEventId!,slurs}))}>Slur 교정 저장</button>
    </>}
    <details><summary>마디 이동·오인식 이벤트 제거</summary><div className={styles.row}><label>이동할 마디<select aria-label="이동할 마디" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">선택하세요</option>{measures.map(m=><option key={m.workspaceMeasureId} value={m.workspaceMeasureId}>{m.number}마디</option>)}</select></label><label>이동 후 시작<input aria-label="이동 후 시작" value={onset} onChange={e=>setOnset(e.target.value)}/></label><button disabled={!allowed||!destination} onClick={()=>save(()=>({kind:"move-event",eventId:event.workspaceEventId!,measureId:destination,onset:time(onset)}))}>이벤트 이동 저장</button></div><label><input type="checkbox" checked={remove} onChange={e=>setRemove(e.target.checked)}/>원본에서 누락이 아닌 오인식·중복으로 확인한 이 이벤트를 제거</label> <button disabled={!allowed||!remove} onClick={()=>save(()=>({kind:"remove-event",eventId:event.workspaceEventId!}))}>이 이벤트 제거 저장</button></details>
    {error&&<p role="alert">{error}</p>}
  </div>;
}

export function WorkspaceMeasureTools({m,commit}:{m:ImportedMeasureDraft;commit:Commit}) {
  const [mounted,setMounted]=useState(false);
  const [evidence,setEvidence]=useState(""),[extent,setExtent]=useState(f(m.duration)),[implicit,setImplicit]=useState(m.implicit),[kind,setKind]=useState<"note"|"rest"|"rhythm">("note"),[value,setValue]=useState(""),[onset,setOnset]=useState("0"),[duration,setDuration]=useState("1/2"),[staff,setStaff]=useState("1"),[voice,setVoice]=useState("1"),[error,setError]=useState("");
  const save=(make:()=>WorkspaceCommand)=>{try{if(evidence.trim().length<8)throw Error("원본 위치와 교정 근거를 입력하세요.");void commit(make(),`${m.workspaceMeasureId}: ${evidence}`);}catch(e){setError(String(e));}};
  return <details onToggle={e=>{if(e.currentTarget.open)setMounted(true);}}><summary>실제 마디 길이·누락 이벤트 교정</summary>{mounted&&<><p>박자와 실제 못갖춘 구간의 길이를 구분합니다. 길이 변경은 음표를 자르거나 쉼표로 채우지 않습니다.</p><Evidence value={evidence} onChange={setEvidence}/><div className={styles.row}><label>실제 구간 길이<input aria-label="실제 구간 길이" value={extent} onChange={e=>setExtent(e.target.value)}/></label><label><input type="checkbox" aria-label="불완전 마디" checked={implicit} onChange={e=>setImplicit(e.target.checked)}/>못갖춘·불완전 마디</label><button disabled={evidence.trim().length<8} onClick={()=>save(()=>({kind:"measure-extent",measureId:m.workspaceMeasureId!,duration:time(extent),implicit}))}>실제 길이 저장</button></div>
    <h4>원본에서 확인한 누락 이벤트 하나 추가</h4><div className={styles.row}>
      <label>새 이벤트 종류<select aria-label="새 이벤트 종류" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="note">음표</option><option value="rest">쉼표</option><option value="rhythm">리듬 슬래시</option></select></label>
      {kind==="note"&&<label>새 음높이<input aria-label="새 음높이" value={value} onChange={e=>setValue(e.target.value)}/></label>}
      <label>새 시작<input aria-label="새 시작" value={onset} onChange={e=>setOnset(e.target.value)}/></label><label>새 길이<input aria-label="새 길이" value={duration} onChange={e=>setDuration(e.target.value)}/></label><label>새 보표<input aria-label="새 보표" value={staff} onChange={e=>setStaff(e.target.value)}/></label><label>새 성부<input aria-label="새 성부" value={voice} onChange={e=>setVoice(e.target.value)}/></label>
      <button disabled={evidence.trim().length<8} onClick={()=>save(()=>({kind:"insert-event",measureId:m.workspaceMeasureId!,eventKind:kind,...(kind==="note"?{pitch:pitch(value)}:{}),onset:time(onset),duration:time(duration),staffNumber:Number(staff),voice,tieStart:false,tieStop:false}))}>누락 이벤트 추가 저장</button>
    </div><h4>원본 의미가 미확정인 부분</h4><p>위 근거에 모호한 위치·가능한 해석·영향을 기록합니다. 미확정은 Source 확정 전 별도 대조 항목으로 남습니다.</p><button disabled={evidence.trim().length<8} onClick={()=>save(()=>({kind:"issue",scope:{kind:"measure",measureId:m.workspaceMeasureId!},detail:evidence}))}>이 마디 미확정 기록</button>{error&&<p role="alert">{error}</p>}
  </>}</details>;
}
