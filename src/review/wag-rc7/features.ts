import { compareCanonicalValues } from "../../domain/digest/canonical";
import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  subtractFractions,
  type Fraction,
} from "../../domain/fraction";
import { pitchMidiNumber } from "../../domain/pitch";
import type { PhraseFeatures } from "../../domain/plans";
import { resolveProductionLyricEmphasis } from "../../domain/source/lyrics";
import { comparePositions, compareRanges } from "../../domain/time";
import { RC7_FROZEN_CONFIG } from "./config";
import {
  chordTonePitchClass,
  fractionCeil,
  fractionToNumber,
  positionToGlobalQ,
  primaryPulseDuration,
  rangeDurationQ,
  roundHalfUpBasisPoints,
  scaleFraction,
} from "./music";
import { measureDurationsForCase } from "./prepare";
import type { Rc7DerivedCue, Rc7PreparedCase } from "./types";

export interface Rc7FeatureAnalysis {
  readonly features: PhraseFeatures;
  readonly cues: readonly Rc7DerivedCue[];
  readonly phraseDurationQ: Fraction;
  readonly primaryPulseQ: Fraction;
  readonly phraseAtoms: Rc7PreparedCase["sourceLeadAtomization"]["atoms"];
  readonly phraseChordSpans: Rc7PreparedCase["effectiveChordTimeline"]["spans"];
  readonly phraseChordSpanOrdinals: readonly number[];
  readonly leadAttackRatePerQuarterBp: number;
}

function phraseAtoms(prepared: Rc7PreparedCase) {
  return prepared.sourceLeadAtomization.atoms
    .filter((atom) => comparePositions(atom.range.start, prepared.phrase.range.end) < 0
      && comparePositions(atom.range.end, prepared.phrase.range.start) > 0)
    .sort((left, right) => compareRanges(left.range, right.range));
}

function phraseSpans(prepared: Rc7PreparedCase) {
  return prepared.effectiveChordTimeline.spans
    .filter((span) => comparePositions(span.range.start, prepared.phrase.range.end) < 0
      && comparePositions(span.range.end, prepared.phrase.range.start) > 0)
    .sort((left, right) => compareRanges(left.range, right.range));
}

function cueKey(cue: Rc7DerivedCue): object {
  return {
    semantic: cue.semantic,
    position: cue.position,
    sourceAtomOrdinal: cue.sourceAtomOrdinal,
    cueCost: cue.cueCost,
    reasonOrdinal: cue.reasonOrdinal,
  };
}

function chordPitchClasses(span: Rc7PreparedCase["effectiveChordTimeline"]["spans"][number]): ReadonlySet<number> {
  const parseResult = span.parseResult;
  if (parseResult.status !== "ok") return new Set();
  return new Set(parseResult.chord.tones.map((tone) => chordTonePitchClass(parseResult.chord, tone)));
}

function commonToneSpanPulses(
  prepared: Rc7PreparedCase,
  spans: Rc7PreparedCase["effectiveChordTimeline"]["spans"],
  pulse: Fraction,
): number {
  const durations = measureDurationsForCase(prepared);
  let longest = fraction(0);
  for (let start = 0; start < spans.length; start += 1) {
    let intersection = chordPitchClasses(spans[start]);
    if (intersection.size === 0) continue;
    let endPosition = spans[start].range.end;
    for (let end = start; end < spans.length; end += 1) {
      if (end > start) {
        if (comparePositions(spans[end - 1].range.end, spans[end].range.start) !== 0) break;
        const next = chordPitchClasses(spans[end]);
        intersection = new Set([...intersection].filter((pc) => next.has(pc)));
        if (intersection.size === 0) break;
        endPosition = spans[end].range.end;
      }
      const startQ = positionToGlobalQ(spans[start].range.start, durations);
      const endQ = positionToGlobalQ(endPosition, durations);
      const length = subtractFractions(endQ, startQ);
      if (compareFractions(length, longest) > 0) longest = length;
    }
  }
  return Math.floor(fractionToNumber(divideFractions(longest, pulse)));
}

