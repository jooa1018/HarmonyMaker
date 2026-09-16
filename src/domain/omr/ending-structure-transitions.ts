import { inspectRecoveryXml, recoveryXmlRoot, serializeRecoveryXml } from "../../import/review/recovery";
import { parseSafeXml, xmlChildren, type XmlChild, type XmlElement } from "../../import/musicxml/xml";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../../import/musicxml/types";

export interface StructureChange {
  readonly feature: string; readonly ruleVersion?: string; readonly measureId?: string;
  readonly before: unknown; readonly after: unknown; readonly eventIds?: readonly string[];
  readonly lineage?: readonly { afterEventId: string; beforeEventIds: readonly string[]; operation: string;
    sourceGlyphIds: readonly string[]; sourceBox?: readonly number[] }[];
  readonly deletedEventIds?: readonly string[];
}
const fail = (): never => { throw new RangeError("LOCAL_CANDIDATE_STRUCTURE_INVALID"); };
function shape(n: XmlChild): unknown {
  return n.kind === "text" ? n.value : [n.name, Object.entries(n.attributes).sort(),
    n.children.filter(c => c.kind !== "text" || c.value.trim()).map(shape)];
}
const key = (n: XmlChild): string => JSON.stringify(shape(n));
function measure(text: unknown): XmlElement {
  if (typeof text !== "string") return fail();
  const p = parseSafeXml(new TextEncoder().encode(text), DEFAULT_IMPORT_SECURITY_LIMITS);
  return p.status === "complete" && p.root.name === "measure" ? p.root : fail();
}
const structural = new Set(["pitch", "unpitched", "rest", "duration", "voice", "type", "dot", "chord", "accidental", "notehead", "tie", "stem", "beam"]);
function protectedNote(n: XmlElement): string {
  return key({ ...n, children: n.children.flatMap((c): XmlChild[] => {
    if (c.kind === "text") return c.value.trim() ? [c] : [];
    if (structural.has(c.name)) return [];
    if (c.name !== "notations") return [c];
    const children = c.children.flatMap((v): XmlChild[] => {
      if (v.kind === "text") return v.value.trim() ? [v] : [];
      if (["tie", "tied", "slur"].includes(v.name)) return [];
      if (v.name !== "ornaments") return [v];
      const keep = v.children.filter(x => x.kind === "element" && x.name !== "trill-mark");
      return keep.length ? [{ ...v, children: keep }] : [];
    });
    return children.length ? [{ ...c, children }] : [];
  }) });
}

/** Reverse an exact append-only structural suffix before checking all older
 * transformations. This is replay integrity, never a musical/user approval. */
export function beforeEndingStructure(xml: string, changes: readonly StructureChange[]): string {
  const patches = changes.filter(c => c.feature === "ending-structure");
  if (!patches.length) return xml;
  if (changes.slice(changes.indexOf(patches[0])).some(c => c.feature !== "ending-structure")) fail();
  const tree = recoveryXmlRoot(xml), replacements = new Map<XmlElement, XmlElement>(), seen = new Set<string>();
  const measures = new Map<string, XmlElement>(xmlChildren(tree, "part").flatMap((p, pi) => xmlChildren(p, "measure").map((m, mi) => [`p${pi}m${mi}`, m] as const)));
  for (const patch of patches) {
    const id = patch.measureId ?? "", current = measures.get(id);
    if (!current || seen.has(id) || patch.ruleVersion !== "hm-ending-structure-recovery-v1"
      || !Array.isArray(patch.deletedEventIds) || patch.deletedEventIds.length) fail();
    seen.add(id);
    const before = measure(patch.before), after = measure(patch.after);
    if (key(current!) !== key(after)) fail();
    const fixed = (m: XmlElement) => key({ ...m, children: m.children.filter(c => c.kind === "element" && !["note", "backup", "forward"].includes(c.name)) });
    if (fixed(before) !== fixed(after)) fail();
    const old = xmlChildren(before, "note"), next = xmlChildren(after, "note"), lineage = patch.lineage;
    if (next.length < old.length || next.length > old.length + 2 || !Array.isArray(lineage) || lineage.length !== next.length
      || JSON.stringify(patch.eventIds) !== JSON.stringify(old.map((_, i) => `d0${id}n${i}`))) fail();
    for (const [i, note] of next.entries()) {
      const row = lineage![i], eventId = `d0${id}n${i}`, inserted = i >= old.length;
      if (!row || row.afterEventId !== eventId || !Array.isArray(row.sourceGlyphIds)
        || JSON.stringify(row.beforeEventIds) !== JSON.stringify(inserted ? [] : [eventId])) fail();
      if (inserted) {
        if (row.operation !== "inserted" || !row.sourceGlyphIds.length || !row.sourceBox
          || xmlChildren(note, "lyric").length || xmlChildren(note, "pitch").length
          || !["rest", "unpitched"].some(name => xmlChildren(note, name).length === 1)) fail();
      } else if (row.operation === "preserved") {
        if (key(old[i]) !== key(note)) fail();
      } else if (row.operation !== "modified" || protectedNote(old[i]) !== protectedNote(note)) fail();
    }
    replacements.set(current!, before);
  }
  const reversed: XmlElement = { ...tree, children: tree.children.map(p => p.kind === "element" && p.name === "part"
    ? { ...p, children: p.children.map(m => m.kind === "element" ? replacements.get(m) ?? m : m) } : p) };
  const previous = serializeRecoveryXml(reversed), a = inspectRecoveryXml(previous), b = inspectRecoveryXml(xml);
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i].chords) !== JSON.stringify(b[i].chords)) fail();
    for (const n of b[i].notes) if (!Number.isFinite(Number(n.onset)) || Number(n.onset) < 0
      || !Number.isFinite(Number(n.duration)) || Number(n.duration) <= 0 || n.kind === "unresolved") fail();
  }
  return previous;
}
