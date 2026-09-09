import { binaryDigest } from "../../domain/digest/canonical";
import { fraction, type Fraction } from "../../domain/fraction";
import type { SpelledPitch } from "../../domain/pitch";
import { exportChordMusicXml } from "../../product/musicxml-export";
import { isCanonicalSpelledPitch } from "../../domain/validation";
import { extractMusicXmlFromMxl } from "../mxl/archive";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../musicxml/types";
import { parseSafeXml, xmlChild, xmlChildren, xmlText, type XmlChild, type XmlElement } from "../musicxml/xml";
import { slashNotationForVoice, updateSlashNotation, type SlashNotationState } from "../musicxml/slash-notation";

export type RecoveryEdit =
  | { readonly kind: "note"; readonly part: number; readonly measure: number; readonly event: number; readonly value: {
      readonly kind: "note" | "rest" | "rhythm"; readonly pitch?: SpelledPitch;
      readonly type: "whole" | "half" | "quarter" | "eighth" | "16th" | "32nd" | "64th";
      readonly dots: 0 | 1 | 2; readonly tieStart: boolean; readonly tieStop: boolean;
    } }
  | { readonly kind: "meter"; readonly part: number; readonly measure: number; readonly numerator: number; readonly denominator: 4 | 8 }
  | { readonly kind: "chord"; readonly part: number; readonly measure: number; readonly event: number; readonly symbol: string; readonly onset: Fraction };

