import {
  isSpelledPitchClass, spelledPitchClass, type Alter, type SpelledPitchClass, type Step,
} from "../pitch";
import { canonicalJson } from "../digest/canonical";
import { hasExactKeys, isPlainRecord } from "../validation";
import type {
  ChordDegree, ChordParseErrorCode, ChordParseResult, ChordToneOrigin,
  ChordToneRole, ChordToneSpec, ParsedChord,
} from "./model";

type Quality = "major" | "minor" | "dim" | "aug";
type Primary = "2" | "6" | "6/9" | "7" | "maj7" | "9" | "maj9";
type Suspension = "sus2" | "sus4";
type SemanticToken =
  | { readonly kind: "quality"; readonly value: Quality }
  | { readonly kind: "primary"; readonly value: Primary }
  | { readonly kind: "suspension"; readonly value: Suspension }
  | { readonly kind: "addition"; readonly value: ChordDegree }
  | { readonly kind: "alteration"; readonly degree: ChordDegree; readonly alteration: Alter }
  | { readonly kind: "omission"; readonly value: 3 | 5 }
  | { readonly kind: "composite"; readonly quality: Quality; readonly primary?: Primary; readonly fifthAlteration?: Alter };

interface TokenDefinition {
  readonly text: string;
  readonly semantic: SemanticToken;
}

const defineToken = (text: string, semantic: SemanticToken): TokenDefinition => ({ text, semantic });

const tokenDefinitions: readonly TokenDefinition[] = [
  ...["minMaj9", "mMaj9"].map((text) => defineToken(text, { kind: "composite", quality: "minor", primary: "maj9" })),
  ...["minMaj7", "mMaj7"].map((text) => defineToken(text, { kind: "composite", quality: "minor", primary: "maj7" })),
  ...["maj9", "MAJ9", "Maj9", "M9", "Δ9"].map((text) => defineToken(text, { kind: "primary", value: "maj9" })),
  ...["maj7", "MAJ7", "Maj7", "M7", "Δ7"].map((text) => defineToken(text, { kind: "primary", value: "maj7" })),
  ...["min7b5", "m7b5", "ø7", "ø"].map((text) => defineToken(text, { kind: "composite", quality: "minor", primary: "7", fifthAlteration: -1 })),
  ...["dim7", "°7"].map((text) => defineToken(text, { kind: "composite", quality: "dim", primary: "7" })),
  ...([13, 11, 9, 6, 4, 2] as const).map((degree) => defineToken(`add${degree}`, { kind: "addition", value: degree })),
  defineToken("sus4", { kind: "suspension", value: "sus4" }),
  defineToken("sus2", { kind: "suspension", value: "sus2" }),
  defineToken("sus", { kind: "suspension", value: "sus4" }),
  defineToken("no5", { kind: "omission", value: 5 }),
  defineToken("no3", { kind: "omission", value: 3 }),
  defineToken("6/9", { kind: "primary", value: "6/9" }),
  defineToken("#11", { kind: "alteration", degree: 11, alteration: 1 }),
  defineToken("b13", { kind: "alteration", degree: 13, alteration: -1 }),
  defineToken("b9", { kind: "alteration", degree: 9, alteration: -1 }),
  defineToken("#9", { kind: "alteration", degree: 9, alteration: 1 }),
  defineToken("b5", { kind: "alteration", degree: 5, alteration: -1 }),
  defineToken("#5", { kind: "alteration", degree: 5, alteration: 1 }),
  defineToken("min", { kind: "quality", value: "minor" }),
  defineToken("dim", { kind: "quality", value: "dim" }),
  defineToken("aug", { kind: "quality", value: "aug" }),
  defineToken("maj", { kind: "quality", value: "major" }),
  defineToken("m", { kind: "quality", value: "minor" }),
  defineToken("-", { kind: "quality", value: "minor" }),
  defineToken("+", { kind: "quality", value: "aug" }),
  defineToken("°", { kind: "quality", value: "dim" }),
  defineToken("Δ", { kind: "quality", value: "major" }),
  defineToken("9", { kind: "primary", value: "9" }),
  defineToken("7", { kind: "primary", value: "7" }),
  defineToken("6", { kind: "primary", value: "6" }),
  defineToken("2", { kind: "primary", value: "2" }),
].sort((left, right) => right.text.length - left.text.length);

const parenthesizedModifierDefinitions = tokenDefinitions.filter((definition) =>
  definition.semantic.kind === "addition"
  || definition.semantic.kind === "alteration"
  || definition.semantic.kind === "omission");

