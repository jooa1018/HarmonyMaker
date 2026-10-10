import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { canonicalJson } from "../domain/digest/canonical";
import { normalizeAutoDraftOptions, parseAutoDraftMarker, serializeAutoDraftOptions } from "../import/workspace/auto-draft";
import { parseScoreWorkspace } from "../import/workspace/journal";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { generateAutoDraftProject, projectSourceStatus } from "./auto-draft";
import { IndexedDbProjectStore } from "./local-project-store";
import { materializeActiveArrangement } from "./render";
import { exportArrangementMusicXml } from "./musicxml-export";
import { arrangementRenderDocumentToAbc } from "./score-adapter";

const oldBytes = (part: string) => readFileSync(new URL(`./fixtures/auto-draft-v1-${part}.json`, import.meta.url), "utf8");
const choice = { rightsConfirmed: true, confirmedAt: "2026-10-09T10:00:00.000Z" } as const;

describe("auto draft policy v2 compatibility and multiple parts", () => {
  it.each(["auto", "alto", "tenor"] as const)("reads frozen v1 %s bytes and preserves the existing two-voice generation", async part => {
    const bytes = oldBytes(part);
    const old = await importHarmonyProject(bytes);
    expect(projectSourceStatus(old)).toBe("auto-draft");
    expect(await exportHarmonyProject(old)).toBe(bytes);
    const {document,trackRoles}=materializeActiveArrangement(old,"standard");
    expect(trackRoles.sourceLeadLabel).toBeUndefined();
    expect(trackRoles.generatedTracks.every(track=>/^(Upper|Lower|Upper\/Lower) \/ H[12]$/u.test(track.label))).toBe(true);
    const display={title:old.source.title,key:old.source.defaultKey,tempo:old.source.defaultTempo};
    expect(exportArrangementMusicXml(document,trackRoles,display)).toContain("<part-name>Source Lead</part-name>");
    expect(arrangementRenderDocumentToAbc(document,trackRoles,display)).toContain('name="Lead"');
    const info = old.source.importInfo;
    if (info?.sourceKind !== "score-workspace") throw new Error("fixture missing workspace");
    const metadata = info.workspaceMetadata;
    const parsed = parseAutoDraftMarker(metadata.autoDraft!.marker);
    expect(parsed.version).toBe("hm-auto-draft-policy-v1");
    expect(serializeAutoDraftOptions(parsed.options, parsed.version)).toBe(metadata.autoDraft!.marker);
    const workspace = await parseScoreWorkspace(metadata.proof);
    const result = await generateAutoDraftProject(workspace, parsed.options, "standard", parsed.version);
    if (result.status !== "generated") throw new Error(result.status);
    expect(result.generation.status).toBe("complete");
    expect(result.assessment.version).toBe("hm-auto-draft-policy-v1");
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
