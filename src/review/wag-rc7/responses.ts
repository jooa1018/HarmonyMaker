import type { ChordToneSpec } from "../../domain/chord/model";
import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  subtractFractions,
} from "../../domain/fraction";
import { comparePositions } from "../../domain/time";
import { RC7_FROZEN_CONFIG } from "./config";
import {
  chordTonePitchClass,
  configFraction,
  fractionMin,
  globalQToPosition,
  positionInRange,
  positionToGlobalQ,
  rangeDurationQ,
  rangeFromGlobalQ,
  roundHalfUpBasisPoints,
  scaleFraction,
} from "./music";
import { measureDurationsForCase } from "./prepare";
import type { Rc7FeatureAnalysis } from "./features";
import type {
  Rc7DerivedCue,
  Rc7PreparedCase,
  Rc7ResponseSpan,
  Rc7SuspensionChain,
} from "./types";

export interface Rc7ConstructedResponse {
  readonly cue: Rc7DerivedCue | null;
  readonly splitReason: "LATE_LONG_NOTE" | "LATE_CHORD_CHANGE" | "CONFIRMED_LYRIC_EMPHASIS" | "PHRASE_MIDPOINT" | null;
  readonly splitPosition: Rc7DerivedCue["position"] | null;
  readonly spans: readonly Rc7ResponseSpan[];
  readonly mandatoryAnchorPositions: readonly Rc7DerivedCue["position"][];
  readonly lyricPolicy: "same-lyrics" | "hold-current-vowel" | "no-new-lyric";
  readonly responseConstructorId: string;
  readonly suspensionChain: Rc7SuspensionChain | null;
}

function attackAtoms(analysis: Rc7FeatureAnalysis) {
  return analysis.phraseAtoms
    .map((atom, ordinal) => ({ atom, ordinal }))
    .filter((entry) => entry.atom.pitch !== null && !entry.atom.tiedFromPrevious);
}

function attackBudget(analysis: Rc7FeatureAnalysis, attackCapBp: number): number {
  return Math.floor(analysis.features.leadAttackCount * attackCapBp / 10_000);
}

function sourceOrdinalsInRange(
  analysis: Rc7FeatureAnalysis,
  start: Rc7DerivedCue["position"],
  end: Rc7DerivedCue["position"],
): readonly number[] {
  return analysis.phraseAtoms.flatMap((atom, ordinal) => (
    comparePositions(atom.range.start, end) < 0 && comparePositions(atom.range.end, start) > 0 ? [ordinal] : []
  ));
}

function attackOrdinalsInRange(
  analysis: Rc7FeatureAnalysis,
  start: Rc7DerivedCue["position"],
  end: Rc7DerivedCue["position"],
): readonly number[] {
  return attackAtoms(analysis).flatMap(({ atom, ordinal }) => (
    comparePositions(atom.range.start, start) >= 0 && comparePositions(atom.range.start, end) < 0 ? [ordinal] : []
  ));
}

function isNoChordAt(prepared: Rc7PreparedCase, position: Rc7DerivedCue["position"]): boolean {
  return prepared.effectiveChordTimeline.spans.some((span) => positionInRange(position, span.range)
    && span.parseResult.status === "no-chord");
}

function maximalContiguousResponse(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  cue: Rc7DerivedCue,
  coverageMinBp: number,
  coverageMaxBp: number,
  attackCapBp: number,
  minimumLeadAttacks: number,
  behavior: Rc7ResponseSpan["behavior"],
): Rc7ResponseSpan | null {
  const durations = measureDurationsForCase(prepared);
  const phraseStartQ = positionToGlobalQ(prepared.phrase.range.start, durations);
  const phraseEndQ = positionToGlobalQ(prepared.phrase.range.end, durations);
  const startQ = positionToGlobalQ(cue.position, durations);
  const budget = attackBudget(analysis, attackCapBp);
  if (budget < minimumLeadAttacks || isNoChordAt(prepared, cue.position)) return null;
  let previousEnd = cue.position;
  let best: Rc7ResponseSpan | null = null;
  for (const { atom } of analysis.phraseAtoms.map((atom, ordinal) => ({ atom, ordinal }))) {
    if (comparePositions(atom.range.end, cue.position) <= 0) continue;
    if (comparePositions(atom.range.start, previousEnd) > 0 && comparePositions(previousEnd, cue.position) > 0) break;
    if (atom.pitch === null || isNoChordAt(prepared, atom.range.start)) break;
    if (comparePositions(atom.range.start, cue.position) < 0) continue;
    previousEnd = atom.range.end;
    const endQ = positionToGlobalQ(atom.range.end, durations);
    const coverageBp = roundHalfUpBasisPoints(subtractFractions(endQ, startQ), subtractFractions(phraseEndQ, phraseStartQ));
    const attacks = attackOrdinalsInRange(analysis, cue.position, atom.range.end);
    if (coverageBp > coverageMaxBp || attacks.length > budget) break;
    if (coverageBp < coverageMinBp || attacks.length < minimumLeadAttacks) continue;
    best = {
      range: rangeFromGlobalQ(startQ, endQ, durations),
      sourceAtomOrdinals: sourceOrdinalsInRange(analysis, cue.position, atom.range.end),
      attackOrdinals: attacks,
      behavior,
    };
  }
  return best;
}

