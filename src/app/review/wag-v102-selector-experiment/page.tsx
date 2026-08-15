import { buildListeningManifest, validateListeningParity } from "@/experiments/wag-v102/playback";
import { ExperimentReviewClient } from "./ReviewClient";

export default async function WagV102SelectorExperimentPage() {
  const items = await buildListeningManifest();
  if (items.length !== 18 || items.some((item) => !validateListeningParity(item))) {
    throw new Error("WAG_V102_LISTENING_MANIFEST_INVALID");
  }
  const branchSha = process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.GITHUB_SHA
    ?? "codex/wag-v102-selector-experiment";
  return <ExperimentReviewClient items={items} branchSha={branchSha} />;
}
