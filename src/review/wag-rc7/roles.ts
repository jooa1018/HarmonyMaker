import type { ChordToneSpec, ParsedChord } from "../../domain/chord/model";
import { canonicalJson } from "../../domain/digest/canonical";
import { containsPitch, pitchMidiNumber, type SpelledPitch } from "../../domain/pitch";
import type { VocalPlacementRole } from "../../domain/performer";
import { RC7_FROZEN_CONFIG } from "./config";
import {
  chordSpanAt,
  leadPitchAt,
  pitchesForToneInRange,
  toneForPitch,
} from "./music";
import type {
  Rc7FeatureAnalysis,
} from "./features";
import type {
  Rc7PreparedCase,
  Rc7SymbolicHarmonyRoleObligation,
  Rc7VerifiedAssignedTrack,
} from "./types";

const ROLE_PRIORITY: Readonly<Record<ChordToneSpec["role"], number>> = {
  root: 0,
  third: 1,
  suspension: 1,
  seventh: 2,
  fifth: 3,
  color: 4,
};

function identityCritical(tone: ChordToneSpec): boolean {
  return tone.role === "root"
    || tone.role === "third"
    || tone.role === "suspension"
    || tone.role === "seventh";
}

function roleAllowsPitch(
  role: VocalPlacementRole,
  pitch: SpelledPitch,
  lead: SpelledPitch | null,
): boolean {
  if (!lead) return true;
  const distance = pitchMidiNumber(pitch) - pitchMidiNumber(lead);
  return role === "upper" ? distance > 0 && distance <= 16 : distance < 0 && distance >= -16;
}

function registerStress(track: Rc7VerifiedAssignedTrack, pitch: SpelledPitch): 0 | 1 | 2 {
  if (track.preferredTessitura && containsPitch(track.preferredTessitura, pitch)) return 0;
  if (containsPitch(track.comfortableRange, pitch)) return 1;
  return 2;
}

function feasiblePitches(
  chord: ParsedChord,
  tone: ChordToneSpec,
  track: Rc7VerifiedAssignedTrack,
  role: VocalPlacementRole,
  lead: SpelledPitch | null,
): readonly SpelledPitch[] {
  return pitchesForToneInRange(chord, tone, track.hardRange)
    .filter((pitch) => roleAllowsPitch(role, pitch, lead))
    .sort((left, right) => registerStress(track, left) - registerStress(track, right)
      || Math.abs((lead ? pitchMidiNumber(lead) : 60) - pitchMidiNumber(left))
        - Math.abs((lead ? pitchMidiNumber(lead) : 60) - pitchMidiNumber(right))
      || pitchMidiNumber(left) - pitchMidiNumber(right));
}

function vectorItem(
  position: Rc7SymbolicHarmonyRoleObligation["anchorPosition"],
  chordSpanOrdinal: number,
  tone: ChordToneSpec,
): Rc7SymbolicHarmonyRoleObligation {
  return {
    anchorPosition: position,
    chordSpanCanonicalOrdinal: chordSpanOrdinal,
    degree: tone.degree,
    alteration: tone.alteration,
    role: tone.role,
    origin: tone.origin,
  };
}

function canonicalOrdinalForSpan(
  analysis: Rc7FeatureAnalysis,
  span: Rc7FeatureAnalysis["phraseChordSpans"][number],
): number {
  const localOrdinal = analysis.phraseChordSpans.indexOf(span);
  const canonicalOrdinal = analysis.phraseChordSpanOrdinals[localOrdinal];
  if (!Number.isSafeInteger(canonicalOrdinal)) throw new RangeError("RC7_CHORD_SPAN_ORDINAL_GRAPH_INVALID");
  return canonicalOrdinal;
}

function spanForCanonicalOrdinal(
  analysis: Rc7FeatureAnalysis,
  canonicalOrdinal: number,
) {
  const localOrdinal = analysis.phraseChordSpanOrdinals.indexOf(canonicalOrdinal);
  return localOrdinal < 0 ? undefined : analysis.phraseChordSpans[localOrdinal];
}

function sameTone(
  left: Rc7SymbolicHarmonyRoleObligation | undefined,
  right: ChordToneSpec,
): boolean {
  return Boolean(left
    && left.degree === right.degree
    && left.alteration === right.alteration
    && left.role === right.role
    && left.origin === right.origin);
}

