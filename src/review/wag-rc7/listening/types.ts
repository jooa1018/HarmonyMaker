export const RC7_PAIR_QUESTIONS = Object.freeze({
  naturalness: "더 자연스러운 편곡은?",
  density: "화음의 양이 더 적절한 쪽은?",
  entryExit: "화음의 진입과 퇴장이 더 자연스러운 쪽은?",
});

export const RC7_SECTION_QUESTIONS = Object.freeze({
  density: "전체 화음 양",
  entryExit: "진입과 퇴장",
  lift: "고조감",
  fatigue: "반복 피로도",
  naturalness: "전체 자연스러움",
});

export type Rc7PairChoice = "A" | "B" | "similar" | "both-unsuitable";

export interface Rc7BlindComparisonStimulus {
  readonly ordinal: number;
  readonly aPlayback: string;
  readonly bPlayback: string;
  readonly leadReferencePlayback: string | null;
}

export interface Rc7BlindSectionStimulus {
  readonly ordinal: number;
  readonly playback: string;
}

export interface Rc7EvaluatorSessionPayload {
  readonly schema: "hm-wag-rc7-evaluator-session-v1";
  readonly sessionId: string;
  readonly comparisonCount: number;
  readonly sectionCount: number;
  readonly comparisons: readonly Rc7BlindComparisonStimulus[];
  readonly sections: readonly Rc7BlindSectionStimulus[];
}

export interface Rc7ComparisonResponse {
  readonly comparisonOrdinal: number;
  readonly naturalnessChoice: Rc7PairChoice | null;
  readonly densityChoice: Rc7PairChoice | null;
  readonly entryExitChoice: Rc7PairChoice | null;
  readonly optionalNote: string;
}

export type Rc7SectionDensityChoice = "too-little" | "appropriate" | "too-much";
export type Rc7SectionEntryExitChoice = "natural" | "slightly-awkward" | "often-awkward";
export type Rc7SectionLiftChoice = "insufficient" | "appropriate" | "excessive";
export type Rc7SectionFatigueChoice = "none" | "some" | "high";
export type Rc7SectionNaturalnessChoice = 1 | 2 | 3 | 4 | 5;

export interface Rc7SectionResponse {
  readonly sectionOrdinal: number;
  readonly densityChoice: Rc7SectionDensityChoice | null;
  readonly entryExitChoice: Rc7SectionEntryExitChoice | null;
  readonly liftChoice: Rc7SectionLiftChoice | null;
  readonly fatigueChoice: Rc7SectionFatigueChoice | null;
  readonly naturalnessChoice: Rc7SectionNaturalnessChoice | null;
  readonly optionalNote: string;
}

export interface Rc7EvaluatorResult {
  readonly schema: "hm-wag-rc7-evaluator-result-v1";
  readonly sessionId: string;
  readonly comparisons: readonly Rc7ComparisonResponse[];
  readonly sections: readonly Rc7SectionResponse[];
}
