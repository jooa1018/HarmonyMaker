import { canonicalJson, semanticDigest } from "../../domain/digest/canonical";
import { compareFractions, addFractions, fraction } from "../../domain/fraction";
import { pitchMidiNumber as midiNumber, type KeySignature, type SpelledPitch } from "../../domain/pitch";
import { validatePerformer } from "../../domain/performer";
import { validateRights, type RightsMetadata, type TempoSpec } from "../../domain/source/model";
import { localCandidateEvidence } from "../../domain/omr/local-candidate";
import { HARMONY_PART_PRESET_VERSION, defaultHarmonyPart, isHarmonyPartPreset, presetPerformer, sourceLeadSpanPerformer, type HarmonyPartPreset, type HarmonyPartPresetVersion } from "../../domain/part-presets";
import { performerId } from "../../domain/ids";
import { __musicXmlParserInternals } from "../musicxml/parser-core";
import { buildImportedSectionOccurrenceReviews } from "../review/occurrences";
import { clean } from "./edit";
import { captureWorkspace, readVerifiedWorkspace } from "./journal";
import { currentlyReviewedIssueIds, deriveStructuralArrangementBlockers, workspaceScopeRelevant } from "./review";
import type { ArrangementRequest, ScoreWorkspace, WorkspaceIssue, WorkspaceScope, WorkspaceState } from "./model";

/**
 * Automatic practice draft ("자동 초안"). A second, explicit contract next to
 * the reviewed-Source path: it never writes attestations, never claims that a
 * person compared the source, and records where every request value came from.
 * Structural/time/pitch/generation checks are the same functions the reviewed
 * path uses; only raw OMR comparison records are classified by their effect on
 * generation instead of being mandatory approvals.
 */
export const AUTO_DRAFT_POLICY_VERSION = "hm-auto-draft-policy-v2" as const;
export type AutoDraftPolicyVersion = "hm-auto-draft-policy-v1" | typeof AUTO_DRAFT_POLICY_VERSION;
const presetVersionForPolicy = (version: AutoDraftPolicyVersion): HarmonyPartPresetVersion => version === "hm-auto-draft-policy-v1" ? "hm-harmony-part-presets-v1" : HARMONY_PART_PRESET_VERSION;

export interface AutoDraftOptions {
  /** One or two distinct parts; normalized to alto → tenor. */
  readonly harmonyParts?: readonly HarmonyPartPreset[];
  /** Explicit user answers to questions this assessment returned. */
  readonly decisions?: { readonly unreadPrintedChords?: "carry-previous" };
  /** Rights confirmation the user gave at attach time (API callers). */
  readonly rights?: RightsMetadata;
}
export type AutoDraftOrigin = "source-read" | "source-inferred" | "policy-default" | "user-edit" | "user-choice";
export interface AutoDraftProvenance { readonly field: string; readonly origin: AutoDraftOrigin; readonly value: unknown; readonly noteKo: string }
export type AutoDraftCategory = "auto" | "reviewed-record" | "warning" | "question" | "unsupported" | "not-applicable";
export interface AutoDraftFinding {
  readonly id: string; readonly code: string; readonly category: Exclude<AutoDraftCategory, "auto" | "reviewed-record" | "not-applicable">;
  readonly messageKo: string; readonly effectKo: string; readonly scope?: WorkspaceScope;
  /** For questions: the explicit answers this contract supports. */
  readonly answers?: readonly { readonly option: string; readonly meaningKo: string }[];
}
export interface AutoDraftAssessment {
  readonly version: AutoDraftPolicyVersion;
  readonly presetVersion: HarmonyPartPresetVersion;
  readonly workspaceId: string; readonly workspaceRevision: number; readonly workspaceDigest: string;
  readonly optionsDigest: string;
  readonly status: "ready" | "ready-with-warnings" | "needs-decision" | "unsupported";
  readonly request?: ArrangementRequest;
  readonly provenance: readonly AutoDraftProvenance[];
  readonly findings: readonly AutoDraftFinding[];
  readonly rawIssueCount: number;
  readonly issueCategories: Readonly<Record<AutoDraftCategory, number>>;
  /** This contract never records or implies a human source comparison. */
  readonly humanSourceReview: "not-performed-by-this-contract";
  readonly existingReviewRecords: number;
}

