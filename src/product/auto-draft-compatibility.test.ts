import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { canonicalJson } from "../domain/digest/canonical";
import { HARMONY_PART_PRESETS } from "../domain/part-presets";
import { containsPitch, pitchMidiNumber } from "../domain/pitch";
import { comparePositions } from "../domain/time";
import { normalizeAutoDraftOptions, parseAutoDraftMarker, serializeAutoDraftOptions } from "../import/workspace/auto-draft";
import { parseScoreWorkspace, replayScoreWorkspace } from "../import/workspace/journal";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { generateAutoDraftProject, projectSourceStatus } from "./auto-draft";
import { generateQuickHarmony, prepareQuickHarmonyWorkspace, type QuickHarmonyChoice } from "./quick-harmony";
import { IndexedDbProjectStore } from "./local-project-store";
import { materializeActiveArrangement } from "./render";

const oldBytes = (part: string) => readFileSync(new URL(`./fixtures/auto-draft-v1-${part}.json`, import.meta.url), "utf8");
const choice = { rightsConfirmed: true, confirmedAt: "2026-10-09T10:00:00.000Z" } as const;

describe("auto draft policy v2 compatibility and multiple parts", () => {
  it.each(["auto", "alto", "tenor"] as const)("reads frozen v1 %s bytes and preserves the existing two-voice generation", async part => {
    const bytes = oldBytes(part);
    const old = await importHarmonyProject(bytes);
    expect(projectSourceStatus(old)).toBe("auto-draft");
    expect(await exportHarmonyProject(old)).toBe(bytes);
    const info = old.source.importInfo;
    if (info?.sourceKind !== "score-workspace") throw new Error("fixture missing workspace");
    const metadata = info.workspaceMetadata;
    const parsed = parseAutoDraftMarker(metadata.autoDraft!.marker);
    expect(parsed.version).toBe("hm-auto-draft-policy-v1");
    expect(serializeAutoDraftOptions(parsed.options, parsed.version)).toBe(metadata.autoDraft!.marker);
    const workspace = await parseScoreWorkspace(metadata.proof);
    const result = await generateAutoDraftProject(workspace, parsed.options);
    if (result.status !== "generated") throw new Error(result.status);
    expect(result.generation.status).toBe("complete");
    expect(result.assessment.version).toBe("hm-auto-draft-policy-v2");
    // All plans, generated notes, candidate IDs/digests and scores are unchanged.
    expect(result.project.variants).toEqual(old.variants);
    expect(result.project.performers).toEqual(old.performers);
    expect(result.project.source.revisionDigest).toBe(old.source.revisionDigest);
    const store = new IndexedDbProjectStore(new IDBFactory());
    await store.saveNew({ projectId: `legacy-${part}`, updatedAt: choice.confirmedAt, project: old });
    expect(await exportHarmonyProject((await store.load(`legacy-${part}`))!.project)).toBe(bytes);
  }, 180_000);

  it("normalizes part order and rejects empty, duplicate, unknown and mixed-version options", () => {
    const normalized = { harmonyParts: ["alto", "tenor"] };
    expect(normalizeAutoDraftOptions({ harmonyParts: ["tenor", "alto"] })).toEqual(normalized);
    expect(serializeAutoDraftOptions({ harmonyParts: ["tenor", "alto"] })).toBe(serializeAutoDraftOptions(normalized as { harmonyParts: ["alto", "tenor"] }));
    for (const harmonyParts of [[], ["alto", "alto"], ["tenor", "tenor"], ["soprano"], ["alto", "tenor", "alto"], new Array(1), null, "alto"]) {
      expect(() => normalizeAutoDraftOptions({ harmonyParts })).toThrow("AUTO_DRAFT_OPTIONS_INVALID");
    }
    expect(() => normalizeAutoDraftOptions({ harmonyPart: "alto" })).toThrow("AUTO_DRAFT_OPTIONS_INVALID");
    expect(() => serializeAutoDraftOptions({ harmonyParts: ["alto", "tenor"] }, "hm-auto-draft-policy-v1")).toThrow("AUTO_DRAFT_VERSION_UNSUPPORTED");
    const marker = serializeAutoDraftOptions({ harmonyParts: ["alto", "tenor"] });
    expect(parseAutoDraftMarker(marker).options).toEqual(normalized);
    expect(() => parseAutoDraftMarker(marker.replace('["alto","tenor"]', '["tenor","alto"]'))).toThrow("AUTO_DRAFT_MARKER_NONCANONICAL");
    expect(() => parseAutoDraftMarker(marker.replace("policy-v2", "policy-v1"))).toThrow();
    expect(() => parseAutoDraftMarker(marker.replace("policy-v2", "policy-v99"))).toThrow("AUTO_DRAFT_VERSION_UNSUPPORTED");
  });

  it("generates Lead + alto + tenor within range with identical bytes for either selection order", async () => {
    const old = await importHarmonyProject(oldBytes("auto"));
    const info = old.source.importInfo;
    if (info?.sourceKind !== "score-workspace") throw new Error("fixture missing workspace");
    const prep = await prepareQuickHarmonyWorkspace(await parseScoreWorkspace(info.workspaceMetadata.proof));
    const results = [];
    for (const parts of [["alto", "tenor"], ["tenor", "alto"], ["alto", "tenor"]] as const) {
      const result = await generateQuickHarmony(prep, { ...choice, parts });
      expect(result.status).toBe("complete");
      if (result.status !== "complete") throw new Error(JSON.stringify(result));
      expect(result.preparation.details.assessment!.request!.singerCount).toBe(3);
      expect(result.project.performers.map(p => p.id)).toEqual(["pf:0", "pf:1", "pf:2"]);
      expect(result.project.assignments.map(a => a.performerId)).toEqual(["pf:0", "pf:1", "pf:2"]);
      expect(result.project.performers[0]).toEqual(old.performers[0]);
      const document = materializeActiveArrangement(result.project, "standard").document;
      expect(document.generatedHarmonyTracks, JSON.stringify(result.generation.execution.generation.rejections)).toHaveLength(2);
      for (const [index, part] of (["alto", "tenor"] as const).entries()) {
        expect(result.project.performers[index + 1].hardRange).toEqual(HARMONY_PART_PRESETS[part].hardRange);
        const notes = document.generatedHarmonyTracks[index].events.filter(e => e.kind === "note");
        expect(notes.length).toBeGreaterThan(0);
        expect(notes.every(n => containsPitch(HARMONY_PART_PRESETS[part].hardRange, n.pitch))).toBe(true);
      }
      const alto = document.generatedHarmonyTracks[0].events.filter(e => e.kind === "note");
      const tenor = document.generatedHarmonyTracks[1].events.filter(e => e.kind === "note");
      const intervals = alto.flatMap(a => tenor.filter(t => comparePositions(a.range.start, t.range.end) < 0 && comparePositions(t.range.start, a.range.end) < 0)
        .map(t => pitchMidiNumber(a.pitch) - pitchMidiNumber(t.pitch)));
      expect(intervals.length).toBeGreaterThan(0);
      expect(Math.min(...intervals)).toBeGreaterThanOrEqual(0);
      const exported = await exportHarmonyProject(result.project);
      expect(await exportHarmonyProject(await importHarmonyProject(exported))).toBe(exported);
      results.push(exported);
    }
    expect(new Set(results).size).toBe(1);
    expect((await replayScoreWorkspace(prep.workspace!)).attestations).toEqual([]);
    for (const parts of [[], ["alto", "alto"], ["tenor", "tenor"], ["alto", "tenor", "alto"], ["alto", "soprano"]]) {
      await expect(generateQuickHarmony(prep, { ...choice, parts } as unknown as QuickHarmonyChoice)).rejects.toMatchObject({ code: "QUICK_HARMONY_CHOICE_INVALID" });
    }
  }, 180_000);

  it("rejects altered legacy markers instead of silently upgrading or ignoring their policy", async () => {
    const raw = JSON.parse(oldBytes("alto"));
    const metadata = raw.source.importInfo.workspaceMetadata;
    const marker = JSON.parse(metadata.autoDraft.marker);
    marker.version = "hm-auto-draft-policy-v2";
    marker.options.harmonyParts = [marker.options.harmonyPart];
    delete marker.options.harmonyPart;
    metadata.autoDraft.marker = canonicalJson(marker);
    await expect(importHarmonyProject(canonicalJson(raw))).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
  });
});
