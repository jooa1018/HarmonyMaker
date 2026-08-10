import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { RC7_GRAMMAR_CONFIG_DIGEST } from "../constants";
import type {
  Rc7InternalComparison,
  Rc7InternalListeningCorpus,
  Rc7InternalStimulus,
} from "./corpus";
import {
  comparisonResponseComplete,
  sectionResponseComplete,
} from "./state";
import type {
  Rc7EvaluatorResult,
  Rc7EvaluatorSessionPayload,
} from "./types";

export const RC7_SESSION_COOKIE = "hm_rc7_listening_session";
export const RC7_COMPLETION_COOKIE = "hm_rc7_listening_complete";

const COOKIE_SCHEMA = "hm-wag-rc7-listening-cookie-v1";
const COMPLETION_SCHEMA = "hm-wag-rc7-listening-complete-v1";
const SIGNING_KEY = `${RC7_GRAMMAR_CONFIG_DIGEST}:controlled-listening-review-only-v1`;

export interface Rc7SessionMaterial {
  readonly schema: typeof COOKIE_SCHEMA;
  readonly sessionId: string;
  readonly seed: string;
  readonly issuedAt: string;
}

export interface Rc7CompletionMaterial {
  readonly schema: typeof COMPLETION_SCHEMA;
  readonly sessionId: string;
  readonly resultDigest: string;
}

function sign(payload: string): string {
  return createHmac("sha256", SIGNING_KEY).update(payload).digest("base64url");
}

