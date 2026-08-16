import type { ChordToneSpec } from "../domain/chord/model";
import { createDiagnostics, type Diagnostic, type DiagnosticCode } from "../domain/diagnostics";
import { addFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import type { FullSongMetrics, GeneratedHarmonyTrack, GeneratedVoiceEvent, RealizedHarmonyAnchor, TextureDensityMetrics } from "../domain/generation/model";
import type { ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan, HarmonyAnchorDirective } from "../domain/plans";
import { containsPitch, pitchMidiNumber, type Alter, type SpelledPitch, type SpelledPitchClass, type Step } from "../domain/pitch";
import { countRate, durationRate, extendedCountRate } from "../domain/rates";
import { comparePositions, compareRanges, type MusicalPosition, type MusicalRange } from "../domain/time";
import { loadFrozenWagAuthority } from "../grammar/authority";
import type { WagLifecycleInput } from "../grammar/lifecycle";

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_SEMITONES: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_SCALE_OFFSET = [0, 2, 4, 5, 7, 9, 11] as const;
const ZERO = fraction(0);

function mod12(value: number): number { return ((value % 12) + 12) % 12; }
function pitchEqual(left: SpelledPitch, right: SpelledPitch): boolean { return left.step === right.step && left.alter === right.alter && left.octave === right.octave; }
function positionEqual(left: MusicalPosition, right: MusicalPosition): boolean { return comparePositions(left, right) === 0; }
function rangeContains(outer: MusicalRange, inner: MusicalRange): boolean { return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0; }

function realizeTone(root: SpelledPitchClass, tone: ChordToneSpec): SpelledPitchClass | undefined {
  const degreeIndex = (tone.degree - 1) % 7;
  const targetStep = STEPS[(STEPS.indexOf(root.step) + degreeIndex) % 7];
  const targetPc = mod12(NATURAL_SEMITONES[root.step] + root.alter + MAJOR_SCALE_OFFSET[degreeIndex] + tone.alteration);
  const alteration = ([-2, -1, 0, 1, 2] as const).find((candidate) => mod12(NATURAL_SEMITONES[targetStep] + candidate) === targetPc);
  return alteration === undefined ? undefined : { step: targetStep, alter: alteration as Alter };
}

function chordContainsPitch(root: SpelledPitchClass, tones: readonly ChordToneSpec[], pitch: SpelledPitch): boolean {
  return tones.some((tone) => {
    const pitchClass = realizeTone(root, tone);
    return pitchClass?.step === pitch.step && pitchClass.alter === pitch.alter;
  });
}

function rangeDuration(range: MusicalRange, durations: readonly Fraction[]): Fraction {
  const absolute = (position: MusicalPosition): Fraction => {
    let value = ZERO;
    for (let index = 0; index < position.performanceMeasureIndex; index += 1) value = addFractions(value, durations[index]);
    return addFractions(value, position.offset);
  };
  return subtractFractions(absolute(range.end), absolute(range.start));
}

function raw(code: DiagnosticCode, subject: string, details: Readonly<Record<string, unknown>>, range?: MusicalRange): Omit<Diagnostic, "id"> {
  return { code, severity: "error", messageKo: code, ...(range ? { location: { range } } : {}), details: { subject, ...details } };
}

function phraseFor(input: WagLifecycleInput, range: MusicalRange) { return input.source.phraseRegions.find((phrase) => rangeContains(phrase.range, range)); }
function atomFor(input: WagLifecycleInput, range: MusicalRange) { return input.sourceLeadAtomization.atoms.find((atom) => rangeContains(atom.range, range)); }
function chordFor(input: WagLifecycleInput, range: MusicalRange) { return input.effectiveChordTimeline.spans.find((span) => rangeContains(span.range, range)); }
function roleFor(intent: ArrangementIntentPlan, phraseId: string, trackPlanId: string) { return intent.phraseIntents.find((phrase) => phrase.phraseId === phraseId)?.trackRoles.find((role) => role.trackPlanId === trackPlanId)?.placementRole; }

function densityMetrics(input: WagLifecycleInput, tracks: readonly GeneratedHarmonyTrack[]): Readonly<Record<string, TextureDensityMetrics>> {
  const durations = input.source.performanceSequence.occurrences.map((measure) => measure.duration);
  const result: Record<string, TextureDensityMetrics> = {};
  for (const section of input.source.sectionOccurrences) {
    const sectionAtoms = input.sourceLeadAtomization.atoms.filter((atom) => atom.range.start.performanceMeasureIndex >= section.startPerformanceMeasureIndex && atom.range.start.performanceMeasureIndex < section.endPerformanceMeasureIndexExclusive);
    const pitchedAtoms = sectionAtoms.filter((atom) => atom.pitch !== null);
    const restAtoms = sectionAtoms.filter((atom) => atom.pitch === null);
    const denominator = pitchedAtoms.reduce((sum, atom) => addFractions(sum, rangeDuration(atom.range, durations)), ZERO);
    const leadRestDuration = restAtoms.reduce((sum, atom) => addFractions(sum, rangeDuration(atom.range, durations)), ZERO);
    let participation = ZERO;
    let overLeadRest = ZERO;
    let divergence = ZERO;
    let exactlyTwo = ZERO;
    let exactlyThree = ZERO;
    let maxSimultaneous = 0;
    const spreads: number[] = [];
    for (const atom of sectionAtoms) {
      const notes = tracks.flatMap((track) => track.events.filter((event): event is Extract<GeneratedVoiceEvent, { readonly kind: "note" }> => event.kind === "note" && rangeContains(atom.range, event.range)));
      const duration = rangeDuration(atom.range, durations);
      maxSimultaneous = Math.max(maxSimultaneous, notes.length);
      if (atom.pitch === null) {
        if (notes.length > 0) overLeadRest = addFractions(overLeadRest, duration);
        continue;
      }
      if (notes.length > 0) participation = addFractions(participation, duration);
      if (notes.some((note) => !pitchEqual(note.pitch, atom.pitch!))) divergence = addFractions(divergence, duration);
      const midis = [pitchMidiNumber(atom.pitch), ...notes.map((note) => pitchMidiNumber(note.pitch))];
      const distinct = new Set(midis).size;
      if (distinct === 2) exactlyTwo = addFractions(exactlyTwo, duration);
      if (distinct === 3) exactlyThree = addFractions(exactlyThree, duration);
      if (notes.length > 0) spreads.push(Math.max(...midis) - Math.min(...midis));
    }
    const leadAttackCount = new Set(pitchedAtoms.map((atom) => atom.sourceEventId)).size;
    const harmonyAttackCount = tracks.reduce((count, track) => count + track.events.filter((event) => event.kind === "note" && !event.tieStop && event.range.start.performanceMeasureIndex >= section.startPerformanceMeasureIndex && event.range.start.performanceMeasureIndex < section.endPerformanceMeasureIndexExclusive).length, 0);
    const orderedSpreads = spreads.sort((left, right) => left - right);
    result[section.id] = {
      participationCoverage: durationRate(participation, denominator),
      harmonyAttackRatio: extendedCountRate(harmonyAttackCount, leadAttackCount),
      harmonyOverLeadRestCoverage: durationRate(overLeadRest, leadRestDuration),
      maxSimultaneousHarmonyTracks: Math.min(2, maxSimultaneous) as 0 | 1 | 2,
      harmonicDivergenceCoverage: durationRate(divergence, denominator),
      exactlyTwoPitchCoverage: durationRate(exactlyTwo, denominator),
      exactlyThreePitchCoverage: durationRate(exactlyThree, denominator),
      medianRegisterSpreadSemitones: orderedSpreads.length === 0 ? 0 : orderedSpreads[Math.floor((orderedSpreads.length - 1) / 2)],
    };
  }
  return result;
}

function sourceChordRespect(input: WagLifecycleInput, anchors: readonly RealizedHarmonyAnchor[], tracks: readonly GeneratedHarmonyTrack[], directives: Readonly<Record<string, HarmonyAnchorDirective>>) {
  let numerator = 0;
  let denominator = 0;
  for (const anchor of anchors) {
    const directive = directives[anchor.directiveId];
    if (!directive || directive.kind !== "chord-tone") continue;
    const span = input.effectiveChordTimeline.spans.find((candidate) => candidate.id === directive.chordSpanId);
    if (span?.parseResult.status !== "ok") continue;
    denominator += 1;
    const event = tracks.find((track) => track.trackPlanId === anchor.trackPlanId)?.events.find((candidate) => candidate.kind === "note" && candidate.originDirectiveId === anchor.directiveId && positionEqual(candidate.range.start, anchor.position));
    if (event?.kind === "note" && pitchEqual(event.pitch, anchor.pitch) && chordContainsPitch(span.parseResult.chord.root, span.parseResult.chord.tones, event.pitch)) numerator += 1;
  }
  return countRate(numerator, denominator);
}

function plannedNctResolution(anchorPlan: ArrangementAnchorPlan, tracks: readonly GeneratedHarmonyTrack[]) {
  const plans = anchorPlan.phraseAnchorPlans.flatMap((phrase) => phrase.nctPlans);
  const resolved = plans.filter((plan) => tracks.find((track) => track.trackPlanId === plan.trackPlanId)?.events.some((event) => event.kind === "note" && event.originDirectiveId === plan.resolutionDirectiveId && comparePositions(event.range.start, plan.resolutionDeadline) <= 0)).length;
  return countRate(resolved, plans.length);
}

export async function validateEditedSnapshot(input: {
  readonly lifecycleInput: WagLifecycleInput;
  readonly intentPlan: ArrangementIntentPlan;
  readonly activityPlan: ArrangementActivityPlan;
  readonly anchorPlan: ArrangementAnchorPlan;
  readonly tracks: readonly GeneratedHarmonyTrack[];
  readonly realizedAnchors: readonly RealizedHarmonyAnchor[];
}): Promise<{ readonly valid: boolean; readonly diagnostics: readonly Diagnostic[]; readonly metrics: FullSongMetrics }> {
  const authority = await loadFrozenWagAuthority();
  const rawDiagnostics: Omit<Diagnostic, "id">[] = [];
  const performerById = Object.fromEntries(input.lifecycleInput.performers.map((performer) => [performer.id, performer]));
  const performerByTrack = Object.fromEntries(input.lifecycleInput.assignments.map((assignment) => [assignment.trackPlanId, performerById[assignment.performerId]]));
  const directives = Object.fromEntries(input.anchorPlan.phraseAnchorPlans.flatMap((phrase) => phrase.anchorDirectives).map((directive) => [directive.id, directive]));
  for (const track of input.tracks) {
    const performer = performerByTrack[track.trackPlanId];
    if (!performer) { rawDiagnostics.push(raw("TRACK_ASSIGNMENT_INVALID", track.trackPlanId, { trackPlanId: track.trackPlanId })); continue; }
    const events = track.events.slice().sort((left, right) => compareRanges(left.range, right.range));
    if (new Set(events.map((event) => event.id)).size !== events.length) rawDiagnostics.push(raw("CANDIDATE_PROJECTION_INVALID", track.trackPlanId, { reason: "DUPLICATE_EVENT_ID" }));
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const previous = events[index - 1];
      const next = events[index + 1];
      if (previous && comparePositions(event.range.start, previous.range.end) < 0) rawDiagnostics.push(raw("INPUT_EVENT_OVERLAP", event.id, { trackPlanId: track.trackPlanId }, event.range));
      const atom = atomFor(input.lifecycleInput, event.range);
      const phrase = phraseFor(input.lifecycleInput, event.range);
      if (!atom || !phrase) rawDiagnostics.push(raw("CANDIDATE_PROJECTION_INVALID", event.id, { reason: "EVENT_OUTSIDE_CANONICAL_PARTITION", trackPlanId: track.trackPlanId }, event.range));
      if (event.kind === "rest") continue;
      if (!containsPitch(performer.hardRange, event.pitch)) rawDiagnostics.push(raw("GENERATED_OUT_OF_RANGE", event.id, { trackPlanId: track.trackPlanId }, event.range));
      const placement = phrase ? roleFor(input.intentPlan, phrase.id, track.trackPlanId) : undefined;
      if (!atom?.pitch || !placement || (placement === "upper" ? pitchMidiNumber(event.pitch) <= pitchMidiNumber(atom.pitch) : pitchMidiNumber(event.pitch) >= pitchMidiNumber(atom.pitch))) rawDiagnostics.push(raw("GENERATED_VOICE_CROSSING", event.id, { trackPlanId: track.trackPlanId }, event.range));
      const span = chordFor(input.lifecycleInput, event.range);
      if (span?.parseResult.status !== "ok") rawDiagnostics.push(raw("GENERATED_NO_CHORD_POLICY_VIOLATION", event.id, { trackPlanId: track.trackPlanId }, event.range));
      else if (!chordContainsPitch(span.parseResult.chord.root, span.parseResult.chord.tones, event.pitch)) rawDiagnostics.push(raw("GENERATED_CHORD_ROLE_CONFLICT", event.id, { reason: "SOURCE_TONE_ILLEGAL", trackPlanId: track.trackPlanId }, event.range));
      if (event.originDirectiveId) {
        const directive = directives[event.originDirectiveId];
        const realized = input.realizedAnchors.find((anchor) => anchor.directiveId === event.originDirectiveId && anchor.trackPlanId === track.trackPlanId && positionEqual(anchor.position, event.range.start) && pitchEqual(anchor.pitch, event.pitch));
        if (!directive || directive.trackPlanId !== track.trackPlanId || !positionEqual(directive.position, event.range.start) || !realized) rawDiagnostics.push(raw("WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH", event.id, { reason: "ANCHOR_PROVENANCE_INVALID", trackPlanId: track.trackPlanId }, event.range));
      }
      const expectedLyrics = atom && positionEqual(atom.range.start, event.range.start) ? atom.lyricTokenIds : [];
      if (JSON.stringify(event.lyricTokenIds) !== JSON.stringify(expectedLyrics)) rawDiagnostics.push(raw("LYRIC_POLICY_VIOLATION", event.id, { trackPlanId: track.trackPlanId }, event.range));
      if (event.tieStart && (!next || next.kind !== "note" || !positionEqual(event.range.end, next.range.start) || !pitchEqual(event.pitch, next.pitch) || !next.tieStop)) rawDiagnostics.push(raw("INPUT_INVALID_TIE", event.id, { reason: "TIE_START_INVALID", trackPlanId: track.trackPlanId }, event.range));
      if (event.tieStop && (!previous || previous.kind !== "note" || !positionEqual(previous.range.end, event.range.start) || !pitchEqual(previous.pitch, event.pitch) || !previous.tieStart)) rawDiagnostics.push(raw("INPUT_INVALID_TIE", event.id, { reason: "TIE_STOP_INVALID", trackPlanId: track.trackPlanId }, event.range));
      if (previous?.kind === "note" && phraseFor(input.lifecycleInput, previous.range)?.id === phrase?.id && Math.abs(pitchMidiNumber(event.pitch) - pitchMidiNumber(previous.pitch)) > input.lifecycleInput.effectiveConfig.hardMaxLeapSemitones) rawDiagnostics.push(raw("GRAMMAR_BLOCKED", event.id, { reason: "CONTINUOUS_HARD_LEAP", trackPlanId: track.trackPlanId }, event.range));
    }
  }
  for (const anchor of input.realizedAnchors) {
    const event = input.tracks.find((track) => track.trackPlanId === anchor.trackPlanId)?.events.find((candidate) => candidate.kind === "note" && candidate.originDirectiveId === anchor.directiveId && positionEqual(candidate.range.start, anchor.position) && pitchEqual(candidate.pitch, anchor.pitch));
    if (!event) rawDiagnostics.push(raw("WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH", anchor.directiveId, { reason: "REALIZED_ANCHOR_MISSING", trackPlanId: anchor.trackPlanId }));
  }
  if (input.tracks.length === 2) {
    const notes = input.tracks.flatMap((track) => track.events.filter((event): event is Extract<GeneratedVoiceEvent, { readonly kind: "note" }> => event.kind === "note").map((event) => ({ trackPlanId: track.trackPlanId, event })));
    for (const atom of input.lifecycleInput.sourceLeadAtomization.atoms.filter((candidate) => candidate.pitch)) {
      const simultaneous = notes.filter(({ event }) => compareRanges(event.range, atom.range) === 0);
      const upper = simultaneous.find(({ trackPlanId }) => roleFor(input.intentPlan, phraseFor(input.lifecycleInput, atom.range)?.id ?? "", trackPlanId) === "upper");
      const lower = simultaneous.find(({ trackPlanId }) => roleFor(input.intentPlan, phraseFor(input.lifecycleInput, atom.range)?.id ?? "", trackPlanId) === "lower");
      if (upper && lower && !(pitchMidiNumber(upper.event.pitch) > pitchMidiNumber(atom.pitch!) && pitchMidiNumber(atom.pitch!) > pitchMidiNumber(lower.event.pitch))) rawDiagnostics.push(raw("GENERATED_VOICE_CROSSING", atom.id, { reason: "PAIR_STRICT_ORDER" }, atom.range));
    }
  }
  const diagnostics = await createDiagnostics(rawDiagnostics, authority.diagnostics);
  const maxLeapSemitonesByTrack = Object.fromEntries(input.tracks.map((track) => {
    let previous: SpelledPitch | undefined;
    let maximum = 0;
    for (const event of track.events.slice().sort((left, right) => compareRanges(left.range, right.range))) {
      if (event.kind === "rest") { previous = undefined; continue; }
      if (previous) maximum = Math.max(maximum, Math.abs(pitchMidiNumber(event.pitch) - pitchMidiNumber(previous)));
      previous = event.pitch;
    }
    return [track.trackPlanId, maximum];
  }));
  const metrics: FullSongMetrics = {
    densityBySectionOccurrence: densityMetrics(input.lifecycleInput, input.tracks),
    maxLeapSemitonesByTrack,
    hardDiagnosticCount: diagnostics.filter((diagnostic) => diagnostic.severity === "blocking" || diagnostic.severity === "error").length,
    plannedNctResolution: plannedNctResolution(input.anchorPlan, input.tracks),
    sourceChordRespect: sourceChordRespect(input.lifecycleInput, input.realizedAnchors, input.tracks, directives),
  };
  return { valid: diagnostics.length === 0, diagnostics, metrics };
}
