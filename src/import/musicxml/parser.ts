import { parseChord } from "../../domain/chord/parser";
import type { ChordParseResult } from "../../domain/chord/model";
import { binaryDigest, compareCanonicalValues } from "../../domain/digest/canonical";
import {
  addFractions,
  compareFractions,
  fraction,
  subtractFractions,
  type Fraction,
} from "../../domain/fraction";
import { timeSignature, type TimeSignature } from "../../domain/meter";
import {
  comparePitches,
  deriveFifths,
  type Alter,
  type KeyMode,
  type KeySignature,
  type SpelledPitch,
  type Step,
} from "../../domain/pitch";
import { performerId } from "../../domain/ids";
import { validateCoreInputLimits } from "../../domain/limits";
import { extractMusicXmlFromMxl } from "../mxl/archive";
import { buildImportedSectionOccurrenceReviews } from "../review/occurrences";
import { materializeImportDiagnostics, type ImportDiagnosticInput } from "./diagnostics";
import {
  DEFAULT_IMPORT_SECURITY_LIMITS,
  MUSICXML_IMPORTER_VERSION,
  type DocumentIdentityFactory,
  type ImportedChordDraft,
  type ImportedLeadEventDraft,
  type ImportedMeasureDraft,
  type ImportedPartDraft,
  type ImportedSectionDraft,
  type ImportedTextDraft,
  type ImportSecurityLimits,
  type LeadVoiceCandidate,
  type MusicImportResult,
  type MusicXmlImportDraft,
  type Step3ImportVersions,
  type UnsupportedPerformanceFlow,
} from "./types";
import {
  parseSafeXml,
  xmlChild,
  xmlChildren,
  xmlDescendants,
  xmlText,
  type XmlElement,
} from "./xml";

type RawChordDraft = Omit<ImportedChordDraft, "key">;

interface TempoEvent {
  readonly measureOrdinal: number;
  readonly onset: Fraction;
  readonly beatUnit: 4 | 8;
  readonly dotted: boolean;
  readonly bpm: number;
}

interface ParsedPart {
  readonly part: ImportedPartDraft;
  readonly tempoEvents: readonly TempoEvent[];
  readonly flowTexts: readonly Omit<UnsupportedPerformanceFlow, "id">[];
}

interface ParseScoreResult {
  readonly title: string;
  readonly composer?: string;
  readonly parts: readonly ImportedPartDraft[];
  readonly candidates: readonly LeadVoiceCandidate[];
  readonly sections: readonly ImportedSectionDraft[];
  readonly flows: readonly UnsupportedPerformanceFlow[];
  readonly defaultKey?: KeySignature;
  readonly defaultTempo?: MusicXmlImportDraft["defaultTempo"];
  readonly diagnostics: readonly ImportDiagnosticInput[];
}

interface ParseContext {
  readonly diagnostics: ImportDiagnosticInput[];
  readonly partOrdinal: number;
}

const ZERO = fraction(0);
const SUPPORTED_FLOW_PATTERN = /\b(?:d\.?\s*c\.?|da\s+capo|d\.?\s*s\.?|dal\s+segno|to\s+coda|coda|segno|fine)\b/iu;