function seal(value: object): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function unseal(token: string): unknown {
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length > 0) throw new RangeError("RC7_LISTENING_COOKIE_INVALID");
  const expected = Buffer.from(sign(payload), "utf8");
  const observed = Buffer.from(signature, "utf8");
  if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) {
    throw new RangeError("RC7_LISTENING_COOKIE_INVALID");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

export function createRc7SessionMaterial(options: {
  readonly sessionId?: string;
  readonly seed?: string;
  readonly issuedAt?: string;
} = {}): Rc7SessionMaterial {
  return {
    schema: COOKIE_SCHEMA,
    sessionId: options.sessionId ?? randomUUID(),
    seed: options.seed ?? randomBytes(32).toString("hex"),
    issuedAt: options.issuedAt ?? new Date().toISOString(),
  };
}

export function encodeRc7SessionCookie(session: Rc7SessionMaterial): string {
  return seal(session);
}

export function decodeRc7SessionCookie(token: string): Rc7SessionMaterial {
  const parsed = unseal(token) as Partial<Rc7SessionMaterial>;
  if (parsed.schema !== COOKIE_SCHEMA
    || typeof parsed.sessionId !== "string"
    || typeof parsed.seed !== "string"
    || typeof parsed.issuedAt !== "string") {
    throw new RangeError("RC7_LISTENING_COOKIE_INVALID");
  }
  return parsed as Rc7SessionMaterial;
}

export function createRc7CompletionMaterial(
  session: Rc7SessionMaterial,
  result: Rc7EvaluatorResult,
): Rc7CompletionMaterial {
  return {
    schema: COMPLETION_SCHEMA,
    sessionId: session.sessionId,
    resultDigest: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
  };
}

export function encodeRc7CompletionCookie(completion: Rc7CompletionMaterial): string {
  return seal(completion);
}

export function decodeRc7CompletionCookie(token: string): Rc7CompletionMaterial {
  const parsed = unseal(token) as Partial<Rc7CompletionMaterial>;
  if (parsed.schema !== COMPLETION_SCHEMA
    || typeof parsed.sessionId !== "string"
    || typeof parsed.resultDigest !== "string") {
    throw new RangeError("RC7_LISTENING_COMPLETION_COOKIE_INVALID");
  }
  return parsed as Rc7CompletionMaterial;
}

export function rc7ComparisonOrderReversed(seed: string, comparisonId: string): boolean {
  const digest = createHash("sha256").update(`${seed}\0${comparisonId}`).digest();
  return (digest[0] & 1) === 1;
}

function orderedSides(
  comparison: Rc7InternalComparison,
  seed: string,
): readonly [Rc7InternalStimulus, Rc7InternalStimulus] {
  return rc7ComparisonOrderReversed(seed, comparison.comparisonId)
    ? [comparison.right, comparison.left]
    : [comparison.left, comparison.right];
}

function blindPlayback(abc: string, title: string): string {
  const sanitized = abc.replace(/^T:.*$/mu, `T:${title}`);
  return Buffer.from(sanitized, "utf8").toString("base64");
}

export function createRc7EvaluatorSessionPayload(
  corpus: Rc7InternalListeningCorpus,
  session: Rc7SessionMaterial,
): Rc7EvaluatorSessionPayload {
  return {
    schema: "hm-wag-rc7-evaluator-session-v1",
    sessionId: session.sessionId,
    comparisonCount: corpus.comparisons.length,
    sectionCount: corpus.sections.length,
    comparisons: corpus.comparisons.map((comparison, index) => {
      const ordinal = index + 1;
      const [a, b] = orderedSides(comparison, session.seed);
      return {
        ordinal,
        aPlayback: blindPlayback(a.playback, `Comparison ${ordinal} A`),
        bPlayback: blindPlayback(b.playback, `Comparison ${ordinal} B`),
        leadReferencePlayback: blindPlayback(
          comparison.leadReferencePlayback,
          `Comparison ${ordinal} Lead reference`,
        ),
      };
    }),
    sections: corpus.sections.map((section, index) => ({
      ordinal: index + 1,
      playback: blindPlayback(section.playback, `Section review ${index + 1}`),
    })),
  };
}

export function assertRc7EvaluatorResultComplete(
  result: Rc7EvaluatorResult,
  corpus: Rc7InternalListeningCorpus,
  session: Rc7SessionMaterial,
): void {
  const comparisonOrdinals = result.comparisons.map((entry) => entry.comparisonOrdinal);
  const sectionOrdinals = result.sections.map((entry) => entry.sectionOrdinal);
  if (result.schema !== "hm-wag-rc7-evaluator-result-v1"
    || result.sessionId !== session.sessionId
    || result.comparisons.length !== corpus.comparisons.length
    || result.sections.length !== corpus.sections.length
    || new Set(comparisonOrdinals).size !== comparisonOrdinals.length
    || new Set(sectionOrdinals).size !== sectionOrdinals.length
    || !result.comparisons.every((entry) => entry.comparisonOrdinal >= 1
      && entry.comparisonOrdinal <= corpus.comparisons.length
      && comparisonResponseComplete(entry)
      && entry.optionalNote.length <= 2_000)
    || !result.sections.every((entry) => entry.sectionOrdinal >= 1
      && entry.sectionOrdinal <= corpus.sections.length
      && sectionResponseComplete(entry)
      && entry.optionalNote.length <= 2_000)) {
    throw new RangeError("RC7_LISTENING_RESPONSES_INCOMPLETE");
  }
}

export function createRc7RevealArtifact(
  corpus: Rc7InternalListeningCorpus,
  session: Rc7SessionMaterial,
  completion: Rc7CompletionMaterial | null,
) {
  if (!completion || completion.sessionId !== session.sessionId) {
    throw new RangeError("RC7_LISTENING_REVEAL_BEFORE_COMPLETION");
  }
  return {
    schema: "hm-wag-rc7-listening-reveal-v1",
    sessionId: session.sessionId,
    comparisons: corpus.comparisons.map((comparison, index) => {
      const [a, b] = orderedSides(comparison, session.seed);
      return {
        comparisonId: comparison.comparisonId,
        comparisonOrdinal: index + 1,
        comparisonType: comparison.comparisonType,
        riskTags: comparison.riskTags,
        A: a.metadata,
        B: b.metadata,
      };
    }),
    sections: corpus.sections.map((section, index) => ({
      sectionOrdinal: index + 1,
      sectionId: section.sectionId,
      songLike: section.songLike,
      bars: section.bars,
      phraseCount: section.phraseCount,
      riskTags: section.riskTags,
      actual: section.metadata,
    })),
  };
}
