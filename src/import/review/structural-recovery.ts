import { binaryDigest, canonicalJson } from "../../domain/digest/canonical";
import { addFractions as add, subtractFractions as sub, compareFractions as cmp, fraction as f, type Fraction } from "../../domain/fraction";
import { xmlChild as child, xmlChildren as children, xmlText as text, type XmlElement } from "../musicxml/xml";
import { applyRecoveryXmlEdit, inspectRecoveryXml, recoveryDuration, recoveryXmlRoot, replayImportRecovery, serializeRecoveryXml as xml, type ImportRecovery, type RecoveryEdit } from "./recovery";

export type RecoveryNoteValue = Extract<RecoveryEdit, { kind: "note" }>["value"];
export interface StructuralEvent { readonly id: string; readonly origin: string; readonly onset: Fraction; readonly node: XmlElement }
export interface StructuralMeasure {
  readonly id: string; readonly documentId: string; readonly origin: string; readonly label: string;
  readonly meter?: { readonly numerator: number; readonly denominator: 4 | 8 };
  readonly fifths?: number; readonly clef: string; readonly implicit: boolean;
  readonly extent?: Fraction; readonly notes: readonly StructuralEvent[]; readonly chords: readonly StructuralEvent[];
  readonly directions: readonly StructuralEvent[]; readonly barlines: readonly XmlElement[];
}
export interface OriginalSystemInventory { readonly page: number; readonly system: number; readonly labels: readonly string[] }
export interface StructuralState { readonly measures: readonly StructuralMeasure[]; readonly joins: readonly string[]; readonly uncertainties: Readonly<Record<string, string>>; readonly resolvedUncertainties?: Readonly<Record<string, string>>; readonly inventory?: readonly OriginalSystemInventory[] }
export type StructuralEdit =
  | { readonly kind: "inventory"; readonly systems: readonly OriginalSystemInventory[] }
  | { readonly kind: "note"; readonly measureId: string; readonly eventId?: string; readonly value: RecoveryNoteValue; readonly onset: Fraction; readonly voice: string; readonly removeNotations?: readonly ("articulations" | "arpeggiate" | "slur")[] }
  | { readonly kind: "remove"; readonly measureId: string; readonly eventId: string }
  | { readonly kind: "move"; readonly measureId: string; readonly eventId: string; readonly destinationId: string; readonly onset: Fraction; readonly voice: string }
  | { readonly kind: "chord"; readonly measureId: string; readonly eventId?: string; readonly symbol: string; readonly onset: Fraction }
  | { readonly kind: "split"; readonly measureId: string; readonly rightEventIds: readonly string[]; readonly rebase: Fraction; readonly rightLabel: string }
  | { readonly kind: "context"; readonly measureId: string; readonly label: string; readonly numerator: number; readonly denominator: 4 | 8; readonly fifths: number; readonly clef?: string; readonly extent: Fraction; readonly implicit: boolean }
  | { readonly kind: "join"; readonly leftDocumentId: string; readonly rightDocumentId: string; readonly partRole: string; readonly voiceMap: Readonly<Record<string, string>> }
  | { readonly kind: "uncertainty"; readonly measureId: string; readonly detail: string }
  | { readonly kind: "resolve-uncertainty"; readonly measureId: string; readonly detail: string };
export interface StructuralOperation {
  readonly id: string; readonly edit: StructuralEdit; readonly sourceLocation: string; readonly appliedAt: string;
  readonly beforeDigest: string; readonly afterDigest: string; readonly affectedIds: readonly string[];
  readonly before: string; readonly after: string;
}
export interface StructuralCoverage {
  readonly measureId: string; readonly page: number; readonly system: number; readonly printedLabel: string;
  readonly voiceCounts: Readonly<Record<string, number>>; readonly chordCount: number;
  readonly sourceLocation: string; readonly revisionDigest: string;
}
export interface StructuralRecovery {
  readonly version: "hm-structural-recovery-v1"; readonly id: string;
  readonly documents: readonly { readonly id: string; readonly recovery: ImportRecovery; readonly failureReason?: string }[];
  readonly operations: readonly StructuralOperation[]; readonly redo: readonly StructuralOperation[];
  readonly coverage: readonly StructuralCoverage[];
}
const ZERO = f(0), GRID = 64;
const enc = new TextEncoder();
const element = (name: string, value?: string, nodes: readonly XmlElement[] = [], attributes: Record<string, string> = {}): XmlElement =>
  ({ kind: "element", name, attributes, children: value === undefined ? nodes : [{ kind: "text", value }] });
