"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { Diagnostic } from "../../domain/diagnostics";
import type { PitchRange, SpelledPitch } from "../../domain/pitch";
import type { RightsBasis, RightsMetadata } from "../../domain/source/model";
import { takeOmrImportHandoff } from "../../domain/omr/browser-handoff";
import type { OmrProviderResult } from "../../domain/omr/contracts";
import { mapEvidenceBoxToNormalizedOriginal, type BoundingBox } from "../../domain/omr/foundation";
import { attachOmrReviewContext, createInitialOmrReviewContext } from "../../domain/omr/normalization";
import { acceptOmrReviewAlternative, manuallyCorrectOmrReviewItem, rejectOmrReviewAlternatives } from "../../domain/omr/review";
import { validateRuntimeOmrReadiness } from "../../domain/omr/readiness";
import { parseChord } from "../../domain/chord/parser";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../algorithm-version-registry";
import { importMusicXml } from "../../import/musicxml/parser";
import {
  step3ImportVersionsFromRegistry,
  type ImportedChordDraft,
  type ImportedSectionDraft,
  type MusicXmlImportDraft,
} from "../../import/musicxml/types";

import {
  addChord,
  confirmChord,
  confirmRights,
  confirmSection,
  editSection,
  replaceChord,
  selectLeadCandidate,
  setDefaultKey,
  setDefaultTempo,
  setPerformerRange,
  setSectionOccurrenceLyricVerse,
  setSingerCount,
} from "../../import/review/commands";
import { deriveQuickReview, type QuickReviewAnalysis } from "../../import/review/quick-review";
import { IndexedDbProjectStore } from "../../product/local-project-store";
import { createProjectFromQuickReview } from "../../product/workspace";
import styles from "./import.module.css";

type DraftUpdater = (draft: MusicXmlImportDraft) => MusicXmlImportDraft;

const STEPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const NOTE_OPTIONS = Array.from({ length: 5 }, (_, octaveIndex) => octaveIndex + 2)
  .flatMap((octave) => STEPS.map((step) => `${step}${octave}`));
const RANGE_LABELS = ["여성 높음", "여성 중간", "여성 낮음", "남성 높음", "남성 중간", "남성 낮음"] as const;
const KEY_OPTIONS = [
  "Cb major", "Gb major", "Db major", "Ab major", "Eb major", "Bb major", "F major", "C major", "G major", "D major", "A major", "E major", "B major", "F# major", "C# major",
  "Ab minor", "Eb minor", "Bb minor", "F minor", "C minor", "G minor", "D minor", "A minor", "E minor", "B minor", "F# minor", "C# minor", "G# minor", "D# minor", "A# minor",
] as const;
const SECTION_TYPES: readonly ImportedSectionDraft["type"][] = [
  "intro", "verse", "pre-chorus", "chorus", "bridge", "tag", "ending", "other",
];
const STEP3_ALGORITHM_VERSIONS = step3ImportVersionsFromRegistry(
  APPLICATION_ALGORITHM_VERSION_REGISTRY,
);