export function constructLeadOnlyResponse(): Rc7ConstructedResponse {
  return {
    cue: null,
    splitReason: null,
    splitPosition: null,
    spans: [],
    mandatoryAnchorPositions: [],
    lyricPolicy: "same-lyrics",
    responseConstructorId: "lead-only-unison-v1",
    suspensionChain: null,
  };
}

export function constructActiveUnisonResponses(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  attackCapBp: number,
): readonly Rc7ConstructedResponse[] {
  const cap = RC7_FROZEN_CONFIG.textureLimits.UNISON.activeUnisonBoundedCoverageBp[prepared.presetId];
  return analysis.cues.flatMap((cue) => {
    if (!["section-start", "qualified-phrase-start", "lyric-emphasis-confirmed", "lyric-emphasis-musicxml-accent-suggested", "late-long-note", "lead-rest-reentry", "active-continuation"].includes(cue.semantic)) return [];
    const span = maximalContiguousResponse(prepared, analysis, cue, cap.min, cap.max, attackCapBp, 1, "unison-double");
    return span ? [{
      cue,
      splitReason: null,
      splitPosition: null,
      spans: [span],
      mandatoryAnchorPositions: span.attackOrdinals.map((ordinal) => analysis.phraseAtoms[ordinal].range.start),
      lyricPolicy: "same-lyrics" as const,
      responseConstructorId: RC7_FROZEN_CONFIG.activityResponseConstructors.ACTIVE_UNISON.responseConstructorId,
      suspensionChain: null,
    }] : [];
  });
}

function splitReason(cue: Rc7DerivedCue): Rc7ConstructedResponse["splitReason"] {
  if (cue.semantic === "late-long-note") return "LATE_LONG_NOTE";
  if (cue.semantic === "compound-late-chord-change") return "LATE_CHORD_CHANGE";
  if (cue.semantic === "lyric-emphasis-confirmed" || cue.semantic === "lyric-emphasis-musicxml-accent-suggested") {
    return "CONFIRMED_LYRIC_EMPHASIS";
  }
  return null;
}

export function constructU2sResponses(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  attackCapBp: number,
): readonly Rc7ConstructedResponse[] {
  const durations = measureDurationsForCase(prepared);
  const phraseEndQ = positionToGlobalQ(prepared.phrase.range.end, durations);
  const minimum = scaleFraction(
    analysis.primaryPulseQ,
    RC7_FROZEN_CONFIG.splitPolicy.minPostSplitPrimaryPulses[prepared.presetId].n,
    RC7_FROZEN_CONFIG.splitPolicy.minPostSplitPrimaryPulses[prepared.presetId].d,
  );
  const minPhrasePulses = RC7_FROZEN_CONFIG.textureLimits.UNISON_TO_SPLIT.minPhrasePulses[prepared.presetId];
  if (compareFractions(divideFractions(analysis.phraseDurationQ, analysis.primaryPulseQ), fraction(minPhrasePulses)) < 0) return [];
  return analysis.cues.flatMap((cue) => {
    const reason = splitReason(cue);
    if (!reason) return [];
    const startQ = positionToGlobalQ(cue.position, durations);
    const post = subtractFractions(phraseEndQ, startQ);
    if (compareFractions(post, minimum) < 0 || isNoChordAt(prepared, cue.position)) return [];
    const attacks = attackOrdinalsInRange(analysis, cue.position, prepared.phrase.range.end);
    if (attacks.length === 0 || attacks.length > attackBudget(analysis, attackCapBp)) return [];
    const span: Rc7ResponseSpan = {
      range: rangeFromGlobalQ(startQ, phraseEndQ, durations),
      sourceAtomOrdinals: sourceOrdinalsInRange(analysis, cue.position, prepared.phrase.range.end),
      attackOrdinals: attacks,
      behavior: "independent-harmony",
    };
    return [{
      cue,
      splitReason: reason,
      splitPosition: cue.position,
      spans: [span],
      mandatoryAnchorPositions: attacks.map((ordinal) => analysis.phraseAtoms[ordinal].range.start),
      lyricPolicy: "same-lyrics" as const,
      responseConstructorId: "u2s-post-split-canonical-v1",
      suspensionChain: null,
    }];
  });
}