export function normalizeAutoDraftOptions(value: unknown): AutoDraftOptions {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["harmonyParts", "decisions", "rights"].includes(k))) throw new RangeError("AUTO_DRAFT_OPTIONS_INVALID");
  const parts = v.harmonyParts;
  if (parts !== undefined && (!Array.isArray(parts) || parts.length < 1 || parts.length > 2
    || !Array.from(parts).every(isHarmonyPartPreset) || new Set(parts).size !== parts.length)) throw new RangeError("AUTO_DRAFT_OPTIONS_INVALID");
  const d = v.decisions as Record<string, unknown> | undefined;
  if (d !== undefined && (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).some(k => k !== "unreadPrintedChords")
    || (d.unreadPrintedChords !== undefined && d.unreadPrintedChords !== "carry-previous"))) throw new RangeError("AUTO_DRAFT_OPTIONS_INVALID");
  const r = v.rights as RightsMetadata | undefined;
  if (r !== undefined && (!r || typeof r !== "object" || !Array.isArray(r.allowedUses) || !r.allowedUses.includes("generation") || !validateRights(r))) throw new RangeError("AUTO_DRAFT_RIGHTS_INVALID");
  return clean({
    ...(parts ? { harmonyParts: [...parts].sort() } : {}),
    ...(d?.unreadPrintedChords ? { decisions: { unreadPrintedChords: "carry-previous" as const } } : {}),
    ...(r ? { rights: { ...r, allowedUses: [...r.allowedUses].sort() } } : {}),
  });
}
/** Preserve the original v1 option bytes when replaying saved sources. */
function optionsForPolicy(options: AutoDraftOptions, version: AutoDraftPolicyVersion) {
  if (version === AUTO_DRAFT_POLICY_VERSION) return options;
  if (version !== "hm-auto-draft-policy-v1" || (options.harmonyParts?.length ?? 0) > 1) throw new RangeError("AUTO_DRAFT_VERSION_UNSUPPORTED");
  const { harmonyParts, ...rest } = options;
  return { ...rest, ...(harmonyParts ? { harmonyPart: harmonyParts[0] } : {}) };
}
export const serializeAutoDraftOptions = (options: AutoDraftOptions, version: AutoDraftPolicyVersion = AUTO_DRAFT_POLICY_VERSION) => canonicalJson({
  version, presetVersion: presetVersionForPolicy(version), options: optionsForPolicy(normalizeAutoDraftOptions(options), version),
});
export function parseAutoDraftMarker(text: string): { readonly version: AutoDraftPolicyVersion; readonly options: AutoDraftOptions } {
  const value = JSON.parse(text) as { version?: string; presetVersion?: string; options?: unknown };
  if (!value || !["hm-auto-draft-policy-v1", AUTO_DRAFT_POLICY_VERSION].includes(value.version ?? "") || value.presetVersion !== presetVersionForPolicy(value.version as AutoDraftPolicyVersion)) throw new RangeError("AUTO_DRAFT_VERSION_UNSUPPORTED");
  const version = value.version as AutoDraftPolicyVersion;
  let rawOptions = value.options;
  if (version === "hm-auto-draft-policy-v1") {
    const v = (rawOptions ?? {}) as Record<string, unknown>;
    if (typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["harmonyPart", "decisions", "rights"].includes(k))
      || (v.harmonyPart !== undefined && !isHarmonyPartPreset(v.harmonyPart))) throw new RangeError("AUTO_DRAFT_OPTIONS_INVALID");
    const { harmonyPart, ...rest } = v;
    rawOptions = { ...rest, ...(harmonyPart ? { harmonyParts: [harmonyPart] } : {}) };
  }
  const options = normalizeAutoDraftOptions(rawOptions);
  if (serializeAutoDraftOptions(options, version) !== text) throw new RangeError("AUTO_DRAFT_MARKER_NONCANONICAL");
  return { version, options };
}

type Music = NonNullable<WorkspaceState["music"]>;
const seedPerformers = (r: ArrangementRequest) => r.performers.length === 1 && !r.performers[0].profile;