function suspensionOpportunityCount(
  prepared: Rc7PreparedCase,
  spans: Rc7PreparedCase["effectiveChordTimeline"]["spans"],
  pulse: Fraction,
): number {
  const durations = measureDurationsForCase(prepared);
  let count = 0;
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const target = spans[index];
    if (comparePositions(previous.range.end, target.range.start) !== 0
      || previous.parseResult.status !== "ok"
      || target.parseResult.status !== "ok") continue;
    const previousChord = previous.parseResult.chord;
    const previousLength = rangeDurationQ(previous.range, durations);
    const targetLength = rangeDurationQ(target.range, durations);
    if (compareFractions(previousLength, scaleFraction(pulse, 1, 2)) < 0
      || compareFractions(targetLength, pulse) < 0) continue;
    const nextPcs = chordPitchClasses(target);
    const hasChain = previousChord.tones.some((tone) => {
      const heldPc = chordTonePitchClass(previousChord, tone);
      if (nextPcs.has(heldPc)) return false;
      return nextPcs.has((heldPc + 11) % 12) || nextPcs.has((heldPc + 10) % 12)
        || nextPcs.has((heldPc + 1) % 12) || nextPcs.has((heldPc + 2) % 12);
    });
    if (hasChain) count += 1;
  }
  return count;
}