function parsePitch(text: string): SpelledPitch | undefined {
  const match = /^([A-G])(#?)(-?\d+)$/u.exec(text);
  if (!match) return undefined;
  return { step: match[1] as SpelledPitch["step"], alter: match[2] === "#" ? 1 : 0, octave: Number(match[3]) };
}

function pitchText(pitch: SpelledPitch | undefined): string {
  if (!pitch) return "";
  const accidental = pitch.alter === 1 ? "#" : pitch.alter === -1 ? "b" : pitch.alter === 2 ? "##" : pitch.alter === -2 ? "bb" : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}

function keyFromText(text: string) {
  const match = /^([A-G])([b#]?)[ ](major|minor)$/u.exec(text);
  if (!match) return undefined;
  return {
    tonic: { step: match[1] as SpelledPitch["step"], alter: match[2] === "#" ? 1 as const : match[2] === "b" ? -1 as const : 0 as const },
    mode: match[3] as "major" | "minor",
  };
}

function NoteSelect({
  id,
  label,
  value,
  onChange,
  optional = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly optional?: boolean;
}) {
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{optional ? "사용 안 함" : "음 선택"}</option>
        {NOTE_OPTIONS.map((note) => <option key={note} value={note}>{note}</option>)}
      </select>
    </label>
  );
}

function PerformerEditor({
  ordinal,
  slot,
  onSave,
}: {
  readonly ordinal: number;
  readonly slot: MusicXmlImportDraft["performerSlots"][number];
  readonly onSave: (ordinal: number, value: { readonly displayName: string; readonly hardRange: PitchRange; readonly comfortableRange: PitchRange; readonly preferredTessitura?: PitchRange }) => void;
}) {
  const profile = slot.profile;
  const [displayName, setDisplayName] = useState(profile?.displayName ?? slot.displayName);
  const [hardLow, setHardLow] = useState(pitchText(profile?.hardRange.low));
  const [hardHigh, setHardHigh] = useState(pitchText(profile?.hardRange.high));
  const [comfortableLow, setComfortableLow] = useState(pitchText(profile?.comfortableRange.low));
  const [comfortableHigh, setComfortableHigh] = useState(pitchText(profile?.comfortableRange.high));
  const [preferredLow, setPreferredLow] = useState(pitchText(profile?.preferredTessitura?.low));
  const [preferredHigh, setPreferredHigh] = useState(pitchText(profile?.preferredTessitura?.high));
  const [rangeLabel, setRangeLabel] = useState<string>("");
  const requiredReady = hardLow !== "" && hardHigh !== "" && comfortableLow !== "" && comfortableHigh !== "";
  const preferredReady = (preferredLow === "" && preferredHigh === "") || (preferredLow !== "" && preferredHigh !== "");

  const save = () => {
    const hardLowPitch = parsePitch(hardLow);
    const hardHighPitch = parsePitch(hardHigh);
    const comfortableLowPitch = parsePitch(comfortableLow);
    const comfortableHighPitch = parsePitch(comfortableHigh);
    const preferredLowPitch = parsePitch(preferredLow);
    const preferredHighPitch = parsePitch(preferredHigh);
    if (!hardLowPitch || !hardHighPitch || !comfortableLowPitch || !comfortableHighPitch || !preferredReady) return;
    onSave(ordinal, {
      displayName: displayName.trim() || `Singer ${ordinal + 1}`,
      hardRange: { low: hardLowPitch, high: hardHighPitch },
      comfortableRange: { low: comfortableLowPitch, high: comfortableHighPitch },
      ...(preferredLowPitch && preferredHighPitch ? { preferredTessitura: { low: preferredLowPitch, high: preferredHighPitch } } : {}),
    });
  };

  return (
    <fieldset className={styles.subpanel}>
      <legend>{ordinal === 0 ? "Source Lead 가수" : `추가 가수 ${ordinal}`}</legend>
      <label className={styles.field} htmlFor={`performer-name-${ordinal}`}>
        <span>표시 이름</span>
        <input id={`performer-name-${ordinal}`} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <div className={styles.presetRow} aria-label="비권위 음역 라벨">
        {RANGE_LABELS.map((label) => (
          <button type="button" key={label} aria-pressed={rangeLabel === label} onClick={() => setRangeLabel(label)}>{label}</button>
        ))}
      </div>
      <p className={styles.help}>“{rangeLabel || "음역 라벨 미선택"}”은 안내 라벨뿐이며 음을 자동 입력하지 않습니다. 아래 음을 직접 확인해야 저장됩니다.</p>
      <div className={styles.rangeGrid}>
        <NoteSelect id={`hard-low-${ordinal}`} label="hard low" value={hardLow} onChange={setHardLow} />
        <NoteSelect id={`hard-high-${ordinal}`} label="hard high" value={hardHigh} onChange={setHardHigh} />
        <NoteSelect id={`comfortable-low-${ordinal}`} label="comfortable low" value={comfortableLow} onChange={setComfortableLow} />
        <NoteSelect id={`comfortable-high-${ordinal}`} label="comfortable high" value={comfortableHigh} onChange={setComfortableHigh} />
        <NoteSelect id={`preferred-low-${ordinal}`} label="preferred low (선택)" value={preferredLow} onChange={setPreferredLow} optional />
        <NoteSelect id={`preferred-high-${ordinal}`} label="preferred high (선택)" value={preferredHigh} onChange={setPreferredHigh} optional />
      </div>
      <p className={styles.help}>hard = 물리적 한계, comfortable = 편곡에서 우선할 편한 범위, preferred = comfortable 안의 추가 선호 범위입니다.</p>
      <button type="button" className={styles.primaryButton} onClick={save} disabled={!requiredReady || !preferredReady} title={!requiredReady || !preferredReady ? "필수 음역과 preferred의 양 끝을 선택하세요." : undefined}>음역 확인</button>
    </fieldset>
  );
}

function ChordEditor({ chord, onCommit }: { readonly chord: ImportedChordDraft; readonly onCommit: (key: string, text: string) => void }) {
  const [text, setText] = useState(chord.sourceText);
  const parseLabel = chord.parseResult.status === "ok" ? chord.parseResult.chord.canonicalSymbol : chord.parseResult.status === "no-chord" ? "N.C." : chord.parseResult.status;
  return (
    <li className={styles.reviewItem}>
      <div>
        <strong>{chord.key}</strong>
        <span className={styles.meta}> onset {chord.onset.n}/{chord.onset.d} · {parseLabel} · {chord.confirmation}</span>
      </div>
      <label className={styles.inlineField} htmlFor={`chord-${chord.key}`}>
        <span>코드</span>
        <input id={`chord-${chord.key}`} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <button type="button" onClick={() => onCommit(chord.key, text)}>저장하고 확인</button>
    </li>
  );
}

function SectionEditor({
  section,
  onEdit,
  onConfirm,
}: {
  readonly section: ImportedSectionDraft;
  readonly onEdit: (key: string, type: ImportedSectionDraft["type"], label: string) => void;
  readonly onConfirm: (key: string) => void;
}) {
  const [type, setType] = useState(section.type);
  const [label, setLabel] = useState(section.label);
  return (
    <li className={styles.reviewItem}>
      <div>
        <strong>{section.label}</strong>
        <span className={styles.meta}> {section.type} · 마디 {section.startMeasureOrdinal + 1}–{section.endMeasureOrdinalExclusive} · {section.confirmation}</span>
      </div>
      <label className={styles.inlineField} htmlFor={`section-label-${section.key}`}>
        <span>label</span>
        <input id={`section-label-${section.key}`} value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className={styles.inlineField} htmlFor={`section-type-${section.key}`}>
        <span>type</span>
        <select id={`section-type-${section.key}`} value={type} onChange={(event) => setType(event.target.value as ImportedSectionDraft["type"])}>
          {SECTION_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <div className={styles.presetRow}>
        <button type="button" onClick={() => onEdit(section.key, type, label)}>type/label 수정 저장</button>
        <button type="button" disabled={section.confirmation === "confirmed"} onClick={() => onConfirm(section.key)}>{section.confirmation === "confirmed" ? "확인됨" : "Section 확인"}</button>
      </div>
    </li>
  );
}

function AddChordForm({
  partOrdinal,
  measureCount,
  onAdd,
}: {
  readonly partOrdinal: number;
  readonly measureCount: number;
  readonly onAdd: (partOrdinal: number, measureOrdinal: number, onsetText: string, chordText: string) => void;
}) {
  const [measure, setMeasure] = useState("0");
  const [onset, setOnset] = useState("0/1");
  const [text, setText] = useState("");
  return (
    <form className={styles.addRow} onSubmit={(event) => {
      event.preventDefault();
      onAdd(partOrdinal, Number(measure), onset, text);
      setText("");
    }}>
      <label>마디<select value={measure} onChange={(event) => setMeasure(event.target.value)}>{Array.from({ length: measureCount }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select></label>
      <label>onset<input value={onset} pattern="[0-9]+/[1-9][0-9]*" onChange={(event) => setOnset(event.target.value)} /></label>
      <label>코드/N.C.<input value={text} required onChange={(event) => setText(event.target.value)} /></label>
      <button type="submit">코드 추가</button>
    </form>
  );
}

function RightsEditor({ onConfirm }: { readonly onConfirm: (rights: RightsMetadata) => void }) {
  const [basis, setBasis] = useState<RightsBasis>("self-authored");
  const [sourceReference, setSourceReference] = useState("");
  const [licenseNote, setLicenseNote] = useState("");
  const [generation, setGeneration] = useState(false);
  const licensedReady = basis !== "licensed" || sourceReference.trim() !== "" || licenseNote.trim() !== "";
  return (
    <fieldset className={styles.subpanel}>
      <legend>권리 확인</legend>
      <label className={styles.field} htmlFor="rights-basis"><span>근거</span><select id="rights-basis" value={basis} onChange={(event) => setBasis(event.target.value as RightsBasis)}><option value="self-authored">직접 창작</option><option value="public-domain">퍼블릭 도메인</option><option value="licensed">라이선스 보유</option><option value="user-confirmed-rights">사용 권리 직접 확인</option></select></label>
      <label className={styles.field} htmlFor="rights-reference"><span>출처/라이선스 참조</span><input id="rights-reference" value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} /></label>
      <label className={styles.field} htmlFor="rights-note"><span>라이선스 메모</span><input id="rights-note" value={licenseNote} onChange={(event) => setLicenseNote(event.target.value)} /></label>
      <label className={styles.checkbox}><input type="checkbox" checked={generation} onChange={(event) => setGeneration(event.target.checked)} /> 이 Source를 편곡 생성 입력으로 사용할 권리가 있습니다.</label>
      <button type="button" className={styles.primaryButton} disabled={!generation || !licensedReady} title={!generation || !licensedReady ? "generation 권리와 필요한 라이선스 근거를 확인하세요." : undefined} onClick={() => onConfirm({ basis, allowedUses: ["generation"], ...(sourceReference.trim() ? { sourceReference: sourceReference.trim() } : {}), ...(licenseNote.trim() ? { licenseNote: licenseNote.trim() } : {}), ...(basis === "user-confirmed-rights" ? { confirmedAt: new Date().toISOString() } : {}) })}>권리 확인 저장</button>
    </fieldset>
  );
}

function DiagnosticSummary({ diagnostics }: { readonly diagnostics: readonly Diagnostic[] }) {
  if (diagnostics.length === 0) return <p className={styles.okBox}>차단 진단이 없습니다.</p>;
  return (
    <div className={styles.errorBox} role="alert" aria-live="polite">
      <strong>확인이 필요한 항목 {diagnostics.length}개</strong>
      <ul>{diagnostics.map((diagnostic) => <li key={diagnostic.id}><code>{diagnostic.code}</code> — {diagnostic.messageKo}</li>)}</ul>
    </div>
  );
}

export function ImportReviewClient() {
  const router = useRouter();
  const [draft, setDraft] = useState<MusicXmlImportDraft>();
  const [analysis, setAnalysis] = useState<QuickReviewAnalysis>();
  const [diagnostics, setDiagnostics] = useState<readonly Diagnostic[]>([]);
  const [fileStatus, setFileStatus] = useState("MusicXML 또는 MXL 파일을 선택하세요.");
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [tempoText, setTempoText] = useState("");
  const [keyText, setKeyText] = useState("");
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [omrHandoff, setOmrHandoff] = useState<{ readonly result: OmrProviderResult; readonly pageUrls: readonly string[] }>();
  const [omrDecision, setOmrDecision] = useState<"open" | "accepted" | "rejected" | "manual">("open");
  const [omrManualChord, setOmrManualChord] = useState("");

  const updateDraft = useCallback((updater: DraftUpdater) => {
    setReviewing(true);
    startTransition(() => setDraft((current) => current ? updater(current) : current));
  }, []);

  useEffect(() => {
    if (!draft) return;
    let active = true;
    void deriveQuickReview(draft, STEP3_ALGORITHM_VERSIONS).then((next) => {
      if (!active) return;
      setAnalysis(next);
      setDiagnostics(next.diagnostics);
      setReviewing(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setFileStatus(error instanceof Error ? error.message : "Quick Review 계산에 실패했습니다.");
      setReviewing(false);
    });
    return () => { active = false; };
  }, [draft]);

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    setAnalysis(undefined);
    setDraft(undefined);
    setDiagnostics([]);
    setFileStatus(`${file.name} 보안 검사 중…`);
    try {
      const result = await importMusicXml(new Uint8Array(await file.arrayBuffer()), {
        algorithmVersions: STEP3_ALGORITHM_VERSIONS,
        originalFileName: file.name,
      });
      if (result.status === "blocked") {
        setDiagnostics(result.diagnostics);
        setFileStatus("가져오기가 안전하게 차단되었습니다.");
      } else {
        setReviewing(true);
        setDraft(result.draft);
        setDiagnostics(result.diagnostics);
        setFileStatus(`${result.draft.containerKind.toUpperCase()} 구조 파싱 완료 · Quick Review 필요`);
      }
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : "파일을 읽지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void takeOmrImportHandoff().then((handoff) => {
      if (handoff) {
        if (handoff.omrProviderResult) setOmrHandoff({ result: handoff.omrProviderResult, pageUrls: handoff.pageImages.map((image) => URL.createObjectURL(image)) });
        void loadFile(handoff.file);
      }
    }).catch(() => {
      setFileStatus("OMR 결과 전달값을 읽지 못했습니다. OMR 검토 화면에서 다시 시도하세요.");
    });
  }, [loadFile]);

  useEffect(() => () => { for (const url of omrHandoff?.pageUrls ?? []) URL.revokeObjectURL(url); }, [omrHandoff]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  const selectedCandidate = draft?.leadCandidates.find((candidate) => candidate.key === draft.selectedLeadStaffKey);
  const selectedPart = draft?.parts.find((part) => part.partOrdinal === selectedCandidate?.partOrdinal);
  const chordPart = useMemo(() => selectedPart?.measures.some((measure) => measure.chords.length > 0)
    ? selectedPart
    : draft?.parts.find((part) => part.measures.some((measure) => measure.chords.length > 0)), [draft, selectedPart]);
  const chords = chordPart?.measures.flatMap((measure) => measure.chords) ?? [];
  const sections = draft?.sections.filter((section) => section.partOrdinal === selectedCandidate?.partOrdinal) ?? [];
  const sectionOccurrences = draft?.sectionOccurrences
    .filter((occurrence) => occurrence.candidateKey === selectedCandidate?.key) ?? [];

  const commitChord = (key: string, text: string) => updateDraft((current) => confirmChord(replaceChord(current, key, text), key));
  const addChordAt = (partOrdinal: number, measureOrdinal: number, onsetText: string, chordText: string) => {
    const match = /^(\d+)\/([1-9]\d*)$/u.exec(onsetText.trim());
    if (!match) return;
    updateDraft((current) => addChord(current, partOrdinal, measureOrdinal, { n: Number(match[1]), d: Number(match[2]) }, chordText));
  };

  const openWorkspace = async () => {
    if (!draft || !analysis?.state.readyForPlanning) return;
    setHandoffBusy(true);
    setFileStatus("정본 프로젝트를 만들고 이 브라우저에 저장하는 중…");
    try {
      let project = await createProjectFromQuickReview(draft, analysis, "standard");
      if (omrHandoff) {
        if (omrDecision === "open") throw new RangeError("OMR_REVIEW_REQUIRED");
        const context = await createInitialOmrReviewContext(project.source, omrHandoff.result);
        let source = project.source;
        const corrections = [];
        const resolvedItems = [];
        const remaps = [];
        for (const item of context.reviewRecord.reviewItems) {
          if (omrDecision === "rejected") {
            resolvedItems.push(rejectOmrReviewAlternatives(item, item.alternatives.map((alternative) => alternative.id)));
            continue;
          }
          if (omrDecision === "manual") {
            const parsed = parseChord(omrManualChord);
            if (item.target.target.kind !== "chord-event" || (parsed.status !== "ok" && parsed.status !== "no-chord")) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
            const resolved = await manuallyCorrectOmrReviewItem({ source, item, patch: { kind: "chord", parseResult: parsed }, appliedAt: new Date().toISOString(), remaps });
            source = resolved.source; corrections.push(resolved.correction); remaps.push(resolved.idRemap); resolvedItems.push(resolved.item);
          } else {
            const alternative = item.alternatives[0];
            if (!alternative) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
            const resolved = await acceptOmrReviewAlternative({ source, item, alternativeId: alternative.id, appliedAt: new Date().toISOString(), remaps });
            source = resolved.source; corrections.push(resolved.correction); remaps.push(resolved.idRemap); resolvedItems.push(resolved.item);
          }
        }
        source = await attachOmrReviewContext({ source, providerResult: omrHandoff.result, reviewRecord: { ...context.reviewRecord, corrections, reviewItems: resolvedItems } });
        const readiness = await validateRuntimeOmrReadiness(source);
        if (readiness.readiness !== "validator-ready") throw new RangeError("OMR_REVIEW_REQUIRED");
        project = { ...project, source };
      }
      const projectId = crypto.randomUUID();
      await new IndexedDbProjectStore().save({ projectId, updatedAt: new Date().toISOString(), project });
      router.push(`/workspace?project=${encodeURIComponent(projectId)}`);
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
      setHandoffBusy(false);
    }
  };

  const omrTargetChordId = omrHandoff?.result.evidence.evidence.find((evidence) => evidence.vendorTargetId?.startsWith("ch:"))?.vendorTargetId;
  const omrTargetChord = chords.find((chord) => chord.key === omrTargetChordId) ?? (omrTargetChordId ? chords[0] : undefined);
  const omrPageIndex = 0;
  const omrPageEvidence = omrHandoff?.result.evidence.evidence.filter((evidence) => omrHandoff.result.evidence.frames.find((frame) => frame.id === evidence.box.frameId)?.pageIndex === omrPageIndex) ?? [];
  const omrBoxStyle = (box: BoundingBox) => ({ left: `${Number(box.xMu) / 10_000}%`, top: `${Number(box.yMu) / 10_000}%`, width: `${Number(box.widthMu) / 10_000}%`, height: `${Number(box.heightMu) / 10_000}%` });

  return (
    <div className={styles.flow}>
      <section className={styles.panel} aria-labelledby="file-heading">
        <h2 id="file-heading">1. 안전한 파일 읽기</h2>
        <label className={styles.dropZone} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <span>{loading ? "검사 중…" : "MusicXML / XML / MXL 선택 또는 드롭"}</span>
          <input type="file" accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" onChange={onFileChange} disabled={loading} />
        </label>
        <p className={styles.status} aria-live="polite">{fileStatus}</p>
        {!draft ? <DiagnosticSummary diagnostics={diagnostics} /> : null}
      </section>

      {draft ? (
        <>
          {omrHandoff ? <section className={styles.panel} aria-labelledby="omr-review-heading">
            <h2 id="omr-review-heading">OMR 증거 검토 · 열린 항목 {omrDecision === "open" ? 1 : 0}개</h2>
            <p className={styles.notice}>제공자 결과는 아직 musical authority가 아닙니다. 아래 결정을 기록해도 기존 Quick Review의 코드·구간·음역·generation 권리 확인은 그대로 필요합니다.</p>
            {omrHandoff.pageUrls[omrPageIndex] ? <div className={styles.omrEvidence}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={omrHandoff.pageUrls[omrPageIndex]} alt="OMR 원본 페이지와 evidence overlay" />
              {omrPageEvidence.map((evidence) => {
                const box = mapEvidenceBoxToNormalizedOriginal(evidence, omrHandoff.result.evidence.frames, omrHandoff.result.evidence.transforms);
                return box ? <span className={styles.omrEvidenceBox} style={omrBoxStyle(box)} key={evidence.id} /> : null;
              })}
            </div> : null}
            <p><strong>진단:</strong> OMR_REVIEW_REQUIRED · <strong>evidence fallback:</strong> {omrHandoff.result.evidence.granularity === "measure" ? "원본 마디와 디지털 코드 후보 연결" : omrHandoff.result.evidence.granularity === "staff" ? "원본 staff crop만" : "원본 page preview만"}</p>
            <dl className={styles.omrBeforeAfter}><div><dt>인식 전/후보</dt><dd>{omrTargetChord?.sourceText ?? "canonical target은 Quick Review에서 확인"}</dd></div><div><dt>현재 결정</dt><dd>{omrDecision}</dd></div></dl>
            <div className={styles.presetRow}>
              <button type="button" onClick={() => { if (omrTargetChord) commitChord(omrTargetChord.key, omrTargetChord.sourceText); setOmrDecision("accepted"); }}>인식 후보 수락</button>
              <button type="button" onClick={() => setOmrDecision("rejected")}>후보 거절</button>
            </div>
            <div className={styles.omrManual}><label className={styles.field}><span>수동 코드 correction</span><input value={omrManualChord} onChange={(event) => setOmrManualChord(event.target.value)} placeholder="예: C, Am7, N.C." /></label><button type="button" disabled={!omrTargetChord || !omrManualChord.trim()} onClick={() => { if (omrTargetChord) commitChord(omrTargetChord.key, omrManualChord); setOmrDecision("manual"); }}>수동 correction 적용</button></div>
            <p className={styles.status}><strong>correction history:</strong> {omrDecision === "open" ? "아직 결정 없음" : omrDecision === "manual" ? `manual · ${omrManualChord}` : omrDecision}</p>
            <p className={styles.help}>stale/remapped target은 Source revision 연결이 정확히 한 개일 때만 적용되며, 그 외에는 archive로 남습니다.</p>
          </section> : null}
          <section className={styles.panel} aria-labelledby="summary-heading">
            <h2 id="summary-heading">2. 악보 요약과 Source Lead</h2>
            <dl className={styles.summary}><div><dt>제목</dt><dd>{draft.title}</dd></div><div><dt>파트</dt><dd>{draft.parts.length}</dd></div><div><dt>마디</dt><dd>{draft.parts[0]?.measures.length ?? 0}</dd></div><div><dt>형식</dt><dd>{draft.containerKind.toUpperCase()}</dd></div></dl>
            <fieldset className={styles.subpanel}>
              <legend>멜로디 staff / voice — 반드시 직접 선택</legend>
              {draft.leadCandidates.map((candidate) => (
                <label className={styles.radioRow} key={candidate.key}>
                  <input type="radio" name="lead-candidate" checked={draft.selectedLeadStaffKey === candidate.key} onChange={() => updateDraft((current) => selectLeadCandidate(current, candidate.key))} />
                  <span><strong>{candidate.displayPartName}</strong> · staff {candidate.staffNumber} · voice {candidate.voiceKey} · note {candidate.noteCount} · lyric {candidate.lyricCount}</span>
                </label>
              ))}
            </fieldset>
            {!draft.defaultTempo ? (
              <form className={styles.addRow} onSubmit={(event: FormEvent) => { event.preventDefault(); const bpm = Number(tempoText); if (Number.isSafeInteger(bpm) && bpm >= 20 && bpm <= 300) updateDraft((current) => setDefaultTempo(current, { beatUnit: 4, dotted: false, bpm })); }}>
                <label>초기 quarter BPM<input type="number" min="20" max="300" value={tempoText} onChange={(event) => setTempoText(event.target.value)} required /></label><button type="submit">tempo 확인</button>
              </form>
            ) : <p className={styles.okBox}>초기 tempo: {draft.defaultTempo.bpm} BPM</p>}
            {!draft.defaultKey ? (
              <form className={styles.addRow} onSubmit={(event: FormEvent) => { event.preventDefault(); const key = keyFromText(keyText); if (key) updateDraft((current) => setDefaultKey(current, key)); }}>
                <label>기본 조성<select value={keyText} onChange={(event) => setKeyText(event.target.value)} required><option value="">조성 선택</option>{KEY_OPTIONS.map((key) => <option key={key} value={key}>{key}</option>)}</select></label><button type="submit">조성 확인</button>
              </form>
            ) : <p className={styles.okBox}>기본 조성: {draft.defaultKey.tonic.step}{draft.defaultKey.tonic.alter === 1 ? "#" : draft.defaultKey.tonic.alter === -1 ? "b" : ""} {draft.defaultKey.mode}</p>}
          </section>

          <section className={styles.panel} aria-labelledby="chord-heading">
            <h2 id="chord-heading">3. 코드 확인</h2>
            {!selectedPart ? <p className={styles.notice}>Source Lead를 선택하면 코드 authority와 gap을 계산합니다.</p> : null}
            {selectedPart && chords.length === 0 ? <p className={styles.notice}>코드가 없습니다. 멜로디가 있는 범위에 코드 또는 N.C.를 추가하세요.</p> : null}
            <ul className={styles.reviewList}>{chords.map((chord) => <ChordEditor key={chord.key} chord={chord} onCommit={commitChord} />)}</ul>
            {selectedPart && chordPart ? <AddChordForm partOrdinal={chordPart.partOrdinal} measureCount={chordPart.measures.length} onAdd={addChordAt} /> : null}
          </section>

          <section className={styles.panel} aria-labelledby="section-heading">
            <h2 id="section-heading">4. Section suggestion 확인</h2>
            <p className={styles.help}>MusicXML의 rehearsal/명시적 section text만 제안으로 사용했습니다. 확인 전에는 authority가 아닙니다.</p>
            <ul className={styles.reviewList}>{sections.map((section) => <SectionEditor key={section.key} section={section} onEdit={(key, type, label) => updateDraft((current) => editSection(current, key, { type, label }))} onConfirm={(key) => updateDraft((current) => confirmSection(current, key))} />)}</ul>
            <p className={styles.help}>이 단계에서 section 범위는 MusicXML source measure 경계로 고정되며, type과 label만 수정할 수 있습니다.</p>
            <ul className={styles.reviewList}>{sectionOccurrences.map((occurrence) => {
              const section = sections.find((candidate) => candidate.key === occurrence.sectionKey);
              return (
                <li className={styles.reviewItem} key={occurrence.key}>
                  <div><strong>{section?.label ?? occurrence.sectionKey} · occurrence {occurrence.occurrenceIndex + 1}</strong><span className={styles.meta}> performance {occurrence.startPerformanceMeasureIndex + 1}–{occurrence.endPerformanceMeasureIndexExclusive}</span></div>
                  {occurrence.availableLyricVerses.length === 0 ? <span className={styles.meta}>가사 없음 · verse 1 authority</span> : (
                    <label className={styles.inlineField} htmlFor={`occurrence-verse-${occurrence.key}`}>
                      <span>production lyric verse</span>
                      <select id={`occurrence-verse-${occurrence.key}`} value={occurrence.selectedLyricVerse ?? ""} onChange={(event) => { const verse = Number(event.target.value); updateDraft((current) => setSectionOccurrenceLyricVerse(current, occurrence.key, verse)); }}>
                        <option value="">verse 선택</option>
                        {occurrence.availableLyricVerses.map((verse) => <option key={verse} value={verse}>{verse}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              );
            })}</ul>
          </section>

          <section className={styles.panel} aria-labelledby="flow-heading">
            <h2 id="flow-heading">5. 진행 지시</h2>
            {draft.unsupportedPerformanceFlows.length === 0 ? <p className={styles.okBox}>지원하지 않는 D.C./D.S./Coda/Fine 흐름이 없습니다.</p> : <div className={styles.errorBox} role="alert"><strong>자동 전개 불가</strong><ul>{draft.unsupportedPerformanceFlows.map((flow) => <li key={flow.id}>{flow.text} · 마디 {flow.measureOrdinal + 1}</li>)}</ul></div>}
          </section>

          <section className={styles.panel} aria-labelledby="range-heading">
            <h2 id="range-heading">6. 가수 수와 음역</h2>
            <label className={styles.field} htmlFor="singer-count"><span>총 보컬 수</span><select id="singer-count" value={draft.singerCount} onChange={(event) => { const singerCount = Number(event.target.value) as 1 | 2 | 3; updateDraft((current) => setSingerCount(current, singerCount)); }}><option value="1">1명 · track:source-lead</option><option value="2">2명 · + track:h1</option><option value="3">3명 · + track:h1/h2</option></select></label>
            {draft.performerSlots.map((slot, ordinal) => <PerformerEditor key={slot.id} ordinal={ordinal} slot={slot} onSave={(performerOrdinal, value) => updateDraft((current) => setPerformerRange(current, performerOrdinal, value))} />)}
          </section>

          <section className={styles.panel} aria-labelledby="rights-heading">
            <h2 id="rights-heading">7. generation 권리</h2>
            <RightsEditor onConfirm={(rights) => updateDraft((current) => confirmRights(current, rights))} />
            {draft.rights ? <p className={styles.okBox}>저장된 권리 근거: {draft.rights.basis} · generation 허용</p> : null}
          </section>

          <section className={styles.panel} aria-labelledby="review-heading">
            <h2 id="review-heading">8. Quick Review</h2>
            <p className={styles.status} aria-live="polite">{reviewing ? "정본 digest·timeline·atomization 재계산 중…" : analysis?.state.readyForPlanning ? "입력 준비 완료" : "검토가 더 필요합니다."}</p>
            {analysis ? (
              <ul className={styles.checklist}>
                <li><span>{analysis.state.selectedLeadStaffKey ? "완료" : "확인 필요"}</span> Source Lead 명시 선택</li>
                <li><span>{analysis.chordTimelineState.status === "resolved" ? "완료" : "확인 필요"}</span> 코드/N.C. coverage와 timeline</li>
                <li><span>{analysis.state.unconfirmedChordEventIds.length === 0 ? "완료" : "확인 필요"}</span> production chord 확인</li>
                <li><span>{analysis.state.unconfirmedSectionDefinitionIds.length === 0 ? "완료" : "확인 필요"}</span> Section 확인</li>
                <li><span>{analysis.state.invalidPerformerIds.length === 0 ? "완료" : "확인 필요"}</span> performer 음역</li>
                <li><span>{analysis.state.missingRightsUses.length === 0 ? "완료" : "확인 필요"}</span> generation 권리</li>
                <li><span>{analysis.state.unsupportedPerformanceFlowIds.length === 0 ? "완료" : "차단"}</span> 지원 불가 진행 지시</li>
              </ul>
            ) : null}
            <DiagnosticSummary diagnostics={diagnostics} />
            {analysis?.state.readyForPlanning ? <button className="primary" type="button" disabled={handoffBusy || Boolean(omrHandoff && omrDecision === "open")} onClick={() => void openWorkspace()}>{handoffBusy ? "워크스페이스 준비 중…" : "프로젝트 워크스페이스 열기 →"}</button> : null}
            <p className={styles.help}>여기서 확정한 Source, 코드, 구간, 가수 음역과 권리 정보가 그대로 프로젝트 authority가 됩니다.</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
