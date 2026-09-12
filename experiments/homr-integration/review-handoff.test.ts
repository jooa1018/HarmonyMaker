import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateLocalCandidate, type LocalCandidateBundle } from "../../src/domain/omr/local-candidate";
import { importMusicXml } from "../../src/import/musicxml/parser";
import { deriveQuickReview } from "../../src/import/review/quick-review";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../../src/app/algorithm-version-registry";
import { step3ImportVersionsFromRegistry } from "../../src/import/musicxml/types";

const evidence = process.env.HM_LOCAL_REVIEW_EVIDENCE;
describe.skipIf(!evidence)("preserved automatic candidates with bound evidence", () => {
  it("verifies the actual artifacts and keeps normal Source blocked, including XML-only imports", async () => {
    const reports = [], versions = step3ImportVersionsFromRegistry(APPLICATION_ALGORITHM_VERSION_REGISTRY);
    for (const name of ["user-jpeg", "independent-a", "independent-b", "holdout-c"]) {
      const bundle = JSON.parse(await readFile(path.join(evidence!, name + ".review.json"), "utf8")) as LocalCandidateBundle;
      await validateLocalCandidate(bundle);
      const result = await importMusicXml(new TextEncoder().encode(bundle.artifacts.candidateXml.text), { algorithmVersions: versions, originalFileName: name + ".musicxml" });
      let diagnosticCodes = result.diagnostics.map((d) => d.code);
      if (result.status === "review-required") {
        expect(result.draft.localCandidateReviewRequired).toBe(true);
        const analysis = await deriveQuickReview(result.draft, versions);
        expect(analysis.state.readyForPlanning).toBe(false);
        diagnosticCodes = analysis.diagnostics.map((d) => d.code);
      }
      reports.push({ case: name, manifest: bundle.manifestSha256, status: result.status, diagnosticCodes, sourceApproved: false });
    }
    await writeFile(path.join(evidence!, "handoff-validation.json"), JSON.stringify(reports, null, 2));
  }, 60000);
});