const degreeOrder: Readonly<Record<ChordDegree, number>> = { 1: 0, 3: 1, 4: 1, 5: 2, 6: 3, 7: 4, 2: 5, 9: 6, 11: 7, 13: 8 };
const tokenRank: Readonly<Record<SemanticToken["kind"], number>> = {
  composite: 1, quality: 1, primary: 2, suspension: 3, addition: 4, alteration: 5, omission: 6,
};

function failure(sourceText: string, errorCode: ChordParseErrorCode, token?: string): ChordParseResult {
  return token === undefined ? { status: "failed", sourceText, errorCode } : { status: "failed", sourceText, errorCode, token };
}

function parsePitchClass(text: string): SpelledPitchClass | undefined {
  const match = /^([A-G])((?:##|bb|#|b)?)$/.exec(text.replaceAll("♯", "#").replaceAll("♭", "b"));
  if (!match) return undefined;
  const alterations: Readonly<Record<string, Alter>> = { "": 0, b: -1, bb: -2, "#": 1, "##": 2 };
  return spelledPitchClass(match[1] as Step, alterations[match[2]]);
}

function pitchClassSymbol(pitch: SpelledPitchClass): string {
  const suffix: Readonly<Record<Alter, string>> = { [-2]: "bb", [-1]: "b", [0]: "", [1]: "#", [2]: "##" };
  return `${pitch.step}${suffix[pitch.alter]}`;
}

function roleFor(degree: ChordDegree, origin: ChordToneOrigin): ChordToneRole {
  if (degree === 1) return "root";
  if (origin === "suspension") return "suspension";
  if (degree === 3) return "third";
  if (degree === 5) return "fifth";
  if (degree === 7) return "seventh";
  return "color";
}

function tone(degree: ChordDegree, alteration: Alter, origin: ChordToneOrigin): ChordToneSpec {
  return { degree, alteration, role: roleFor(degree, origin), origin };
}

function parseBody(sourceText: string, body: string): { readonly tokens: readonly SemanticToken[]; readonly bass?: SpelledPitchClass } | ChordParseResult {
  const compact = body.replace(/\s*([/,])\s*/g, "$1");
  if (/\s/u.test(compact)) return failure(sourceText, "UNSUPPORTED_TOKEN", compact);
  let flattened = compact;
  if (flattened.includes("(")) {
    const match = /^([^()]*)\(([^()]*)\)(\/[^()]*)?$/.exec(flattened);
    if (!match) return failure(sourceText, "INVALID_TOKEN_ORDER");
    const parenthesized = match[2];
    if (parenthesized.length === 0
      || parenthesized.startsWith(",")
      || parenthesized.endsWith(",")
      || parenthesized.includes(",,")) return failure(sourceText, "INVALID_TOKEN_ORDER");
    for (const group of parenthesized.split(",")) {
      let remainingGroup = group;
      let modifierCount = 0;
      while (remainingGroup.length > 0) {
        const definition = parenthesizedModifierDefinitions.find((entry) =>
          remainingGroup.startsWith(entry.text));
        if (!definition) return failure(sourceText, "INVALID_TOKEN_ORDER", remainingGroup);
        modifierCount += 1;
        remainingGroup = remainingGroup.slice(definition.text.length);
      }
      if (modifierCount === 0) return failure(sourceText, "INVALID_TOKEN_ORDER");
    }
    flattened = `${match[1]}${parenthesized.replaceAll(",", "")}${match[3] ?? ""}`;
  } else if (flattened.includes(")") || flattened.includes(",")) {
    return failure(sourceText, "INVALID_TOKEN_ORDER");
  }
  const tokens: SemanticToken[] = [];
  let remaining = flattened;
  let lastRank = 0;
  while (remaining.length > 0 && !remaining.startsWith("/")) {
    const definition = tokenDefinitions.find((entry) => remaining.startsWith(entry.text));
    if (!definition) return failure(sourceText, "UNSUPPORTED_TOKEN", remaining);
    const rank = tokenRank[definition.semantic.kind];
    if (rank < lastRank) return failure(sourceText, "INVALID_TOKEN_ORDER", definition.text);
    lastRank = rank;
    tokens.push(definition.semantic);
    remaining = remaining.slice(definition.text.length);
  }
  if (remaining === "") return { tokens };
  if (!remaining.startsWith("/") || remaining.indexOf("/", 1) >= 0) return failure(sourceText, "AMBIGUOUS_SLASH", remaining);
  const bass = parsePitchClass(remaining.slice(1));
  return bass ? { tokens, bass } : failure(sourceText, "AMBIGUOUS_SLASH", remaining);
}

function buildChord(sourceText: string, root: SpelledPitchClass, body: ReturnType<typeof parseBody>): ChordParseResult {
  if ("status" in body) return body;
  let quality: Quality = "major";
  let explicitQuality = false;
  let primary: Primary | undefined;
  let suspension: Suspension | undefined;
  const additions = new Set<ChordDegree>();
  const alterations = new Map<ChordDegree, Alter>();
  const omissions = new Set<3 | 5>();
  for (const token of body.tokens) {
    if (token.kind === "quality") {
      if (explicitQuality) return failure(sourceText, "TOKEN_CONFLICT");
      quality = token.value; explicitQuality = true;
    } else if (token.kind === "primary") {
      if (primary !== undefined) return failure(sourceText, "TOKEN_CONFLICT");
      primary = token.value;
    } else if (token.kind === "suspension") {
      if (suspension !== undefined) return failure(sourceText, "TOKEN_CONFLICT");
      suspension = token.value;
    } else if (token.kind === "addition") {
      if (additions.has(token.value)) return failure(sourceText, "TOKEN_CONFLICT");
      additions.add(token.value);
    } else if (token.kind === "alteration") {
      const previous = alterations.get(token.degree);
      if (previous !== undefined) return failure(sourceText, "TOKEN_CONFLICT");
      alterations.set(token.degree, token.alteration);
    } else if (token.kind === "omission") {
      if (omissions.has(token.value)) return failure(sourceText, "TOKEN_CONFLICT");
      omissions.add(token.value);
    } else {
      if (explicitQuality) return failure(sourceText, "TOKEN_CONFLICT");
      if (primary !== undefined && token.primary !== undefined) return failure(sourceText, "TOKEN_CONFLICT");
      quality = token.quality; explicitQuality = true;
      primary = token.primary ?? primary;
      if (token.fifthAlteration !== undefined) alterations.set(5, token.fifthAlteration);
    }
  }
  if (quality === "minor" && suspension !== undefined) return failure(sourceText, "TOKEN_CONFLICT");
  if (quality === "dim" && primary !== undefined && primary !== "7") return failure(sourceText, "TOKEN_CONFLICT");
  if (quality === "aug" && primary !== undefined && primary !== "7") return failure(sourceText, "TOKEN_CONFLICT");
  if (suspension !== undefined && primary !== undefined && !["7"].includes(primary)) return failure(sourceText, "TOKEN_CONFLICT");

  const tones = new Map<ChordDegree, ChordToneSpec>();
  tones.set(1, tone(1, 0, "root"));
  if (!omissions.has(3) && suspension === undefined) tones.set(3, tone(3, quality === "minor" || quality === "dim" ? -1 : 0, "quality"));
  if (!omissions.has(5)) tones.set(5, tone(5, quality === "dim" ? -1 : quality === "aug" ? 1 : 0, "quality"));
  if (suspension !== undefined) {
    const degree = suspension === "sus2" ? 2 : 4;
    tones.set(degree, tone(degree, 0, "suspension"));
  }
  const extensionTones: readonly [ChordDegree, Alter][] =
    primary === "2" ? [[2, 0]] : primary === "6" ? [[6, 0]] : primary === "6/9" ? [[6, 0], [9, 0]] :
    primary === "7" ? [[7, quality === "dim" ? -2 : -1]] : primary === "maj7" ? [[7, 0]] :
    primary === "9" ? [[7, -1], [9, 0]] : primary === "maj9" ? [[7, 0], [9, 0]] : [];
  for (const [degree, alteration] of extensionTones) tones.set(degree, tone(degree, alteration, "extension"));
  for (const degree of additions) tones.set(degree, tone(degree, 0, "addition"));
  for (const [degree, alteration] of alterations) {
    if (degree === 5 && omissions.has(5)) return failure(sourceText, "TOKEN_CONFLICT");
    tones.set(degree, tone(degree, alteration, "alteration"));
  }
  for (const omission of omissions) tones.delete(omission);

  const sortedTones = [...tones.values()].sort((a, b) => degreeOrder[a.degree] - degreeOrder[b.degree] || a.degree - b.degree || a.alteration - b.alteration || a.origin.localeCompare(b.origin));
  const qualitySymbol = quality === "minor" ? "m" : quality === "dim" ? "dim" : quality === "aug" ? "aug" : "";
  const normalizedPrimary = primary === "2" ? undefined : primary;
  const primarySymbol = primary === "2" ? "add2" : normalizedPrimary ?? "";
  const additionSymbols = [...additions].filter((degree) => !(primary === "2" && degree === 2)).sort((a, b) => a - b).map((degree) => `add${degree}`).join("");
  const alterationSymbols = [...alterations.entries()].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([degree, alter]) => `${alter < 0 ? "b" : "#"}${degree}`).join("");
  const omissionSymbols = ([3, 5] as const).filter((degree) => omissions.has(degree)).map((degree) => `no${degree}`).join("");
  const canonicalSymbol = `${pitchClassSymbol(root)}${qualitySymbol}${primarySymbol}${suspension ?? ""}${additionSymbols}${alterationSymbols}${omissionSymbols}${body.bass ? `/${pitchClassSymbol(body.bass)}` : ""}`;
  const chord: ParsedChord = { root, tones: sortedTones, omissions: [...omissions].sort(), canonicalSymbol, ...(body.bass ? { bass: body.bass } : {}) };
  return { status: "ok", chord };
}

export function parseChord(sourceText: string): ChordParseResult {
  const trimmed = sourceText.trim();
  if (trimmed === "") return failure(sourceText, "EMPTY_CHORD");
  if (/^(?:N\.C\.?|NC)$/i.test(trimmed)) return { status: "no-chord", sourceText };
  if (trimmed === "%") return { status: "carry", sourceText };
  const normalized = trimmed.replaceAll("♯", "#").replaceAll("♭", "b");
  const rootMatch = /^([A-G])((?:##|bb|#|b)?)/.exec(normalized);
  if (!rootMatch) return failure(sourceText, "UNKNOWN_ROOT", normalized[0]);
  const root = parsePitchClass(`${rootMatch[1]}${rootMatch[2]}`);
  if (!root) return failure(sourceText, "UNKNOWN_ROOT", rootMatch[0]);
  const body = parseBody(sourceText, normalized.slice(rootMatch[0].length));
  return buildChord(sourceText, root, body);
}

export function chordSemanticProjection(chord: ParsedChord): object {
  return { root: chord.root, tones: chord.tones, bass: chord.bass ?? null, omissions: chord.omissions };
}

export function isChordParseResult(value: unknown): value is ChordParseResult {
  if (!isPlainRecord(value)) return false;
  if (value.status === "no-chord" || value.status === "carry") {
    return hasExactKeys(value, ["status", "sourceText"])
      && typeof value.sourceText === "string";
  }
  if (value.status === "failed") {
    return hasExactKeys(value, ["status", "sourceText", "errorCode"], ["token"])
      && typeof value.sourceText === "string"
      && ["UNKNOWN_ROOT", "TOKEN_CONFLICT", "UNSUPPORTED_TOKEN", "AMBIGUOUS_SLASH", "EMPTY_CHORD", "INVALID_TOKEN_ORDER"].includes(String(value.errorCode))
      && (value.token === undefined || typeof value.token === "string");
  }
  return value.status === "ok"
    && hasExactKeys(value, ["status", "chord"])
    && isParsedChord(value.chord);
}

export function isParsedChord(value: unknown): value is ParsedChord {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["root", "tones", "omissions", "canonicalSymbol"], ["bass"])
    || !isSpelledPitchClass(value.root)
    || (value.bass !== undefined && !isSpelledPitchClass(value.bass))
    || !Array.isArray(value.tones)
    || !Array.isArray(value.omissions)
    || typeof value.canonicalSymbol !== "string"
    || value.canonicalSymbol.length === 0) return false;
  const degrees: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 9, 11, 13];
  const roles: readonly string[] = ["root", "third", "fifth", "seventh", "color", "suspension"];
  const origins: readonly string[] = ["root", "quality", "extension", "addition", "alteration", "suspension"];
  const tonesValid = value.tones.every((candidate) => {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["degree", "alteration", "role", "origin"])) return false;
    if (!degrees.includes(candidate.degree as number)
      || ![-2, -1, 0, 1, 2].includes(candidate.alteration as number)
      || !roles.includes(String(candidate.role))
      || !origins.includes(String(candidate.origin))) return false;
    return candidate.role === roleFor(candidate.degree as ChordDegree, candidate.origin as ChordToneOrigin);
  });
  if (!tonesValid) return false;
  const typedTones = value.tones as unknown as readonly ChordToneSpec[];
  const sortedTones = [...typedTones].sort((a, b) => degreeOrder[a.degree] - degreeOrder[b.degree] || a.degree - b.degree || a.alteration - b.alteration || a.origin.localeCompare(b.origin));
  if (canonicalJson(sortedTones) !== canonicalJson(typedTones)
    || new Set(typedTones.map((item) => item.degree)).size !== typedTones.length) return false;
  if (!value.omissions.every((degree) => degree === 3 || degree === 5)
    || new Set(value.omissions).size !== value.omissions.length
    || canonicalJson(value.omissions) !== canonicalJson([...value.omissions].sort((a, b) => (a as number) - (b as number)))) return false;
  const reparsed = parseChord(value.canonicalSymbol);
  return reparsed.status === "ok"
    && reparsed.chord.canonicalSymbol === value.canonicalSymbol
    && canonicalJson(chordSemanticProjection(reparsed.chord)) === canonicalJson(chordSemanticProjection(value as unknown as ParsedChord));
}
