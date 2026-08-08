import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "../digest/canonical";
import { sourceRevisionRecordId } from "../ids";
import {
  computeRevisionHistoryDigest, createSourceIdRemap, validateRevisionHistory,
  validateRevisionHistoryIntegrity, type SourceRevisionRecord, type SourceRevisionRef,
} from "./revision";

const digest = (digit: string) => digit.repeat(64) as SemanticDigest;
const revision = (ordinal: number, value: string): SourceRevisionRef => ({ documentId: "doc", revisionOrdinal: ordinal, revisionDigest: digest(value) });

async function chainFixture() {
  const revisions = [revision(0, "0"), revision(1, "1"), revision(2, "2")];
  const remap01 = await createSourceIdRemap(revisions[0], revisions[1], [{ entityKind: "lead-event", fromId: "le:0:0", toIds: ["le:0:1"], status: "mapped-one" }]);
  const remap12 = await createSourceIdRemap(revisions[1], revisions[2], [{ entityKind: "phrase", fromId: "ph:0", toIds: [], status: "deleted" }]);
  const record = (index: number, idRemap: typeof remap01): SourceRevisionRecord => ({ id: sourceRevisionRecordId(index, index + 1, 0), editOrdinal: 0, fromRevision: revisions[index], toRevision: revisions[index + 1], commandKind: "manual-source-edit", beforeProjection: "{}", afterProjection: "{}", idRemap });
  const history = [record(0, remap01), record(1, remap12)];
  return { current: revisions[2], history, historyDigest: await computeRevisionHistoryDigest(history) };
}

describe("source revision chain integrity", () => {
  it("accepts only a complete revision-0-to-current chain with digest parity", async () => {
    const fixture = await chainFixture();
    expect(validateRevisionHistory(fixture.current, fixture.history)).toBe(true);
    expect(await validateRevisionHistoryIntegrity(fixture.current, fixture.history, fixture.historyDigest)).toBe(true);
  });

  it("blocks missing, reordered, duplicated, and non-canonical records", async () => {
    const fixture = await chainFixture();
    expect(validateRevisionHistory(fixture.current, fixture.history.slice(1))).toBe(false);
    expect(validateRevisionHistory(fixture.current, [...fixture.history].reverse())).toBe(false);
    expect(validateRevisionHistory(fixture.current, [fixture.history[0], fixture.history[0], fixture.history[1]])).toBe(false);
    expect(validateRevisionHistory(fixture.current, [{ ...fixture.history[0], id: "ser:wrong" }, fixture.history[1]])).toBe(false);
    const badRemap = { ...fixture.history[0].idRemap, remapDigest: digest("f") };
    expect(await validateRevisionHistoryIntegrity(fixture.current, [{ ...fixture.history[0], idRemap: badRemap }, fixture.history[1]], fixture.historyDigest)).toBe(false);
  });

  it("rejects duplicate remap authority keys", async () => {
    const from = revision(0, "0");
    const to = revision(1, "1");
    await expect(createSourceIdRemap(from, to, [
      { entityKind: "measure", fromId: "sm:0", toIds: ["sm:1"], status: "mapped-one" },
      { entityKind: "measure", fromId: "sm:0", toIds: [], status: "deleted" },
    ])).rejects.toThrow("SOURCE_ID_REMAP_FAILED");
  });
});
