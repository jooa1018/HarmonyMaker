from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"replacement target missing: {path}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


quick_path = "src/import/review/quick-review.test.ts"
replace_once(
    quick_path,
    '''    const selectedC = selectLeadCandidate(draft, cLead.key);\n    expect(selectedC.defaultKey).toEqual({ tonic: { step: "C", alter: 0 }, mode: "major" });\n    expect((await deriveQuickReview(selectedC)).diagnostics.some((item) => item.code === "UNSUPPORTED_MODULATION")).toBe(false);\n\n    const selectedD = selectLeadCandidate(selectedC, dLead.key);\n    expect(selectedD.defaultKey).toEqual({ tonic: { step: "D", alter: 0 }, mode: "major" });\n''',
    '''    const cPartKey = draft.parts.find((part) => part.partOrdinal === cLead.partOrdinal)?.measures[0]?.key;\n    const dPartKey = draft.parts.find((part) => part.partOrdinal === dLead.partOrdinal)?.measures[0]?.key;\n    expect(cPartKey).toBeDefined();\n    expect(dPartKey).toBeDefined();\n    const selectedC = selectLeadCandidate(draft, cLead.key);\n    expect(selectedC.defaultKey).toEqual(cPartKey);\n    expect((await deriveQuickReview(selectedC)).diagnostics.some((item) => item.code === "UNSUPPORTED_MODULATION")).toBe(false);\n\n    const selectedD = selectLeadCandidate(selectedC, dLead.key);\n    expect(selectedD.defaultKey).toEqual(dPartKey);\n''',
)
replace_once(
    quick_path,
    '    expect(reset.defaultKey).toEqual({ tonic: { step: "C", alter: 0 }, mode: "major" });',
    '    expect(reset.defaultKey).toEqual(cPartKey);',
)
replace_once(
    quick_path,
    '''    const selected = selectLeadCandidate(draft, stableLead.key);\n    expect(selected.defaultKey).toEqual({ tonic: { step: "C", alter: 0 }, mode: "major" });\n''',
    '''    const selectedPartKey = draft.parts.find((part) => part.partOrdinal === stableLead.partOrdinal)?.measures[0]?.key;\n    expect(selectedPartKey).toBeDefined();\n    const selected = selectLeadCandidate(draft, stableLead.key);\n    expect(selected.defaultKey).toEqual(selectedPartKey);\n''',
)

shared_path = Path("src/product/shared-practice-playback.test.ts")
shared = shared_path.read_text(encoding="utf-8")
shared = shared.replace(
    'import { isPracticeSharePayload, type PracticeSharePayload } from "../domain/share";',
    'import { isPracticeSharePayload, type PracticeSharePayload, type PracticeSharePayloadV3 } from "../domain/share";',
    1,
)
start = shared.index('  it("resolves a legacy selectedTrackIndex against original payload ordering before source-first reconstruction"')
end = shared.index('  it("rejects the former cumulative overflow counterexample', start)
legacy_block = '''  it("resolves a legacy selectedTrackIndex against original payload ordering before source-first reconstruction", () => {\n    const candidate: PracticeSharePayloadV3 = {\n      schemaVersion: 3,\n      title: "Legacy track order",\n      tempo: { beatUnit: 4, dotted: false, bpm: 80 },\n      key: { tonic: { step: "C", alter: 0 }, mode: "major" },\n      presetId: "standard",\n      arrangementArtifactDigest: digest,\n      effectiveChordTimelineDigest: digest,\n      arrangement: {\n        measures: [{ index: 0, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }],\n        tracks: [\n          { kind: "generated-harmony", label: "Upper / H1", events: [] },\n          { kind: "source-lead", label: "Lead", events: [] },\n          { kind: "generated-harmony", label: "Lower / H2", events: [] },\n        ],\n      },\n      lyrics: [],\n      playbackDefaults: { selectedTrackIndex: 0, speedPercent: 125 },\n      rightsShareConfirmed: true,\n    };\n    expect(isPracticeSharePayload(candidate)).toBe(true);\n    const materialized = materializeSharedPractice(candidate);\n    const plan = buildPlaybackPlan(materialized.document, materialized.trackRoles);\n    expect(plan.trackIds).toEqual(["track:source-lead", "share:track:h1", "share:track:h2"]);\n    expect(materialized.playbackDefaults).toEqual({ selectedTrackId: "share:track:h1", speedPercent: 125 });\n    expect(resolvePracticePlayerInitialState(plan, materialized.playbackDefaults)).toEqual({\n      speed: 125, solo: "share:track:h1", bandEnabled: true,\n    });\n  });\n\n'''
shared_path.write_text(shared[:start] + legacy_block + shared[end:], encoding="utf-8")

