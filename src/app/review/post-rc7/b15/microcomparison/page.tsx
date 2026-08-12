import {
  createMicroPlaybackArtifact,
  MICRO_PLAYBACK_MIXES,
  MICROCOMPARISON_REFERENCES,
  type MicroPlaybackArtifact,
  type MicroPlaybackMix,
  type MicroReference,
} from "@/review/post-rc7/microcomparison";
import { MicroComparisonClient, type MicroReferenceView } from "./MicroComparisonClient";

function artifactsFor(reference: MicroReference): Readonly<Record<MicroPlaybackMix, MicroPlaybackArtifact>> {
  return Object.fromEntries(MICRO_PLAYBACK_MIXES.map((mix) => [mix, createMicroPlaybackArtifact(reference, mix)])) as Readonly<Record<MicroPlaybackMix, MicroPlaybackArtifact>>;
}

export default function MicrocomparisonPage() {
  const references: readonly MicroReferenceView[] = MICROCOMPARISON_REFERENCES.map((reference) => ({
    id: reference.id,
    fixtureId: reference.fixtureId,
    provenance: reference.provenance,
    analysis: reference.analysis,
    artifacts: artifactsFor(reference),
  }));
  return <MicroComparisonClient references={references} />;
}
