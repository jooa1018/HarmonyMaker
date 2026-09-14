import { inspectRecoveryXml, recoveryXmlRoot } from "../../import/review/recovery";
import { parseSafeXml, xmlChild, xmlChildren, type XmlChild, type XmlElement } from "../../import/musicxml/xml";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../../import/musicxml/types";

interface Change {
  readonly feature: string; readonly eventIds?: readonly string[]; readonly measureId?: string;
  readonly before: unknown; readonly after: string; readonly onset?: string;
  readonly ruleVersion?: string;
}
const fail = (): never => { throw new RangeError("LOCAL_CANDIDATE_TRANSITION_INVALID"); };
function shape(node: XmlChild): unknown {
  if (node.kind === "text") return node.value;
  return [node.name, Object.entries(node.attributes).sort(([a], [b]) => a.localeCompare(b)),
    node.children.filter((c) => c.kind !== "text" || c.value.trim()).map(shape)];
}
const key = (n: XmlChild): string => JSON.stringify(shape(n));
function parse(text: unknown): XmlElement {
  if (typeof text !== "string") return fail();
  const result = parseSafeXml(new TextEncoder().encode(text), DEFAULT_IMPORT_SECURITY_LIMITS);
  return result.status === "complete" ? result.root : fail();
}
const fractionValue = (s: string) => { const [n, d = "1"] = s.split("/"); return Number(n) / Number(d); };
const timelineVersions = new Set(["hm-automatic-timeline-v1", "hm-automatic-timeline-v1.1"]);

/** Verify the sidecar describes the actual A→C changes, not a different XML with matching counts. */
export function validateCandidateTransitions(rawXml: string, candidateXml: string, changes: readonly Change[]): void {
  const raw = recoveryXmlRoot(rawXml), candidate = recoveryXmlRoot(candidateXml);
  const oldMeasures = xmlChildren(raw, "part").flatMap((p, pi) => xmlChildren(p, "measure").map((m, mi) => ({ m, id: `p${pi}m${mi}` })));
  const newMeasures = xmlChildren(candidate, "part").flatMap((p) => xmlChildren(p, "measure"));
  const inspectedOld = inspectRecoveryXml(rawXml), inspectedNew = inspectRecoveryXml(candidateXml);
  const notes = new Map<string, XmlElement>(), meters = new Map<string, XmlElement[]>();
  const attributes = new Map(oldMeasures.map(({m, id}) => [id, { ...m.attributes }]));
  const harmonies = new Map<string, { node: XmlElement; at: number }[]>();
  for (const [{ m, id }, inspected] of oldMeasures.map((m, i) => [m, inspectedOld[i]] as const)) {
    xmlChildren(m, "note").forEach((n, i) => notes.set(`d0${id}n${i}`, n));
    meters.set(id, xmlChildren(m, "attributes").flatMap((a) => xmlChildren(a, "time")));
    harmonies.set(id, xmlChildren(m, "harmony").map((n, i) => ({ node: n, at: fractionValue(inspected.chords[i].onset) })));
  }
  for (const change of changes) {
    const after = parse(change.after);
    if (change.feature === "lyric" || change.feature === "rhythm-slash") {
      if (change.eventIds?.length !== 1) fail();
      const id = change.eventIds![0], before = notes.get(id);
      if (!before) fail();
      if (change.feature === "lyric") {
        if (change.before !== null || after.name !== "lyric" || xmlChildren(before!, "lyric").length) fail();
        notes.set(id, { ...before!, children: [...before!.children, after] });
      } else {
        if (after.name !== "note" || key(parse(change.before)) !== key(before!)) fail();
        notes.set(id, after);
      }
    } else if (change.feature === "meter") {
      const before = meters.get(change.measureId ?? "");
      if (!before || after.name !== "time" || !Array.isArray(change.before)
        || JSON.stringify(change.before.map((s) => key(parse(s)))) !== JSON.stringify(before.map(key))) fail();
      meters.set(change.measureId!, [after]);
    } else if (change.feature === "timeline-extent") {
      const before = attributes.get(change.measureId ?? "");
      // Narrow additive contract: only the ordinary MusicXML implicit flag.
      // This attests a replayable transformation, never musical correctness.
      if (!before || !timelineVersions.has(change.ruleVersion ?? "")
        || change.before !== (before.implicit ?? null)
        || after.name !== "implicit" || after.attributes.value !== "yes"
        || Object.keys(after.attributes).length !== 1 || after.children.some((c) => c.kind !== "text" || c.value.trim())) fail();
      attributes.set(change.measureId!, { ...before!, implicit: "yes" });
    } else if (change.feature === "chord") {
      const before = harmonies.get(change.measureId ?? "");
      if (!before || after.name !== "harmony" || change.before !== null || typeof change.onset !== "string") fail();
      before!.push({ node: after, at: fractionValue(change.onset!) });
    } else fail();
  }
  for (const [{ m, id }, index] of oldMeasures.map((m, i) => [m, i] as const)) {
    const current = newMeasures[index];
    if (!current || JSON.stringify(Object.entries(current.attributes).sort()) !== JSON.stringify(Object.entries(attributes.get(id)!).sort())) fail();
    const actualNotes = xmlChildren(current, "note");
    if (actualNotes.some((n, i) => key(n) !== key(notes.get(`d0${id}n${i}`)!))) fail();
    const actualMeters = xmlChildren(current, "attributes").flatMap((a) => xmlChildren(a, "time"));
    if (JSON.stringify(actualMeters.map(key)) !== JSON.stringify(meters.get(id)!.map(key))) fail();
    const chordKey = (n: XmlElement, at: number) => JSON.stringify([key(n), at]);
    const actualChords = xmlChildren(current, "harmony").map((n, i) => chordKey(n, fractionValue(inspectedNew[index].chords[i].onset))).sort();
    if (JSON.stringify(actualChords) !== JSON.stringify(harmonies.get(id)!.map((h) => chordKey(h.node, h.at)).sort())) fail();
    const other = (measure: XmlElement) => measure.children.flatMap((c) => {
      if (c.kind === "text") return c.value.trim() ? [key(c)] : [];
      if (["note", "harmony"].includes(c.name)) return [];
      if (c.name === "attributes") return c.children.filter((a) => a.kind === "element" && a.name !== "time").map(key);
      return [key(c)];
    });
    if (JSON.stringify(other(m)) !== JSON.stringify(other(current))) fail();
  }
  // The only permitted metadata addition is the prototype's unverified-candidate notice.
  const header = (root: XmlElement) => root.children.filter((n) => n.kind === "element" && n.name !== "part").map((node) => {
    if (node.kind !== "element" || node.name !== "identification") return node;
    return { ...node, children: node.children.filter((n) => !(n.kind === "element" && n.name === "miscellaneous"
      && xmlChildren(n, "miscellaneous-field").length === 1
      && xmlChild(n, "miscellaneous-field")?.attributes.name === "harmonymaker-local-candidate")) };
  }).map(key);
  if (JSON.stringify(header(raw)) !== JSON.stringify(header(candidate))) fail();
}