function chooseLead(music: Music, request: ArrangementRequest): { lead?: string; origin?: AutoDraftOrigin; noteKo: string } {
  if (request.lead) return { lead: request.lead, origin: "user-edit", noteKo: "작업 공간에서 사용자가 선택한 Lead" };
  const pitched = music.leadCandidates.filter(c => c.noteCount > 0);
  if (pitched.length === 1) return { lead: pitched[0].key, origin: "policy-default", noteKo: "음표가 있는 성부가 하나뿐이라 자동 선택" };
  const withLyrics = pitched.filter(c => c.lyricCount > 0);
  if (withLyrics.length === 1) return { lead: withLyrics[0].key, origin: "policy-default", noteKo: "가사가 붙은 유일한 성부를 Lead로 자동 선택(비선택 성부는 작업 공간에 보존)" };
  return { noteKo: "가사·음표 근거로 Lead를 하나로 정할 수 없음" };
}
function inferMode(music: Music, fifths: number): { key: KeySignature; origin: AutoDraftOrigin; noteKo: string } | undefined {
  const major = __musicXmlParserInternals.keyFromFifths(fifths, "major"), minor = __musicXmlParserInternals.keyFromFifths(fifths, "minor");
  if (!major || !minor) return undefined;
  const chords = music.parts.flatMap(p => p.measures.flatMap(m => [...m.chords].sort((a, b) => compareFractions(a.onset, b.onset))))
    .filter(c => c.parseResult.status === "ok");
  const tonic = (c: (typeof chords)[number], key: KeySignature, minorThird: boolean) => {
    if (c.parseResult.status !== "ok") return false;
    const ch = c.parseResult.chord, third = ch.tones.find(t => t.role === "third");
    return ch.root.step === key.tonic.step && ch.root.alter === key.tonic.alter && !!third && (third.alteration === -1) === minorThird;
  };
  const ends = [chords[0], chords.at(-1)].filter(Boolean) as typeof chords;
  const maj = ends.filter(c => tonic(c, major, false)).length, min = ends.filter(c => tonic(c, minor, true)).length;
  if (min > maj) return { key: minor, origin: "source-inferred", noteKo: `조표 fifths=${fifths}와 첫/끝 코드가 단조 으뜸화음과 일치해 단조로 추정` };
  if (maj > 0) return { key: major, origin: "source-inferred", noteKo: `조표 fifths=${fifths}와 첫/끝 코드가 장조 으뜸화음과 일치해 장조로 추정` };
  return { key: major, origin: "policy-default", noteKo: `조표 fifths=${fifths}; 코드 근거가 없어 장조를 제품 기본값으로 사용` };
}
const PRACTICE_TEMPO: Readonly<Record<"simple" | "compound", TempoSpec>> = {
  simple: { beatUnit: 4, dotted: false, bpm: 80 },
  compound: { beatUnit: 4, dotted: true, bpm: 60 },
};

/** Build the effective request. Values the user set in the journal win; empty
 * fields are filled from the source, then from named product defaults. */
