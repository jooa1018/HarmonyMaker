import type {
  Rc7ComparisonResponse,
  Rc7EvaluatorResult,
  Rc7EvaluatorSessionPayload,
  Rc7SectionResponse,
} from "./types";

export interface Rc7ListeningState {
  readonly cursor: number;
  readonly comparisonResponses: Readonly<Record<number, Rc7ComparisonResponse>>;
  readonly sectionResponses: Readonly<Record<number, Rc7SectionResponse>>;
}

export type Rc7ListeningAction =
  | { readonly type: "reset" }
  | { readonly type: "go"; readonly cursor: number; readonly total: number }
  | { readonly type: "answer-comparison"; readonly response: Rc7ComparisonResponse }
  | { readonly type: "answer-section"; readonly response: Rc7SectionResponse };

export function emptyComparisonResponse(comparisonOrdinal: number): Rc7ComparisonResponse {
  return {
    comparisonOrdinal,
    naturalnessChoice: null,
    densityChoice: null,
    entryExitChoice: null,
    optionalNote: "",
  };
}

export function emptySectionResponse(sectionOrdinal: number): Rc7SectionResponse {
  return {
    sectionOrdinal,
    densityChoice: null,
    entryExitChoice: null,
    liftChoice: null,
    fatigueChoice: null,
    naturalnessChoice: null,
    optionalNote: "",
  };
}

export function createListeningState(): Rc7ListeningState {
  return { cursor: 0, comparisonResponses: {}, sectionResponses: {} };
}

export function reduceListeningState(
  state: Rc7ListeningState,
  action: Rc7ListeningAction,
): Rc7ListeningState {
  if (action.type === "reset") return createListeningState();
  if (action.type === "go") {
    const last = Math.max(0, action.total - 1);
    return { ...state, cursor: Math.min(last, Math.max(0, action.cursor)) };
  }
  if (action.type === "answer-comparison") {
    return {
      ...state,
      comparisonResponses: {
        ...state.comparisonResponses,
        [action.response.comparisonOrdinal]: action.response,
      },
    };
  }
  return {
    ...state,
    sectionResponses: {
      ...state.sectionResponses,
      [action.response.sectionOrdinal]: action.response,
    },
  };
}

export function comparisonResponseComplete(response: Rc7ComparisonResponse | undefined): boolean {
  return Boolean(response?.naturalnessChoice && response.densityChoice && response.entryExitChoice);
}

export function sectionResponseComplete(response: Rc7SectionResponse | undefined): boolean {
  return Boolean(response?.densityChoice
    && response.entryExitChoice
    && response.liftChoice
    && response.fatigueChoice
    && response.naturalnessChoice);
}

export function sessionResponsesComplete(
  payload: Rc7EvaluatorSessionPayload,
  state: Rc7ListeningState,
): boolean {
  return payload.comparisons.every((entry) => comparisonResponseComplete(
    state.comparisonResponses[entry.ordinal],
  )) && payload.sections.every((entry) => sectionResponseComplete(
    state.sectionResponses[entry.ordinal],
  ));
}

export function createEvaluatorResult(
  payload: Rc7EvaluatorSessionPayload,
  state: Rc7ListeningState,
): Rc7EvaluatorResult {
  if (!sessionResponsesComplete(payload, state)) {
    throw new RangeError("RC7_LISTENING_RESPONSES_INCOMPLETE");
  }
  return {
    schema: "hm-wag-rc7-evaluator-result-v1",
    sessionId: payload.sessionId,
    comparisons: payload.comparisons.map((entry) => state.comparisonResponses[entry.ordinal]),
    sections: payload.sections.map((entry) => state.sectionResponses[entry.ordinal]),
  };
}

export function parseEvaluatorResultJson(value: string): Rc7EvaluatorResult {
  const parsed = JSON.parse(value) as Partial<Rc7EvaluatorResult>;
  if (parsed.schema !== "hm-wag-rc7-evaluator-result-v1"
    || typeof parsed.sessionId !== "string"
    || !Array.isArray(parsed.comparisons)
    || !Array.isArray(parsed.sections)) {
    throw new RangeError("RC7_LISTENING_RESULT_INVALID");
  }
  return parsed as Rc7EvaluatorResult;
}
