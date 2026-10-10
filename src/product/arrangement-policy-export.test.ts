import { describe, expect, it } from "vitest";
import { parseChord } from "../domain/chord/parser";
import type { SemanticDigest } from "../domain/digest/canonical";
import { fraction } from "../domain/fraction";
import type { ArrangementRenderDocument } from "../domain/generation/model";
import { COMMON_TIME } from "../domain/meter";
import type { HarmonyProject } from "../domain/project";
import type { WorkspaceProjectionMetadata } from "../domain/source/model";
import { musicalRange } from "../domain/time";
import { createWagFixtureInput } from "../grammar/fixtures";
import { loadFrozenWagAuthority } from "../grammar/authority";
import { importMusicXml } from "../import/musicxml/parser";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../import/musicxml/types";
import { parseSafeXml, xmlChildren, xmlDescendants, xmlText } from "../import/musicxml/xml";
import { exportArrangementMusicXml } from "./musicxml-export";
import { materializePracticeShare } from "./practice-share";
import type { MaterializedArrangement } from "./render";
import { arrangementRenderDocumentToAbc } from "./score-adapter";

const digest = "0".repeat(64) as SemanticDigest;
const roles = { generatedTracks: [], byTrackPlanId: {} } as const;
const options = { title: "Policy pickup", key: { tonic: { step: "B", alter: -1 }, mode: "major" }, tempo: { beatUnit: 4, dotted: false, bpm: 62 } } as const;
const versions = { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } as const;

function pickupDocument(policy = true): ArrangementRenderDocument {
  const durations = [fraction(1, 2), fraction(4)];
  const measures = durations.map((duration, index) => ({
    occurrenceId: `pm:${index}:${index}:0`, sourceMeasureId: `sm:${index}`, sourceMeasureNumber: index + 1,
    occurrenceIndexForSource: 0, performanceIndex: index, time: COMMON_TIME, duration,
  }));
  const chord = parseChord("Bb");
  if (chord.status !== "ok") throw new Error("invalid fixture chord");
  const spans = measures.map((_, index) => ({
    id: `pcs:${index}`,
    range: musicalRange({ performanceMeasureIndex: index, offset: fraction(0) }, { performanceMeasureIndex: index + 1, offset: fraction(0) }, durations),
    parseResult: chord,
    origin: index === 0 && policy
      ? { kind: "arrangement-policy" as const, policy: "anticipate-first-chord" as const, followingSourceChordEventId: "ch:1" }
      : { kind: "source-event" as const, sourceChordEventId: `ch:${index}` },
  }));
  return {
    measures,
    sourceLeadTrack: { trackPlanId: "track:source-lead", atomizationDigest: digest, atoms: spans.map((span, index) => ({
      id: `ta:${index}`, sourceEventId: `le:${index}`, range: span.range,
      pitch: { step: index === 0 ? "F" as const : "B" as const, alter: index === 0 ? 0 as const : -1 as const, octave: 3 },
      tiedFromPrevious: false, tiedToNext: false, lyricTokenIds: [],
    })) },
    generatedHarmonyTracks: [],
    effectiveChordTimeline: {
      sourceChordProjectionDigest: digest, performanceSequenceDigest: digest,
      resolutionPolicy: { gapPolicy: "carry-until-next", ...(policy ? { initialPickup: "anticipate-first-chord" as const } : {}) },
      chordTimelineResolverVersion: "chord-timeline-v1", spans, digest,
    },
    lyricTokens: [],
  };
}

function parsedXml(encoded: string) {
  const parsed = parseSafeXml(new TextEncoder().encode(encoded), DEFAULT_IMPORT_SECURITY_LIMITS);
  if (parsed.status !== "complete") throw new Error("exported XML rejected");
  return parsed.root;
}