export function resolvePrimaryRoleObligations(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  anchorPositions: readonly Rc7SymbolicHarmonyRoleObligation["anchorPosition"][],
  track: Rc7VerifiedAssignedTrack,
  role: VocalPlacementRole,
): readonly Rc7SymbolicHarmonyRoleObligation[] | null {
  const result: Rc7SymbolicHarmonyRoleObligation[] = [];
  let previous: Rc7SymbolicHarmonyRoleObligation | undefined;
  for (const position of anchorPositions) {
    const span = chordSpanAt(position, analysis.phraseChordSpans);
    if (!span || span.parseResult.status !== "ok") return null;
    const chord = span.parseResult.chord;
    const lead = leadPitchAt(position, analysis.phraseAtoms);
    const leadRole = lead ? toneForPitch(chord, lead)?.role : undefined;
    const candidates = chord.tones.map((tone, toneOrdinal) => {
      const feasible = feasiblePitches(chord, tone, track, role, lead);
      if (feasible.length === 0) return null;
      return {
        tone,
        tuple: [
          identityCritical(tone) ? 0 : 1,
          tone.role === leadRole ? 1 : 0,
          ROLE_PRIORITY[tone.role],
          sameTone(previous, tone) ? 0 : 1,
          toneOrdinal,
          registerStress(track, feasible[0]),
          canonicalJson(tone),
        ] as const,
      };
    }).filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((left, right) => {
        for (let index = 0; index < left.tuple.length; index += 1) {
          if (left.tuple[index] < right.tuple[index]) return -1;
          if (left.tuple[index] > right.tuple[index]) return 1;
        }
        return 0;
      });
    const selected = candidates[0];
    if (!selected) return null;
    const chordSpanOrdinal = canonicalOrdinalForSpan(analysis, span);
    previous = vectorItem(position, chordSpanOrdinal, selected.tone);
    result.push(previous);
  }
  return result;
}

export function resolveSecondTrackContributions(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  anchorPositions: readonly Rc7SymbolicHarmonyRoleObligation["anchorPosition"][],
  primary: readonly Rc7SymbolicHarmonyRoleObligation[],
  track: Rc7VerifiedAssignedTrack,
  role: VocalPlacementRole,
): readonly Rc7SymbolicHarmonyRoleObligation[] | null {
  if (anchorPositions.length !== primary.length) return null;
  const result: Rc7SymbolicHarmonyRoleObligation[] = [];
  for (let index = 0; index < anchorPositions.length; index += 1) {
    const position = anchorPositions[index];
    const span = chordSpanAt(position, analysis.phraseChordSpans);
    if (!span || span.parseResult.status !== "ok") return null;
    const chord = span.parseResult.chord;
    const lead = leadPitchAt(position, analysis.phraseAtoms);
    const covered = new Set<string>([primary[index].role]);
    const leadTone = lead ? toneForPitch(chord, lead) : undefined;
    if (leadTone) covered.add(leadTone.role);
    const candidates = chord.tones.map((tone, toneOrdinal) => {
      if (!identityCritical(tone) || covered.has(tone.role)) return null;
      const feasible = feasiblePitches(chord, tone, track, role, lead);
      if (feasible.length === 0 || !feasible.some((pitch) => containsPitch(track.comfortableRange, pitch))) return null;
      return {
        tone,
        tuple: [
          ROLE_PRIORITY[tone.role],
          toneOrdinal,
          registerStress(track, feasible[0]),
          canonicalJson(tone),
        ] as const,
      };
    }).filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((left, right) => {
        for (let tupleIndex = 0; tupleIndex < left.tuple.length; tupleIndex += 1) {
          if (left.tuple[tupleIndex] < right.tuple[tupleIndex]) return -1;
          if (left.tuple[tupleIndex] > right.tuple[tupleIndex]) return 1;
        }
        return 0;
      });
    if (!candidates[0]) return null;
    result.push(vectorItem(position, canonicalOrdinalForSpan(analysis, span), candidates[0].tone));
  }
  return result;
}

function bandCost(missBp: number, bands: readonly { readonly maxMissBp: number; readonly cost: number }[]): number {
  return bands.find((band) => missBp <= band.maxMissBp)?.cost ?? bands.at(-1)?.cost ?? 0;
}

function vectorStressCost(
  analysis: Rc7FeatureAnalysis,
  vector: readonly Rc7SymbolicHarmonyRoleObligation[],
  track: Rc7VerifiedAssignedTrack,
  role: VocalPlacementRole,
): number {
  let comfortableMiss = 0;
  let preferredMiss = 0;
  for (const item of vector) {
    const span = spanForCanonicalOrdinal(analysis, item.chordSpanCanonicalOrdinal);
    if (!span || span.parseResult.status !== "ok") return 100_000;
    const tone = span.parseResult.chord.tones.find((candidate) => candidate.degree === item.degree
      && candidate.alteration === item.alteration
      && candidate.role === item.role
      && candidate.origin === item.origin);
    if (!tone) return 100_000;
    const lead = leadPitchAt(item.anchorPosition, analysis.phraseAtoms);
    const pitches = feasiblePitches(span.parseResult.chord, tone, track, role, lead);
    if (pitches.length === 0) return 100_000;
    if (!pitches.some((pitch) => containsPitch(track.comfortableRange, pitch))) comfortableMiss += 1;
    if (track.preferredTessitura && !pitches.some((pitch) => containsPitch(track.preferredTessitura!, pitch))) preferredMiss += 1;
  }
  if (vector.length === 0) return 0;
  const comfortableBp = Math.floor((comfortableMiss * 10_000 + Math.floor(vector.length / 2)) / vector.length);
  const preferredBp = Math.floor((preferredMiss * 10_000 + Math.floor(vector.length / 2)) / vector.length);
  return bandCost(comfortableBp, RC7_FROZEN_CONFIG.rolePolicy.comfortableMissCostBandsBp)
    + bandCost(preferredBp, RC7_FROZEN_CONFIG.rolePolicy.preferredMissCostBandsBp);
}