export function constructTppResponses(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  attackCapBp: number,
): readonly Rc7ConstructedResponse[] {
  const cap = RC7_FROZEN_CONFIG.textureLimits.TWO_PART_PARALLEL.boundedWindowCoverageBp[prepared.presetId];
  return analysis.cues.flatMap((cue) => {
    if (!["section-start", "qualified-phrase-start", "late-long-note", "compound-late-chord-change", "lyric-emphasis-confirmed", "lyric-emphasis-musicxml-accent-suggested", "lead-rest-reentry"].includes(cue.semantic)) return [];
    const span = maximalContiguousResponse(
      prepared,
      analysis,
      cue,
      cap.min,
      cap.max,
      attackCapBp,
      RC7_FROZEN_CONFIG.textureLimits.TWO_PART_PARALLEL.boundedWindowMinimumRun.minimumLeadAttacks,
      "independent-harmony",
    );
    if (!span) return [];
    const duration = rangeDurationQ(span.range, measureDurationsForCase(prepared));
    const minimumPulse = configFraction(RC7_FROZEN_CONFIG.textureLimits.TWO_PART_PARALLEL.boundedWindowMinimumRun.minimumPrimaryPulses);
    if (span.attackOrdinals.length < 2 && compareFractions(duration, scaleFraction(analysis.primaryPulseQ, minimumPulse.n, minimumPulse.d)) < 0) return [];
    return [{
      cue,
      splitReason: null,
      splitPosition: null,
      spans: [span],
      mandatoryAnchorPositions: span.attackOrdinals.map((ordinal) => analysis.phraseAtoms[ordinal].range.start),
      lyricPolicy: "same-lyrics" as const,
      responseConstructorId: RC7_FROZEN_CONFIG.activityResponseConstructors.TWO_PART_PARALLEL.responseConstructorId,
      suspensionChain: null,
    }];
  });
}

export function constructAccentResponses(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  attackCapBp: number,
): readonly Rc7ConstructedResponse[] {
  const durations = measureDurationsForCase(prepared);
  const direct = analysis.cues.filter((cue) => cue.semantic === "lyric-emphasis-confirmed"
    || cue.semantic === "lyric-emphasis-musicxml-accent-suggested")
    .sort((left, right) => left.cueCost - right.cueCost
      || left.reasonOrdinal - right.reasonOrdinal
      || comparePositions(left.position, right.position)
      || left.sourceAtomOrdinal - right.sourceAtomOrdinal);
  const maxBlocks = RC7_FROZEN_CONFIG.textureLimits.ACCENT_BLOCK.maxBlocksPerPhrase[prepared.presetId];
  const budget = attackBudget(analysis, attackCapBp);
  const spacing = scaleFraction(
    analysis.primaryPulseQ,
    RC7_FROZEN_CONFIG.textureLimits.ACCENT_BLOCK.minOnsetSpacingPulses[prepared.presetId].n,
    RC7_FROZEN_CONFIG.textureLimits.ACCENT_BLOCK.minOnsetSpacingPulses[prepared.presetId].d,
  );
  const selected: Rc7DerivedCue[] = [];
  for (const cue of direct) {
    if (selected.length >= maxBlocks || selected.length >= budget) break;
    const cueQ = positionToGlobalQ(cue.position, durations);
    if (selected.some((item) => {
      const difference = subtractFractions(cueQ, positionToGlobalQ(item.position, durations));
      return compareFractions({ n: Math.abs(difference.n), d: difference.d }, spacing) < 0;
    })) continue;
    selected.push(cue);
  }
  if (selected.length === 0) return [];
  const spans = selected.map((cue): Rc7ResponseSpan => {
    const atom = analysis.phraseAtoms[cue.sourceAtomOrdinal];
    const chord = prepared.effectiveChordTimeline.spans.find((span) => positionInRange(cue.position, span.range));
    const startQ = positionToGlobalQ(cue.position, durations);
    const atomEndQ = positionToGlobalQ(atom.range.end, durations);
    const pulseEndQ = addFractions(startQ, analysis.primaryPulseQ);
    const chordEndQ = chord ? positionToGlobalQ(chord.range.end, durations) : atomEndQ;
    const endQ = fractionMin(atomEndQ, fractionMin(pulseEndQ, chordEndQ));
    return {
      range: rangeFromGlobalQ(startQ, endQ, durations),
      sourceAtomOrdinals: [cue.sourceAtomOrdinal],
      attackOrdinals: [cue.sourceAtomOrdinal],
      behavior: "independent-harmony",
    };
  });
  return [{
    cue: selected[0],
    splitReason: null,
    splitPosition: null,
    spans,
    mandatoryAnchorPositions: selected.map((cue) => cue.position),
    lyricPolicy: "same-lyrics",
    responseConstructorId: RC7_FROZEN_CONFIG.activityResponseConstructors.ACCENT_BLOCK.responseConstructorId,
    suspensionChain: null,
  }];
}