async function shareFixture() {
  const input = await createWagFixtureInput({ maxHarmonyTracks: 0 });
  const source = { ...input.source, rights: { ...input.source.rights, allowedUses: ["generation", "share"] as const } };
  const project: HarmonyProject = {
    schemaVersion: 9, source,
    chordTimelineState: { status: "resolved", timeline: input.effectiveChordTimeline, diagnostics: [] },
    sourceLeadAtomizationState: { status: "resolved", atomization: input.sourceLeadAtomization, diagnostics: [] },
    presetProfiles: (await loadFrozenWagAuthority()).presetProfiles,
    performers: input.performers, trackPlans: input.trackPlans, assignments: input.assignments,
    settings: { mode: input.effectiveConfig.mode, requestedPresetIds: ["standard"], userCaps: input.userCaps },
    locksByPreset: {}, variants: {}, selectedPresetId: "standard",
  };
  const materialized: MaterializedArrangement = {
    document: {
      measures: source.performanceSequence.occurrences,
      sourceLeadTrack: { trackPlanId: "track:source-lead", atomizationDigest: input.sourceLeadAtomization.digest, atoms: input.sourceLeadAtomization.atoms },
      generatedHarmonyTracks: [], effectiveChordTimeline: input.effectiveChordTimeline,
      lyricTokens: source.sourceMeasures.flatMap((measure) => measure.lyricTokens),
    },
    artifactDigest: digest, artifactKind: "candidate", validity: "valid", trackRoles: roles,
  };
  return { project, presetId: "standard" as const, materialized };
}

