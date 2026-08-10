"use client";

import type ABCJS from "abcjs";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  comparisonResponseComplete,
  createEvaluatorResult,
  createListeningState,
  emptyComparisonResponse,
  emptySectionResponse,
  reduceListeningState,
  sectionResponseComplete,
  sessionResponsesComplete,
} from "../../../../review/wag-rc7/listening/state";
import type {
  Rc7ComparisonResponse,
  Rc7EvaluatorResult,
  Rc7EvaluatorSessionPayload,
  Rc7PairChoice,
  Rc7SectionResponse,
} from "../../../../review/wag-rc7/listening/types";
import styles from "./listening.module.css";

const PAIR_OPTIONS = [
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "similar", label: "비슷함" },
] as const;

const SECTION_DENSITY_OPTIONS = [
  { value: "too-little", label: "너무 적음" },
  { value: "appropriate", label: "적당함" },
  { value: "too-much", label: "너무 많음" },
] as const;

const SECTION_ENTRY_OPTIONS = [
  { value: "natural", label: "자연스러움" },
  { value: "slightly-awkward", label: "약간 어색함" },
  { value: "often-awkward", label: "자주 어색함" },
] as const;

const SECTION_LIFT_OPTIONS = [
  { value: "insufficient", label: "부족" },
  { value: "appropriate", label: "적당" },
  { value: "excessive", label: "과함" },
] as const;

const SECTION_FATIGUE_OPTIONS = [
  { value: "none", label: "없음" },
  { value: "some", label: "조금" },
  { value: "high", label: "큼" },
] as const;

interface Option<Value extends string | number> {
  readonly value: Value;
  readonly label: string;
}