export function deriveRc7Features(prepared: Rc7PreparedCase): Rc7FeatureAnalysis {
  const durations = measureDurationsForCase(prepared);
  const atoms = phraseAtoms(prepared);
  const spans = phraseSpans(prepared);
  const spanOrdinals = spans.map((span) => prepared.effectiveChordTimeline.spans.indexOf(span));
  if (spanOrdinals.some((ordinal) => ordinal < 0)) {
    throw new RangeError("RC7_CHORD_SPAN_ORDINAL_GRAPH_INVALID");
  }
  const phraseDurationQ = rangeDurationQ(prepared.phrase.range, durations);
  const pulse = primaryPulseDuration(prepared.meterFamily);
  const phraseStartQ = positionToGlobalQ(prepared.phrase.range.start, durations);
  const phraseEndQ = positionToGlobalQ(prepared.phrase.range.end, durations);
  const lateStartQ = addFractions(
    phraseStartQ,
    scaleFraction(phraseDurationQ, RC7_FROZEN_CONFIG.featureDerivation.lateRegionStartRatio.n,
      RC7_FROZEN_CONFIG.featureDerivation.lateRegionStartRatio.d),
  );
  const lyricById = new Map(prepared.lyricTokens.map((token) => [token.id, token]));
  const atomOrdinalById = new Map(atoms.map((atom, ordinal) => [atom.id, ordinal]));
  const attacks = atoms.filter((atom) => atom.pitch !== null && !atom.tiedFromPrevious);
  const cues: Rc7DerivedCue[] = [];

  if (comparePositions(prepared.phrase.range.start, {
    performanceMeasureIndex: prepared.sectionOccurrence.startPerformanceMeasureIndex,
    offset: fraction(0),
  }) === 0 && attacks.length > 0) {
    cues.push({
      semantic: "section-start",
      position: prepared.phrase.range.start,
      sourceAtomOrdinal: atomOrdinalById.get(attacks[0].id) ?? 0,
      cueCost: 0,
      reasonOrdinal: 1,
      productionSource: "derived",
    });
  }

  let previousPitchedEnd = prepared.phrase.range.start;
  for (const atom of attacks) {
    const ordinal = atomOrdinalById.get(atom.id) ?? 0;
    const onsetQ = positionToGlobalQ(atom.range.start, durations);
    const durationQ = rangeDurationQ(atom.range, durations);
    const remainingQ = subtractFractions(phraseEndQ, onsetQ);
    const lateLong = compareFractions(onsetQ, lateStartQ) >= 0
      && compareFractions(durationQ, pulse) >= 0
      && compareFractions(remainingQ, pulse) >= 0;
    if (lateLong) cues.push({
      semantic: "late-long-note",
      position: atom.range.start,
      sourceAtomOrdinal: ordinal,
      cueCost: RC7_FROZEN_CONFIG.splitCueCost.confirmedLateLongNote,
      reasonOrdinal: 2,
      productionSource: "derived",
    });

    const productionEmphasis = atom.lyricTokenIds
      .map((id) => lyricById.get(id))
      .filter((token): token is NonNullable<typeof token> => token !== undefined)
      .map(resolveProductionLyricEmphasis)
      .find((value) => value !== "none");
    if (productionEmphasis) cues.push({
      semantic: productionEmphasis === "confirmed"
        ? "lyric-emphasis-confirmed"
        : "lyric-emphasis-musicxml-accent-suggested",
      position: atom.range.start,
      sourceAtomOrdinal: ordinal,
      cueCost: productionEmphasis === "confirmed"
        ? RC7_FROZEN_CONFIG.splitCueCost.confirmedLyricEmphasis
        : RC7_FROZEN_CONFIG.splitCueCost.musicXmlAccentSuggested,
      reasonOrdinal: productionEmphasis === "confirmed" ? 3 : 4,
      productionSource: productionEmphasis,
    });

    if (comparePositions(atom.range.start, prepared.phrase.range.start) > 0
      && comparePositions(previousPitchedEnd, atom.range.start) < 0) {
      cues.push({
        semantic: "lead-rest-reentry",
        position: atom.range.start,
        sourceAtomOrdinal: ordinal,
        cueCost: 0,
        reasonOrdinal: 5,
        productionSource: "derived",
      });
    }
    previousPitchedEnd = atom.range.end;
  }

  const lateBoundaries = spans.filter((span, index) => index > 0
    && compareFractions(positionToGlobalQ(span.range.start, durations), lateStartQ) >= 0
    && compareFractions(subtractFractions(phraseEndQ, positionToGlobalQ(span.range.start, durations)), scaleFraction(pulse, 1, 2)) >= 0);
  for (const boundary of lateBoundaries) {
    const boundaryQ = positionToGlobalQ(boundary.range.start, durations);
    const companion = cues.find((cue) => [
      "late-long-note",
      "lyric-emphasis-confirmed",
      "lyric-emphasis-musicxml-accent-suggested",
      "lead-rest-reentry",
    ].includes(cue.semantic) && compareFractions(positionToGlobalQ(cue.position, durations), lateStartQ) >= 0
      && compareFractions(positionToGlobalQ(cue.position, durations), boundaryQ) >= 0);
    if (!companion) continue;
    cues.push({
      semantic: "compound-late-chord-change",
      position: boundary.range.start,
      sourceAtomOrdinal: companion.sourceAtomOrdinal,
      cueCost: RC7_FROZEN_CONFIG.splitCueCost.lateChordChange,
      reasonOrdinal: 6,
      productionSource: "derived",
    });
  }

  const uniqueCues = [...cues].sort((left, right) => comparePositions(left.position, right.position)
    || left.cueCost - right.cueCost
    || left.reasonOrdinal - right.reasonOrdinal
    || left.sourceAtomOrdinal - right.sourceAtomOrdinal)
    .filter((cue, index, values) => index === 0
      || compareCanonicalValues(cueKey(cue), cueKey(values[index - 1])) !== 0);
  const pitches = atoms.filter((atom) => atom.pitch !== null).map((atom) => pitchMidiNumber(atom.pitch!));
  const emphasisCount = uniqueCues.filter((cue) => cue.semantic.startsWith("lyric-emphasis-")).length;
  let noChordDuration = fraction(0);
  for (const span of spans) {
    if (span.parseResult.status === "no-chord") {
      noChordDuration = addFractions(noChordDuration, rangeDurationQ(span.range, durations));
    }
  }
  const leadAttackRatePerQuarterBp = roundHalfUpBasisPoints(fraction(attacks.length), phraseDurationQ);
  const features: PhraseFeatures = {
    phraseId: prepared.phrase.id,
    sectionType: prepared.sectionDefinition.type,
    sectionVariant: prepared.sectionOccurrence.variant,
    meterFamily: prepared.meterFamily,
    primaryPulseCount: Math.max(1, fractionCeil(divideFractions(phraseDurationQ, pulse))),
    leadAttackCount: attacks.length,
    leadRangeSemitones: pitches.length < 2 ? 0 : Math.max(...pitches) - Math.min(...pitches),
    productionLyricEmphasisCount: emphasisCount,
    lateLongNote: uniqueCues.some((cue) => cue.semantic === "late-long-note"),
    lateChordChange: lateBoundaries.length > 0,
    commonToneSpanPrimaryPulses: commonToneSpanPulses(prepared, spans, pulse),
    suspensionOpportunityCount: suspensionOpportunityCount(prepared, spans, pulse),
    noChordCoverageBp: roundHalfUpBasisPoints(noChordDuration, phraseDurationQ) as PhraseFeatures["noChordCoverageBp"],
    repeatedSourcePhrase: false,
    previousTextureIds: [],
  };
  return {
    features,
    cues: uniqueCues,
    phraseDurationQ,
    primaryPulseQ: pulse,
    phraseAtoms: atoms,
    phraseChordSpans: spans,
    phraseChordSpanOrdinals: spanOrdinals,
    leadAttackRatePerQuarterBp,
  };
}
