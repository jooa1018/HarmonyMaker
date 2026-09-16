import { describe, expect, it } from "vitest";
import { beforeEndingStructure, type StructureChange } from "./ending-structure-transitions";
import { validateCandidateTransitions } from "./local-candidate-transitions";
const lyric = '<lyric number="1"><text>kept</text></lyric>';
const note = `<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff>${lyric}</note>`;
const attrs = '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const before = `<measure number="arbitrary">${attrs}${note}</measure>`;
const appended = '<note><rest/><duration>1</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>';
const after = `<measure number="arbitrary">${attrs}${note}<backup><duration>2</duration></backup>${appended}</measure>`;
const wrap = (m: string) => `<score-partwise><part-list/><part id="unrelated">${m}</part></score-partwise>`;
const patch: StructureChange = { feature: "ending-structure", ruleVersion: "hm-ending-structure-recovery-v1", measureId: "p0m0", before, after,
  eventIds: ["d0p0m0n0"], deletedEventIds: [], lineage: [
    { afterEventId: "d0p0m0n0", beforeEventIds: ["d0p0m0n0"], operation: "preserved", sourceGlyphIds: [] },
    { afterEventId: "d0p0m0n1", beforeEventIds: [], operation: "inserted", sourceGlyphIds: ["pixel-independent-rest"], sourceBox: [1,2,3,4] },
  ] };
describe("automatic structure replay boundary", () => {
  it("checks the old full pipeline before accepting appended source events", () => {
    expect(() => validateCandidateTransitions(wrap(before), wrap(after), [patch as Parameters<typeof validateCandidateTransitions>[2][number]])).not.toThrow();
    expect(beforeEndingStructure(wrap(after), [patch])).not.toContain("<backup>");
    expect(() => validateCandidateTransitions(wrap(before.replace("D</step>", "F</step>")), wrap(after), [patch as Parameters<typeof validateCandidateTransitions>[2][number]])).toThrow();
  });
  it.each(["version", "candidate", "before-id", "after-id", "glyph", "deletion", "ordering", "negative-clock"])("rejects broken %s even if someone reseals a file", (kind) => {
    const p = structuredClone(patch) as { -readonly [K in keyof StructureChange]: StructureChange[K] };
    let candidate = wrap(after), changes = [p];
    if (kind === "version") p.ruleVersion = "unknown";
    if (kind === "candidate") candidate = candidate.replace("D</step>", "F</step>");
    if (kind === "before-id") p.lineage = [{ ...p.lineage![0], beforeEventIds: ["d0p0m0n99"] }, p.lineage![1]];
    if (kind === "after-id") p.lineage = [p.lineage![0], { ...p.lineage![1], afterEventId: "other" }];
    if (kind === "glyph") p.lineage = [p.lineage![0], { ...p.lineage![1], sourceGlyphIds: [] }];
    if (kind === "deletion") p.deletedEventIds = ["d0p0m0n0"];
    if (kind === "ordering") changes = [p, { ...p, feature: "chord" }];
    if (kind === "negative-clock") { p.after = after.replace('<backup><duration>2', '<backup><duration>3'); candidate = wrap(p.after as string); }
    expect(() => beforeEndingStructure(candidate, changes)).toThrow();
  });
  it.each(["lyrics", "harmony", "meter", "articulation", "pitched-insertion"])("does not grant authority to change %s", (kind) => {
    let changed = after;
    if (kind === "lyrics") changed = changed.replace("kept", "lost");
    if (kind === "harmony") changed = changed.replace("</attributes>", "</attributes><harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>");
    if (kind === "meter") changed = changed.replace("<beats>4", "<beats>3");
    if (kind === "articulation") changed = changed.replace(lyric, `<notations><articulations><accent/></articulations></notations>${lyric}`);
    if (kind === "pitched-insertion") changed = changed.replace("<rest/>", "<pitch><step>C</step><octave>4</octave></pitch>");
    const p = { ...patch, after: changed, lineage: [{ ...patch.lineage![0], operation: "modified" }, patch.lineage![1]] };
    expect(() => beforeEndingStructure(wrap(changed), [p])).toThrow();
  });
});