function ChoiceGroup<Value extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly options: readonly Option<Value>[];
  readonly value: Value | null;
  readonly onChange: (value: Value) => void;
}) {
  return (
    <fieldset className={styles.question}>
      <legend>{legend}</legend>
      <div className={styles.choiceGrid}>
        {options.map((option) => (
          <label key={option.value} className={value === option.value ? styles.selectedChoice : styles.choice}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ComparisonQuestions({
  response,
  onChange,
}: {
  readonly response: Rc7ComparisonResponse;
  readonly onChange: (response: Rc7ComparisonResponse) => void;
}) {
  const common = [...PAIR_OPTIONS, { value: "both-unsuitable", label: "둘 다 어색함" }] as const;
  const density = [...PAIR_OPTIONS, { value: "both-unsuitable", label: "둘 다 부적절함" }] as const;
  return (
    <div className={styles.questions}>
      <ChoiceGroup<Rc7PairChoice>
        legend="더 자연스러운 편곡은?"
        name={`naturalness-${response.comparisonOrdinal}`}
        options={common}
        value={response.naturalnessChoice}
        onChange={(naturalnessChoice) => onChange({ ...response, naturalnessChoice })}
      />
      <ChoiceGroup<Rc7PairChoice>
        legend="화음의 양이 더 적절한 쪽은?"
        name={`density-${response.comparisonOrdinal}`}
        options={density}
        value={response.densityChoice}
        onChange={(densityChoice) => onChange({ ...response, densityChoice })}
      />
      <ChoiceGroup<Rc7PairChoice>
        legend="화음의 진입과 퇴장이 더 자연스러운 쪽은?"
        name={`entry-${response.comparisonOrdinal}`}
        options={common}
        value={response.entryExitChoice}
        onChange={(entryExitChoice) => onChange({ ...response, entryExitChoice })}
      />
      <label className={styles.noteLabel}>
        메모 <span>선택사항</span>
        <textarea
          maxLength={2_000}
          value={response.optionalNote}
          onChange={(event) => onChange({ ...response, optionalNote: event.target.value })}
          placeholder="짧게 남겨도 되고 비워도 됩니다."
        />
      </label>
    </div>
  );
}

function SectionQuestions({
  response,
  onChange,
}: {
  readonly response: Rc7SectionResponse;
  readonly onChange: (response: Rc7SectionResponse) => void;
}) {
  const ratingOptions = [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) })) as readonly Option<1 | 2 | 3 | 4 | 5>[];
  return (
    <div className={styles.questions}>
      <ChoiceGroup
        legend="전체 화음 양"
        name={`section-density-${response.sectionOrdinal}`}
        options={SECTION_DENSITY_OPTIONS}
        value={response.densityChoice}
        onChange={(densityChoice) => onChange({ ...response, densityChoice })}
      />
      <ChoiceGroup
        legend="진입과 퇴장"
        name={`section-entry-${response.sectionOrdinal}`}
        options={SECTION_ENTRY_OPTIONS}
        value={response.entryExitChoice}
        onChange={(entryExitChoice) => onChange({ ...response, entryExitChoice })}
      />
      <ChoiceGroup
        legend="고조감"
        name={`section-lift-${response.sectionOrdinal}`}
        options={SECTION_LIFT_OPTIONS}
        value={response.liftChoice}
        onChange={(liftChoice) => onChange({ ...response, liftChoice })}
      />
      <ChoiceGroup
        legend="반복 피로도"
        name={`section-fatigue-${response.sectionOrdinal}`}
        options={SECTION_FATIGUE_OPTIONS}
        value={response.fatigueChoice}
        onChange={(fatigueChoice) => onChange({ ...response, fatigueChoice })}
      />
      <ChoiceGroup
        legend="전체 자연스러움"
        name={`section-naturalness-${response.sectionOrdinal}`}
        options={ratingOptions}
        value={response.naturalnessChoice}
        onChange={(naturalnessChoice) => onChange({ ...response, naturalnessChoice })}
      />
      <label className={styles.noteLabel}>
        메모 <span>선택사항</span>
        <textarea
          maxLength={2_000}
          value={response.optionalNote}
          onChange={(event) => onChange({ ...response, optionalNote: event.target.value })}
          placeholder="느낌이 분명할 때만 짧게 적어 주세요."
        />
      </label>
    </div>
  );
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function decodePlayback(value: string): string {
  return atob(value);
}

export function ListeningClient() {
  const [payload, setPayload] = useState<Rc7EvaluatorSessionPayload | null>(null);
  const [state, dispatch] = useReducer(reduceListeningState, undefined, createListeningState);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedResult, setCompletedResult] = useState<Rc7EvaluatorResult | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioStatus, setAudioStatus] = useState("재생할 항목을 선택해 주세요.");
  const [activePlayback, setActivePlayback] = useState<string | null>(null);

  const abcRef = useRef<typeof ABCJS | null>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ABCJS.SynthObjectController | null>(null);

  const total = (payload?.comparisonCount ?? 0) + (payload?.sectionCount ?? 0);
  const comparison = payload && state.cursor < payload.comparisonCount
    ? payload.comparisons[state.cursor]
    : null;
  const sectionIndex = payload ? state.cursor - payload.comparisonCount : -1;
  const section = payload && sectionIndex >= 0 ? payload.sections[sectionIndex] : null;
  const comparisonResponse = comparison
    ? state.comparisonResponses[comparison.ordinal] ?? emptyComparisonResponse(comparison.ordinal)
    : null;
  const sectionResponse = section
    ? state.sectionResponses[section.ordinal] ?? emptySectionResponse(section.ordinal)
    : null;
  const currentComplete = comparisonResponse
    ? comparisonResponseComplete(comparisonResponse)
    : sectionResponseComplete(sectionResponse ?? undefined);
  const allComplete = payload ? sessionResponsesComplete(payload, state) : false;
  const answeredCount = payload
    ? payload.comparisons.filter((entry) => comparisonResponseComplete(state.comparisonResponses[entry.ordinal])).length
      + payload.sections.filter((entry) => sectionResponseComplete(state.sectionResponses[entry.ordinal])).length
    : 0;

  const resetAudio = useCallback(() => {
    controllerRef.current?.pause();
    controllerRef.current?.restart();
    controllerRef.current = null;
    scoreRef.current?.replaceChildren();
    audioRef.current?.replaceChildren();
    setActivePlayback(null);
  }, []);

  useEffect(() => {
    let disposed = false;
    void import("abcjs").then((module) => {
      if (disposed) return;
      abcRef.current = module.default;
      setRendererReady(true);
    }).catch(() => setPageError("오디오 렌더러를 불러오지 못했습니다."));
    return () => {
      disposed = true;
      controllerRef.current?.pause();
    };
  }, []);

  const play = async (label: string, abc: string) => {
    const renderer = abcRef.current;
    const score = scoreRef.current;
    const audio = audioRef.current;
    if (!renderer || !score || !audio || audioBusy) return;
    setAudioBusy(true);
    setPageError(null);
    try {
      resetAudio();
      const tune = renderer.renderAbc(score, decodePlayback(abc), {
        responsive: "resize",
        staffwidth: 760,
        add_classes: false,
      })[0];
      if (!tune) throw new Error("LISTENING_TUNE_MISSING");
      const controller = new renderer.synth.SynthController();
      controller.load(audio, null, {
        displayLoop: false,
        displayRestart: false,
        displayPlay: false,
        displayProgress: false,
        displayWarp: false,
      });
      controllerRef.current = controller;
      const initialized = await controller.setTune(tune, true, {});
      if (initialized.status === "no-audio-context") throw new Error("LISTENING_AUDIO_CONTEXT_MISSING");
      await controller.play();
      setActivePlayback(label);
      setAudioStatus(`${label} 재생 중 · 다시 누르면 처음부터 재생합니다.`);
    } catch {
      resetAudio();
      setAudioStatus("재생을 시작하지 못했습니다. 버튼을 다시 눌러 주세요.");
    } finally {
      setAudioBusy(false);
    }
  };

  const stopAudio = () => {
    resetAudio();
    setAudioStatus("재생을 멈췄습니다.");
  };

  const goTo = (cursor: number) => {
    resetAudio();
    setAudioStatus("재생할 항목을 선택해 주세요.");
    dispatch({ type: "go", cursor, total });
  };

  const startSession = async () => {
    setStarting(true);
    setPageError(null);
    setCompletedResult(null);
    resetAudio();
    setAudioStatus("재생할 항목을 선택해 주세요.");
    try {
      const response = await fetch("/review/wag-rc7/listening/session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("LISTENING_SESSION_START_FAILED");
      setPayload(await response.json() as Rc7EvaluatorSessionPayload);
      dispatch({ type: "reset" });
    } catch {
      setPageError("세션을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setStarting(false);
    }
  };

  const completeSession = async () => {
    if (!payload || !allComplete) return;
    setSubmitting(true);
    setPageError(null);
    try {
      const result = createEvaluatorResult(payload, state);
      const response = await fetch("/review/wag-rc7/listening/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      if (!response.ok) throw new Error("LISTENING_SESSION_COMPLETE_FAILED");
      const body = await response.json() as { readonly result: Rc7EvaluatorResult };
      setCompletedResult(body.result);
      resetAudio();
    } catch {
      setPageError("모든 응답을 확인한 뒤 다시 완료해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  const downloadReveal = async () => {
    setPageError(null);
    try {
      const response = await fetch("/review/wag-rc7/listening/reveal", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("LISTENING_REVEAL_FAILED");
      downloadJson("rc7-listening-admin-reveal.json", await response.json());
    } catch {
      setPageError("완료 확인 정보를 불러오지 못했습니다.");
    }
  };

  const progressLabel = payload ? `${answeredCount} / ${total} 응답 완료` : "";

  if (!payload) {
    return (
      <main className={styles.shell}>
        <section className={styles.intro}>
          <p className={styles.eyebrow}>Controlled listening</p>
          <h1>블라인드 편곡 듣기</h1>
          <p>두 버전을 여러 번 들어 보고, 더 자연스럽게 느껴지는 쪽을 고르면 됩니다.</p>
          <p>전문 용어를 알 필요가 없으며 메모는 선택사항입니다.</p>
          <button type="button" className={styles.primary} onClick={() => void startSession()} disabled={starting}>
            {starting ? "세션 준비 중…" : "Start Listening Session"}
          </button>
          {pageError ? <p className={styles.error} role="alert">{pageError}</p> : null}
        </section>
      </main>
    );
  }

  if (completedResult) {
    return (
      <main className={styles.shell}>
        <section className={styles.completeCard}>
          <p className={styles.eyebrow}>Session complete</p>
          <h1>평가가 완료되었습니다</h1>
          <p>평가 응답과 관리자용 확인 파일은 서로 분리되어 있습니다.</p>
          <div className={styles.downloads}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => downloadJson("rc7-listening-evaluator-result.json", completedResult)}
            >
              평가 결과 JSON 다운로드
            </button>
            <button type="button" className={styles.secondary} onClick={() => void downloadReveal()}>
              관리자용 확인 JSON 다운로드
            </button>
          </div>
          <button type="button" className={styles.textButton} onClick={() => void startSession()}>
            새 세션 시작
          </button>
          {pageError ? <p className={styles.error} role="alert">{pageError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Blind listening session</p>
          <h1>{comparison ? `Comparison ${comparison.ordinal} / ${payload.comparisonCount}` : `Section review ${section?.ordinal} / ${payload.sectionCount}`}</h1>
        </div>
        <div className={styles.progressBlock} aria-label={progressLabel}>
          <span>{progressLabel}</span>
          <progress value={answeredCount} max={total} />
        </div>
      </header>

      <section className={styles.playerCard} aria-labelledby="listen-heading">
        <div className={styles.playerHeading}>
          <div>
            <p className={styles.stepLabel}>{comparison ? "A와 B를 원하는 만큼 반복해서 들어 보세요" : "구간 전체를 듣고 느낌을 골라 주세요"}</p>
            <h2 id="listen-heading">듣기</h2>
          </div>
          <span className={rendererReady ? styles.ready : styles.waiting}>{rendererReady ? "오디오 준비됨" : "오디오 준비 중"}</span>
        </div>

        {comparison ? (
          <div className={styles.playButtons}>
            <button
              type="button"
              className={activePlayback === "A" ? styles.activePlay : styles.play}
              onClick={() => void play("A", comparison.aPlayback)}
              disabled={!rendererReady || audioBusy}
              aria-label="A 재생"
            >
              <span>▶</span> A
            </button>
            <button
              type="button"
              className={activePlayback === "B" ? styles.activePlay : styles.play}
              onClick={() => void play("B", comparison.bPlayback)}
              disabled={!rendererReady || audioBusy}
              aria-label="B 재생"
            >
              <span>▶</span> B
            </button>
            {comparison.leadReferencePlayback ? (
              <button
                type="button"
                className={styles.reference}
                onClick={() => void play("Lead reference", comparison.leadReferencePlayback!)}
                disabled={!rendererReady || audioBusy}
              >
                Lead reference
              </button>
            ) : null}
          </div>
        ) : section ? (
          <div className={styles.playButtons}>
            <button
              type="button"
              className={activePlayback === "Section" ? styles.activePlay : styles.playWide}
              onClick={() => void play("Section", section.playback)}
              disabled={!rendererReady || audioBusy}
            >
              <span>▶</span> 구간 재생
            </button>
          </div>
        ) : null}

        <div className={styles.transportStatus} aria-live="polite">
          <span>{audioStatus}</span>
          <button type="button" onClick={stopAudio} disabled={!activePlayback}>정지</button>
        </div>
        <div ref={scoreRef} className={styles.auralScore} aria-hidden="true" />
        <div ref={audioRef} hidden />
      </section>

      <section className={styles.formCard} aria-labelledby="response-heading">
        <h2 id="response-heading">느낌을 선택해 주세요</h2>
        {comparisonResponse ? (
          <ComparisonQuestions
            response={comparisonResponse}
            onChange={(response) => dispatch({ type: "answer-comparison", response })}
          />
        ) : sectionResponse ? (
          <SectionQuestions
            response={sectionResponse}
            onChange={(response) => dispatch({ type: "answer-section", response })}
          />
        ) : null}
      </section>

      <nav className={styles.navigation} aria-label="Listening session navigation">
        <button
          type="button"
          className={styles.secondary}
          onClick={() => goTo(state.cursor - 1)}
          disabled={state.cursor === 0}
        >
          ← 이전
        </button>
        <span>{state.cursor + 1} / {total}</span>
        {state.cursor < total - 1 ? (
          <button
            type="button"
            className={styles.primary}
            onClick={() => goTo(state.cursor + 1)}
            disabled={!currentComplete}
          >
            다음 →
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={() => void completeSession()}
            disabled={!allComplete || submitting}
          >
            {submitting ? "완료 확인 중…" : "세션 완료"}
          </button>
        )}
      </nav>
      {pageError ? <p className={styles.error} role="alert">{pageError}</p> : null}
    </main>
  );
}
