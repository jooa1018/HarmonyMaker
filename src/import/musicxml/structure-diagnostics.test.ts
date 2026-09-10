import { afterEach, describe, expect, it, vi } from "vitest";
import { importMusicXml } from "./parser-core";
import * as xml from "./xml";

const options = {
  identityFactory: () => "doc:structural-regression",
  algorithmVersions: { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" },
};
// Self-authored structural fixtures; no user score content.
const attributes = '<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const note = (duration: number, voice = 1) => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice></note>`;
const score = (measures: string) => new TextEncoder().encode(`<score-partwise><part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`);
afterEach(() => vi.restoreAllMocks());

describe("MusicXML structural failure boundary", () => {
  it.each([4, 12, 480])("preserves beam-duration evidence without silently repairing it, divisions %s", async (divisions) => {
    const make = (overfull: boolean) => {
      // Same causal structure, self-authored pitches and moved measure number.
      const durations = [0.5, 0.5, 0.5, 0.5, overfull ? 1 : 0.25, overfull ? 1.5 : 0.75, 0.5, 0.5];
      const notes = durations.map((duration, i) => `<note><pitch><step>F</step><octave>4</octave></pitch><duration>${duration * divisions}</duration><voice>2</voice><type>${i === 4 ? (overfull ? "quarter" : "16th") : i === 5 ? (overfull ? "quarter" : "eighth") : "eighth"}</type>${i === 5 ? "<dot/>" : ""}</note>`).join("");
      return score(`<measure number="32"><attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure>`);
    };
    const valid = await importMusicXml(make(false), options);
    expect(valid.status).toBe("review-required");
    if (valid.status === "review-required") {
      expect(valid.draft.parts[0].measures[0].leadEvents).toHaveLength(8);
    }
    const contradictory = await importMusicXml(make(true), options);
    expect(contradictory.status).toBe("blocked");
    expect(contradictory.diagnostics[0].details).toMatchObject({ measureNumber: 32, maximum: "11/2", meterDuration: "4/1" });
  });

  it("locates an overfull measure without truncating or inventing timing", async () => {
    const result = await importMusicXml(score(`<measure number="0" implicit="yes">${attributes}${note(1)}</measure><measure number="1">${note(4)}${note(7)}</measure>`), options);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics[0]).toMatchObject({ code: "IMPORT_CORRUPT_XML", details: {
      reason: "MusicXML cursor exceeds measure duration", partOrdinal: 0, measureOrdinal: 1, measureNumber: 1,
      maximum: "11/2", meterDuration: "4/1", element: "measure",
    } });
    expect(result.diagnostics[0].messageKo).toContain("박자 길이를 넘습니다");
  });

  it("preserves a pickup, two voices with backup, and a later meter change", async () => {
    const result = await importMusicXml(score(`<measure number="0" implicit="yes">${attributes}${note(1)}</measure><measure number="1">${note(8)}<backup><duration>8</duration></backup>${note(8, 2)}</measure><measure number="2"><attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>${note(4)}</measure>`), options);
    expect(result.status).toBe("review-required");
    if (result.status !== "review-required") return;
    expect(result.draft.parts[0].measures.map(m => m.leadEvents.length)).toEqual([1, 2, 1]);
    expect(result.draft.parts[0].measures[1].leadEvents.map(n => n.onset)).toEqual([{ n: 0, d: 1 }, { n: 0, d: 1 }]);
  });

  it.each([
    ['<backup><duration>1</duration></backup>', "MusicXML backup moved before measure start"],
    [note(0), "invalid MusicXML duration/divisions"],
    ['<note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>', "MusicXML chord member has no preceding note"],
  ])("keeps invalid structure blocked and located: %s", async (body, reason) => {
    const result = await importMusicXml(score(`<measure number="7">${attributes}${body}</measure>`), options);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics[0].details).toMatchObject({ reason, partOrdinal: 0, measureOrdinal: 0, measureNumber: 7 });
  });

  it("does not publish arbitrary exceptions as corrupt-XML diagnostics", async () => {
    vi.spyOn(xml, "xmlChildren").mockImplementation(() => { throw new Error("private runtime detail"); });
    await expect(importMusicXml(score(`<measure number="1">${attributes}${note(8)}</measure>`), options)).rejects.toThrow("private runtime detail");
  });
});