controls_path = Path("src/product/workspace-controls.ts")
controls = controls_path.read_text(encoding="utf-8")
block_start = controls.index("export interface CompactedEditedArrangementHistory")
block_end = controls.index("export function staleBoundaryPresentation", block_start)
replacement = '''function uniqueSnapshots(snapshots: readonly EditedArrangementSnapshot[]): readonly EditedArrangementSnapshot[] {\n  const byId = new Map<string, EditedArrangementSnapshot>();\n  for (const snapshot of snapshots) byId.set(snapshot.id, snapshot);\n  return [...byId.values()];\n}\n\nexport interface CompactedEditedArrangementHistory {\n  readonly outputEdits: readonly ArrangementOutputEdit[];\n  readonly editedSnapshots: readonly EditedArrangementSnapshot[];\n}\n\n/**\n * Keeps the active snapshot and as much newest valid history as fits the explicit\n * current-schema bounds. Unreferenced edits are discarded, while edit ordinals\n * remain immutable and may therefore be sparse.\n */\nexport function compactEditedArrangementHistory(input: {\n  readonly outputEdits: readonly ArrangementOutputEdit[];\n  readonly editedSnapshots: readonly EditedArrangementSnapshot[];\n  readonly activeSnapshotId: string;\n}): CompactedEditedArrangementHistory {\n  const editById = new Map(input.outputEdits.map((edit) => [edit.id, edit]));\n  const snapshots = uniqueSnapshots(input.editedSnapshots);\n  const active = snapshots.find((snapshot) => snapshot.id === input.activeSnapshotId);\n  if (!active) throw new RangeError("EDIT_HISTORY_ACTIVE_SNAPSHOT_MISSING");\n\n  const retainedSnapshots: EditedArrangementSnapshot[] = [];\n  const retainedSnapshotIds = new Set<string>();\n  const retainedEditIds = new Set<string>();\n  const candidates = [active, ...[...snapshots].reverse().filter((snapshot) => snapshot.id !== active.id)];\n  for (const snapshot of candidates) {\n    if (retainedSnapshots.length >= MAX_EDITED_SNAPSHOTS_PER_VARIANT) break;\n    const snapshotEditIds = [...new Set(snapshot.appliedEditIds)];\n    if (snapshotEditIds.some((editId) => !editById.has(editId))) {\n      if (snapshot.id === active.id) throw new RangeError("EDIT_HISTORY_ACTIVE_EDIT_MISSING");\n      continue;\n    }\n    const additionalEditIds = snapshotEditIds.filter((editId) => !retainedEditIds.has(editId));\n    if (retainedEditIds.size + additionalEditIds.length > MAX_OUTPUT_EDIT_REVISIONS_PER_VARIANT) {\n      if (snapshot.id === active.id) throw new RangeError("EDIT_HISTORY_LIMIT_EXCEEDED");\n      continue;\n    }\n    retainedSnapshots.push(snapshot);\n    retainedSnapshotIds.add(snapshot.id);\n    for (const editId of snapshotEditIds) retainedEditIds.add(editId);\n  }\n\n  return {\n    outputEdits: input.outputEdits\n      .filter((edit) => retainedEditIds.has(edit.id))\n      .sort((left, right) => left.editOrdinal - right.editOrdinal || left.id.localeCompare(right.id)),\n    editedSnapshots: snapshots.filter((snapshot) => retainedSnapshotIds.has(snapshot.id)),\n  };\n}\n\n'''
controls_path.write_text(controls[:block_start] + replacement + controls[block_end:], encoding="utf-8")
