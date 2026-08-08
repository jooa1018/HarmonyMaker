import type { Alter, SpelledPitchClass } from "../pitch";

export type ChordDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 11 | 13;
export type ChordToneRole = "root" | "third" | "fifth" | "seventh" | "color" | "suspension";
export type ChordToneOrigin = "root" | "quality" | "extension" | "addition" | "alteration" | "suspension";
export interface ChordToneSpec {
  readonly degree: ChordDegree;
  readonly alteration: Alter;
  readonly role: ChordToneRole;
  readonly origin: ChordToneOrigin;
}
export interface ParsedChord {
  readonly root: SpelledPitchClass;
  readonly tones: readonly ChordToneSpec[];
  readonly bass?: SpelledPitchClass;
  readonly omissions: readonly ChordDegree[];
  readonly canonicalSymbol: string;
}
export type ChordParseErrorCode =
  | "UNKNOWN_ROOT" | "TOKEN_CONFLICT" | "UNSUPPORTED_TOKEN"
  | "AMBIGUOUS_SLASH" | "EMPTY_CHORD" | "INVALID_TOKEN_ORDER";
export type ChordParseResult =
  | { readonly status: "ok"; readonly chord: ParsedChord }
  | { readonly status: "no-chord"; readonly sourceText: string }
  | { readonly status: "carry"; readonly sourceText: string }
  | { readonly status: "failed"; readonly sourceText: string; readonly errorCode: ChordParseErrorCode; readonly token?: string };
export type ResolvedChordParseResult =
  | { readonly status: "ok"; readonly chord: ParsedChord }
  | { readonly status: "no-chord"; readonly sourceText: string };