export interface Rc7RoleResolution {
  readonly roleByTrackPlanId: Readonly<Record<string, VocalPlacementRole>>;
  readonly primary: readonly Rc7SymbolicHarmonyRoleObligation[];
  readonly secondary: readonly Rc7SymbolicHarmonyRoleObligation[];
  readonly rangeStressCostByTrackOrdinal: Readonly<Record<number, number>>;
}

export function resolveRolesAndObligations(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  assignedTracks: readonly Rc7VerifiedAssignedTrack[],
  activeTrackCount: 1 | 2,
  anchorPositions: readonly Rc7SymbolicHarmonyRoleObligation["anchorPosition"][],
): Rc7RoleResolution | null {
  const tracks = assignedTracks.slice(0, activeTrackCount);
  if (tracks.length !== activeTrackCount) return null;
  if (activeTrackCount === 2) {
    const primaryTrack = tracks[0];
    const secondaryTrack = tracks[1];
    const primary = resolvePrimaryRoleObligations(prepared, analysis, anchorPositions, primaryTrack, "upper");
    if (!primary) return null;
    const secondary = resolveSecondTrackContributions(prepared, analysis, anchorPositions, primary, secondaryTrack, "lower");
    if (!secondary) return null;
    return {
      roleByTrackPlanId: { [primaryTrack.trackPlanId]: "upper", [secondaryTrack.trackPlanId]: "lower" },
      primary,
      secondary,
      rangeStressCostByTrackOrdinal: {
        [primaryTrack.trackOrdinal]: vectorStressCost(analysis, primary, primaryTrack, "upper"),
        [secondaryTrack.trackOrdinal]: vectorStressCost(analysis, secondary, secondaryTrack, "lower"),
      },
    };
  }

  const track = tracks[0];
  const roles: readonly VocalPlacementRole[] = track.previousPlacementRole
    ? [track.previousPlacementRole, track.previousPlacementRole === "upper" ? "lower" : "upper"]
    : ["upper", "lower"];
  const candidates = roles.map((role) => {
    const primary = resolvePrimaryRoleObligations(prepared, analysis, anchorPositions, track, role);
    if (!primary) return null;
    return {
      role,
      primary,
      cost: vectorStressCost(analysis, primary, track, role)
        + (track.previousPlacementRole && track.previousPlacementRole !== role
          ? RC7_FROZEN_CONFIG.rolePolicy.roleChangeCost[prepared.presetId] ?? 100_000
          : 0),
    };
  }).filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((left, right) => left.cost - right.cost
      || (left.role === "upper" ? -1 : 1));
  if (!candidates[0]) return null;
  return {
    roleByTrackPlanId: { [track.trackPlanId]: candidates[0].role },
    primary: candidates[0].primary,
    secondary: [],
    rangeStressCostByTrackOrdinal: { [track.trackOrdinal]: candidates[0].cost },
  };
}

export function chordToneFromObligation(
  chord: ParsedChord,
  obligation: Rc7SymbolicHarmonyRoleObligation,
): ChordToneSpec | undefined {
  return chord.tones.find((tone) => tone.degree === obligation.degree
    && tone.alteration === obligation.alteration
    && tone.role === obligation.role
    && tone.origin === obligation.origin);
}

export function legalPitchesForObligation(
  analysis: Rc7FeatureAnalysis,
  obligation: Rc7SymbolicHarmonyRoleObligation,
  track: Rc7VerifiedAssignedTrack,
  role: VocalPlacementRole,
): readonly SpelledPitch[] {
  const span = spanForCanonicalOrdinal(analysis, obligation.chordSpanCanonicalOrdinal);
  if (!span || span.parseResult.status !== "ok") return [];
  const tone = chordToneFromObligation(span.parseResult.chord, obligation);
  if (!tone) return [];
  return feasiblePitches(span.parseResult.chord, tone, track, role, leadPitchAt(obligation.anchorPosition, analysis.phraseAtoms));
}
