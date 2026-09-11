import { test, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importMusicXml } from "../../src/import/musicxml/parser";
import { deriveQuickReview } from "../../src/import/review/quick-review";

const base = process.env.HM_LOCAL_INTEGRATION_EVIDENCE;
const versions = { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" };
test.skipIf(!base)("imports new automatic candidates without approving Source or changing evidence", async () => {
  const rows: unknown[] = [];
  for (const name of ["user-jpeg", "independent-a", "independent-b"]) {
    const directory = join(base!, "runs", name, "v6");
    const raw = readFileSync(join(directory, "C-integrated.candidate.musicxml"));
    const parsed = await importMusicXml(new Uint8Array(raw), { algorithmVersions: versions });
    const row: Record<string, unknown> = { name, status: parsed.status, parseDiagnostics: parsed.diagnostics, sourceApproved: false };
    if (parsed.status === "review-required") {
      const analysis = await deriveQuickReview(parsed.draft, versions);
      row.draft = parsed.draft; row.reviewState = analysis.state; row.reviewDiagnostics = analysis.diagnostics;
      expect(analysis.state.readyForPlanning).toBe(false);
      if (name === "independent-b") {
        const events = parsed.draft.parts.flatMap(p => p.measures.flatMap(m => m.leadEvents));
        const rhythm = events.filter(e => e.kind === "rhythm");
        expect(rhythm).toHaveLength(4);
        expect(rhythm.every(e => !("pitch" in e))).toBe(true);
        expect(events.filter(e => e.kind === "note")).toHaveLength(24);
        const cg = parsed.draft.parts[0].measures[1].chords[0];
        expect(cg.sourceText).toBe("C/G"); expect(cg.onset).toEqual({ n: 0, d: 1 });
      }
    }
    expect(readFileSync(join(directory, "C-integrated.candidate.musicxml"))).toEqual(raw);
    rows.push(row);
  }
  writeFileSync(join(base!, "app-import-report.json"), JSON.stringify(rows, null, 2));
});