function padCommonToneEnd(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
  cue: Rc7DerivedCue,
): Rc7DerivedCue["position"] | null {
  const durations = measureDurationsForCase(prepared);
  const startQ = positionToGlobalQ(cue.position, durations);
  const capEndQ = addFractions(
    startQ,
    scaleFraction(analysis.primaryPulseQ, RC7_FROZEN_CONFIG.textureLimits.SUSTAINED_PAD.automaticSingleSustainCapPulses[prepared.presetId]),
  );
  const phraseEndQ = positionToGlobalQ(prepared.phrase.range.end, durations);
  let intersection: Set<number> | null = null;
  let endQ = startQ;
  for (const span of analysis.phraseChordSpans) {
    if (comparePositions(span.range.end, cue.position) <= 0) continue;
    const parseResult = span.parseResult;
    if (parseResult.status !== "ok") break;
    const spanStartQ = positionToGlobalQ(span.range.start, durations);
    if (compareFractions(spanStartQ, endQ) > 0 && compareFractions(endQ, startQ) > 0) break;
    const pcs: Set<number> = new Set(
      parseResult.chord.tones.map((tone) => chordTonePitchClass(parseResult.chord, tone)),
    );
    if (intersection === null) {
      intersection = pcs;
    } else {
      const previousIntersection: Set<number> = intersection;
      intersection = new Set([...previousIntersection].filter((pc) => pcs.has(pc)));
    }
    if (intersection.size === 0) break;
    endQ = fractionMin(positionToGlobalQ(span.range.end, durations), fractionMin(capEndQ, phraseEndQ));
    if (compareFractions(endQ, capEndQ) >= 0 || compareFractions(endQ, phraseEndQ) >= 0) break;
  }
  const minimum = scaleFraction(
    analysis.primaryPulseQ,
    RC7_FROZEN_CONFIG.textureLimits.SUSTAINED_PAD.minCommonTonePrimaryPulses[prepared.presetId],
  );
  return intersection && intersection.size > 0 && compareFractions(subtractFractions(endQ, startQ), minimum) >= 0
    ? globalQToPosition(endQ, durations)
    : null;
}

export function constructPadResponses(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
): readonly Rc7ConstructedResponse[] {
  const durations = measureDurationsForCase(prepared);
  return analysis.cues.flatMap((cue) => {
    if (!["section-start", "qualified-phrase-start", "late-long-note", "lead-rest-reentry", "lyric-emphasis-confirmed", "lyric-emphasis-musicxml-accent-suggested", "compound-late-chord-change", "active-continuation"].includes(cue.semantic)) return [];
    const end = padCommonToneEnd(prepared, analysis, cue);
    if (!end) return [];
    const startQ = positionToGlobalQ(cue.position, durations);
    const endQ = positionToGlobalQ(end, durations);
    return [{
      cue,
      splitReason: null,
      splitPosition: null,
      spans: [{
        range: rangeFromGlobalQ(startQ, endQ, durations),
        sourceAtomOrdinals: sourceOrdinalsInRange(analysis, cue.position, end),
        attackOrdinals: [cue.sourceAtomOrdinal],
        behavior: "sustained-pad" as const,
      }],
      mandatoryAnchorPositions: [cue.position],
      lyricPolicy: "no-new-lyric" as const,
      responseConstructorId: RC7_FROZEN_CONFIG.activityResponseConstructors.SUSTAINED_PAD.responseConstructorId,
      suspensionChain: null,
    }];
  });
}