function effectiveRequest(state: WorkspaceState, options: AutoDraftOptions, performanceVersion: string, provenance: AutoDraftProvenance[], findings: AutoDraftFinding[], policyVersion: AutoDraftPolicyVersion): ArrangementRequest | undefined {
  const presetVersion = presetVersionForPolicy(policyVersion);
  const music = state.music!, seed = state.request;
  const lead = chooseLead(music, seed);
  if (!lead.lead) {
    findings.push({ id: "lead-selection", code: "LEAD_SELECTION_REQUIRED", category: "question", messageKo: "Lead(원본 멜로디) 성부를 하나로 정할 수 없습니다.",
      effectKo: "화음은 Lead를 기준으로 생성되므로 선택이 필요합니다.", answers: music.leadCandidates.map(c => ({ option: c.key, meaningKo: `${c.displayPartName} · 음표 ${c.noteCount} · 가사 ${c.lyricCount}` })) });
    return undefined;
  }
  provenance.push({ field: "lead", origin: lead.origin!, value: lead.lead, noteKo: lead.noteKo });
  const candidate = music.leadCandidates.find(c => c.key === lead.lead)!;
  const part = music.parts.find(p => p.partOrdinal === candidate.partOrdinal)!;
  const rhythmVoices = seed.lead ? seed.rhythmVoices : [];
  const keys: Record<string, KeySignature> = { ...seed.keys };
  for (const m of part.measures) {
    const o = m.keyObservation;
    if (!o || keys[o.contextId] || o.interpretation === "explicit-source-mode") continue;
    const inferred = inferMode(music, o.fifths);
    if (!inferred) continue;
    keys[o.contextId] = inferred.key;
    provenance.push({ field: `keys.${o.contextId}`, origin: inferred.origin, value: inferred.key, noteKo: inferred.noteKo });
  }
  for (const [ctx, key] of Object.entries(seed.keys)) provenance.push({ field: `keys.${ctx}`, origin: "user-edit", value: key, noteKo: "작업 공간에서 사용자가 확인한 조성" });
  let tempo = seed.tempo;
  if (tempo) provenance.push({ field: "tempo", origin: "user-edit", value: tempo, noteKo: "작업 공간에서 사용자가 입력한 템포" });
  else if (music.defaultTempo) { tempo = music.defaultTempo; provenance.push({ field: "tempo", origin: "source-read", value: tempo, noteKo: "악보 파일에 기록된 템포" }); }
  else {
    const compound = [6, 12].includes(part.measures[0]?.time.numerator) && part.measures[0]?.time.denominator === 8;
    tempo = PRACTICE_TEMPO[compound ? "compound" : "simple"];
    provenance.push({ field: "tempo", origin: "policy-default", value: tempo, noteKo: "악보에서 템포를 읽지 못해 제품 연습 템포를 사용(원본 템포 아님)" });
  }
  // Performers: an explicit complete user setting is an advanced constraint and
  // is honoured. Otherwise the Lead track spans the printed melody and the
  // generated voice uses the chosen (or default) preset.
  const userComplete = !seedPerformers(seed) && seed.performers.length === seed.singerCount && seed.singerCount >= 2 && seed.performers.every(s => s.profile && validatePerformer(s.profile));
  const leadPitches = part.measures.flatMap(m => m.leadEvents).filter(e => e.candidateKey === lead.lead && e.kind === "note").map(e => (e as { pitch: SpelledPitch }).pitch);
  if (!leadPitches.length) {
    findings.push({ id: "lead-empty", code: "LEAD_WITHOUT_PITCHES", category: "unsupported", messageKo: "선택한 Lead에 음높이가 있는 음표가 없습니다.", effectKo: "화음을 생성할 멜로디가 없습니다." });
    return undefined;
  }
  let singerCount: 1 | 2 | 3 = 2, performers = seed.performers;
  const leadSlot = seed.performers[0]?.profile && validatePerformer(seed.performers[0].profile) ? seed.performers[0] : undefined;
  if (userComplete && !options.harmonyParts && policyVersion === "hm-auto-draft-policy-v1") {
    singerCount = seed.singerCount; performers = seed.performers;
    provenance.push({ field: "performers", origin: "user-edit", value: seed.performers.map(p => p.profile), noteKo: "작업 공간에서 사용자가 지정한 가수 음역(고급 설정)을 그대로 사용" });
  } else {
    const median = [...leadPitches].map(midiNumber).sort((a, b) => a - b)[Math.floor(leadPitches.length / 2)];
    const parts = options.harmonyParts ?? [defaultHarmonyPart(median)];
    singerCount = parts.length === 2 ? 3 : 2;
    const leadProfile = leadSlot?.profile ?? sourceLeadSpanPerformer(leadPitches);
    performers = [{ id: performerId(0), displayName: leadProfile.displayName, profile: { ...leadProfile, id: performerId(0) } },
      ...parts.map((part, index) => {
        const profile = presetPerformer(part, index === 0 ? "pf:1" : "pf:2", presetVersion);
        return { id: profile.id, displayName: profile.displayName, profile };
      })];
    provenance.push({ field: "performers[0]", origin: leadSlot ? "user-edit" : "policy-default", value: leadProfile,
      noteKo: leadSlot ? "사용자가 지정한 Lead 가수 제약(고급 설정)을 적용" : "Lead는 원본 멜로디 그대로: 악보의 실제 Lead 음역을 기록(가수 음역 아님, 이조·삭제 없음)" });
    parts.forEach((part, index) => provenance.push({ field: `performers[${index + 1}]`, origin: options.harmonyParts ? "user-choice" : "policy-default", value: { preset: part, version: presetVersion },
      noteKo: options.harmonyParts ? `사용자가 선택한 생성 화음 프리셋: ${part}` : `선택이 없어 Lead 중앙 음높이(MIDI ${median}) 기준 기본 프리셋 ${part}` }));
  }
  let rights = seed.rights;
  if (rights) provenance.push({ field: "rights", origin: "user-edit", value: rights, noteKo: "작업 공간에 기록된 사용자 권리 확인을 재사용" });
  else if (options.rights) { rights = options.rights; provenance.push({ field: "rights", origin: "user-choice", value: rights, noteKo: "첨부 시 사용자가 한 권리 확인" }); }
  else findings.push({ id: "rights", code: "RIGHTS_CONFIRMATION_REQUIRED", category: "question", messageKo: "이 악보로 화음을 생성할 권리를 확인해야 합니다.",
    effectKo: "권리 확인은 기본값으로 채우지 않습니다. 첨부 때 한 번 확인하면 재사용합니다.", answers: [{ option: "confirm-generation-rights", meaningKo: "사용자가 생성 용도의 권리를 확인" }] });
  let sections = seed.sections;
  if (sections.length && sections.every(s => s.confirmation === "confirmed")) provenance.push({ field: "sections", origin: "user-edit", value: sections, noteKo: "작업 공간에서 사용자가 확인한 구간" });
  else {
    const base = sections.length ? sections : music.sections;
    sections = (base.length ? base : [{ key: `section:p:${part.partOrdinal}:m:0`, partOrdinal: part.partOrdinal, startMeasureOrdinal: 0, endMeasureOrdinalExclusive: part.measures.length, type: "other" as const, label: "전체 곡" }])
      .map(s => ({ ...s, confirmation: "confirmed" as const }));
    provenance.push({ field: "sections", origin: "policy-default", value: sections.map(s => [s.startMeasureOrdinal, s.endMeasureOrdinalExclusive]), noteKo: "악보 구조에서 제안된 구간(없으면 전체 곡)을 연습 구간으로 사용(사람 확인 아님)" });
  }
  const lyricVerses: Record<string, number> = { ...seed.lyricVerses };
  const occurrences = buildImportedSectionOccurrenceReviews(music.parts, music.leadCandidates, sections, performanceVersion)
    .filter(o => o.candidateKey === lead.lead);
  for (const o of occurrences) if (lyricVerses[o.key] === undefined && o.availableLyricVerses.length > 1) {
    lyricVerses[o.key] = Math.min(...o.availableLyricVerses);
    provenance.push({ field: `lyricVerses.${o.key}`, origin: "policy-default", value: lyricVerses[o.key], noteKo: "여러 절 가사 중 가장 앞 절을 표시·재발음 기준으로 사용" });
  }
  let initialPickup = seed.initialPickup;
  if (initialPickup) provenance.push({ field: "initialPickup", origin: "user-edit", value: initialPickup, noteKo: "사용자가 선택한 첫 못갖춘마디 코드 정책" });
  else {
    const [m0, m1] = part.measures, chordPart = part.measures.some(m => m.chords.length) ? part : music.parts.find(p => p.measures.some(m => m.chords.length)) ?? part;
    if (m0?.implicit && !chordPart.measures[0]?.chords.some(c => c.onset.n === 0) && m1 && chordPart.measures[1]?.chords.some(c => c.onset.n === 0)
      && m0.leadEvents.some(e => e.candidateKey === lead.lead && e.kind === "note")) {
      initialPickup = "anticipate-first-chord";
      provenance.push({ field: "initialPickup", origin: "policy-default", value: initialPickup, noteKo: "인쇄 코드가 없는 첫 못갖춘마디에 다음 마디 첫 코드를 미리 적용(편곡 정책, 원본 코드 아님)" });
    }
  }
  if (!music.title) provenance.push({ field: "title", origin: "policy-default", value: "", noteKo: "제목 미판독: 생성 차단 사유 아님" });
  return clean({ range: "whole-score", lead: lead.lead, rhythmVoices, keys, tempo, singerCount, performers, ...(rights ? { rights } : {}), sections, lyricVerses,
    policy: "existing-wag-v1", ...(initialPickup ? { initialPickup } : {}), preset: "standard" }) as ArrangementRequest;
}