describe("arrangement pickup policy export boundaries", () => {
  it("keeps the anticipated chord out of original MusicXML harmony and preserves its explicit provenance", () => {
    const document = pickupDocument();
    const before = structuredClone(document);
    const encoded = exportArrangementMusicXml(document, roles, options);
    const root = parsedXml(encoded);
    const measures = xmlDescendants(root, "measure");
    expect(xmlDescendants(measures[0], "harmony")).toHaveLength(0);
    expect(xmlDescendants(measures[1], "harmony")).toHaveLength(1);
    expect(xmlDescendants(measures[0], "words").map(xmlText)).toEqual(["Bb (편곡 정책: 첫 코드 선행 적용)"]);
    const field = xmlDescendants(root, "miscellaneous-field").find((item) => item.attributes.name === "harmonymaker-arrangement-chord-policy");
    expect(JSON.parse(xmlText(field)!)).toEqual({
      version: "hm-arrangement-chord-policy-v1", resolutionPolicy: document.effectiveChordTimeline.resolutionPolicy,
      spans: [{ id: "pcs:0", range: document.effectiveChordTimeline.spans[0].range, symbol: "Bb", origin: document.effectiveChordTimeline.spans[0].origin }],
    });
    expect(document).toEqual(before);
  });

  it("shows a policy label only on the interpreted span in the score", () => {
    const abc = arrangementRenderDocumentToAbc(pickupDocument(), roles, options);
    expect(abc).toContain('"Bb (편곡 정책)"');
    expect(abc.match(/편곡 정책/gu)).toHaveLength(1);
    expect(abc).toContain('"Bb"');
    expect(abc).toContain("F,2");
    expect(abc).not.toContain("=F,2");
  });

  it("combines export selection and policy metadata without exposing workspace proof", () => {
    const projection: WorkspaceProjectionMetadata = {
      version: "hm-workspace-projection-v1", originKind: "local-omr", workspaceId: "ws:synthetic", workspaceRevision: 9,
      workspaceDigest: digest, evidenceDigest: digest, requestDigest: digest, initialSourceDigest: digest,
      selectedVoices: ["voice:1"], excludedVoices: ["voice:2"], targetMap: [], proof: "private-proof-do-not-export",
    };
    const encoded = exportArrangementMusicXml(pickupDocument(), roles, { ...options, workspaceProjection: projection });
    const root = parsedXml(encoded);
    expect(xmlDescendants(root, "miscellaneous")).toHaveLength(1);
    expect(xmlDescendants(root, "miscellaneous-field").map((field) => field.attributes.name)).toEqual([
      "harmonymaker-workspace-projection", "harmonymaker-arrangement-chord-policy",
    ]);
    expect(encoded).not.toContain(projection.proof);
    expect(encoded).not.toContain("targetMap");
  });

  it("leaves ordinary chord export and score annotation unchanged when the policy is absent", () => {
    const document = pickupDocument(false);
    const encoded = exportArrangementMusicXml(document, roles, options);
    const root = parsedXml(encoded);
    expect(xmlDescendants(root, "harmony")).toHaveLength(2);
    expect(xmlChildren(root, "identification")).toHaveLength(0);
    expect(encoded).not.toContain("harmonymaker-arrangement-chord-policy");
    expect(encoded).not.toContain("편곡 정책");
    expect(arrangementRenderDocumentToAbc(document, roles, options)).not.toContain("편곡 정책");
  });

  it.each(["missing-option", "missing-span"] as const)("refuses %s instead of silently losing policy identity", (caseName) => {
    const document = pickupDocument();
    const timeline = document.effectiveChordTimeline;
    const inconsistent = { ...document, effectiveChordTimeline: caseName === "missing-option"
      ? { ...timeline, resolutionPolicy: { gapPolicy: "carry-until-next" as const } }
      : { ...timeline, spans: timeline.spans.map((span) => ({ ...span, origin: { kind: "source-event" as const, sourceChordEventId: "ch:1" } })) } };
    expect(() => exportArrangementMusicXml(inconsistent, roles, options)).toThrow("MUSICXML_ARRANGEMENT_POLICY_INCONSISTENT");
  });

  it("reimports a policy export with the pickup chord still absent from original chord events", async () => {
    const imported = await importMusicXml(new TextEncoder().encode(exportArrangementMusicXml(pickupDocument(), roles, options)), {
      algorithmVersions: versions, identityFactory: () => "doc:policy-export-roundtrip",
    });
    expect(imported.status).toBe("review-required");
    if (imported.status !== "review-required") throw new Error("policy export reimport rejected");
    const measures = imported.draft.parts[0].measures;
    expect(measures.map((measure) => measure.chords.length)).toEqual([0, 1]);
    expect(imported.draft.importedArrangementChordPolicy?.resolutionPolicy.initialPickup).toBe("anticipate-first-chord");
    expect(imported.draft.importedArrangementChordPolicy?.spans[0].origin.followingSourceChordEventId).toBe("ch:1");
    expect(imported.draft.chordResolutionPolicy?.initialPickup).toBeUndefined();
    expect(measures.map((measure) => measure.duration)).toEqual([fraction(1, 2), fraction(4)]);
    expect(measures.flatMap((measure) => measure.leadEvents).map((event) => event.kind === "note" ? event.pitch : null)).toEqual([
      { step: "F", alter: 0, octave: 3 }, { step: "B", alter: -1, octave: 3 },
    ]);
  });

  it.each(["document-option", "span-origin", "project-option"] as const)("refuses compact share when %s would lose policy authority", async (caseName) => {
    const fixture = await shareFixture();
    const timeline = fixture.materialized.document.effectiveChordTimeline;
    const policyTimeline = { ...timeline, resolutionPolicy: { ...timeline.resolutionPolicy, initialPickup: "anticipate-first-chord" as const } };
    const materialized = caseName === "project-option" ? fixture.materialized : {
      ...fixture.materialized,
      document: { ...fixture.materialized.document, effectiveChordTimeline: caseName === "document-option" ? policyTimeline : {
        ...timeline, spans: timeline.spans.map((span) => ({ ...span, origin: { kind: "arrangement-policy" as const, policy: "anticipate-first-chord" as const, followingSourceChordEventId: "ch:following" } })),
      } },
    };
    const project = caseName === "project-option" ? { ...fixture.project, chordTimelineState: { status: "resolved" as const, timeline: policyTimeline, diagnostics: [] } } : fixture.project;
    expect(() => materializePracticeShare({ ...fixture, project, materialized })).toThrow("SHARE_ARRANGEMENT_CHORD_POLICY_UNSUPPORTED");
  });

  it("continues to materialize the existing compact share for an ordinary fixture", async () => {
    const fixture = await shareFixture();
    const payload = materializePracticeShare(fixture);
    expect(payload.schemaVersion).toBe(4);
    expect(payload.chords).toBeDefined();
    if (!payload.chords) throw new Error("ordinary fixture chord payload missing");
    expect(payload.chords[0].kind).toBe("chord");
    expect(payload.arrangement.tracks).toHaveLength(1);
  });
});
