import { describe, expect, it } from "vitest";
import { compareFractions, fraction } from "../../domain/fraction";
import { isSongSourceDocument } from "../../domain/source/validation";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import { confirmChord, confirmRights, confirmSection, selectLeadCandidate, setPerformerRange } from "../review/commands";
import { deriveQuickReview } from "../review/quick-review";
import { createProjectFromQuickReview, generateProjectVariant } from "../../product/workspace";
import { materializeActiveArrangement } from "../../product/render";
import { exportHarmonyProject, importHarmonyProject } from "../../product/project-transfer";
import { exportArrangementMusicXml } from "../../product/musicxml-export";
import { arrangementRenderDocumentToAbc } from "../../product/score-adapter";
import { buildPlaybackPlan } from "../../product/playback-plan";
import { confirmShareRights, materializePracticeShare } from "../../product/practice-share";
import { practiceShareToRenderDocument } from "../../product/shared-practice";
import { importMusicXml } from "./parser";
import { DEFAULT_IMPORT_SECURITY_LIMITS, type MusicXmlImportDraft } from "./types";
import { parseSafeXml, xmlChild, xmlChildren } from "./xml";
import { createImportRecovery, inspectRecoveryXml, applyRecoveryEdit } from "../review/recovery";
import { validateRuntimeOmrReadiness } from "../../domain/omr/readiness";
import { binaryDigest } from "../../domain/digest/canonical";
import { computeProviderBundleDigest, coordinateMicrounit } from "../../domain/omr/foundation";
import { computeVendorNormalizationMappingDigest } from "../../domain/omr/contracts";
import { attachOmrReviewContext, createInitialOmrReviewContext } from "../../domain/omr/normalization";
import { acceptOmrReviewAlternative } from "../../domain/omr/review";