function measureOf(state: WorkspaceState, id: string) {
  for (const p of state.music?.parts ?? []) for (const m of p.measures) if (m.workspaceMeasureId === id) return { part: p, measure: m };
  return undefined;
}
function leadExtent(m: Music["parts"][number]["measures"][number], voices: readonly string[]) {
  return m.leadEvents.filter(e => voices.includes(e.candidateKey)).reduce((end, e) => { const x = addFractions(e.onset, e.duration); return compareFractions(x, end) > 0 ? x : end; }, fraction(0));
}

/** Classify one raw issue by its effect on generating the practice draft. */
function classifyIssue(issue: WorkspaceIssue, state: WorkspaceState, request: ArrangementRequest, options: AutoDraftOptions, evidence: ReturnType<typeof localCandidateEvidence> | undefined): AutoDraftFinding | "auto" | "not-applicable" {
  const selected = [request.lead!, ...request.rhythmVoices];
  const scoped = { ...state, request };
  if (issue.requiredAction === "unsupported")
    return workspaceScopeRelevant(scoped, issue.scope) ? { id: issue.id, code: "UNSUPPORTED_NOTATION", category: "unsupported", messageKo: issue.messageKo, effectKo: "현재 생성 계약이 해석하지 못하는 표기입니다.", scope: issue.scope } : "not-applicable";
  if (issue.id.startsWith("link:")) {
    const eventId = issue.id.slice(5).replace(/^d0/u, "");
    const hit = state.music?.parts.flatMap(p => p.measures.flatMap(m => m.leadEvents)).find(e => e.workspaceEventId === eventId);
    if (hit && !selected.includes(hit.candidateKey)) return "not-applicable";
    return { id: issue.id, code: "OMR_EVENT_SOURCE_LINK_UNCONFIRMED", category: "warning", messageKo: issue.messageKo, scope: issue.scope,
      effectKo: "자동 판독한 음높이·길이를 그대로 사용합니다. 원본 기호와의 대응은 확인되지 않았습니다." };
  }
  if (issue.id.startsWith("measure-link:")) return { id: issue.id, code: "OMR_MEASURE_BOUNDARY_UNCONFIRMED", category: "warning", messageKo: issue.messageKo, scope: issue.scope,
    effectKo: "마디 길이는 구조 검사(박자·겹침·초과)를 통과한 값을 사용합니다. 원본 마디선 대응은 확인되지 않았습니다." };
  const match = /^candidate:(\d+)$/u.exec(issue.id), record = match && evidence ? evidence.candidates[Number(match[1])] as Record<string, unknown> : undefined;
  const feature = String(record?.feature ?? ""), measureIndex = Number.isSafeInteger(record?.measureIndex) ? Number(record!.measureIndex) : undefined;
  const target = measureIndex !== undefined ? measureOf(state, `p0m${measureIndex}`) : undefined;
  switch (feature) {
    case "lyric": return { id: issue.id, code: "LYRIC_UNCERTAIN", category: "warning", messageKo: issue.messageKo, scope: issue.scope,
      effectKo: "가사 표시와 생성 화음의 재발음(가사 시작) 위치에 영향이 있을 수 있습니다. 음높이 생성은 막지 않습니다." };
    case "chord":
      if (options.decisions?.unreadPrintedChords === "carry-previous") return { id: issue.id, code: "PRINTED_CHORD_UNREAD_CARRIED", category: "warning", messageKo: issue.messageKo, scope: issue.scope,
        effectKo: "사용자 선택에 따라 판독하지 못한 인쇄 코드 구간은 직전 코드를 유지해 생성했습니다(원본 코드 아님)." };
      return { id: issue.id, code: "PRINTED_CHORD_UNREAD", category: "question", messageKo: `원본에 인쇄된 코드로 보이는 글자를 판독하지 못했습니다(시스템 ${Number(record?.systemIndex ?? -1) + 1}).`, scope: issue.scope,
        effectKo: "이 구간의 화음이 실제 코드와 다를 수 있어 자동으로 이전 코드를 유지하지 않습니다.",
        answers: [{ option: "carry-previous", meaningKo: "판독하지 못한 코드 구간은 모두 직전 코드를 유지(초안에 표시)" }, { option: "edit-in-workspace", meaningKo: "작업 공간에서 해당 코드를 입력" }] };
    case "meter": {
      if (!target) return { id: issue.id, code: "METER_TOKEN_UNCERTAIN", category: "warning", messageKo: issue.messageKo, effectKo: "박자표 판독 후보가 확정되지 않았지만 마디 위치를 특정할 수 없어 구조 검사 결과를 따릅니다." };
      const nominal = fraction(target.measure.time.numerator * 4, target.measure.time.denominator), end = leadExtent(target.measure, selected);
      const consistent = compareFractions(end, target.measure.duration) === 0 && (target.measure.implicit || compareFractions(target.measure.duration, nominal) === 0);
      return consistent ? { id: issue.id, code: "METER_TOKEN_UNCERTAIN", category: "warning", messageKo: issue.messageKo, scope: issue.scope, effectKo: "박자표 숫자 판독은 미확정이지만 해당 마디 음표 길이가 현재 박자와 정확히 맞습니다." }
        : { id: issue.id, code: "METER_UNRESOLVED", category: "question", messageKo: `${target.measure.number}마디의 박자표를 판독하지 못했고 음표 길이도 현재 박자와 맞지 않습니다.`, scope: issue.scope, effectKo: "시간축이 틀릴 수 있어 박자를 확인해야 합니다." };
    }
    case "timeline-extent": {
      if (!target) return { id: issue.id, code: "TIMELINE_UNCERTAIN", category: "question", messageKo: issue.messageKo, effectKo: "시간축 불확실성을 특정할 수 없습니다." };
      const end = leadExtent(target.measure, selected), cmp = compareFractions(end, target.measure.duration);
      if (cmp === 0) return { id: issue.id, code: "TIMELINE_EVIDENCE_INCOMPLETE", category: "warning", messageKo: issue.messageKo, scope: issue.scope, effectKo: "원본 기호 대응 근거는 부족하지만 선택 Lead가 마디를 정확히 채웁니다." };
      return { id: issue.id, code: "TIMELINE_GAP", category: "question", messageKo: `${target.measure.number}마디: 선택 Lead가 마디를 ${cmp < 0 ? "다 채우지 않습니다" : "넘칩니다"}(쉼표 누락, 분할 마디 또는 판독 오류 가능).`, scope: issue.scope,
        effectKo: "이후 전체 시간축이 달라질 수 있어 자동으로 쉼표를 넣거나 자르지 않습니다.", answers: [{ option: "edit-in-workspace", meaningKo: "작업 공간에서 마디 길이 또는 음표를 교정" }] };
    }
    case "rhythm-slash": return { id: issue.id, code: "RHYTHM_SLASH_UNCERTAIN", category: "warning", messageKo: issue.messageKo, scope: issue.scope,
      effectKo: "리듬 슬래시는 선택 Lead에 포함되지 않아 화음 음높이 생성에 쓰이지 않습니다." };
    default:
      if (issue.id.startsWith("legacy:")) return { id: issue.id, code: "LEGACY_UNCERTAINTY", category: "question", messageKo: issue.messageKo, scope: issue.scope, effectKo: "구형 교정 기록의 미확정 사항입니다." };
      return workspaceScopeRelevant(scoped, issue.scope) ? { id: issue.id, code: "UNCLASSIFIED_UNCERTAINTY", category: "question", messageKo: issue.messageKo, scope: issue.scope, effectKo: "생성 영향이 분류되지 않은 불확실성은 자동으로 통과시키지 않습니다." } : "not-applicable";
  }
}
function classifyBlocker(b: { id: string; messageKo: string; scope: WorkspaceScope }): AutoDraftFinding {
  const kind = b.id.split(":")[0];
  if (["meter", "modulation", "rhythm-staff", "separate-chord-part", "policy", "rhythm", "uninterpreted"].includes(kind))
    return { id: b.id, code: `UNSUPPORTED_${kind.toUpperCase().replace(/-/gu, "_")}`, category: "unsupported", messageKo: b.messageKo, scope: b.scope, effectKo: "현재 지원하는 생성 범위(2/4·4/4·6/8, 단일 조성, Lead와 같은 보표) 밖입니다." };
  return { id: b.id, code: `STRUCTURE_${kind.toUpperCase().replace(/-/gu, "_")}`, category: "question", messageKo: b.messageKo, scope: b.scope,
    effectKo: "음높이·시간·조성 정보가 생성에 필요한 형태로 확정되지 않아 경고만으로 통과시키지 않습니다.", answers: [{ option: "edit-in-workspace", meaningKo: "작업 공간에서 해당 마디를 교정" }] };
}

