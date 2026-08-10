import { beforeAll, describe, expect, it } from "vitest";
import { RC7_PRESET_ORDER } from "../constants";
import {
  buildRc7InternalListeningCorpus,
  type Rc7InternalListeningCorpus,
} from "./corpus";
import {
  RC7_SONG_SECTION_DEFINITIONS,
  runRc7SongSection,
} from "./song-sections";
import {
  createEvaluatorResult,
  createListeningState,
  emptyComparisonResponse,
  emptySectionResponse,
  parseEvaluatorResultJson,
  reduceListeningState,
  sessionResponsesComplete,
} from "./state";
import {
  assertRc7EvaluatorResultComplete,
  createRc7EvaluatorSessionPayload,
  createRc7RevealArtifact,
  createRc7SessionMaterial,
  decodeRc7SessionCookie,
  encodeRc7SessionCookie,
  type Rc7CompletionMaterial,
  type Rc7SessionMaterial,
} from "./session";

describe("rc.7 controlled blinded listening corpus", () => {
  let corpus: Rc7InternalListeningCorpus;

  beforeAll(async () => {
    corpus = await buildRc7InternalListeningCorpus();
  }, 120_000);

  it("contains 18 meaningful, hard-legal A/B comparisons across every target risk", () => {
    expect(corpus.comparisons).toHaveLength(18);
    expect(new Set(corpus.comparisons.map((entry) => entry.comparisonId)).size).toBe(18);
    expect(corpus.comparisons.some((entry) => entry.comparisonType === "winner-vs-runner-up")).toBe(true);

    const coveredRisks = new Set(corpus.comparisons.flatMap((entry) => entry.riskTags));
    expect(coveredRisks).toEqual(new Set([
      "accent",
      "selective-third-voice",
      "pad",
      "bounded-tpp",
      "u2s",
      "suspension",
      "negative-control",
    ]));

    for (const comparison of corpus.comparisons) {
      expect(comparison.left.playback).not.toBe(comparison.right.playback);
      expect(comparison.left.leadPlayback).toBe(comparison.right.leadPlayback);
      expect(comparison.leadReferencePlayback).toBe(comparison.left.leadPlayback);
      expect(comparison.left.hardRangeFailureCount).toBe(0);
      expect(comparison.right.hardRangeFailureCount).toBe(0);
      expect(comparison.left.verticalFailureCount).toBe(0);
      expect(comparison.right.verticalFailureCount).toBe(0);
    }

    const selectiveThird = corpus.comparisons.find((entry) => entry.comparisonId === "CMP-04");
    expect(selectiveThird?.left.soundingDurationQByTrackOrdinal[1]).toBeGreaterThan(
      selectiveThird?.left.soundingDurationQByTrackOrdinal[2] ?? Number.POSITIVE_INFINITY,
    );
    expect(Object.keys(selectiveThird?.right.soundingDurationQByTrackOrdinal ?? {})).toHaveLength(1);
  });

  it("includes three 8–16 bar multi-phrase song-like sections and the final no-cue control", () => {
    const songLike = corpus.sections.filter((entry) => entry.songLike);
    expect(songLike).toHaveLength(3);
    expect(songLike.map((entry) => entry.sectionId)).toEqual(
      RC7_SONG_SECTION_DEFINITIONS.map((entry) => entry.sectionId),
    );
    for (const section of songLike) {
      expect(section.bars).toBeGreaterThanOrEqual(8);
      expect(section.bars).toBeLessThanOrEqual(16);
      expect(section.phraseCount).toBeGreaterThanOrEqual(2);
      expect(section.hardRangeFailureCount).toBe(0);
      expect(section.verticalFailureCount).toBe(0);
    }

    const finalControl = corpus.sections.find((entry) => (
      entry.sectionId === "CONTROL-FINAL-NO-REAL-CUE"
    ));
    expect(finalControl).toMatchObject({
      songLike: false,
      bars: 3,
      phraseCount: 1,
      riskTags: ["negative-control"],
    });
    expect(finalControl?.hardRangeFailureCount).toBe(0);
    expect(finalControl?.verticalFailureCount).toBe(0);
  });

  it("runs every song-like section through all presets with persisted phrase-role continuity", async () => {
    let derivedPreviousRoleCount = 0;
    for (const definition of RC7_SONG_SECTION_DEFINITIONS) {
      for (const preset of RC7_PRESET_ORDER) {
        const output = await runRc7SongSection(definition, preset);
        expect(output.phraseOutputs).toHaveLength(definition.phrases.length);
        expect(output.playback.fullArrangementAbc).toContain("[V:lead]");

        for (const phraseOutput of output.phraseOutputs) {
          expect(phraseOutput.rangeChecks.every((check) => check.insideHardRange)).toBe(true);
          expect(phraseOutput.verticalLegalityChecks.every((check) => check.legal)).toBe(true);
        }

        for (let index = 1; index < output.phraseOutputs.length; index += 1) {
          const previous = output.phraseOutputs[index - 1].intent.plan.phraseIntents[0];
          const current = output.phraseOutputs[index];
          const priorRoles = new Map(previous?.trackRoles.map((entry) => (
            [entry.trackPlanId, entry.placementRole] as const
          )) ?? []);
          for (const assigned of current.intent.verifiedAssignedTracks) {
            const expected = priorRoles.get(assigned.trackPlanId) ?? null;
            expect(assigned.previousPlacementRole).toBe(expected);
            if (expected) derivedPreviousRoleCount += 1;
          }
        }
      }
    }
    expect(derivedPreviousRoleCount).toBeGreaterThan(0);
  }, 120_000);

  it("keeps all case, preset, texture, winner, score, and mapping metadata out of evaluator payloads", () => {
    const session = fixedSession("blind-session", "blind-seed");
    const payload = createRc7EvaluatorSessionPayload(corpus, session);
    const serialized = JSON.stringify(payload);
    const forbiddenFieldNames = [
      "caseId",
      "preset",
      "texture",
      "grammarRelation",
      "candidateId",
      "candidateContentDigest",
      "opportunityKey",
      "cost",
      "roleTuple",
      "winner",
      "runner-up",
      "mapping",
      "riskTags",
    ];
    for (const field of forbiddenFieldNames) {
      expect(serialized).not.toContain(`\"${field}\"`);
    }

    const internalTokens = [
      ...corpus.comparisons.flatMap((entry) => [
        entry.comparisonId,
        entry.left.metadata.caseId,
        entry.right.metadata.caseId,
        entry.left.metadata.candidateId,
        entry.right.metadata.candidateId,
        entry.left.metadata.opportunityKey,
        entry.right.metadata.opportunityKey,
      ]),
      ...corpus.sections.flatMap((entry) => [entry.sectionId, entry.metadata.caseId]),
    ].filter((entry): entry is string => Boolean(entry));
    for (const token of internalTokens) expect(serialized).not.toContain(token);

    expect(payload).toMatchObject({
      schema: "hm-wag-rc7-evaluator-session-v1",
      comparisonCount: 18,
      sectionCount: 4,
    });
    for (const comparison of payload.comparisons) {
      const decodedA = Buffer.from(comparison.aPlayback, "base64").toString("utf8");
      const decodedB = Buffer.from(comparison.bPlayback, "base64").toString("utf8");
      const decodedLead = Buffer.from(comparison.leadReferencePlayback ?? "", "base64").toString("utf8");
      expect(decodedA).toContain(`T:Comparison ${comparison.ordinal} A`);
      expect(decodedB).toContain(`T:Comparison ${comparison.ordinal} B`);
      expect(decodedLead).toContain(`T:Comparison ${comparison.ordinal} Lead reference`);
      for (const token of internalTokens) {
        expect(decodedA).not.toContain(token);
        expect(decodedB).not.toContain(token);
        expect(decodedLead).not.toContain(token);
      }
    }
  });

  it("reproduces a session order, changes at least one side in another session, and blocks early reveal", () => {
    const first = fixedSession("session-one", "seed-one");
    const repeated = fixedSession("session-one", "seed-one");
    const second = fixedSession("session-two", "seed-two");
    expect(createRc7EvaluatorSessionPayload(corpus, repeated)).toEqual(
      createRc7EvaluatorSessionPayload(corpus, first),
    );
    expect(() => createRc7RevealArtifact(corpus, first, null)).toThrow(
      "RC7_LISTENING_REVEAL_BEFORE_COMPLETION",
    );

    const firstReveal = createRc7RevealArtifact(corpus, first, completionFor(first));
    const repeatedReveal = createRc7RevealArtifact(corpus, repeated, completionFor(repeated));
    const secondReveal = createRc7RevealArtifact(corpus, second, completionFor(second));
    expect(repeatedReveal).toEqual(firstReveal);
    expect(secondReveal.comparisons.some((entry, index) => (
      entry.A.candidateId !== firstReveal.comparisons[index].A.candidateId
        || entry.A.sourceKind !== firstReveal.comparisons[index].A.sourceKind
    ))).toBe(true);
  });

  it("signs the private session material and rejects a modified cookie", () => {
    const session = fixedSession("cookie-session", "cookie-seed");
    const token = encodeRc7SessionCookie(session);
    expect(decodeRc7SessionCookie(token)).toEqual(session);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(() => decodeRc7SessionCookie(tampered)).toThrow("RC7_LISTENING_COOKIE_INVALID");
  });

  it("preserves answers across navigation and editing, then round-trips a complete evaluator-only result", () => {
    const session = fixedSession("response-session", "response-seed");
    const payload = createRc7EvaluatorSessionPayload(corpus, session);
    let state = createListeningState();

    state = reduceListeningState(state, {
      type: "answer-comparison",
      response: {
        ...emptyComparisonResponse(1),
        naturalnessChoice: "A",
        densityChoice: "similar",
        entryExitChoice: "B",
        optionalNote: "first answer",
      },
    });
    state = reduceListeningState(state, { type: "go", cursor: 1, total: 22 });
    state = reduceListeningState(state, { type: "go", cursor: 0, total: 22 });
    expect(state.comparisonResponses[1]?.optionalNote).toBe("first answer");
    state = reduceListeningState(state, {
      type: "answer-comparison",
      response: { ...state.comparisonResponses[1], densityChoice: "A", optionalNote: "edited" },
    });
    expect(state.comparisonResponses[1]).toMatchObject({ densityChoice: "A", optionalNote: "edited" });
    expect(sessionResponsesComplete(payload, state)).toBe(false);
    expect(() => createEvaluatorResult(payload, state)).toThrow("RC7_LISTENING_RESPONSES_INCOMPLETE");

    for (const entry of payload.comparisons) {
      state = reduceListeningState(state, {
        type: "answer-comparison",
        response: {
          ...emptyComparisonResponse(entry.ordinal),
          naturalnessChoice: "A",
          densityChoice: "similar",
          entryExitChoice: "B",
          optionalNote: entry.ordinal === 1 ? "edited" : "",
        },
      });
    }
    for (const entry of payload.sections) {
      state = reduceListeningState(state, {
        type: "answer-section",
        response: {
          ...emptySectionResponse(entry.ordinal),
          densityChoice: "appropriate",
          entryExitChoice: "natural",
          liftChoice: "appropriate",
          fatigueChoice: "none",
          naturalnessChoice: 4,
        },
      });
    }

    expect(sessionResponsesComplete(payload, state)).toBe(true);
    const result = createEvaluatorResult(payload, state);
    expect(() => assertRc7EvaluatorResultComplete(result, corpus, session)).not.toThrow();
    expect(parseEvaluatorResultJson(JSON.stringify(result))).toEqual(result);
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain("caseId");
    expect(serializedResult).not.toContain("candidateId");
    expect(serializedResult).not.toContain("mapping");
  });
});

function fixedSession(sessionId: string, seed: string): Rc7SessionMaterial {
  return createRc7SessionMaterial({
    sessionId,
    seed,
    issuedAt: "2026-08-10T00:00:00.000Z",
  });
}

function completionFor(session: Rc7SessionMaterial): Rc7CompletionMaterial {
  return {
    schema: "hm-wag-rc7-listening-complete-v1",
    sessionId: session.sessionId,
    resultDigest: "test-only-completed-result",
  };
}