function parseInteger(text: string | undefined): number | undefined {
  if (text === undefined || !/^[+-]?\d+$/u.test(text.trim())) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

function parseDecimalInteger(text: string | undefined): number | undefined {
  if (text === undefined || !/^[+-]?\d+(?:\.0+)?$/u.test(text.trim())) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

function integerChild(
  parent: XmlElement,
  name: string,
  missingValue: number,
): number | undefined {
  const child = xmlChild(parent, name);
  return child === undefined ? missingValue : parseInteger(xmlText(child));
}

function fixedCompare(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateKey(partOrdinal: number, staffNumber: number, voiceKey: string): string {
  const normalizedVoice = voiceKey.normalize("NFC");
  return `lead:p:${partOrdinal}:s:${staffNumber}:v:${normalizedVoice.length}:${normalizedVoice}`;
}

function candidateIdentity(key: string): { readonly staffNumber: number; readonly voiceKey: string } | undefined {
  const match = /^lead:p:\d+:s:(\d+):v:\d+:(.*)$/u.exec(key);
  if (!match) return undefined;
  const staffNumber = Number(match[1]);
  return Number.isSafeInteger(staffNumber) && staffNumber > 0
    ? { staffNumber, voiceKey: match[2] }
    : undefined;
}

function durationFraction(durationText: string | undefined, divisions: number): Fraction {
  const duration = parseInteger(durationText);
  if (duration === undefined || duration <= 0 || !Number.isSafeInteger(divisions) || divisions <= 0) {
    throw new RangeError("invalid MusicXML duration/divisions");
  }
  return fraction(duration, divisions);
}

function fullMeasureDuration(time: TimeSignature): Fraction {
  return fraction(time.numerator * 4, time.denominator);
}

const MAJOR_KEYS: readonly KeySignature[] = [
  { tonic: { step: "C", alter: -1 }, mode: "major" },
  { tonic: { step: "G", alter: -1 }, mode: "major" },
  { tonic: { step: "D", alter: -1 }, mode: "major" },
  { tonic: { step: "A", alter: -1 }, mode: "major" },
  { tonic: { step: "E", alter: -1 }, mode: "major" },
  { tonic: { step: "B", alter: -1 }, mode: "major" },
  { tonic: { step: "F", alter: 0 }, mode: "major" },
  { tonic: { step: "C", alter: 0 }, mode: "major" },
  { tonic: { step: "G", alter: 0 }, mode: "major" },
  { tonic: { step: "D", alter: 0 }, mode: "major" },
  { tonic: { step: "A", alter: 0 }, mode: "major" },
  { tonic: { step: "E", alter: 0 }, mode: "major" },
  { tonic: { step: "B", alter: 0 }, mode: "major" },
  { tonic: { step: "F", alter: 1 }, mode: "major" },
  { tonic: { step: "C", alter: 1 }, mode: "major" },
];

const MINOR_KEYS: readonly KeySignature[] = [
  { tonic: { step: "A", alter: -1 }, mode: "minor" },
  { tonic: { step: "E", alter: -1 }, mode: "minor" },
  { tonic: { step: "B", alter: -1 }, mode: "minor" },
  { tonic: { step: "F", alter: 0 }, mode: "minor" },
  { tonic: { step: "C", alter: 0 }, mode: "minor" },
  { tonic: { step: "G", alter: 0 }, mode: "minor" },
  { tonic: { step: "D", alter: 0 }, mode: "minor" },
  { tonic: { step: "A", alter: 0 }, mode: "minor" },
  { tonic: { step: "E", alter: 0 }, mode: "minor" },
  { tonic: { step: "B", alter: 0 }, mode: "minor" },
  { tonic: { step: "F", alter: 1 }, mode: "minor" },
  { tonic: { step: "C", alter: 1 }, mode: "minor" },
  { tonic: { step: "G", alter: 1 }, mode: "minor" },
  { tonic: { step: "D", alter: 1 }, mode: "minor" },
  { tonic: { step: "A", alter: 1 }, mode: "minor" },
];

function keyFromFifths(fifths: number, mode: KeyMode): KeySignature | undefined {
  if (!Number.isSafeInteger(fifths) || fifths < -7 || fifths > 7) return undefined;
  return (mode === "major" ? MAJOR_KEYS : MINOR_KEYS)[fifths + 7];
}

function parseKey(attributes: XmlElement, context: ParseContext, measureOrdinal: number): {
  readonly key?: KeySignature;
  readonly fifths?: number;
} {
  const keys = xmlChildren(attributes, "key");
  if (keys.length === 0) return {};
  if (keys.length > 1 || xmlDescendants(keys[0], "key-step").length > 0) {
    context.diagnostics.push({
      code: "UNSUPPORTED_KEY_SIGNATURE",
      messageKo: "비전통 조표 또는 여러 조표는 Core import에서 지원하지 않습니다.",
      details: { partOrdinal: context.partOrdinal, measureOrdinal },
    });
    return {};
  }
  const fifths = parseInteger(xmlText(xmlChild(keys[0], "fifths")));
  const modeText = (xmlText(xmlChild(keys[0], "mode")) ?? "major").toLowerCase();
  if (fifths === undefined || (modeText !== "major" && modeText !== "minor")) {
    context.diagnostics.push({
      code: "UNSUPPORTED_KEY_SIGNATURE",
      messageKo: "조표의 fifths/mode를 해석할 수 없습니다.",
      details: { partOrdinal: context.partOrdinal, measureOrdinal },
    });
    return {};
  }
  const key = keyFromFifths(fifths, modeText);
  if (!key) {
    context.diagnostics.push({
      code: "UNSUPPORTED_KEY_SIGNATURE",
      messageKo: "지원 범위를 벗어난 조표입니다.",
      details: { fifths, measureOrdinal, partOrdinal: context.partOrdinal },
    });
    return { fifths };
  }
  if (deriveFifths(key) !== fifths) {
    context.diagnostics.push({
      code: "INPUT_KEY_SIGNATURE_INCONSISTENT",
      messageKo: "가져온 fifths와 canonical tonic/mode가 일치하지 않습니다.",
      details: { fifths, measureOrdinal, partOrdinal: context.partOrdinal },
    });
  }
  return { key, fifths };
}

function parseTime(attributes: XmlElement, context: ParseContext, measureOrdinal: number): TimeSignature | undefined {
  const times = xmlChildren(attributes, "time");
  if (times.length === 0) return undefined;
  if (times.length > 1) {
    context.diagnostics.push({
      code: "UNSUPPORTED_METER",
      messageKo: "동시에 여러 박자표를 사용하는 MusicXML은 지원하지 않습니다.",
      details: { partOrdinal: context.partOrdinal, measureOrdinal },
    });
    return undefined;
  }
  const beats = parseInteger(xmlText(xmlChild(times[0], "beats")));
  const beatType = parseInteger(xmlText(xmlChild(times[0], "beat-type")));
  if (beats === undefined || beats <= 0 || (beatType !== 4 && beatType !== 8)) {
    context.diagnostics.push({
      code: "UNSUPPORTED_METER",
      messageKo: "이 박자표는 canonical Source에서 지원하지 않습니다.",
      details: { partOrdinal: context.partOrdinal, measureOrdinal },
    });
    return undefined;
  }
  const groups = beats === 6 && beatType === 8
    ? [3, 3]
    : Array.from({ length: beats }, () => 1);
  return timeSignature(beats, beatType, groups);
}

function parsePitch(note: XmlElement): SpelledPitch | undefined {
  const pitch = xmlChild(note, "pitch");
  if (!pitch) return undefined;
  const step = xmlText(xmlChild(pitch, "step"));
  const alter = integerChild(pitch, "alter", 0);
  const octave = parseInteger(xmlText(xmlChild(pitch, "octave")));
  if (!step || !["A", "B", "C", "D", "E", "F", "G"].includes(step)
    || alter === undefined
    || ![-2, -1, 0, 1, 2].includes(alter)
    || octave === undefined) return undefined;
  return { step: step as Step, alter: alter as Alter, octave };
}

function parseLyrics(
  note: XmlElement,
  accent: boolean,
  context: ParseContext,
  measureOrdinal: number,
  leadCandidateKey: string,
) {
  return xmlChildren(note, "lyric").flatMap((lyric) => {
    const text = xmlText(xmlChild(lyric, "text"));
    const rawVerse = lyric.attributes.number ?? "1";
    const verse = parseInteger(rawVerse);
    const syllabic = xmlText(xmlChild(lyric, "syllabic")) ?? "single";
    if (!text) return [];
    if (verse === undefined || verse < 1 || !["single", "begin", "middle", "end"].includes(syllabic)) {
      context.diagnostics.push({
        code: "IMPORT_UNSUPPORTED_ELEMENT",
        messageKo: "가사 verse 또는 syllabic 표기가 모호합니다.",
        details: {
          issue: "lyric-verse-ambiguity",
          measureOrdinal,
          partOrdinal: context.partOrdinal,
          diagnosticScope: "lead-candidate",
          candidateKey: leadCandidateKey,
        },
      });
      return [];
    }
    return [{
      text,
      verse,
      syllabic: syllabic as "single" | "begin" | "middle" | "end",
      extend: xmlChild(lyric, "extend") !== undefined,
      musicXmlAccent: accent,
    }];
  });
}

function pitchClassSymbol(step: string, alter: number): string | undefined {
  if (!["A", "B", "C", "D", "E", "F", "G"].includes(step)) return undefined;
  const suffix: Readonly<Record<number, string>> = { [-2]: "bb", [-1]: "b", [0]: "", [1]: "#", [2]: "##" };
  return suffix[alter] === undefined ? undefined : `${step}${suffix[alter]}`;
}

const HARMONY_KIND_SUFFIX: Readonly<Record<string, string>> = {
  major: "",
  minor: "m",
  augmented: "aug",
  diminished: "dim",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "diminished-seventh": "dim7",
  "augmented-seventh": "aug7",
  "half-diminished": "m7b5",
  "major-minor": "mMaj7",
  "major-sixth": "6",
  "minor-sixth": "m6",
  "dominant-ninth": "9",
  "major-ninth": "maj9",
  "minor-ninth": "m9",
  "dominant-11th": "9add11",
  "major-11th": "maj9add11",
  "minor-11th": "m9add11",
  "dominant-13th": "9add11add13",
  "major-13th": "maj9add11add13",
  "minor-13th": "m9add11add13",
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  power: "no3",
};

function failedChord(sourceText: string, token: string): ChordParseResult {
  return { status: "failed", sourceText, errorCode: "UNSUPPORTED_TOKEN", token };
}

function parseHarmony(
  harmony: XmlElement,
  context: ParseContext,
  measureOrdinal: number,
  onset: Fraction,
): RawChordDraft {
  const partOrdinal = context.partOrdinal;
  const kindElement = xmlChild(harmony, "kind");
  const kind = (xmlText(kindElement) ?? "major").toLowerCase();
  if (kind === "none") {
    return {
      partOrdinal,
      measureOrdinal,
      onset,
      sourceText: kindElement?.attributes.text ?? "N.C.",
      parseResult: parseChord("N.C."),
      source: "musicxml",
      confirmation: "unconfirmed",
    };
  }
  const root = xmlChild(harmony, "root");
  const rootStep = xmlText(xmlChild(root ?? harmony, "root-step")) ?? "";
  const rootAlter = integerChild(root ?? harmony, "root-alter", 0);
  const rootSymbol = rootAlter === undefined ? undefined : pitchClassSymbol(rootStep, rootAlter);
  const bass = xmlChild(harmony, "bass");
  const bassStep = xmlText(xmlChild(bass ?? harmony, "bass-step"));
  const bassAlter = integerChild(bass ?? harmony, "bass-alter", 0);
  const bassSymbol = bassStep && bassAlter !== undefined ? pitchClassSymbol(bassStep, bassAlter) : undefined;
  const kindText = kindElement?.attributes.text?.trim();
  const suffix = HARMONY_KIND_SUFFIX[kind];
  const degreeTokens: string[] = [];
  let unsupportedToken = rootAlter === undefined
    ? "root-alter:invalid"
    : bassStep && bassAlter === undefined ? "bass-alter:invalid" : undefined;
  for (const degree of xmlChildren(harmony, "degree")) {
    const value = parseInteger(xmlText(xmlChild(degree, "degree-value")));
    const alter = integerChild(degree, "degree-alter", 0);
    const type = xmlText(xmlChild(degree, "degree-type"));
    if (value === undefined || alter === undefined || ![2, 3, 4, 5, 6, 7, 9, 11, 13].includes(value)) {
      unsupportedToken = `degree:${value ?? "?"}`;
      continue;
    }
    if (type === "add" && alter === 0) degreeTokens.push(`add${value}`);
    else if ((type === "alter" || type === "add") && (alter === -1 || alter === 1)) {
      degreeTokens.push(`${alter === -1 ? "b" : "#"}${value}`);
    } else if (type === "subtract" && (value === 3 || value === 5) && alter === 0) {
      degreeTokens.push(`no${value}`);
    } else unsupportedToken = `degree:${type ?? "?"}:${value}:${alter}`;
  }
  const displaySuffix = kindText ?? suffix ?? kind;
  const sourceText = `${rootSymbol ?? rootStep}${displaySuffix}${degreeTokens.join("")}${bassSymbol ? `/${bassSymbol}` : ""}`;
  if (!rootSymbol || (bassStep && !bassSymbol) || suffix === undefined || unsupportedToken) {
    return {
      partOrdinal,
      measureOrdinal,
      onset,
      sourceText,
      parseResult: failedChord(sourceText, unsupportedToken ?? `kind:${kind}`),
      source: "musicxml",
      confirmation: "unconfirmed",
    };
  }
  const canonicalText = kindText ? `${rootSymbol}${kindText}${bassSymbol ? `/${bassSymbol}` : ""}` : undefined;
  const canonicalParsed = canonicalText ? parseChord(canonicalText) : undefined;
  const parserText = canonicalParsed?.status === "ok"
    ? canonicalText!
    : `${rootSymbol}${suffix}${degreeTokens.join("")}${bassSymbol ? `/${bassSymbol}` : ""}`;
  return {
    partOrdinal,
    measureOrdinal,
    onset,
    sourceText,
    parseResult: parseChord(parserText),
    source: "musicxml",
    confirmation: "unconfirmed",
  };
}

function sectionTypeForLabel(text: string): ImportedSectionDraft["type"] | undefined {
  const compact = text.normalize("NFC").trim().toLowerCase().replace(/[._]/gu, " ").replace(/\s+/gu, " ");
  if (/^(?:intro|introduction)$/u.test(compact)) return "intro";
  if (/^(?:verse|v)(?:\s*\d+)?$/u.test(compact)) return "verse";
  if (/^(?:pre[ -]?chorus|prechorus)(?:\s*\d+)?$/u.test(compact)) return "pre-chorus";
  if (/^(?:chorus|ch)(?:\s*\d+)?$/u.test(compact)) return "chorus";
  if (/^(?:bridge|br)(?:\s*\d+)?$/u.test(compact)) return "bridge";
  if (/^tag(?:\s*\d+)?$/u.test(compact)) return "tag";
  if (/^(?:ending|outro)$/u.test(compact)) return "ending";
  return undefined;
}

function flowFromDirection(
  direction: XmlElement,
  partOrdinal: number,
  measureOrdinal: number,
): readonly Omit<UnsupportedPerformanceFlow, "id">[] {
  const texts = [
    ...xmlDescendants(direction, "words").map(xmlText),
    ...xmlDescendants(direction, "rehearsal").map(xmlText),
  ].filter((text): text is string => text !== undefined);
  const sound = xmlDescendants(direction, "sound");
  for (const item of sound) {
    for (const attribute of ["dacapo", "dalsegno", "segno", "coda", "tocoda", "fine"] as const) {
      const value = item.attributes[attribute];
      if (value && value !== "0" && value.toLowerCase() !== "no") texts.push(`${attribute}:${value}`);
    }
  }
  if (xmlDescendants(direction, "segno").length > 0) texts.push("segno");
  if (xmlDescendants(direction, "coda").length > 0) texts.push("coda");
  return [...new Set(texts.filter((text) => SUPPORTED_FLOW_PATTERN.test(text) || text.includes(":")))]
    .sort(fixedCompare)
    .map((text) => ({ partOrdinal, measureOrdinal, text }));
}

function directionTextEvents(direction: XmlElement, onset: Fraction): readonly ImportedTextDraft[] {
  const events: ImportedTextDraft[] = [];
  for (const rehearsal of xmlDescendants(direction, "rehearsal")) {
    const text = xmlText(rehearsal);
    if (text) events.push({ onset, kind: sectionTypeForLabel(text) ? "section-label" : "rehearsal-mark", text });
  }
  for (const words of xmlDescendants(direction, "words")) {
    const text = xmlText(words);
    if (text && sectionTypeForLabel(text)) events.push({ onset, kind: "section-label", text });
  }
  return events;
}

function parseTempo(direction: XmlElement, measureOrdinal: number, onset: Fraction): TempoEvent | undefined {
  const soundTempo = xmlDescendants(direction, "sound")
    .map((sound) => parseDecimalInteger(sound.attributes.tempo))
    .find((tempo) => tempo !== undefined);
  if (soundTempo !== undefined) return { measureOrdinal, onset, beatUnit: 4, dotted: false, bpm: soundTempo };
  const metronome = xmlDescendants(direction, "metronome")[0];
  if (!metronome) return undefined;
  const beatUnitText = xmlText(xmlChild(metronome, "beat-unit"));
  const beatUnit = beatUnitText === "quarter" ? 4 : beatUnitText === "eighth" ? 8 : undefined;
  const bpm = parseDecimalInteger(xmlText(xmlChild(metronome, "per-minute")));
  if (!beatUnit || bpm === undefined) return undefined;
  return { measureOrdinal, onset, beatUnit, dotted: xmlChild(metronome, "beat-unit-dot") !== undefined, bpm };
}

function endingNumbers(barline: XmlElement): readonly (1 | 2)[] | null | undefined {
  const ending = xmlChild(barline, "ending");
  if (!ending) return undefined;
  const tokens = (ending.attributes.number ?? "")
    .split(/[ ,]+/u)
    .filter((part) => part.length > 0);
  const numbers = tokens.map((part) => Number(part));
  if (numbers.length === 0 || numbers.some((value) => value !== 1 && value !== 2)) return null;
  return [...new Set(numbers as readonly (1 | 2)[])].sort();
}

function parseMeasure(
  measure: XmlElement,
  ordinal: number,
  context: ParseContext,
  inherited: {
    divisions: number;
    time?: TimeSignature;
    key?: KeySignature;
    importedFifths?: number;
    activeEnding?: readonly (1 | 2)[];
  },
): {
  readonly measure: ImportedMeasureDraft;
  readonly next: typeof inherited;
  readonly tempoEvents: readonly TempoEvent[];
  readonly flowTexts: readonly Omit<UnsupportedPerformanceFlow, "id">[];
} {
  let divisions = inherited.divisions;
  let time = inherited.time;
  let key = inherited.key;
  let importedFifths = inherited.importedFifths;
  let cursor = ZERO;
  let maximum = ZERO;
  const lastOnset = new Map<string, Fraction>();
  const leadEvents: ImportedLeadEventDraft[] = [];
  const rawChords: RawChordDraft[] = [];
  const textEvents: ImportedTextDraft[] = [];
  const tempos: TempoEvent[] = [];
  const flowTexts: Omit<UnsupportedPerformanceFlow, "id">[] = [];
  const barlines = xmlChildren(measure, "barline");
  const parsedEndings = barlines.map((barline) => ({ barline, numbers: endingNumbers(barline) }));
  if (parsedEndings.some((entry) => entry.numbers === null)) {
    context.diagnostics.push({
      code: "PERFORMANCE_EXPANSION_FAILED",
      messageKo: "Core repeat expander는 1·2번 ending만 지원합니다.",
      details: { issue: "unsupported-ending-number", measureOrdinal: ordinal, partOrdinal: context.partOrdinal },
    });
  }
  const startingEnding = barlines
    .filter((barline) => xmlChild(barline, "ending")?.attributes.type === "start")
    .flatMap((barline) => endingNumbers(barline) ?? []);
  if (startingEnding.length > 0 && inherited.activeEnding) {
    context.diagnostics.push({
      code: "PERFORMANCE_EXPANSION_FAILED",
      messageKo: "겹치거나 중첩된 ending은 지원하지 않습니다.",
      details: { issue: "overlapping-ending", measureOrdinal: ordinal, partOrdinal: context.partOrdinal },
    });
  }
  const hasEndingStop = barlines.some((barline) => {
    const type = xmlChild(barline, "ending")?.attributes.type;
    return type === "stop" || type === "discontinue";
  });
  if (hasEndingStop && startingEnding.length === 0 && !inherited.activeEnding) {
    context.diagnostics.push({
      code: "PERFORMANCE_EXPANSION_FAILED",
      messageKo: "시작되지 않은 ending 종료 지시가 있습니다.",
      details: { issue: "unmatched-ending-stop", measureOrdinal: ordinal, partOrdinal: context.partOrdinal },
    });
  }
  const activeEnding = startingEnding.length > 0 ? [...new Set(startingEnding)].sort() as readonly (1 | 2)[] : inherited.activeEnding;
  let startRepeat = false;
  let endRepeat: { readonly totalPasses: 2 | 3 | 4 } | undefined;
  for (const barline of barlines) {
    const repeat = xmlChild(barline, "repeat");
    if (repeat?.attributes.direction === "forward") startRepeat = true;
    if (repeat?.attributes.direction === "backward") {
      const times = parseInteger(repeat.attributes.times ?? "2");
      if (times === 2 || times === 3 || times === 4) endRepeat = { totalPasses: times };
      else context.diagnostics.push({
        code: "PERFORMANCE_EXPANSION_FAILED",
        messageKo: "repeat times는 Core에서 2–4회만 지원합니다.",
        details: { measureOrdinal: ordinal, partOrdinal: context.partOrdinal },
      });
    }
  }
  for (const child of measure.children) {
    if (child.kind !== "element") continue;
    if (child.name === "attributes") {
      const divisionsElement = xmlChild(child, "divisions");
      if (divisionsElement) {
        const nextDivisions = parseInteger(xmlText(divisionsElement));
        if (nextDivisions === undefined || nextDivisions <= 0) {
          context.diagnostics.push({
            code: "IMPORT_UNSUPPORTED_ELEMENT",
            messageKo: "divisions는 존재하면 양의 정수여야 합니다.",
            details: {
              issue: "invalid-divisions",
              measureOrdinal: ordinal,
              partOrdinal: context.partOrdinal,
              diagnosticScope: "lead-part",
            },
          });
        } else divisions = nextDivisions;
      }
      const nextTime = parseTime(child, context, ordinal);
      if (nextTime) time = nextTime;
      const parsedKey = parseKey(child, context, ordinal);
      if (parsedKey.key) key = parsedKey.key;
      if (parsedKey.fifths !== undefined) importedFifths = parsedKey.fifths;
      continue;
    }
    if (child.name === "backup" || child.name === "forward") {
      const amount = durationFraction(xmlText(xmlChild(child, "duration")), divisions);
      cursor = child.name === "backup" ? subtractFractions(cursor, amount) : addFractions(cursor, amount);
      if (cursor.n < 0) throw new RangeError("MusicXML backup moved before measure start");
      if (compareFractions(cursor, maximum) > 0) maximum = cursor;
      continue;
    }
    if (child.name === "note") {
      const staffElement = xmlChild(child, "staff");
      const staff = staffElement === undefined ? 1 : parseInteger(xmlText(staffElement));
      const voice = xmlText(xmlChild(child, "voice")) ?? "1";
      const isChordMember = xmlChild(child, "chord") !== undefined;
      if (staff === undefined || staff <= 0) {
        context.diagnostics.push({
          code: "IMPORT_UNSUPPORTED_ELEMENT",
          messageKo: "staff는 존재하면 양의 정수여야 합니다.",
          details: {
            issue: "invalid-staff",
            measureOrdinal: ordinal,
            partOrdinal: context.partOrdinal,
            diagnosticScope: "lead-part",
          },
        });
        const durationText = xmlText(xmlChild(child, "duration"));
        const parsedDuration = durationText === undefined ? undefined : parseInteger(durationText);
        if (!isChordMember && parsedDuration !== undefined && parsedDuration > 0) {
          cursor = addFractions(cursor, fraction(parsedDuration, divisions));
          if (compareFractions(cursor, maximum) > 0) maximum = cursor;
        }
        continue;
      }
      const keyForCandidate = candidateKey(context.partOrdinal, staff, voice);
      const unsupported = xmlChild(child, "grace") || xmlChild(child, "cue")
        || xmlDescendants(child, "ornaments").length > 0
        || xmlChild(child, "time-modification");
      if (unsupported) {
        context.diagnostics.push({
          code: "IMPORT_UNSUPPORTED_ELEMENT",
          messageKo: "grace/cue/ornament/tuplet note는 의미 손실 없이 가져올 수 없습니다.",
          details: {
            issue: "unsupported-lead-note",
            measureOrdinal: ordinal,
            partOrdinal: context.partOrdinal,
            diagnosticScope: "lead-candidate",
            candidateKey: keyForCandidate,
          },
        });
        const durationText = xmlText(xmlChild(child, "duration"));
        const parsedDuration = durationText === undefined ? undefined : parseInteger(durationText);
        if (!isChordMember && parsedDuration !== undefined && parsedDuration > 0) {
          const duration = fraction(parsedDuration, divisions);
          cursor = addFractions(cursor, duration);
          if (compareFractions(cursor, maximum) > 0) maximum = cursor;
        }
        continue;
      }
      const duration = durationFraction(xmlText(xmlChild(child, "duration")), divisions);
      const onset = isChordMember ? lastOnset.get(keyForCandidate) : cursor;
      if (!onset) throw new RangeError("MusicXML chord member has no preceding note");
      if (!isChordMember) lastOnset.set(keyForCandidate, onset);
      const end = addFractions(onset, duration);
      if (compareFractions(end, maximum) > 0) maximum = end;
      const isRest = xmlChild(child, "rest") !== undefined;
      if (isRest) {
        leadEvents.push({ kind: "rest", candidateKey: keyForCandidate, onset, duration });
      } else {
        const pitch = parsePitch(child);
        if (!pitch) {
          context.diagnostics.push({
            code: "IMPORT_UNSUPPORTED_ELEMENT",
            messageKo: "pitched note의 step/alter/octave를 해석할 수 없습니다.",
            details: {
              issue: "invalid-pitch",
              measureOrdinal: ordinal,
              partOrdinal: context.partOrdinal,
              diagnosticScope: "lead-candidate",
              candidateKey: keyForCandidate,
            },
          });
        } else {
          const tieTypes = new Set([
            ...xmlChildren(child, "tie").map((tie) => tie.attributes.type),
            ...xmlDescendants(child, "tied").map((tie) => tie.attributes.type),
          ]);
          const accent = xmlDescendants(child, "accent").length > 0;
          leadEvents.push({
            kind: "note",
            candidateKey: keyForCandidate,
            onset,
            duration,
            pitch,
            tieStart: tieTypes.has("start"),
            tieStop: tieTypes.has("stop"),
            lyrics: parseLyrics(child, accent, context, ordinal, keyForCandidate),
          });
        }
      }
      if (!isChordMember) cursor = addFractions(cursor, duration);
      continue;
    }
    if (child.name === "harmony") {
      const offsetElement = xmlChild(child, "offset");
      const parsedOffset = offsetElement === undefined ? 0 : parseInteger(xmlText(offsetElement));
      if (parsedOffset === undefined) {
        context.diagnostics.push({
          code: "IMPORT_UNSUPPORTED_ELEMENT",
          messageKo: "harmony offset은 존재하면 정수여야 합니다.",
          details: {
            issue: "invalid-harmony-offset",
            measureOrdinal: ordinal,
            partOrdinal: context.partOrdinal,
            diagnosticScope: "lead-part",
          },
        });
        continue;
      }
      const offset = fraction(parsedOffset, divisions);
      const onset = addFractions(cursor, offset);
      if (onset.n < 0) throw new RangeError("MusicXML harmony offset precedes measure start");
      rawChords.push(parseHarmony(child, context, ordinal, onset));
      continue;
    }
    if (child.name === "direction") {
      const offsetElement = xmlChild(child, "offset");
      const parsedOffset = offsetElement === undefined ? 0 : parseInteger(xmlText(offsetElement));
      if (parsedOffset === undefined) {
        context.diagnostics.push({
          code: "IMPORT_UNSUPPORTED_ELEMENT",
          messageKo: "direction offset은 존재하면 정수여야 합니다.",
          details: {
            issue: "invalid-direction-offset",
            measureOrdinal: ordinal,
            partOrdinal: context.partOrdinal,
            diagnosticScope: "lead-part",
          },
        });
        continue;
      }
      const offset = fraction(parsedOffset, divisions);
      const onset = addFractions(cursor, offset);
      if (onset.n < 0) throw new RangeError("MusicXML direction offset precedes measure start");
      textEvents.push(...directionTextEvents(child, onset));
      flowTexts.push(...flowFromDirection(child, context.partOrdinal, ordinal));
      const tempo = parseTempo(child, ordinal, onset);
      if (tempo) tempos.push(tempo);
    }
  }
  if (!time) throw new RangeError("MusicXML has no initial time signature");
  const meterDuration = fullMeasureDuration(time);
  if (compareFractions(maximum, meterDuration) > 0 || compareFractions(cursor, meterDuration) > 0) {
    throw new RangeError("MusicXML cursor exceeds measure duration");
  }
  const implicit = measure.attributes.implicit === "yes";
  const actualDuration = implicit && maximum.n > 0 ? maximum : meterDuration;
  const rawNumber = parseInteger(measure.attributes.number);
  const number = rawNumber !== undefined && rawNumber >= 1 ? rawNumber : ordinal + 1;
  const orderedChords = rawChords
    .sort((left, right) => compareFractions(left.onset, right.onset)
      || compareCanonicalValues(
        { parseResult: left.parseResult, sourceText: left.sourceText.normalize("NFC") },
        { parseResult: right.parseResult, sourceText: right.sourceText.normalize("NFC") },
      ))
    .map((chord, chordOrdinal): ImportedChordDraft => ({
      ...chord,
      key: `chord:p:${context.partOrdinal}:m:${ordinal}:c:${chordOrdinal}`,
    }));
  const dedupedText = textEvents
    .sort((left, right) => compareFractions(left.onset, right.onset)
      || fixedCompare(left.kind, right.kind)
      || fixedCompare(left.text, right.text))
    .filter((event, index, values) => index === 0
      || compareFractions(event.onset, values[index - 1].onset) !== 0
      || event.kind !== values[index - 1].kind
      || event.text !== values[index - 1].text);
  return {
    measure: {
      ordinal,
      number,
      implicit,
      time,
      duration: actualDuration,
      ...(key ? { key } : {}),
      ...(importedFifths !== undefined ? { importedFifths } : {}),
      leadEvents,
      chords: orderedChords,
      textEvents: dedupedText,
      repeat: {
        startRepeat,
        ...(endRepeat ? { endRepeat } : {}),
        ...(activeEnding && activeEnding.length > 0 ? { endingNumbers: activeEnding } : {}),
      },
    },
    next: {
      divisions,
      time,
      ...(key ? { key } : {}),
      ...(importedFifths !== undefined ? { importedFifths } : {}),
      ...(hasEndingStop ? {} : activeEnding ? { activeEnding } : {}),
    },
    tempoEvents: tempos,
    flowTexts,
  };
}

function parsePart(
  part: XmlElement,
  partOrdinal: number,
  displayPartName: string,
  diagnostics: ImportDiagnosticInput[],
): ParsedPart {
  const context: ParseContext = { diagnostics, partOrdinal };
  let inherited: {
    divisions: number;
    time?: TimeSignature;
    key?: KeySignature;
    importedFifths?: number;
    activeEnding?: readonly (1 | 2)[];
  } = { divisions: 1 };
  const measures: ImportedMeasureDraft[] = [];
  const tempoEvents: TempoEvent[] = [];
  const flowTexts: Omit<UnsupportedPerformanceFlow, "id">[] = [];
  for (const [ordinal, measureElement] of xmlChildren(part, "measure").entries()) {
    const parsed = parseMeasure(measureElement, ordinal, context, inherited);
    measures.push(parsed.measure);
    tempoEvents.push(...parsed.tempoEvents);
    flowTexts.push(...parsed.flowTexts);
    inherited = parsed.next;
  }
  if (measures.length === 0) throw new RangeError("MusicXML part has no measures");
  if (inherited.activeEnding) {
    diagnostics.push({
      code: "PERFORMANCE_EXPANSION_FAILED",
      messageKo: "first/second ending이 닫히지 않았습니다.",
      details: { partOrdinal },
    });
  }
  return {
    part: { partOrdinal, displayPartName, measures },
    tempoEvents,
    flowTexts,
  };
}

function buildCandidates(parts: readonly ImportedPartDraft[]): readonly LeadVoiceCandidate[] {
  const result: LeadVoiceCandidate[] = [];
  for (const part of parts) {
    const keys = [...new Set(part.measures.flatMap((measure) => measure.leadEvents.map((event) => event.candidateKey)))].sort(fixedCompare);
    for (const key of keys) {
      const identity = candidateIdentity(key);
      if (!identity) continue;
      const occurrences = part.measures.flatMap((measure) => measure.leadEvents
        .filter((event) => event.candidateKey === key)
        .map((event) => ({ measureOrdinal: measure.ordinal, event })));
      const notes = occurrences
        .map((entry) => entry.event)
        .filter((event): event is Extract<ImportedLeadEventDraft, { readonly kind: "note" }> => event.kind === "note");
      const pitches = notes.map((note) => note.pitch).sort(comparePitches);
      result.push({
        key,
        partOrdinal: part.partOrdinal,
        staffNumber: identity.staffNumber,
        voiceKey: identity.voiceKey,
        displayPartName: part.displayPartName,
        noteCount: notes.length,
        lyricCount: notes.reduce((sum, note) => sum + note.lyrics.length, 0),
        ...(pitches.length > 0 ? { pitchRangePreview: { low: pitches[0], high: pitches[pitches.length - 1] } } : {}),
        measureCoverage: [...new Set(occurrences.map((entry) => entry.measureOrdinal))].sort((left, right) => left - right),
      });
    }
  }
  return result.sort((left, right) => left.partOrdinal - right.partOrdinal
    || left.staffNumber - right.staffNumber
    || fixedCompare(left.voiceKey, right.voiceKey));
}

function buildSections(parts: readonly ImportedPartDraft[]): readonly ImportedSectionDraft[] {
  return parts.flatMap((part) => {
    const boundaries = part.measures.flatMap((measure) => measure.textEvents
      .filter((event) => event.kind === "section-label" || event.kind === "rehearsal-mark")
      .map((event) => ({ ordinal: measure.ordinal, event })))
      .sort((left, right) => left.ordinal - right.ordinal
        || (left.event.kind === "section-label" ? -1 : 1)
        || fixedCompare(left.event.text, right.event.text));
    const selected = new Map<number, ImportedTextDraft>();
    for (const boundary of boundaries) if (!selected.has(boundary.ordinal)) selected.set(boundary.ordinal, boundary.event);
    if (!selected.has(0)) selected.set(0, { onset: ZERO, kind: "section-label", text: "전체 곡" });
    const starts = [...selected.entries()].sort((left, right) => left[0] - right[0]);
    return starts.map(([start, event], index): ImportedSectionDraft => ({
      key: `section:p:${part.partOrdinal}:m:${start}`,
      partOrdinal: part.partOrdinal,
      startMeasureOrdinal: start,
      endMeasureOrdinalExclusive: starts[index + 1]?.[0] ?? part.measures.length,
      type: sectionTypeForLabel(event.text) ?? "other",
      label: event.text,
      confirmation: "suggested",
    }));
  });
}

function scoreMetadata(root: XmlElement): { readonly title: string; readonly composer?: string } {
  const work = xmlChild(root, "work");
  const title = xmlText(xmlChild(work ?? root, "work-title"))
    ?? xmlText(xmlChild(root, "movement-title"))
    ?? "제목 없음";
  const creators = xmlDescendants(root, "creator");
  const composerElement = creators.find((creator) => creator.attributes.type?.toLowerCase() === "composer") ?? creators[0];
  const composer = xmlText(composerElement);
  return { title, ...(composer ? { composer } : {}) };
}

function parseScore(root: XmlElement): ParseScoreResult | undefined {
  if (root.name !== "score-partwise") return undefined;
  const diagnostics: ImportDiagnosticInput[] = [];
  const metadata = scoreMetadata(root);
  const partList = xmlChild(root, "part-list");
  const listedNames = new Map<string, string>();
  if (partList) {
    for (const scorePart of xmlChildren(partList, "score-part")) {
      const id = scorePart.attributes.id;
      if (id) listedNames.set(id, xmlText(xmlChild(scorePart, "part-name")) ?? `Part ${listedNames.size + 1}`);
    }
  }
  const parsedParts = xmlChildren(root, "part").map((part, partOrdinal) => parsePart(
    part,
    partOrdinal,
    listedNames.get(part.attributes.id ?? "") ?? `Part ${partOrdinal + 1}`,
    diagnostics,
  ));
  if (parsedParts.length === 0) return undefined;
  const parts = parsedParts.map((parsed) => parsed.part);
  for (const part of parts) {
    for (const violation of validateCoreInputLimits({ maxSourceMeasures: part.measures.length })) {
      diagnostics.push({
        code: "INPUT_LIMIT_EXCEEDED",
        messageKo: "Core source measure 상한을 초과했습니다.",
        details: {
          issue: violation.limit,
          actual: violation.actual,
          maximum: violation.maximum,
          partOrdinal: part.partOrdinal,
        },
      });
    }
  }
  const firstPart = parts[0];
  const defaultKey = firstPart.measures[0]?.key;
  if (defaultKey && firstPart.measures.some((measure) => measure.key
    && (measure.key.mode !== defaultKey.mode
      || measure.key.tonic.step !== defaultKey.tonic.step
      || measure.key.tonic.alter !== defaultKey.tonic.alter))) {
    diagnostics.push({
      code: "UNSUPPORTED_MODULATION",
      messageKo: "곡 중간 조바꿈은 Core planning에서 지원하지 않습니다.",
      details: { issue: "mid-song-key-change" },
    });
  }
  const firstPartTempos = [...parsedParts[0].tempoEvents]
    .sort((left, right) => left.measureOrdinal - right.measureOrdinal || compareFractions(left.onset, right.onset));
  const initialTempos = firstPartTempos.filter((tempo) => tempo.measureOrdinal === 0 && tempo.onset.n === 0);
  const defaultTempo = initialTempos[0];
  if (firstPartTempos.some((tempo, index) => index > 0
    || tempo.measureOrdinal !== 0
    || tempo.onset.n !== 0
    || (defaultTempo && (tempo.bpm !== defaultTempo.bpm
      || tempo.beatUnit !== defaultTempo.beatUnit
      || tempo.dotted !== defaultTempo.dotted)))) {
    diagnostics.push({
      code: "IMPORT_UNSUPPORTED_ELEMENT",
      messageKo: "곡 중간 tempo 변경은 Core import에서 지원하지 않습니다.",
      details: { issue: "mid-song-tempo-change" },
    });
  }
  if (defaultTempo && (defaultTempo.bpm < 20 || defaultTempo.bpm > 300)) {
    diagnostics.push({
      code: "IMPORT_UNSUPPORTED_ELEMENT",
      messageKo: "tempo는 20–300 BPM의 정수여야 합니다.",
      details: { issue: "invalid-tempo", bpm: defaultTempo.bpm },
    });
  }
  const flowEntries = parsedParts.flatMap((parsed) => parsed.flowTexts)
    .sort((left, right) => left.partOrdinal - right.partOrdinal
      || left.measureOrdinal - right.measureOrdinal
      || fixedCompare(left.text, right.text))
    .filter((flow, index, values) => index === 0
      || flow.partOrdinal !== values[index - 1].partOrdinal
      || flow.measureOrdinal !== values[index - 1].measureOrdinal
      || flow.text !== values[index - 1].text)
    .map((flow, ordinal): UnsupportedPerformanceFlow => ({ ...flow, id: `flow:${ordinal}` }));
  for (const flow of flowEntries) diagnostics.push({
    code: "UNSUPPORTED_PERFORMANCE_FLOW",
    messageKo: `자동 전개할 수 없는 진행 지시가 있습니다: ${flow.text}`,
    details: { flowId: flow.id, measureOrdinal: flow.measureOrdinal, partOrdinal: flow.partOrdinal },
  });
  return {
    ...metadata,
    parts,
    candidates: buildCandidates(parts),
    sections: buildSections(parts),
    flows: flowEntries,
    ...(defaultKey ? { defaultKey } : {}),
    ...(defaultTempo && defaultTempo.bpm >= 20 && defaultTempo.bpm <= 300
      ? { defaultTempo: { beatUnit: defaultTempo.beatUnit, dotted: defaultTempo.dotted, bpm: defaultTempo.bpm } }
      : {}),
    diagnostics,
  };
}

export function createSecureDocumentId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `doc:${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function importMusicXml(
  rawBytes: Uint8Array,
  options: {
    readonly algorithmVersions: Step3ImportVersions;
    readonly originalFileName?: string;
    readonly securityLimits?: ImportSecurityLimits;
    readonly identityFactory?: DocumentIdentityFactory;
  },
): Promise<MusicImportResult> {
  const limits = options.securityLimits ?? DEFAULT_IMPORT_SECURITY_LIMITS;
  const isMxl = rawBytes.byteLength >= 2
    && rawBytes[0] === 0x50
    && rawBytes[1] === 0x4b;
  let musicXmlBytes = rawBytes;
  let containerKind: MusicXmlImportDraft["containerKind"] = "xml";
  if (isMxl) {
    const extracted = extractMusicXmlFromMxl(rawBytes, limits);
    if (extracted.status === "blocked") {
      return { status: "blocked", diagnostics: await materializeImportDiagnostics(extracted.diagnostics) };
    }
    musicXmlBytes = extracted.musicXmlBytes;
    containerKind = "mxl";
  }
  const parsedXml = parseSafeXml(musicXmlBytes, limits);
  if (parsedXml.status === "blocked") {
    return { status: "blocked", diagnostics: await materializeImportDiagnostics(parsedXml.diagnostics) };
  }
  let score: ParseScoreResult | undefined;
  try {
    score = parseScore(parsedXml.root);
  } catch (error) {
    const diagnostics = await materializeImportDiagnostics([{
      code: "IMPORT_CORRUPT_XML",
      messageKo: "MusicXML의 시간축 또는 구조가 유효하지 않습니다.",
      details: { reason: error instanceof Error ? error.message : "score-parse-failed" },
    }]);
    return { status: "blocked", diagnostics };
  }
  if (!score) {
    const diagnostics = await materializeImportDiagnostics([{
      code: "IMPORT_UNSUPPORTED_ELEMENT",
      messageKo: "score-partwise MusicXML만 Core import에서 지원합니다.",
      details: { reason: "unsupported-score-root" },
    }]);
    return { status: "blocked", diagnostics };
  }
  if (score.diagnostics.some((diagnostic) => diagnostic.code === "INPUT_LIMIT_EXCEEDED")) {
    return {
      status: "blocked",
      diagnostics: await materializeImportDiagnostics(score.diagnostics),
    };
  }
  const documentId = (options.identityFactory ?? createSecureDocumentId)();
  if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u.test(documentId) || /\s/u.test(documentId)) {
    throw new RangeError("document identity factory returned an invalid canonical ID");
  }
  const diagnostics = await materializeImportDiagnostics(score.diagnostics);
  const sectionOccurrences = buildImportedSectionOccurrenceReviews(
    score.parts,
    score.candidates,
    score.sections,
    options.algorithmVersions.performanceExpanderVersion,
  );
  const draft: MusicXmlImportDraft = {
    importerVersion: MUSICXML_IMPORTER_VERSION,
    documentId,
    rawDigest: await binaryDigest(rawBytes),
    containerKind,
    ...(options.originalFileName ? { originalFileName: options.originalFileName } : {}),
    title: score.title,
    ...(score.composer ? { composer: score.composer } : {}),
    parts: score.parts,
    leadCandidates: score.candidates,
    sections: score.sections,
    sectionOccurrences,
    unsupportedPerformanceFlows: score.flows,
    ...(score.defaultKey ? { defaultKey: score.defaultKey } : {}),
    ...(score.defaultTempo ? { defaultTempo: score.defaultTempo } : {}),
    algorithmVersions: {
      performanceExpanderVersion: options.algorithmVersions.performanceExpanderVersion,
      chordTimelineResolverVersion: options.algorithmVersions.chordTimelineResolverVersion,
      sourceLeadAtomizerVersion: options.algorithmVersions.sourceLeadAtomizerVersion,
    },
    singerCount: 1,
    performerSlots: [{ id: performerId(0), displayName: "Lead" }],
    diagnostics,
  };
  return { status: "review-required", draft, diagnostics };
}

export const __musicXmlParserInternals = {
  candidateKey,
  durationFraction,
  keyFromFifths,
  parseHarmony,
  sectionTypeForLabel,
};