/** One verdict for API and UI: same workspace revision, options and versions
 * always produce the same status, reasons and effective request. */
const assessments = new WeakMap<ScoreWorkspace, { captured: string; options: string; result: Promise<AutoDraftAssessment> }>();
export async function assessAutoDraft(workspace: ScoreWorkspace, rawOptions: AutoDraftOptions = {}, policyVersion: AutoDraftPolicyVersion = AUTO_DRAFT_POLICY_VERSION): Promise<AutoDraftAssessment> {
  const options = normalizeAutoDraftOptions(rawOptions);
  // Exact state includes identity, history, algorithms and original evidence.
  // Only journal-owned immutable inputs can reuse captured bytes; mutable API
  // inputs are serialized on every call. Keep one option per weak identity.
  const captured = captureWorkspace(workspace), key = serializeAutoDraftOptions(options, policyVersion);
  let entry = assessments.get(workspace);
  if (!entry || entry.captured !== captured || entry.options !== key) {
    const result = computeAutoDraft(workspace, options, policyVersion).then(value => {
      if (captureWorkspace(workspace) !== captured) throw new RangeError("WORKSPACE_MUTATED_DURING_ASSESSMENT");
      return value;
    });
    entry = { captured, options: key, result };
    assessments.set(workspace, entry);
    const owned = entry;
    void result.catch(() => { if (assessments.get(workspace) === owned) assessments.delete(workspace); });
  }
  // A caller may edit its returned assessment; never expose the cached graph.
  const result = await entry.result;
  if (captureWorkspace(workspace) !== captured) throw new RangeError("WORKSPACE_MUTATED_DURING_ASSESSMENT");
  return structuredClone(result);
}
async function computeAutoDraft(workspace: ScoreWorkspace, options: AutoDraftOptions, policyVersion: AutoDraftPolicyVersion): Promise<AutoDraftAssessment> {
  const { state, evidenceDigest } = await readVerifiedWorkspace(workspace);
  const provenance: AutoDraftProvenance[] = [], findings: AutoDraftFinding[] = [];
  const categories: Record<AutoDraftCategory, number> = { auto: 0, "reviewed-record": 0, warning: 0, question: 0, unsupported: 0, "not-applicable": 0 };
  let request: ArrangementRequest | undefined;
  if (!state.music) findings.push({ id: "uninterpreted", code: "INPUT_UNINTERPRETED", category: "unsupported", messageKo: "원본을 보존했지만 현재 모델로 음악을 해석하지 못했습니다.", effectKo: "생성할 수 없습니다." });
  else request = effectiveRequest(state, options, workspace.algorithmVersions.performanceExpanderVersion, provenance, findings, policyVersion);
  if (request) {
    const evidence = workspace.origin.localCandidate ? localCandidateEvidence(workspace.origin.localCandidate) : undefined;
    const reviewedByRecord = await currentlyReviewedIssueIds(state, evidenceDigest);
    for (const issue of state.issues) {
      // A still-current existing review record resolves the item. The record is
      // a work log entry; its actor label is not treated as proof of review.
      if (reviewedByRecord.has(issue.id)) { categories["reviewed-record"] += 1; continue; }
      const verdict = classifyIssue(issue, state, request, options, evidence);
      if (verdict === "auto" || verdict === "not-applicable") categories[verdict] += 1;
      else { categories[verdict.category] += 1; findings.push(verdict); }
    }
    const { blockers, policyNotes } = await deriveStructuralArrangementBlockers({ ...state, request });
    for (const b of blockers) if (!(b.id === "rights" && findings.some(f => f.id === "rights"))) findings.push(classifyBlocker(b));
    for (const n of policyNotes) findings.push({ id: n.id, code: "FERMATA_AS_WRITTEN", category: "warning", messageKo: n.messageKo, scope: n.scope, effectKo: "늘임 길이는 재생에 반영하지 않습니다." });
  }
  const status = findings.some(f => f.category === "unsupported") ? "unsupported" : findings.some(f => f.category === "question") ? "needs-decision"
    : findings.length || provenance.some(p => p.origin === "policy-default" || p.origin === "source-inferred") ? "ready-with-warnings" : "ready";
  return {
    version: policyVersion, presetVersion: presetVersionForPolicy(policyVersion),
    workspaceId: workspace.id, workspaceRevision: workspace.revision, workspaceDigest: workspace.digest,
    optionsDigest: await semanticDigest(optionsForPolicy(options, policyVersion)), status, ...(request ? { request } : {}), provenance, findings,
    rawIssueCount: state.issues.length, issueCategories: categories,
    humanSourceReview: "not-performed-by-this-contract", existingReviewRecords: state.attestations.length,
  };
}
export const autoDraftGeneratable = (a: Pick<AutoDraftAssessment, "status">) => a.status === "ready" || a.status === "ready-with-warnings";
/** Compact, bounded summary sealed into the Source (grouped by code). */
export function autoDraftSummary(a: AutoDraftAssessment) {
  const groups = new Map<string, { code: string; category: string; count: number; sampleIds: string[]; effectKo: string }>();
  for (const f of a.findings) {
    const g = groups.get(f.code) ?? { code: f.code, category: f.category, count: 0, sampleIds: [], effectKo: f.effectKo };
    g.count += 1; if (g.sampleIds.length < 5) g.sampleIds.push(f.id); groups.set(f.code, g);
  }
  return clean({ policyVersion: a.version, presetVersion: a.presetVersion, status: a.status, humanSourceReview: a.humanSourceReview,
    rawIssueCount: a.rawIssueCount, issueCategories: a.issueCategories, findingGroups: [...groups.values()].sort((x, y) => x.code.localeCompare(y.code)),
    provenance: a.provenance.map(p => ({ field: p.field, origin: p.origin, noteKo: p.noteKo })) });
}
export type AutoDraftSummary = ReturnType<typeof autoDraftSummary>;
