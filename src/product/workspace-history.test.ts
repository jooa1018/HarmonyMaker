import { describe, expect, it } from "vitest";

import {
  MAX_EDITED_SNAPSHOTS_PER_VARIANT,
  MAX_OUTPUT_EDIT_REVISIONS_PER_VARIANT,
  type ArrangementOutputEdit,
  type EditedArrangementSnapshot,
} from "../domain/edit/model";
import { compactEditedArrangementHistory } from "./workspace-controls";

const digest = "0".repeat(64) as never;

function edit(index: number): ArrangementOutputEdit {
  return {
    id: `edit:history:${index}`,
    presetId: "standard",
    baseCandidateId: "candidate:history",
    baseCandidateDigest: digest,
    editOrdinal: index,
    kind: "replace-pitch",
    eventId: "event:history",
    pitch: { step: "C", alter: 0, octave: 4 },
  };
}

function snapshot(index: number, appliedEditIds: readonly string[] = [`edit:history:${index}`]): EditedArrangementSnapshot {
  return {
    id: `snapshot:history:${index}`,
    materializerVersion: "materializer-v1",
    validatorVersion: "validator-v1",
    validatorConfigDigest: digest,
    metricsVersion: "metrics-v1",
    metricConfigDigest: digest,
    diagnosticRegistryVersion: "diagnostics-v1",
    diagnosticRegistryDigest: digest,
    effectiveChordTimelineDigest: digest,
    sourceLeadAtomizationDigest: digest,
    presetId: "standard",
    baseCandidateId: "candidate:history",
    baseCandidateDigest: digest,
    appliedEditIds,
    appliedEditSetDigest: digest,
    generatedHarmonyTracks: [],
    realizedAnchors: [],
    metrics: {} as never,
    validationDiagnostics: [],
    status: "valid",
    contentDigest: digest,
  };
}

describe("bounded edited arrangement history", () => {
  it("retains the active and latest snapshot history under explicit cardinality bounds", () => {
    const count = MAX_OUTPUT_EDIT_REVISIONS_PER_VARIANT + 200;
    const edits = Array.from({ length: count }, (_, index) => edit(index));
    const snapshots = edits.map((item, index) => snapshot(index, [item.id]));
    const active = snapshots.at(-1)!;
    const compacted = compactEditedArrangementHistory({
      outputEdits: edits,
      editedSnapshots: snapshots,
      activeSnapshotId: active.id,
    });

    expect(compacted.editedSnapshots).toHaveLength(MAX_EDITED_SNAPSHOTS_PER_VARIANT);
    expect(compacted.outputEdits).toHaveLength(MAX_EDITED_SNAPSHOTS_PER_VARIANT);
    expect(compacted.editedSnapshots.at(-1)?.id).toBe(active.id);
    expect(compacted.outputEdits.at(-1)?.id).toBe(edits.at(-1)?.id);
    expect(new Set(compacted.editedSnapshots.flatMap((item) => item.appliedEditIds)))
      .toEqual(new Set(compacted.outputEdits.map((item) => item.id)));
  });

  it("fails closed when the active snapshot alone exceeds the supported edit bound", () => {
    const edits = Array.from({ length: MAX_OUTPUT_EDIT_REVISIONS_PER_VARIANT + 1 }, (_, index) => edit(index));
    const active = snapshot(9999, edits.map((item) => item.id));
    expect(() => compactEditedArrangementHistory({
      outputEdits: edits,
      editedSnapshots: [active],
      activeSnapshotId: active.id,
    })).toThrow("EDIT_HISTORY_LIMIT_EXCEEDED");
  });

  it("drops unreferenced obsolete edits instead of carrying quadratic validation history", () => {
    const edits = [edit(0), edit(1), edit(2)];
    const active = snapshot(2, [edits[2].id]);
    const compacted = compactEditedArrangementHistory({
      outputEdits: edits,
      editedSnapshots: [active],
      activeSnapshotId: active.id,
    });
    expect(compacted.outputEdits).toEqual([edits[2]]);
    expect(compacted.editedSnapshots).toEqual([active]);
  });
});