export interface RecoveryOperation {
  readonly edit: RecoveryEdit;
  /** The user's reference to the original, never inferred from an engine ordinal. */
  readonly sourceLocation: string;
  readonly appliedAt: string;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly before: string;
  readonly after: string;
}
export interface ImportRecovery {
  readonly version: "hm-import-recovery-v1";
  readonly originalXml: string;
  readonly originalDigest: string;
  readonly originalFileName: string;
  readonly operations: readonly RecoveryOperation[];
}
export interface RecoveryMeasure {
  readonly part: number;
  readonly measure: number;
  readonly printedNumber: string;
  readonly page: number;
  readonly system: number;
  readonly meter?: { readonly numerator: number; readonly denominator: number };
  readonly chords: readonly { readonly event: number; readonly text: string; readonly onset: string }[];
  readonly notes: readonly {
    readonly event: number; readonly kind: "note" | "rest" | "rhythm" | "unresolved";
    readonly pitch?: SpelledPitch; readonly duration: string; readonly onset: string;
    readonly voice: string; readonly type: string; readonly dots: number;
    readonly tieStart: boolean; readonly tieStop: boolean;
    readonly rhythmicSlashStyle?: true;
  }[];
}
const encoder = new TextEncoder();
const typeQuarters = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625 } as const;
function root(xml: string): XmlElement {
  const parsed = parseSafeXml(encoder.encode(xml), DEFAULT_IMPORT_SECURITY_LIMITS);
  if (parsed.status !== "complete" || parsed.root.name !== "score-partwise") throw new RangeError("RECOVERY_XML_UNREPRESENTABLE");
  const parts = xmlChildren(parsed.root, "part");
  const measures = parts.flatMap((part) => xmlChildren(part, "measure"));
  if (parts.length > 32 || measures.length > 512 || measures.some((measure) => xmlChildren(measure, "note").length > 1024)) throw new RangeError("RECOVERY_EDITOR_LIMIT");
  return parsed.root;
}
function escape(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function serialize(node: XmlChild): string {
  if (node.kind === "text") return escape(node.value);
  return `<${node.name}${Object.entries(node.attributes).map(([key, value]) => ` ${key}="${escape(value)}"`).join("")}>${node.children.map(serialize).join("")}</${node.name}>`;
}
function el(name: string, text?: string, attributes: Record<string, string> = {}): XmlElement {
  return { kind: "element", name, attributes, children: text === undefined ? [] : [{ kind: "text", value: text }] };
}
function number(element: XmlElement | undefined): number { return element ? Number(xmlText(element)) : 0; }
function accidental(alter: number): string { return [-2, -1, 0, 1, 2].includes(alter) ? alter < 0 ? "b".repeat(-alter) : "#".repeat(alter) : "?"; }
function replaceChild(parent: XmlElement, previous: XmlElement, next: XmlElement): XmlElement {
  return { ...parent, children: parent.children.map((child) => child === previous ? next : child) };
}
function divisionsAt(part: XmlElement, measureIndex: number): number {
  let divisions = 1;
  for (const measure of xmlChildren(part, "measure").slice(0, measureIndex + 1)) {
    for (const attributes of xmlChildren(measure, "attributes")) {
      const value = xmlChild(attributes, "divisions");
      if (value) divisions = number(value);
    }
  }
  if (!Number.isSafeInteger(divisions) || divisions < 1) throw new RangeError("RECOVERY_DIVISIONS_INVALID");
  return divisions;
}
function noteValue(note: XmlElement): Pick<RecoveryMeasure["notes"][number], "kind" | "pitch"> {
  if (xmlChild(note, "rest")) return { kind: "rest" };
  if (xmlChild(note, "unpitched") && xmlText(xmlChild(note, "notehead")) === "slash") return { kind: "rhythm" };
  const pitch = xmlChild(note, "pitch");
  const value = { step: xmlText(pitch && xmlChild(pitch, "step")), alter: pitch && xmlChild(pitch, "alter") ? number(xmlChild(pitch, "alter")) : 0, octave: pitch ? number(xmlChild(pitch, "octave")) : NaN };
  return isCanonicalSpelledPitch(value) ? { kind: "note", pitch: value } : { kind: "unresolved" };
}
export function inspectRecoveryXml(xml: string): readonly RecoveryMeasure[] {
  const tree = root(xml);
  return xmlChildren(tree, "part").flatMap((part, partIndex) => {
    let divisions = 1; let page = 1; let system = 1;
    const slashNotation: SlashNotationState = new Map();
    let meter: RecoveryMeasure["meter"];
    return xmlChildren(part, "measure").map((measure, measureIndex): RecoveryMeasure => {
      const print = xmlChild(measure, "print");
      if (measureIndex > 0 && print?.attributes["new-page"] === "yes") { page += 1; system = 1; }
      else if (measureIndex > 0 && print?.attributes["new-system"] === "yes") system += 1;
      let cursor = 0; let event = 0;
      const lastOnset = new Map<string, number>();
      const notes: RecoveryMeasure["notes"][number][] = [];
      const chords: RecoveryMeasure["chords"][number][] = [];
      for (const child of measure.children) {
        if (child.kind !== "element") continue;
        if (child.name === "attributes") {
          updateSlashNotation(slashNotation, child);
          if (xmlChild(child, "divisions")) divisions = number(xmlChild(child, "divisions"));
          const time = xmlChild(child, "time");
          if (time) meter = { numerator: number(xmlChild(time, "beats")), denominator: number(xmlChild(time, "beat-type")) };
        } else if (child.name === "harmony") {
          const chordRoot = xmlChild(child, "root");
          const step = chordRoot && xmlText(xmlChild(chordRoot, "root-step")) || "";
          const alter = chordRoot ? number(xmlChild(chordRoot, "root-alter")) : 0;
          const kind = xmlChild(child, "kind");
          const suffix = kind?.attributes.text ?? ({ major: "", minor: "m", dominant: "7", "major-seventh": "maj7", "minor-seventh": "m7", none: "N.C." } as Record<string, string>)[xmlText(kind) ?? ""] ?? xmlText(kind) ?? "?";
          const bass = xmlChild(child, "bass");
          const bassStep = bass && xmlText(xmlChild(bass, "bass-step"));
          const bassAlter = bass ? number(xmlChild(bass, "bass-alter")) : 0;
          chords.push({ event: chords.length, text: `${step}${accidental(alter)}${suffix}${bassStep ? `/${bassStep}${accidental(bassAlter)}` : ""}`,
            onset: String(cursor + number(xmlChild(child, "offset")) / divisions) });
        } else if (child.name === "backup" || child.name === "forward") {
          cursor += (child.name === "backup" ? -1 : 1) * number(xmlChild(child, "duration")) / divisions;
        } else if (child.name === "note") {
          const voice = xmlText(xmlChild(child, "voice")) || "1";
          const onset = xmlChild(child, "chord") ? lastOnset.get(voice) ?? NaN : cursor;
          const duration = number(xmlChild(child, "duration")) / divisions;
          const ties = xmlChildren(child, "tie");
          const style = slashNotationForVoice(slashNotation, number(xmlChild(child, "staff")) || 1, voice);
          const value = style && !xmlChild(child, "rest")
            ? style.rhythmic ? { kind: "rhythm" as const, rhythmicSlashStyle: true as const } : { kind: "unresolved" as const }
            : noteValue(child);
          notes.push({ event: event++, ...value, duration: String(duration), onset: String(onset), voice,
            type: xmlText(xmlChild(child, "type")) ?? "", dots: xmlChildren(child, "dot").length,
            tieStart: ties.some((tie) => tie.attributes.type === "start"), tieStop: ties.some((tie) => tie.attributes.type === "stop") });
          if (!xmlChild(child, "chord") && !xmlChild(child, "grace")) { lastOnset.set(voice, onset); cursor += duration; }
        }
      }
      return { part: partIndex, measure: measureIndex, printedNumber: measure.attributes.number ?? "?", page, system, ...(meter ? { meter } : {}), notes, chords };
    });
  });
}
function applyEdit(xml: string, edit: RecoveryEdit): string {
  const tree = root(xml);
  if (![edit.part, edit.measure].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new RangeError("RECOVERY_TARGET_INVALID");
  const part = xmlChildren(tree, "part")[edit.part];
  const measure = part && xmlChildren(part, "measure")[edit.measure];
  if (!part || !measure) throw new RangeError("RECOVERY_TARGET_INVALID");
  let timedContent = false;
  for (const child of measure.children) {
    if (child.kind !== "element") continue;
    if (["note", "backup", "forward", "harmony"].includes(child.name)) timedContent = true;
    if (timedContent && child.name === "attributes" && xmlChild(child, "divisions")) {
      // This small editor cannot retime a changing divisions grid safely.
      throw new RangeError("RECOVERY_DIVISIONS_CHANGE_UNSUPPORTED");
    }
  }
  let nextMeasure: XmlElement;
  if (edit.kind === "chord") {
    const harmonies = xmlChildren(measure, "harmony");
    if (!Number.isSafeInteger(edit.event) || edit.event < 0 || edit.event > harmonies.length
      || typeof edit.symbol !== "string" || edit.symbol.length > 128 || !edit.onset
      || !Number.isSafeInteger(edit.onset.n) || !Number.isSafeInteger(edit.onset.d) || edit.onset.n < 0 || edit.onset.d <= 0) throw new RangeError("RECOVERY_CHORD_INVALID");
    const divisions = divisionsAt(part, edit.measure);
    let cursor = 0;
    const old = harmonies[edit.event];
    for (const child of measure.children) {
      if (child === old) break;
      if (child.kind !== "element") continue;
      if (child.name === "backup") cursor -= number(xmlChild(child, "duration"));
      if (child.name === "forward" || (child.name === "note" && !xmlChild(child, "chord") && !xmlChild(child, "grace"))) cursor += number(xmlChild(child, "duration"));
    }
    const parsed = parseSafeXml(encoder.encode(exportChordMusicXml(edit.symbol, edit.onset.n * divisions / edit.onset.d - cursor)), DEFAULT_IMPORT_SECURITY_LIMITS);
    if (parsed.status !== "complete") throw new RangeError("RECOVERY_CHORD_INVALID");
    nextMeasure = old ? replaceChild(measure, old, parsed.root) : { ...measure, children: [...measure.children, parsed.root] };
  } else if (edit.kind === "meter") {
    if (!Number.isSafeInteger(edit.numerator) || edit.numerator < 1 || edit.numerator > 32 || ![4, 8].includes(edit.denominator)) throw new RangeError("RECOVERY_METER_INVALID");
    const existing = xmlChild(measure, "attributes");
    const attributes = existing ?? el("attributes");
    if (xmlChildren(attributes, "time").length > 1) throw new RangeError("RECOVERY_POLYMETER_UNSUPPORTED");
    const time = { ...el("time"), children: [el("beats", String(edit.numerator)), el("beat-type", String(edit.denominator))] };
    const prior = xmlChild(attributes, "time");
    const next = prior ? replaceChild(attributes, prior, time) : { ...attributes, children: [...attributes.children, time] };
    nextMeasure = existing ? replaceChild(measure, existing, next) : { ...measure, children: [next, ...measure.children] };
  } else {
    if (edit.kind !== "note" || !Number.isSafeInteger(edit.event) || edit.event < 0) throw new RangeError("RECOVERY_TARGET_INVALID");
    const note = xmlChildren(measure, "note")[edit.event];
    if (!note || xmlChild(note, "grace") || xmlChild(note, "time-modification")) throw new RangeError("RECOVERY_NOTE_UNSUPPORTED");
    const v = edit.value;
    const target = inspectRecoveryXml(xml).find((m) => m.part === edit.part && m.measure === edit.measure)?.notes[edit.event];
    if (target?.rhythmicSlashStyle && v.kind === "note") throw new RangeError("RECOVERY_RHYTHM_STYLE_ACTIVE");
    if (!["note", "rest", "rhythm"].includes(v.kind) || !(v.type in typeQuarters) || ![0, 1, 2].includes(v.dots)
      || typeof v.tieStart !== "boolean" || typeof v.tieStop !== "boolean"
      || (v.kind === "note" ? !isCanonicalSpelledPitch(v.pitch) : v.pitch !== undefined)
      || (v.kind === "rest" && (v.tieStart || v.tieStop))) throw new RangeError("RECOVERY_NOTE_INVALID");
    const duration = typeQuarters[v.type] * [1, 1.5, 1.75][v.dots] * divisionsAt(part, edit.measure);
    // Never round duration to fit the existing divisions or the measure.
    if (!Number.isSafeInteger(duration) || duration <= 0) throw new RangeError("RECOVERY_DURATION_UNREPRESENTABLE");
    const body: XmlElement[] = [];
    const chord = xmlChild(note, "chord"); if (chord) body.push(chord);
    if (v.kind === "rest") body.push(el("rest"));
    else if (v.kind === "rhythm") body.push({ ...el("unpitched"), children: [el("display-step", "B"), el("display-octave", "4")] });
    else body.push({ ...el("pitch"), children: [el("step", v.pitch!.step), el("alter", String(v.pitch!.alter)), el("octave", String(v.pitch!.octave))] });
    body.push(el("duration", String(duration)));
    if (v.tieStop) body.push(el("tie", undefined, { type: "stop" }));
    if (v.tieStart) body.push(el("tie", undefined, { type: "start" }));
    const voice = xmlChild(note, "voice"); if (voice) body.push(voice);
    body.push(el("type", v.type), ...Array.from({ length: v.dots }, () => el("dot")));
    if (v.kind === "rhythm") body.push(el("notehead", "slash"));
    const staff = xmlChild(note, "staff"); if (staff) body.push(staff);
    const notations = xmlChildren(note, "notations").flatMap((n) => n.children.filter((child) => child.kind !== "element" || child.name !== "tied"));
    if (v.tieStop) notations.push(el("tied", undefined, { type: "stop" }));
    if (v.tieStart) notations.push(el("tied", undefined, { type: "start" }));
    if (notations.length) body.push({ ...el("notations"), children: notations });
    if (v.kind !== "rest") body.push(...xmlChildren(note, "lyric"));
    // Refuse an edit if it would silently drop a musical element outside this editor.
    const supported = new Set(["chord", "pitch", "rest", "unpitched", "duration", "tie", "voice", "type", "dot", "accidental", "stem", "notehead", "staff", "beam", "notations", "lyric"]);
    if (note.children.some((child) => child.kind === "element" && !supported.has(child.name))) throw new RangeError("RECOVERY_NOTE_UNSUPPORTED");
    if (v.kind === "rest" && xmlChildren(note, "lyric").length) throw new RangeError("RECOVERY_LYRICS_WOULD_BE_LOST");
    nextMeasure = replaceChild(measure, note, { ...note, children: body });
  }
  return serialize(replaceChild(tree, part, replaceChild(part, measure, nextMeasure)));
}
export async function createImportRecovery(bytes: Uint8Array, originalFileName: string): Promise<ImportRecovery> {
  let xmlBytes = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const extracted = extractMusicXmlFromMxl(bytes, DEFAULT_IMPORT_SECURITY_LIMITS);
    if (extracted.status !== "complete") throw new RangeError("RECOVERY_XML_UNREPRESENTABLE");
    xmlBytes = extracted.musicXmlBytes;
  }
  const originalXml = new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes);
  root(originalXml);
  return { version: "hm-import-recovery-v1", originalXml, originalDigest: await binaryDigest(encoder.encode(originalXml)), originalFileName, operations: [] };
}
export async function replayImportRecovery(recovery: ImportRecovery): Promise<string> {
  if (recovery.version !== "hm-import-recovery-v1" || recovery.operations.length > 512
    || await binaryDigest(encoder.encode(recovery.originalXml)) !== recovery.originalDigest) throw new RangeError("RECOVERY_HISTORY_INVALID");
  let xml = recovery.originalXml;
  root(xml);
  for (const operation of recovery.operations) {
    if (!operation.sourceLocation.trim() || operation.sourceLocation.length > 256 || !Number.isFinite(Date.parse(operation.appliedAt))
      || await binaryDigest(encoder.encode(xml)) !== operation.beforeDigest
      || operation.before !== editPreview(xml, operation.edit)) throw new RangeError("RECOVERY_HISTORY_INVALID");
    xml = applyEdit(xml, operation.edit);
    if (await binaryDigest(encoder.encode(xml)) !== operation.afterDigest || operation.after !== editPreview(xml, operation.edit)) throw new RangeError("RECOVERY_HISTORY_INVALID");
  }
  return xml;
}
export async function applyRecoveryEdit(recovery: ImportRecovery, edit: RecoveryEdit, sourceLocation: string, appliedAt: string): Promise<ImportRecovery> {
  if (!sourceLocation.trim() || sourceLocation.length > 256 || !Number.isFinite(Date.parse(appliedAt)) || recovery.operations.length >= 512) throw new RangeError("RECOVERY_REFERENCE_REQUIRED");
  const before = await replayImportRecovery(recovery);
  const after = applyEdit(before, edit);
  return { ...recovery, operations: [...recovery.operations, { edit: structuredClone(edit), sourceLocation: sourceLocation.trim(), appliedAt,
    beforeDigest: await binaryDigest(encoder.encode(before)), afterDigest: await binaryDigest(encoder.encode(after)),
    before: editPreview(before, edit), after: editPreview(after, edit) }] };
}
function editPreview(xml: string, edit: RecoveryEdit): string {
  const measure = inspectRecoveryXml(xml).find((m) => m.part === edit.part && m.measure === edit.measure);
  return JSON.stringify(edit.kind === "meter" ? measure?.meter ?? null : edit.kind === "chord" ? measure?.chords[edit.event] ?? null : measure?.notes[edit.event] ?? null);
}
export function undoRecoveryEdit(recovery: ImportRecovery): ImportRecovery { return { ...recovery, operations: recovery.operations.slice(0, -1) }; }
export function recoveryDuration(type: keyof typeof typeQuarters, dots: 0 | 1 | 2): Fraction { return fraction(typeQuarters[type] * 64 * [1, 1.5, 1.75][dots], 64); }
export async function importRecoveryProof(recovery: ImportRecovery): Promise<string> {
  const xml = await replayImportRecovery(recovery);
  return JSON.stringify({ version: recovery.version, originalDigest: recovery.originalDigest,
    candidateDigest: await binaryDigest(encoder.encode(xml)), operations: recovery.operations });
}
