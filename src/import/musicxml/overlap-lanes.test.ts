import { describe, expect, it } from "vitest";
import { deriveQuickReview } from "../review/quick-review";
import { selectLeadCandidate } from "../review/commands";
import { importMusicXml } from "./parser";

const encoder = new TextEncoder();
const versions = {
  performanceExpanderVersion: "repeat-v1",
  chordTimelineResolverVersion: "chord-timeline-v1",
  sourceLeadAtomizerVersion: "source-lead-atomizer-v1",
} as const;

function score(withOverlap: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction><sound tempo="100"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      ${withOverlap ? "<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>" : ""}
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
}

async function draftFor(xml: string) {
  const result = await importMusicXml(encoder.encode(xml), {
    algorithmVersions: versions,
    identityFactory: () => "doc:overlap-lane-test",
  });
  expect(result.status).toBe("review-required");
  if (result.status !== "review-required") throw new Error("fixture import was blocked");
  return result.draft;
}

describe("MusicXML overlapping lead candidate lanes", () => {
  it("leaves an ordinary monophonic voice as one unchanged candidate", async () => {
    const draft = await draftFor(score(false));
    expect(draft.leadCandidates).toHaveLength(1);
    expect(draft.leadCandidates[0].noteCount).toBe(4);
    expect(draft.leadCandidates[0].key).not.toContain(":lane:");
  });

  it("preserves simultaneous notes as explicit candidate lanes instead of a blocked overlap", async () => {
    const draft = await draftFor(score(true));
    expect(draft.leadCandidates).toHaveLength(2);
    const base = draft.leadCandidates.find((candidate) => !candidate.key.includes(":lane:"));
    const overlap = draft.leadCandidates.find((candidate) => candidate.key.includes(":lane:"));
    expect(base?.noteCount).toBe(4);
    expect(overlap?.noteCount).toBe(1);
    expect(overlap?.displayPartName).toContain("겹침 lane 2");
    expect(base?.voiceKey).toBe("1");
    expect(overlap?.voiceKey).toBe("1");
    expect(draft.musicXmlIdentityInventory?.leadEvents.filter((item) => item.candidateKey === overlap?.key)).toHaveLength(1);

    if (!base) throw new Error("base lane missing");
    const review = await deriveQuickReview(selectLeadCandidate(draft, base.key), versions);
    expect(review.diagnostics.some((diagnostic) => diagnostic.code === "INPUT_EVENT_OVERLAP")).toBe(false);
  });
});
