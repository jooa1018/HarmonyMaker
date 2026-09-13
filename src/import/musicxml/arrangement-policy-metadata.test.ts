import { describe, expect, it } from "vitest";
import { importMusicXml } from "./parser";

// Independent public XML. Metadata is export evidence and never an import request.
function metadata() {
  return {
    version: "hm-arrangement-chord-policy-v1",
    resolutionPolicy: { gapPolicy: "carry-until-next", initialPickup: "anticipate-first-chord" },
    spans: [{ id: "pcs:public",
      range: { start: { performanceMeasureIndex: 0, offset: { n: 0, d: 1 } }, end: { performanceMeasureIndex: 1, offset: { n: 0, d: 1 } } },
      symbol: "Bb",
      origin: { kind: "arrangement-policy", policy: "anticipate-first-chord", followingSourceChordEventId: "ch:public:following" },
    }],
  };
}

async function importFields(fields: readonly string[]) {
  const escapedFields = fields.map((field) => `<miscellaneous-field name="harmonymaker-arrangement-chord-policy">${field.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</miscellaneous-field>`).join("");
  const xml = `<score-partwise version="4.0"><identification><miscellaneous>${escapedFields}</miscellaneous></identification><part-list><score-part id="P1"><part-name>Public melody</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure></part></score-partwise>`;
  return importMusicXml(new TextEncoder().encode(xml), {
    identityFactory: () => "doc:public-policy-metadata",
    algorithmVersions: { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" },
  });
}

async function expectBlocked(fields: readonly string[]) {
  const imported = await importFields(fields);
  expect(imported.status).toBe("blocked");
  if (imported.status !== "blocked") throw new Error("Malformed metadata unexpectedly imported");
  expect(imported.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
    code: "IMPORT_CORRUPT_XML", severity: "blocking", details: { issue: "arrangement-policy-metadata-invalid" },
  })]));
  expect(imported).not.toHaveProperty("draft");
}

describe("MusicXML arrangement policy metadata boundary", () => {
  it("preserves valid metadata as evidence without inserting a chord or choosing a policy", async () => {
    const imported = await importFields([JSON.stringify(metadata())]);
    expect(imported.status).toBe("review-required");
    if (imported.status !== "review-required") throw new Error("Valid public XML did not reach review");
    expect(imported.draft.importedArrangementChordPolicy).toEqual(metadata());
    expect(imported.draft.chordResolutionPolicy).toBeUndefined();
    expect(imported.draft.parts[0].measures[0].chords).toEqual([]);
  });

  it("blocks malformed policy JSON with an explicit metadata diagnostic", async () => {
    await expectBlocked(["{"]);
  });

  it.each([
    { label: "array", gapPolicy: ["carry-until-next"] },
    { label: "object", gapPolicy: { value: "carry-until-next" } },
  ])("blocks a $label gapPolicy through actual XML import", async ({ gapPolicy }) => {
    const value = metadata();
    await expectBlocked([JSON.stringify({ ...value, resolutionPolicy: { ...value.resolutionPolicy, gapPolicy } })]);
  });

  it("blocks duplicate named XML fields even when their metadata values are identical", async () => {
    const encoded = JSON.stringify(metadata());
    await expectBlocked([encoded, encoded]);
  });

  it("blocks an unsupported policy version without relabeling it as original harmony", async () => {
    await expectBlocked([JSON.stringify({ ...metadata(), version: "hm-arrangement-chord-policy-v2" })]);
  });
});