const without = (node: XmlElement, names: readonly string[]): XmlElement => ({ ...node, children: node.children.filter((c) => c.kind === "element" && !names.includes(c.name)) });
const number = (node: XmlElement, key: string, fallback = 0) => Number(text(child(node, key)) ?? fallback);
const voice = (e: StructuralEvent) => text(child(e.node, "voice")) || "1";
function withVoice(node: XmlElement, value: string): XmlElement {
  const body = [...without(node, ["voice", "chord"]).children];
  const index = body.findIndex((c) => c.kind === "element" && ["type", "dot", "accidental", "time-modification", "stem", "notehead", "staff", "beam", "notations", "lyric"].includes(c.name));
  body.splice(index < 0 ? body.length : index, 0, element("voice", value));
  return { ...node, children: body };
}
const duration = (e: StructuralEvent) => f(number(e.node, "duration"), GRID);
export const structuralDigest = (s: StructuralState): Promise<string> => binaryDigest(enc.encode(canonicalJson(s)));
function checkFraction(value: Fraction, positive = false): void {
  if (!value || !Number.isSafeInteger(value.n) || !Number.isSafeInteger(value.d) || value.d <= 0 || value.n < (positive ? 1 : 0)
    || !Number.isSafeInteger(value.n * GRID / value.d) || value.n / value.d > 4096) throw new RangeError("RECOVERY_TIME_GRID_UNSUPPORTED");
}
function checkVoice(v: string): void { if (typeof v !== "string" || !/^[\p{L}\p{N}._-]{1,32}$/u.test(v)) throw new RangeError("RECOVERY_VOICE_INVALID"); }
function checkReference(s: string): void { if (typeof s !== "string" || !s.trim() || s.length > 256) throw new RangeError("RECOVERY_REFERENCE_REQUIRED"); }
function gridNode(node: XmlElement, divisions: number): XmlElement {
  const cs = node.children.map((c) => {
    if (c.kind !== "element" || !["duration", "offset"].includes(c.name)) return c;
    const val = Number(text(c)) * GRID / divisions;
    if (!Number.isSafeInteger(val)) throw new RangeError("RECOVERY_TIME_GRID_UNSUPPORTED");
    return element(c.name, String(val));
  });
  return { ...node, children: cs };
}
async function seedState(documents: StructuralRecovery["documents"]): Promise<StructuralState> {
  if (!Array.isArray(documents) || !documents.length || documents.length > 16 || new Set(documents.map((d) => d.id)).size !== documents.length) throw new RangeError("RECOVERY_DOCUMENTS_INVALID");
  if (documents.reduce((n, d) => n + enc.encode(d.recovery.originalXml).length, 0) > 4_000_000) throw new RangeError("RECOVERY_COLLECTION_LIMIT");
  const measures: StructuralMeasure[] = [];
  for (const doc of documents) {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/u.test(doc.id)) throw new RangeError("RECOVERY_DOCUMENT_ID_INVALID");
    const tree = recoveryXmlRoot(await replayImportRecovery(doc.recovery));
    const parts = children(tree, "part");
    // A one-part score is supported here; never flatten several parts or staves.
    if (parts.length !== 1) throw new RangeError("RECOVERY_PART_MAPPING_REQUIRED");
    let divisions = 1, fifths: number | undefined, meter: StructuralMeasure["meter"], clef = "";
    for (const [index, m] of children(parts[0], "measure").entries()) {
      const id = `${doc.id}:m${index}`;
      let cursor = ZERO, previous = ZERO, timed = false;
      const notes: StructuralEvent[] = [], chords: StructuralEvent[] = [], directions: StructuralEvent[] = [], barlines: XmlElement[] = [];
      for (const node of m.children) {
        if (node.kind !== "element") continue;
        if (node.name === "attributes") {
          if (timed) throw new RangeError("RECOVERY_MID_MEASURE_CONTEXT_UNSUPPORTED");
          divisions = number(node, "divisions", divisions);
          if (!Number.isSafeInteger(divisions) || divisions < 1 || number(node, "staves", 1) !== 1 || child(node, "transpose") || child(node, "measure-style")) throw new RangeError("RECOVERY_CONTEXT_UNSUPPORTED");
          const k = child(node, "key"), t = child(node, "time"), c = child(node, "clef");
          if (k) fifths = number(k, "fifths");
          if (t) { const denominator = number(t, "beat-type"); if (![4, 8].includes(denominator)) throw new RangeError("RECOVERY_METER_UNSUPPORTED"); meter = { numerator: number(t, "beats"), denominator: denominator as 4 | 8 }; }
          if (c) clef = `${text(child(c, "sign"))}:${number(c, "line")}`;
        } else if (["backup", "forward"].includes(node.name)) {
          timed = true; const delta = f(number(node, "duration"), divisions); cursor = node.name === "backup" ? sub(cursor, delta) : add(cursor, delta); checkFraction(cursor);
        } else if (node.name === "note") {
          timed = true;
          if (child(node, "grace") || child(node, "time-modification") || number(node, "staff", 1) !== 1) throw new RangeError("RECOVERY_NOTE_STRUCTURE_UNSUPPORTED");
          const onset = child(node, "chord") ? previous : cursor;
          const value = gridNode(node, divisions);
          const event: StructuralEvent = { id: `${id}:n${notes.length}`, origin: `${id}:n${notes.length}`, onset, node: value };
          checkFraction(onset); checkFraction(duration(event), true); notes.push(event);
          if (!child(node, "chord")) { previous = cursor; cursor = add(cursor, duration(event)); }
        } else if (["harmony", "direction", "sound"].includes(node.name)) {
          timed = true; const list = node.name === "harmony" ? chords : directions;
          const onset = add(cursor, f(number(node, "offset"), divisions)); checkFraction(onset);
          list.push({ id: `${id}:${node.name}${list.length}`, origin: `${id}:${node.name}${list.length}`, onset, node: without(gridNode(node, divisions), ["offset"]) });
        } else if (node.name === "barline") barlines.push(node);
        else if (node.name !== "print") throw new RangeError(`RECOVERY_MEASURE_ELEMENT_UNSUPPORTED:${node.name}`);
      }
      measures.push({ id, documentId: doc.id, origin: id, label: m.attributes.number ?? "?", ...(meter ? { meter } : {}), ...(fifths !== undefined ? { fifths } : {}), clef, implicit: m.attributes.implicit === "yes", notes, chords, directions, barlines });
    }
  }
  if (measures.length > 512) throw new RangeError("RECOVERY_MEASURE_LIMIT");
  return { measures, joins: [], uncertainties: {} };
}
function measureXml(m: StructuralMeasure): XmlElement {
  const attrs: XmlElement[] = [element("divisions", String(GRID))];
  if (m.fifths !== undefined) attrs.push(element("key", undefined, [element("fifths", String(m.fifths))]));
  if (m.meter) attrs.push(element("time", undefined, [element("beats", String(m.meter.numerator)), element("beat-type", String(m.meter.denominator))]));
  if (m.clef) { const [sign, line] = m.clef.split(":"); attrs.push(element("clef", undefined, [element("sign", sign), element("line", line)])); }
  const body: XmlElement[] = [element("attributes", undefined, attrs)];
  for (const e of [...m.directions, ...m.chords].sort((a, b) => cmp(a.onset, b.onset))) {
    body.push({ ...e.node, children: [...e.node.children, ...(cmp(e.onset, ZERO) ? [element("offset", String(e.onset.n * GRID / e.onset.d))] : [])] });
  }
  let cursor = ZERO;
  for (const e of [...m.notes].sort((a, b) => voice(a).localeCompare(voice(b)) || cmp(a.onset, b.onset) || a.id.localeCompare(b.id))) {
    const delta = sub(e.onset, cursor);
    if (delta.n) body.push(element(delta.n < 0 ? "backup" : "forward", undefined, [element("duration", String(Math.abs(delta.n) * GRID / delta.d))]));
    body.push(without(e.node, ["chord"])); cursor = add(e.onset, duration(e));
  }
  body.push(...m.barlines);
  return element("measure", undefined, body, { number: m.label, ...(m.implicit ? { implicit: "yes" } : {}) });
}
function scoreXml(ms: readonly StructuralMeasure[], originalXml?: string): string {
  const header = originalXml ? recoveryXmlRoot(originalXml).children.filter((node): node is XmlElement => node.kind === "element" && ["work", "movement-number", "movement-title", "identification"].includes(node.name)) : [];
  return xml(element("score-partwise", undefined, [...header, element("part-list", undefined, [element("score-part", undefined, [element("part-name", "Recovered source")], { id: "P1" })]), element("part", undefined, ms.map(measureXml), { id: "P1" })], { version: "4.0" }));
}
export function inspectStructuralMeasure(m: StructuralMeasure) { return inspectRecoveryXml(scoreXml([m]))[0]; }
export function inspectStructuralNote(m: StructuralMeasure, e: StructuralEvent) {
  return inspectRecoveryXml(scoreXml([{ ...m, notes: [e], chords: [], directions: [] }]))[0].notes[0];
}
export function structuralCandidateXml(s: StructuralState, originalXml?: string): string { return scoreXml(s.measures, originalXml); }
function editState(state: StructuralState, edit: StructuralEdit, operationId: string): StructuralState {
  if (edit.kind === "inventory") {
    if (!Array.isArray(edit.systems) || !edit.systems.length || edit.systems.length > 128 || edit.systems.reduce((n, s) => n + s.labels.length, 0) > 512) throw new RangeError("RECOVERY_INVENTORY_INVALID");
    let previous = [0, 0];
    for (const s of edit.systems) {
      if (!Number.isSafeInteger(s.page) || s.page < 1 || !Number.isSafeInteger(s.system) || s.system < 1 || s.page < previous[0] || s.page === previous[0] && s.system <= previous[1]
        || !s.labels.length || new Set(s.labels).size !== s.labels.length || s.labels.some((label: unknown) => typeof label !== "string" || !label.trim() || label.length > 32)) throw new RangeError("RECOVERY_INVENTORY_INVALID");
      previous = [s.page, s.system];
    }
    return { ...state, inventory: structuredClone(edit.systems) };
  }
  if (edit.kind === "join") {
    checkReference(edit.partRole);
    const order = [...new Set(state.measures.map((m) => m.documentId))];
    if (order.indexOf(edit.rightDocumentId) !== order.indexOf(edit.leftDocumentId) + 1 || order.indexOf(edit.leftDocumentId) < 0) throw new RangeError("RECOVERY_JOIN_ORDER_INVALID");
    const left = state.measures.filter((m) => m.documentId === edit.leftDocumentId).at(-1)!;
    const right = state.measures.filter((m) => m.documentId === edit.rightDocumentId);
    if (!left.meter || left.fifths === undefined || !right[0]?.meter || right[0].fifths === undefined || !left.clef || left.clef !== right[0].clef) throw new RangeError("RECOVERY_JOIN_CONTEXT_UNRESOLVED");
    const voices = new Set(right.flatMap((m) => m.notes.map(voice)));
    if (Object.keys(edit.voiceMap).length !== voices.size || [...voices].some((v) => !Object.hasOwn(edit.voiceMap, v))) throw new RangeError("RECOVERY_JOIN_VOICE_MAPPING_REQUIRED");
    Object.values(edit.voiceMap).forEach(checkVoice);
    const join = `${edit.leftDocumentId}>${edit.rightDocumentId}`;
    if (state.joins.includes(join)) throw new RangeError("RECOVERY_DUPLICATE_JOIN");
    return { ...state, joins: [...state.joins, join], measures: state.measures.map((m) => m.documentId !== edit.rightDocumentId ? m : { ...m, notes: m.notes.map((n) => ({ ...n, node: withVoice(n.node, edit.voiceMap[voice(n)]) })) }) };
  }
  const measure = state.measures.find((m) => m.id === edit.measureId);
  if (!measure) throw new RangeError("RECOVERY_STABLE_TARGET_MISSING");
  const replace = (m: StructuralMeasure): StructuralState => ({ ...state, measures: state.measures.map((old) => old.id === m.id ? m : old) });
  if (edit.kind === "uncertainty") {
    checkReference(edit.detail); return { ...state, uncertainties: { ...state.uncertainties, [measure.id]: edit.detail } };
  }
  if (edit.kind === "resolve-uncertainty") {
    checkReference(edit.detail);
    if (!Object.hasOwn(state.uncertainties, measure.id)) throw new RangeError("RECOVERY_UNCERTAINTY_MISSING");
    const uncertainties = { ...state.uncertainties }; delete uncertainties[measure.id];
    return { ...state, uncertainties, resolvedUncertainties: { ...state.resolvedUncertainties, [measure.id]: edit.detail } };
  }
  if (edit.kind === "context") {
    checkReference(edit.label); checkFraction(edit.extent, true);
    if (!Number.isInteger(edit.numerator) || edit.numerator < 1 || edit.numerator > 32 || ![4, 8].includes(edit.denominator) || !Number.isInteger(edit.fifths) || Math.abs(edit.fifths) > 7) throw new RangeError("RECOVERY_CONTEXT_INVALID");
    if (edit.clef !== undefined && !["G:2", "F:4", "C:3", "C:4"].includes(edit.clef)) throw new RangeError("RECOVERY_CLEF_INVALID");
    return replace({ ...measure, label: edit.label, meter: { numerator: edit.numerator, denominator: edit.denominator }, fifths: edit.fifths, clef: edit.clef ?? measure.clef, implicit: edit.implicit, extent: edit.extent });
  }
  if (edit.kind === "split") {
    checkReference(edit.rightLabel); checkFraction(edit.rebase);
    if (state.measures.length >= 512 || new Set(edit.rightEventIds).size !== edit.rightEventIds.length) throw new RangeError("RECOVERY_SPLIT_INVALID");
    const events = [...measure.notes, ...measure.chords, ...measure.directions];
    if (edit.rightEventIds.some((id) => !events.some((n) => n.id === id))) throw new RangeError("RECOVERY_STABLE_TARGET_MISSING");
    const selected = (e: StructuralEvent) => edit.rightEventIds.includes(e.id);
    const shift = (e: StructuralEvent) => { const onset = sub(e.onset, edit.rebase); checkFraction(onset); return { ...e, onset }; };
    const base = { ...measure }; delete base.extent;
    const right: StructuralMeasure = { ...base, id: `inserted:${operationId}`, origin: measure.origin, label: edit.rightLabel, notes: measure.notes.filter(selected).map(shift), chords: measure.chords.filter(selected).map(shift), directions: measure.directions.filter(selected).map(shift) };
    const left: StructuralMeasure = { ...base, notes: measure.notes.filter((e) => !selected(e)), chords: measure.chords.filter((e) => !selected(e)), directions: measure.directions.filter((e) => !selected(e)), barlines: [] };
    return { ...state, measures: state.measures.flatMap((m) => m.id === measure.id ? [left, right] : [m]) };
  }
  const prior = [...measure.notes, ...measure.chords].find((e) => e.id === edit.eventId);
  if (edit.eventId && !prior) throw new RangeError("RECOVERY_STABLE_TARGET_MISSING");
  if (edit.kind === "remove") return replace({ ...measure, notes: measure.notes.filter((e) => e.id !== prior!.id), chords: measure.chords.filter((e) => e.id !== prior!.id) });
  if (edit.kind === "move") {
    checkFraction(edit.onset);
    if (!prior || !["note", "harmony"].includes(prior.node.name) || !state.measures.some((m) => m.id === edit.destinationId)) throw new RangeError("RECOVERY_MOVE_INVALID");
    if (prior.node.name === "note") checkVoice(edit.voice);
    const updated = { ...prior, onset: edit.onset, node: prior.node.name === "note" ? withVoice(prior.node, edit.voice) : prior.node };
    return { ...state, measures: state.measures.map((m) => ({ ...m,
      notes: [...m.notes.filter((e) => e.id !== prior.id), ...(m.id === edit.destinationId && prior.node.name === "note" ? [updated] : [])],
      chords: [...m.chords.filter((e) => e.id !== prior.id), ...(m.id === edit.destinationId && prior.node.name === "harmony" ? [updated] : [])],
    })) };
  }
  checkFraction(edit.onset);
  const newId = prior?.id ?? `inserted:${operationId}`;
  if (edit.kind === "note") {
    checkVoice(edit.voice); if (prior && prior.node.name !== "note") throw new RangeError("RECOVERY_TARGET_KIND_MISMATCH");
    const base = prior?.node ?? element("note", undefined, [element("rest"), element("duration", "64"), element("type", "quarter")]);
    const seed: StructuralMeasure = { ...measure, chords: [], directions: [], barlines: [], notes: [{ id: newId, origin: "inserted", onset: ZERO, node: without(base, ["chord"]) }] };
    const edited = recoveryXmlRoot(applyRecoveryXmlEdit(scoreXml([seed]), { kind: "note", part: 0, measure: 0, event: 0, value: edit.value }));
    const node = children(children(edited, "part")[0], "measure")[0];
    let n = without(children(node, "note")[0], ["voice"]);
    if (edit.removeNotations) {
      if (!Array.isArray(edit.removeNotations) || edit.removeNotations.some((name: string) => !["articulations", "arpeggiate", "slur"].includes(name))) throw new RangeError("RECOVERY_NOTATION_INVALID");
      n = { ...n, children: n.children.map((c) => c.kind === "element" && c.name === "notations" ? without(c, edit.removeNotations!) : c) };
    }
    const next: StructuralEvent = { id: newId, origin: prior?.origin ?? "inserted", onset: edit.onset, node: withVoice(n, edit.voice) };
    if (cmp(duration(next), recoveryDuration(edit.value.type, edit.value.dots))) throw new RangeError("RECOVERY_DURATION_INVALID");
    return replace({ ...measure, notes: prior ? measure.notes.map((e) => e.id === prior.id ? next : e) : [...measure.notes, next] });
  }
  if (prior && prior.node.name !== "harmony") throw new RangeError("RECOVERY_TARGET_KIND_MISMATCH");
  const edited = recoveryXmlRoot(applyRecoveryXmlEdit(scoreXml([{ ...measure, notes: [], chords: [], directions: [], barlines: [] }]), { kind: "chord", part: 0, measure: 0, event: 0, symbol: edit.symbol, onset: edit.onset }));
  const node = children(children(children(edited, "part")[0], "measure")[0], "harmony")[0];
  const next: StructuralEvent = { id: newId, origin: prior?.origin ?? "inserted", onset: edit.onset, node: without(node, ["offset"]) };
  return replace({ ...measure, chords: prior ? measure.chords.map((e) => e.id === prior.id ? next : e) : [...measure.chords, next] });
}
function changed(before: StructuralState, after: StructuralState) {
  const ids = new Set([...before.measures, ...after.measures].map((m) => m.id));
  const affectedIds = [...ids].filter((id) => canonicalJson(before.measures.find((m) => m.id === id) ?? null) !== canonicalJson(after.measures.find((m) => m.id === id) ?? null));
  return { affectedIds, before: canonicalJson(before.measures.filter((m) => affectedIds.includes(m.id))), after: canonicalJson(after.measures.filter((m) => affectedIds.includes(m.id))) };
}
export async function createStructuralRecovery(id: string, documents: StructuralRecovery["documents"]): Promise<StructuralRecovery> {
  await seedState(documents); return { version: "hm-structural-recovery-v1", id, documents: structuredClone(documents), operations: [], redo: [], coverage: [] };
}
const verified = new WeakMap<StructuralRecovery, { readonly serialized: string; readonly state: StructuralState }>();
export async function replayStructuralRecovery(value: StructuralRecovery): Promise<StructuralState> {
  const serialized = JSON.stringify(value);
  const cache = verified.get(value); if (cache?.serialized === serialized) return structuredClone(cache.state);
  if (value.version !== "hm-structural-recovery-v1" || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(value.id) || value.operations.length + value.redo.length > 1024 || serialized.length > 32_000_000) throw new RangeError("RECOVERY_STRUCTURE_HISTORY_INVALID");
  let state = await seedState(value.documents);
  const opIds = new Set<string>();
  for (const op of value.operations) {
    checkReference(op.sourceLocation);
    if (!/^[a-zA-Z0-9._:-]{1,128}$/u.test(op.id) || opIds.has(op.id) || !Number.isFinite(Date.parse(op.appliedAt)) || await structuralDigest(state) !== op.beforeDigest) throw new RangeError("RECOVERY_STRUCTURE_HISTORY_INVALID");
    opIds.add(op.id); const next = editState(state, op.edit, op.id);
    if (await structuralDigest(next) !== op.afterDigest || canonicalJson(changed(state, next)) !== canonicalJson({ affectedIds: op.affectedIds, before: op.before, after: op.after })) throw new RangeError("RECOVERY_STRUCTURE_HISTORY_INVALID");
    state = next;
  }
  verified.set(value, { serialized, state: structuredClone(state) }); return state;
}
export async function applyStructuralEdit(value: StructuralRecovery, expectedDigest: string, edit: StructuralEdit, sourceLocation: string, id: string, appliedAt: string): Promise<StructuralRecovery> {
  checkReference(sourceLocation);
  const state = await replayStructuralRecovery(value), beforeDigest = await structuralDigest(state);
  if (beforeDigest !== expectedDigest) throw new RangeError("RECOVERY_STALE_REVISION");
  if (value.operations.length >= 1024 || !Number.isFinite(Date.parse(appliedAt)) || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(id) || value.operations.some((o) => o.id === id)) throw new RangeError("RECOVERY_OPERATION_INVALID");
  const next = editState(state, edit, id);
  const result: StructuralRecovery = { ...value, operations: [...value.operations, { id, edit: structuredClone(edit), sourceLocation, appliedAt, beforeDigest, afterDigest: await structuralDigest(next), ...changed(state, next) }], redo: [], coverage: [] };
  if (JSON.stringify(result).length > 32_000_000) throw new RangeError("RECOVERY_COLLECTION_LIMIT");
  verified.set(result, { serialized: JSON.stringify(result), state: structuredClone(next) }); return result;
}
export function undoStructuralEdit(v: StructuralRecovery): StructuralRecovery { const op = v.operations.at(-1); return op ? { ...v, operations: v.operations.slice(0, -1), redo: [...v.redo, op], coverage: [] } : v; }
export async function redoStructuralEdit(v: StructuralRecovery): Promise<StructuralRecovery> {
  const op = v.redo.at(-1); if (!op) return v;
  const next = { ...v, operations: [...v.operations, op], redo: v.redo.slice(0, -1), coverage: [] };
  await replayStructuralRecovery(next); return next;
}
export async function attestStructuralMeasure(v: StructuralRecovery, coverage: StructuralCoverage): Promise<StructuralRecovery> {
  const state = await replayStructuralRecovery(v); checkReference(coverage.sourceLocation);
  if (coverage.revisionDigest !== await structuralDigest(state) || !state.measures.some((m) => m.id === coverage.measureId)
    || !Number.isSafeInteger(coverage.page) || coverage.page < 1 || !Number.isSafeInteger(coverage.system) || coverage.system < 1 || !coverage.printedLabel.trim()
    || !Number.isSafeInteger(coverage.chordCount) || coverage.chordCount < 0 || Object.entries(coverage.voiceCounts).some(([k, n]) => !k || !Number.isSafeInteger(n) || n < 1)) throw new RangeError("RECOVERY_COVERAGE_INVALID");
  const next = { ...v, coverage: [...v.coverage.filter((c) => c.measureId !== coverage.measureId), structuredClone(coverage)] };
  // Only the attestation changed. Reuse the verified musical state while the exact
  // serialized guard still detects caller mutation, including history tampering.
  verified.set(next, { serialized: JSON.stringify(next), state: structuredClone(state) });
  return next;
}
export async function validateStructuralRecovery(v: StructuralRecovery): Promise<{ readonly state: StructuralState; readonly digest: string; readonly issues: readonly string[]; readonly overfull: number }> {
  const state = await replayStructuralRecovery(v), digest = await structuralDigest(state), issues: string[] = [];
  const docIds = v.documents.map((d) => d.id);
  const inventory = state.inventory?.flatMap((s) => s.labels.map((label) => `${s.page}:${s.system}:${label}`));
  if (!inventory || inventory.length !== state.measures.length) issues.push("원본에서 센 전체 시스템·표기 마디 목록과 후보 개수 불일치/미확정");
  for (let i = 1; i < docIds.length; i++) if (!state.joins.includes(`${docIds[i - 1]}>${docIds[i]}`)) issues.push(`조각 연결 미확정: ${i} → ${i + 1}`);
  for (const [id, detail] of Object.entries(state.uncertainties)) issues.push(`원본 의미 미확정 ${id}: ${detail}`);
  const seenIds = new Set<string>(), seenSources = new Set<string>(); let overfull = 0, previousLocation = [0, 0];
  const voiceTail = new Map<string, { event: StructuralEvent; end: Fraction }>(); let absolute = ZERO;
  const openSlurs = new Map<string, string>();
  for (const [measureIndex, m] of state.measures.entries()) {
    const prefix = `마디 ${m.label}: `;
    if (!m.meter || m.fifths === undefined || !m.clef || !m.extent) issues.push(prefix + "박자·조성·실제 길이 문맥 미확정");
    const nominal = m.meter ? f(m.meter.numerator * 4, m.meter.denominator) : undefined;
    const extent = m.extent ?? nominal ?? ZERO;
    const counts: Record<string, number> = {};
    const lanes = new Map<string, StructuralEvent[]>();
    for (const e of [...m.notes, ...m.chords, ...m.directions]) { if (seenIds.has(e.id)) issues.push(prefix + "이벤트 중복"); seenIds.add(e.id); }
    if (nominal && m.notes.some((e) => cmp(add(e.onset, duration(e)), nominal) > 0)) overfull++;
    for (const e of m.notes) { const key = voice(e); counts[key] = (counts[key] ?? 0) + 1; lanes.set(key, [...(lanes.get(key) ?? []), e]); }
    if (!m.notes.length) issues.push(prefix + "이벤트 없음");
    for (const [key, events] of lanes) {
      let end = ZERO;
      for (const e of events.sort((a, b) => cmp(a.onset, b.onset))) {
        if (cmp(e.onset, end)) issues.push(prefix + `voice ${key} 시간축 ${cmp(e.onset, end) < 0 ? "겹침" : "공백"}`);
        end = add(e.onset, duration(e));
        const ties = children(e.node, "tie").map((t) => t.attributes.type);
        for (const slur of children(child(e.node, "notations") ?? element("notations"), "slur")) {
          const slurKey = `${key}:${slur.attributes.number ?? "1"}`, type = slur.attributes.type;
          if (type === "start") {
            if (openSlurs.has(slurKey)) issues.push(prefix + `voice ${key} 프레이즈선 시작 중복`);
            openSlurs.set(slurKey, m.id);
          } else if (type === "stop") {
            if (!openSlurs.delete(slurKey)) issues.push(prefix + `voice ${key} 프레이즈선 시작 누락`);
          } else if (type !== "continue" || !openSlurs.has(slurKey)) issues.push(prefix + `voice ${key} 프레이즈선 연결 미확정`);
        }
        const prior = voiceTail.get(key), priorTies = prior ? children(prior.event.node, "tie").map((t) => t.attributes.type) : [];
        if (ties.includes("stop") || priorTies.includes("start")) {
          const pitch = (n: StructuralEvent) => xml(child(n.node, "pitch") ?? child(n.node, "unpitched") ?? element("rest"));
          if (!ties.includes("stop") || !priorTies.includes("start") || !prior || cmp(prior.end, add(absolute, e.onset)) || pitch(prior.event) !== pitch(e)) issues.push(prefix + `voice ${key} 붙임줄 연결 불일치`);
        }
        voiceTail.set(key, { event: e, end: add(absolute, end) });
      }
      if (cmp(end, extent)) issues.push(prefix + `voice ${key} 실제 길이 불일치`);
    }
    if (m.extent && nominal && (cmp(m.extent, nominal) > 0 || (!m.implicit && cmp(m.extent, nominal)))) issues.push(prefix + "박자와 짧은 마디 표기 불일치");
    const chordTimes = new Set<string>();
    for (const c of m.chords) { const at = canonicalJson(c.onset); if (cmp(c.onset, extent) >= 0 || chordTimes.has(at)) issues.push(prefix + "코드 위치 범위/중복 오류"); chordTimes.add(at); }
    const coverage = v.coverage.find((c) => c.measureId === m.id);
    if (!coverage || coverage.revisionDigest !== digest || canonicalJson(coverage.voiceCounts) !== canonicalJson(counts) || coverage.chordCount !== m.chords.length) issues.push(prefix + "원본 성부·이벤트·코드 대조 필요");
    if (coverage) {
      const loc = `${coverage.page}:${coverage.system}:${coverage.printedLabel}`;
      if (inventory?.[measureIndex] !== loc) issues.push(prefix + "원본 전곡 목록과 대응 불일치");
      if (seenSources.has(loc) || coverage.page < previousLocation[0] || coverage.page === previousLocation[0] && coverage.system < previousLocation[1]) issues.push(prefix + "원본 대응 중복/순서 오류");
      seenSources.add(loc); previousLocation = [coverage.page, coverage.system];
    }
    absolute = add(absolute, extent);
  }
  for (const [key, tail] of voiceTail) if (children(tail.event.node, "tie").some((t) => t.attributes.type === "start")) issues.push(`voice ${key} 마지막 붙임줄 미연결`);
  for (const key of openSlurs.keys()) issues.push(`voice/slur ${key} 마지막 프레이즈선 미연결`);
  return { state, digest, issues: [...new Set(issues)], overfull };
}
export async function verifiedStructuralCandidate(v: StructuralRecovery): Promise<{ readonly xml: string; readonly proof: string }> {
  const result = await validateStructuralRecovery(v);
  if (result.issues.length) throw new RangeError("RECOVERY_STRUCTURE_UNRESOLVED");
  const candidate = structuralCandidateXml(result.state, v.documents[0].recovery.originalXml);
  return { xml: candidate, proof: JSON.stringify({ version: v.version, originalDigests: v.documents.map((d) => d.recovery.originalDigest), candidateDigest: await binaryDigest(enc.encode(candidate)), workspace: v }) };
}