export function constructSuspensionResponses(
  prepared: Rc7PreparedCase,
  analysis: Rc7FeatureAnalysis,
): readonly Rc7ConstructedResponse[] {
  if (!prepared.presetId || RC7_FROZEN_CONFIG.textureLimits.SUSPENSION_RELEASE.maxOpportunitiesPerPhrase[prepared.presetId] === 0) return [];
  const durations = measureDurationsForCase(prepared);
  const cues = analysis.cues.filter((cue) => cue.semantic === "compound-late-chord-change"
    || cue.semantic === "lyric-emphasis-confirmed"
    || cue.semantic === "lyric-emphasis-musicxml-accent-suggested"
    || cue.semantic === "lead-rest-reentry"
    || cue.semantic === "section-start"
    || cue.semantic === "qualified-phrase-start");
  const results: Rc7ConstructedResponse[] = [];
  for (let index = 1; index < analysis.phraseChordSpans.length; index += 1) {
    const previous = analysis.phraseChordSpans[index - 1];
    const target = analysis.phraseChordSpans[index];
    if (comparePositions(previous.range.end, target.range.start) !== 0
      || previous.parseResult.status !== "ok"
      || target.parseResult.status !== "ok") continue;
    const previousChord = previous.parseResult.chord;
    const targetChord = target.parseResult.chord;
    const cue = cues.find((item) => comparePositions(item.position, target.range.start) === 0);
    if (!cue) continue;
    const candidates: Array<{
      readonly heldTone: ChordToneSpec;
      readonly resolutionTone: ChordToneSpec;
      readonly direction: "down" | "up";
      readonly distance: number;
    }> = [];
    for (const heldTone of previousChord.tones) {
      const heldPc = chordTonePitchClass(previousChord, heldTone);
      for (const resolutionTone of targetChord.tones) {
        const targetPc = chordTonePitchClass(targetChord, resolutionTone);
        const down = (heldPc - targetPc + 12) % 12;
        const up = (targetPc - heldPc + 12) % 12;
        if (down === 1 || down === 2) {
          candidates.push({ heldTone, resolutionTone, direction: "down", distance: down });
        } else if (prepared.presetId === "full" && (up === 1 || up === 2)) {
          candidates.push({ heldTone, resolutionTone, direction: "up", distance: up });
        }
      }
    }
    candidates.sort((left, right) => (left.direction === right.direction
      ? 0
      : left.direction === "down" ? -1 : 1)
      || left.distance - right.distance
      || left.heldTone.degree - right.heldTone.degree
      || left.resolutionTone.degree - right.resolutionTone.degree);
    if (!candidates[0]) continue;
    const boundaryQ = positionToGlobalQ(target.range.start, durations);
    const preparationQ = addFractions(boundaryQ, scaleFraction(analysis.primaryPulseQ, -1, 2));
    const resolutionQ = addFractions(boundaryQ, scaleFraction(analysis.primaryPulseQ, 1, 2));
    if (compareFractions(preparationQ, positionToGlobalQ(previous.range.start, durations)) < 0
      || compareFractions(resolutionQ, positionToGlobalQ(target.range.end, durations)) >= 0) continue;
    const preparation = globalQToPosition(preparationQ, durations);
    const resolution = globalQToPosition(resolutionQ, durations);
    const chain: Rc7SuspensionChain = {
      preparationPosition: preparation,
      suspensionPosition: target.range.start,
      resolutionPosition: resolution,
      contextChordSpanOrdinal: analysis.phraseChordSpanOrdinals[index - 1],
      targetChordSpanOrdinal: analysis.phraseChordSpanOrdinals[index],
      heldTone: candidates[0].heldTone,
      resolutionTone: candidates[0].resolutionTone,
      resolutionDirection: candidates[0].direction,
    };
    results.push({
      cue,
      splitReason: null,
      splitPosition: null,
      spans: [
        {
          range: rangeFromGlobalQ(preparationQ, resolutionQ, durations),
          sourceAtomOrdinals: sourceOrdinalsInRange(analysis, preparation, resolution),
          attackOrdinals: [cue.sourceAtomOrdinal],
          behavior: "independent-harmony",
        },
        {
          range: rangeFromGlobalQ(resolutionQ, positionToGlobalQ(target.range.end, durations), durations),
          sourceAtomOrdinals: sourceOrdinalsInRange(analysis, resolution, target.range.end),
          attackOrdinals: [],
          behavior: "independent-harmony",
        },
      ],
      mandatoryAnchorPositions: [preparation, resolution],
      lyricPolicy: "hold-current-vowel",
      responseConstructorId: "suspension-preparation-hold-release-v1",
      suspensionChain: chain,
    });
    if (results.length >= RC7_FROZEN_CONFIG.textureLimits.SUSPENSION_RELEASE.maxOpportunitiesPerPhrase[prepared.presetId]) break;
  }
  return results;
}
