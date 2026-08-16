import { describe, expect, it } from "vitest";

import { canonicalUtf8, semanticDigest, type SemanticDigest } from "./digest/canonical";
import type { PracticeSharePayload } from "./share";
import { encodePracticeShare } from "./share";
import { createWagFixtureInput } from "../grammar/fixtures";
import { executeWagSegmentB } from "../grammar/segment-b";
import { decryptAeadV1, encryptAeadV1 } from "../server/security/crypto-core";

const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function practicePayload(digest: SemanticDigest): PracticeSharePayload {
  return {
    schemaVersion: 3,
    title: "Governance isolation",
    tempo: { beatUnit: 4, dotted: false, bpm: 80 },
    key: { tonic: { step: "C", alter: 0 }, mode: "major" },
    presetId: "simple",
    arrangementArtifactDigest: digest,
    effectiveChordTimelineDigest: digest,
    arrangement: {
      measures: [{ index: 0, sourceMeasureNumber: 1, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }],
      tracks: [{
        kind: "source-lead",
        label: "Lead",
        events: [{ kind: "note", occurrenceIndex: 0, offset: [0, 1], duration: [4, 1], pitch: ["C", 0, 4], lyricTokenIds: ["ly:0"] }],
      }],
    },
    lyrics: [{ id: "ly:0", text: "la", verse: 1, syllabic: "single", extend: false }],
    rightsShareConfirmed: true,
  };
}

describe("C0 governance identity isolation", () => {
  it("keeps every representative governance value outside canonical musical results", async () => {
    const input = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
    const governanceA = {
      sessionToken: "session-A", csrfToken: "csrf-A", shareToken: "share-A",
      ownerDeleteSecret: "delete-A", abuseReportId: "abuse:A", takedownAuditId: "audit:A",
      omrPublicHandle: "omr:A", vendorJobId: "vendor-A", aeadNonce: "nonce-A",
      createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-06-30T00:00:00.000Z",
      databaseRowId: "row-A", requestId: "request-A", idempotencyKey: "idem-A",
      quotaIpHmac: "ip-A", s3ObjectKey: "object-A", s3ObjectVersion: "version-A",
    };
    const governanceB = Object.fromEntries(Object.keys(governanceA).map((name) => [name, `${name}-B`]));
    const [left, right] = await Promise.all([
      executeWagSegmentB({ ...input }),
      executeWagSegmentB({ ...input }),
    ]);
    expect(left).toEqual(right);
    expect(left.status).not.toBe("blocked");
    if (left.status === "blocked" || right.status === "blocked") return;
    expect(left.generation.result.digests).toEqual(right.generation.result.digests);
    expect(left.generation.result.candidates.map(({ id, contentDigest, canonicalPathKey }) => ({ id, contentDigest, canonicalPathKey })))
      .toEqual(right.generation.result.candidates.map(({ id, contentDigest, canonicalPathKey }) => ({ id, contentDigest, canonicalPathKey })));
    const exportedMusicalValues = JSON.stringify({
      generation: left.generation.result,
      renderDocument: left.renderDocument,
      accompaniment: left.accompaniment,
    });
    for (const value of [...Object.values(governanceA), ...Object.values(governanceB)]) {
      expect(exportedMusicalValues).not.toContain(value);
    }
  });

  it("digests canonical plaintext before encryption and isolates fresh nonces", async () => {
    const digest = "0".repeat(64) as SemanticDigest;
    const payload = practicePayload(digest);
    const encoded = encodePracticeShare(payload);
    const payloadDigestA = await semanticDigest(payload);
    const payloadDigestB = await semanticDigest(JSON.parse(encoded));
    const first = encryptAeadV1(canonicalUtf8(payload), key, { nonce: Uint8Array.from({ length: 12 }, () => 1), associatedDataVersion: "practice-share-v3" });
    const second = encryptAeadV1(canonicalUtf8(payload), key, { nonce: Uint8Array.from({ length: 12 }, () => 2), associatedDataVersion: "practice-share-v3" });
    expect(payloadDigestA).toBe(payloadDigestB);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.nonce).not.toBe(second.nonce);
    expect(new TextDecoder().decode(decryptAeadV1(first, key))).toBe(encoded);
    expect(new TextDecoder().decode(decryptAeadV1(second, key))).toBe(encoded);
  });
});