const versions = { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } as const;
const encoder = new TextEncoder();
const slash = (duration: number, type: string, dots = 0) => `<note><unpitched><display-step>B</display-step><display-octave>4</display-octave></unpitched><duration>${duration}</duration><type>${type}</type>${"<dot/>".repeat(dots)}<notehead>slash</notehead></note>`;
const harmony = '<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>';
const attrs = '<attributes><divisions>4</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="96"/></direction>';
const score = (onlyRhythm = false) => `<score-partwise><work><work-title>Independent rhythm support fixture</work-title></work><part-list><score-part id="P"><part-name>Lead</part-name></score-part></part-list><part id="P"><measure number="1">${attrs}${harmony}${onlyRhythm ? slash(16, "whole") : ["C", "D", "E", "F"].map((step) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>`).join("")}</measure><measure number="2">${harmony}${slash(3, "eighth", 1)}${slash(1, "16th")}${slash(2, "eighth")}${slash(2, "eighth")}${slash(4, "quarter")}${slash(4, "quarter")}</measure></part></score-partwise>`;
async function reviewed(onlyRhythm = false, input = score(onlyRhythm)) {
  const parsed = await importMusicXml(encoder.encode(input), { algorithmVersions: versions });
  if (parsed.status !== "review-required") throw new Error(JSON.stringify(parsed.diagnostics));
  let draft: MusicXmlImportDraft = selectLeadCandidate(parsed.draft, parsed.draft.leadCandidates[0].key);
  for (const part of draft.parts) for (const measure of part.measures) for (const chord of measure.chords) draft = confirmChord(draft, chord.key);
  for (const section of draft.sections) draft = confirmSection(draft, section.key);
  draft = setPerformerRange(draft, 0, { displayName: "Lead", hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 6 } }, comfortableRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 6 } } });
  draft = confirmRights(draft, { basis: "self-authored", allowedUses: ["generation"] });
  return { draft, analysis: await deriveQuickReview(draft, versions) };
}
describe("pitch-unspecified rhythmic slashes", () => {
  it("preserves count, onset and dotted durations without a pitch or rest", async () => {
    const { analysis } = await reviewed();
    expect(analysis.state.readyForPlanning, JSON.stringify(analysis.diagnostics)).toBe(true);
    const events = [...analysis.source!.sourceMeasures[1].leadEvents].sort((a, b) => compareFractions(a.onset, b.onset));
    expect(events.map((e) => e.kind)).toEqual(Array(6).fill("rhythm"));
    expect(events.map((e) => e.onset)).toEqual([fraction(0), fraction(3, 4), fraction(1), fraction(3, 2), fraction(2), fraction(3)]);
    expect(events.map((e) => e.duration)).toEqual([fraction(3, 4), fraction(1, 4), fraction(1, 2), fraction(1, 2), fraction(1), fraction(1)]);
    expect(events.every((event) => !("pitch" in event))).toBe(true);
    expect(analysis.atomization!.atoms.filter((atom) => atom.rhythmOnly)).toHaveLength(6);
    expect((await validateRuntimeOmrReadiness(analysis.source!)).readiness).toBe("validator-ready");
    const forged = structuredClone(analysis.source!);
    Object.assign(forged.sourceMeasures[1].leadEvents[0], { pitch: { step: "C", alter: 0, octave: 4 } });
    expect(isSongSourceDocument(forged)).toBe(false);
  });
  it("accepts an entirely rhythm-only lead without asking for a missing melody", async () => {
    const { analysis } = await reviewed(true);
    expect(analysis.state.readyForPlanning, JSON.stringify(analysis.diagnostics)).toBe(true);
    expect(analysis.source!.sourceMeasures.flatMap((m) => m.leadEvents).every((e) => e.kind === "rhythm")).toBe(true);
  });
  it("requires explicit OMR evidence review of a slash without a pitch alternative", async () => {
    const { analysis } = await reviewed(true);
    const source = analysis.source!;
    const rawMusicXml = score(true);
    const vendorResultDigest = await binaryDigest(encoder.encode(rawMusicXml));
    const evidencePayload = { granularity: "symbol" as const,
      frames: [{ id: "frame:slash", pageIndex: 0, coordinateSpace: "normalized-original" as const, widthPixels: 100, heightPixels: 100, imageDigest: vendorResultDigest }],
      transforms: [], evidence: [{ id: "evidence:slash", vendorTargetId: "raw-slash", granularity: "symbol" as const, vendorId: "hm-reference",
        box: { frameId: "frame:slash", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) } }] };
    const providerBundleDigest = await computeProviderBundleDigest(evidencePayload);
    const mapping = { version: "vendor-export-target-map-v2" as const, vendorResultDigest, providerBundleDigest,
      mappings: [{ vendorTargetId: "raw-slash", target: { kind: "voice-event" as const, musicXmlPartOrdinal: 0, musicXmlStaffNumber: 1, musicXmlVoiceKey: "1", measureOrdinal: 0, eventOrdinal: 0 } }] };
    const providerResult = { vendorId: "hm-reference", vendorResultDigest, rawMusicXml, evidence: { ...evidencePayload, providerBundleDigest },
      normalizationMapping: { ...mapping, artifactDigest: await computeVendorNormalizationMappingDigest(mapping) }, retentionInfo: { canDeleteImmediately: true } };
    const selection = { partOrdinal: 0, staffNumber: 1, voiceKey: "1", chordAuthorityPartOrdinal: 0 };
    const context = await createInitialOmrReviewContext(source, providerResult, selection);
    expect(context.reviewRecord.reviewItems).toHaveLength(1);
    expect(context.reviewRecord.autoRepairs).toHaveLength(0);
    expect(context.reviewRecord.diagnostics).toHaveLength(0);
    await expect(attachOmrReviewContext({ source, providerResult, selection, reviewRecord: context.reviewRecord })).rejects.toThrow("OMR_REVIEW_REQUIRED");
    const item = context.reviewRecord.reviewItems[0];
    expect(item.alternatives[0].patch).toEqual({ kind: "duration", duration: fraction(4) });
    const accepted = await acceptOmrReviewAlternative({ source, item, alternativeId: item.alternatives[0].id, appliedAt: "2026-09-09T16:00:00Z" });
    const attached = await attachOmrReviewContext({ source: accepted.source, providerResult, selection,
      reviewRecord: { ...context.reviewRecord, corrections: [accepted.correction], reviewItems: [accepted.item] } });
    expect(attached.sourceMeasures.every((measure) => measure.leadEvents.every((event) => event.kind === "rhythm" && !("pitch" in event)))).toBe(true);
    expect((await validateRuntimeOmrReadiness(attached)).readiness).toBe("validator-ready");
  });
  it("honors rhythmic measure-style scope, inherited state, stop and except-voice without importing placeholder pitches", async () => {
    const note = (voice = "1") => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>${voice}</voice><type>whole</type></note>`;
    const input = `<score-partwise><part-list><score-part id="P"><part-name>Lead</part-name></score-part></part-list><part id="P"><measure number="1">${attrs}<attributes><measure-style><slash type="start" use-stems="yes"><except-voice>2</except-voice></slash></measure-style></attributes>${harmony}${note()}<backup><duration>16</duration></backup>${note("2")}</measure><measure number="2">${note()}</measure><measure number="3"><attributes><measure-style><slash type="stop"/></measure-style></attributes>${note()}</measure></part></score-partwise>`;
    const parsed = await importMusicXml(encoder.encode(input), { algorithmVersions: versions });
    if (parsed.status !== "review-required") throw new Error("rhythmic style blocked");
    const measures = parsed.draft.parts[0].measures;
    expect(measures[0].leadEvents.map((event) => event.kind)).toEqual(["rhythm", "note"]);
    expect(measures[1].leadEvents[0]).toMatchObject({ kind: "rhythm", onset: fraction(0), duration: fraction(4) });
    expect(measures[1].leadEvents[0]).not.toHaveProperty("pitch");
    expect(measures[2].leadEvents[0]).toMatchObject({ kind: "note", pitch: { step: "C", alter: 0, octave: 4 } });
    expect(inspectRecoveryXml(input)[0].notes[0]).toMatchObject({ kind: "rhythm", rhythmicSlashStyle: true });
    const recovery = await createImportRecovery(encoder.encode(input), "rhythmic-style.xml");
    await expect(applyRecoveryEdit(recovery, { kind: "note", part: 0, measure: 0, event: 0, value: { kind: "note", pitch: { step: "D", alter: 0, octave: 4 }, type: "whole", dots: 0, tieStart: false, tieStop: false } }, "Original rhythmic style", "2026-09-09T16:00:00Z")).rejects.toThrow("RECOVERY_RHYTHM_STYLE_ACTIVE");
  });
  it("does not use hidden note pitches as melody for unsupported beat-slash layout", async () => {
    const input = score().replace("<divisions>4</divisions>", '<divisions>4</divisions><measure-style><slash type="start"/></measure-style>');
    const parsed = await importMusicXml(encoder.encode(input), { algorithmVersions: versions });
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.details?.issue === "unsupported-beat-slash")).toBe(true);
    if (parsed.status === "review-required") expect(parsed.draft.parts.flatMap((part) => part.measures.flatMap((measure) => measure.leadEvents)).every((event) => event.kind !== "note")).toBe(true);
  });
  it("keeps a tied slash as one band attack and preserves sustained spans outside slash measures", async () => {
    const ordinary = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>';
    const tiedStart = slash(4, "quarter").replace("<type>", '<tie type="start"/><type>');
    const tiedStop = slash(4, "quarter").replace("<type>", '<tie type="stop"/><type>');
    const input = `<score-partwise><part-list><score-part id="P"><part-name>Lead</part-name></score-part></part-list><part id="P"><measure number="1">${attrs}${harmony}${ordinary}</measure><measure number="2">${ordinary}</measure><measure number="3">${tiedStart}${tiedStop}${slash(8, "half")}</measure></part></score-partwise>`;
    const { draft, analysis } = await reviewed(false, input);
    expect(analysis.state.readyForPlanning).toBe(true);
    const generated = await generateProjectVariant(await createProjectFromQuickReview(draft, analysis, "standard"), "standard");
    if (generated.status === "blocked") throw new Error("rhythm generation blocked");
    const rendered = materializeActiveArrangement(generated.project, "standard");
    const accompaniment = await generateDeterministicAccompaniment(rendered.document.effectiveChordTimeline);
    // A sustained voicing crossing ordinary and slash measures is the boundary
    // under test; chord arrangement segmentation is tested separately.
    const sustained = { ...accompaniment, spans: [{ ...accompaniment.spans[0], range: {
      start: { performanceMeasureIndex: 0, offset: fraction(0) },
      end: { performanceMeasureIndex: 2, offset: fraction(4) },
    } }] };
    const plan = buildPlaybackPlan(rendered.document, rendered.trackRoles, sustained);
    const attacks = [...new Set(plan.events.filter((event) => event.kind === "band").map((event) => `${event.startQuarter}:${event.durationQuarter}`))];
    expect(attacks).toEqual(["0:8", "8:2", "10:2"]);
    expect(plan.events.filter((event) => event.trackId === "track:source-lead" && event.startQuarter >= 8)).toHaveLength(0);
    const xml = exportArrangementMusicXml(rendered.document, rendered.trackRoles, { title: generated.project.source.title, key: generated.project.source.defaultKey, tempo: generated.project.source.defaultTempo });
    const reparsed = await importMusicXml(encoder.encode(xml), { algorithmVersions: versions });
    if (reparsed.status !== "review-required") throw new Error("tied rhythm export invalid");
    const events = reparsed.draft.parts[0].measures[2].leadEvents;
    expect(events[0]).toMatchObject({ kind: "rhythm", tieStart: true, tieStop: false });
    expect(events[1]).toMatchObject({ kind: "rhythm", tieStart: false, tieStop: true });
  });
  it("survives WAG, score, playback, project export/reload and sharing without invented Source pitch", async () => {
    const { draft, analysis } = await reviewed();
    const base = await createProjectFromQuickReview(draft, analysis, "standard");
    const generated = await generateProjectVariant(base, "standard");
    expect(generated.status, JSON.stringify(generated.status === "blocked" ? generated.diagnostics : [])).not.toBe("blocked");
    if (generated.status === "blocked") throw new Error("rhythm generation blocked");
    const project = await importHarmonyProject(await exportHarmonyProject(generated.project));
    expect(project.source.sourceMeasures[1].leadEvents).toEqual(base.source.sourceMeasures[1].leadEvents);
    const materialized = materializeActiveArrangement(project, "standard");
    const metadata = { title: project.source.title, key: project.source.defaultKey, tempo: project.source.defaultTempo };
    expect(arrangementRenderDocumentToAbc(materialized.document, materialized.trackRoles, metadata)).toContain("!style=rhythm!");
    const xml = exportArrangementMusicXml(materialized.document, materialized.trackRoles, metadata);
    const parsed = parseSafeXml(encoder.encode(xml), DEFAULT_IMPORT_SECURITY_LIMITS);
    if (parsed.status !== "complete") throw new Error("export XML invalid");
    const notes = xmlChildren(xmlChildren(xmlChildren(parsed.root, "part")[0], "measure")[1], "note");
    expect(notes).toHaveLength(6);
    expect(notes.every((note) => xmlChild(note, "unpitched") && !xmlChild(note, "rest") && !xmlChild(note, "pitch"))).toBe(true);
    const reimported = await importMusicXml(encoder.encode(xml), { algorithmVersions: versions });
    if (reimported.status !== "review-required") throw new Error("slash XML failed to reimport");
    expect(reimported.draft.parts[0].measures[1].leadEvents.map((e) => e.kind)).toEqual(Array(6).fill("rhythm"));
    const plan = buildPlaybackPlan(materialized.document, materialized.trackRoles, await generateDeterministicAccompaniment(materialized.document.effectiveChordTimeline));
    expect(plan.events.filter((e) => e.trackId === "track:source-lead" && e.startQuarter >= 4)).toHaveLength(0);
    expect(plan.events.some((e) => e.kind === "band" && e.startQuarter >= 4)).toBe(true);
    const shared = materializePracticeShare({ project: confirmShareRights(project), presetId: "standard", materialized });
    const sharedDocument = practiceShareToRenderDocument(shared);
    expect(sharedDocument.sourceLeadTrack.atoms.filter((atom) => atom.rhythmOnly)).toHaveLength(6);
  });
});
