"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ABCJS from "abcjs";

import { deterministicBlindSwap } from "@/experiments/wag-v102/experiment";
import type { ListeningItemArtifact, ListeningSideArtifact } from "@/experiments/wag-v102/playback";
import styles from "./review.module.css";

const SESSION_KEY = "hm-wag-v102-experiment-session-v1";
const RESPONSE_KEY = "hm-wag-v102-experiment-responses-v1";

const FEATURE_LABELS: Readonly<Record<ListeningItemArtifact["feature"], string>> = {
  E1: "가창 음역 편안함",
  E3: "다음 음 연결성",
  E4: "쉼 뒤 재진입",
  CUMULATIVE: "종합 개선안",
  NEUTRAL: "중립 대조군",
};

export type Preference = "strongly-a" | "slightly-a" | "tie" | "slightly-b" | "strongly-b";
export type PrimaryReason =
  | "singability-tessitura"
  | "continuity-no-dropout"
  | "reentry-naturalness"
  | "harmonic-fit"
  | "line-naturalness"
  | "no-meaningful-difference"
  | "other";
export type Confidence = "low" | "medium" | "high";

interface LockedResponse {
  readonly preference: Preference;
  readonly primaryReason: PrimaryReason;
  readonly confidence: Confidence;
  readonly note: string;
  readonly lockedAtIso: string;
}

interface PlaybackState {
  readonly heardA: boolean;
  readonly heardB: boolean;
  readonly invalidA?: string;
  readonly invalidB?: string;
}

function loadStoredResponses(): Readonly<Record<string, LockedResponse>> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(RESPONSE_KEY) ?? "{}") as Readonly<Record<string, LockedResponse>>;
  } catch {
    return {};
  }
}

function BlindPlayer({
  label,
  side,
  heard,
  onHeard,
  onInvalid,
}: {
  readonly label: "A" | "B";
  readonly side: ListeningSideArtifact;
  readonly heard: boolean;
  readonly onHeard: () => void;
  readonly onInvalid: (reason: string) => void;
}) {
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const abcRef = useRef<typeof ABCJS | null>(null);
  const tuneRef = useRef<ABCJS.TuneObject | null>(null);
  const controllerRef = useRef<ABCJS.SynthObjectController | null>(null);
  const onInvalidRef = useRef(onInvalid);
  useEffect(() => {
    onInvalidRef.current = onInvalid;
  }, [onInvalid]);
  const [renderedAbc, setRenderedAbc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [transportComplete, setTransportComplete] = useState(false);
  const ready = renderedAbc === side.abc;

  useEffect(() => {
    let disposed = false;
    controllerRef.current?.pause();
    controllerRef.current = null;
    audioRef.current?.replaceChildren();
    const render = async () => {
      const imported = await import("abcjs");
      if (disposed || !scoreRef.current) return;
      abcRef.current = imported.default;
      scoreRef.current.replaceChildren();
      tuneRef.current = imported.default.renderAbc(scoreRef.current, side.abc, {
        staffwidth: 720,
        responsive: "resize",
      })[0] ?? null;
      setRenderedAbc(tuneRef.current ? side.abc : null);
    };
    void render().catch(() => onInvalidRef.current("INITIALIZATION_FAILURE"));
    return () => {
      disposed = true;
      controllerRef.current?.pause();
    };
  }, [side.abc]);

  const play = async () => {
    if (!ready || !tuneRef.current || !abcRef.current || !audioRef.current || busy) return;
    setBusy(true);
    setTransportComplete(false);
    try {
      controllerRef.current?.pause();
      const controller = new abcRef.current.synth.SynthController();
      controller.load(audioRef.current, {
        onStart: () => setPlaying(true),
        onFinished: () => {
          setPlaying(false);
          setTransportComplete(true);
        },
      }, {
        displayLoop: false,
        displayRestart: false,
        displayPlay: false,
        displayProgress: false,
        displayWarp: false,
      });
      const initialized = await controller.setTune(tuneRef.current, true, {});
      if (initialized.status === "no-audio-context") throw new Error("NO_AUDIO_OUTPUT");
      controllerRef.current = controller;
      await controller.play();
      setPlaying(true);
    } catch (error) {
      setPlaying(false);
      onInvalid(error instanceof Error && error.message === "NO_AUDIO_OUTPUT" ? "NO_AUDIO_OUTPUT" : "PLAYBACK_START_FAILURE");
    } finally {
      setBusy(false);
    }
  };

  const stopEarly = () => {
    controllerRef.current?.pause();
    setPlaying(false);
    setTransportComplete(false);
    onInvalid("STOPPED_EARLY");
  };

  return <section className={styles.player} aria-label={`블라인드 음원 ${label}`}>
    <div className={styles.playerHeader}>
      <strong>{label}</strong>
      <span>{heard
        ? "끝까지 들음 확인됨"
        : transportComplete
          ? "확인 버튼을 눌러 주세요"
          : playing
            ? "재생 중"
            : "아직 끝까지 듣지 않음"}</span>
    </div>
    <div className={styles.transport}>
      <button type="button" onClick={() => void play()} disabled={!ready || busy || playing}>처음부터 재생</button>
      <button type="button" onClick={stopEarly} disabled={!playing}>중간에 정지</button>
      <button type="button" onClick={onHeard} disabled={!transportComplete || heard}>끝까지 들었음 확인</button>
    </div>
    <div className={styles.problemRow}>
      <span>재생 문제:</span>
      <button type="button" onClick={() => onInvalid("NO_AUDIO_OUTPUT")}>소리가 안 남</button>
      <button type="button" onClick={() => onInvalid("AUDIBLE_GLITCH")}>잡음·끊김</button>
    </div>
    <div ref={scoreRef} className={styles.concealedScore} aria-hidden="true" />
    <div ref={audioRef} hidden />
  </section>;
}

export function ExperimentReviewClient({
  items,
  branchSha,
}: {
  readonly items: readonly ListeningItemArtifact[];
  readonly branchSha: string;
}) {
  const [seed, setSeed] = useState("");
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Readonly<Record<string, LockedResponse>>>({});
  const [playback, setPlayback] = useState<Readonly<Record<string, PlaybackState>>>({});
  const [preference, setPreference] = useState<Preference | "">("");
  const [primaryReason, setPrimaryReason] = useState<PrimaryReason | "">("");
  const [confidence, setConfidence] = useState<Confidence | "">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let current = window.localStorage.getItem(SESSION_KEY);
      if (!current) {
        current = window.crypto.randomUUID();
        window.localStorage.setItem(SESSION_KEY, current);
      }
      const stored = loadStoredResponses();
      const firstUnanswered = items.findIndex((item) => !stored[item.id]);
      setSeed(current);
      setResponses(stored);
      setIndex(firstUnanswered < 0 ? Math.max(0, items.length - 1) : firstUnanswered);
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const item = items[index];
  const swap = seed ? deterministicBlindSwap(seed, item.id) : false;
  const sideA = swap ? item.challenger : item.baseline;
  const sideB = swap ? item.baseline : item.challenger;
  const locked = responses[item.id];
  const itemPlayback = playback[item.id] ?? { heardA: false, heardB: false };
  const voteEnabled = itemPlayback.heardA && itemPlayback.heardB && !locked;
  const completedCount = Object.keys(responses).length;

  const updatePlayback = useCallback((update: Partial<PlaybackState>) => {
    setPlayback((previous) => ({
      ...previous,
      [item.id]: {
        ...(previous[item.id] ?? { heardA: false, heardB: false }),
        ...update,
      },
    }));
  }, [item.id]);

  const lockResponse = () => {
    if (!voteEnabled || !preference || !primaryReason || !confidence) return;
    const response: LockedResponse = {
      preference,
      primaryReason,
      confidence,
      note: note.trim().slice(0, 240),
      lockedAtIso: new Date().toISOString(),
    };
    setResponses((previous) => {
      const next = { ...previous, [item.id]: response };
      window.localStorage.setItem(RESPONSE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const goTo = (nextIndex: number) => {
    setIndex(Math.max(0, Math.min(items.length - 1, nextIndex)));
    setPreference("");
    setPrimaryReason("");
    setConfidence("");
    setNote("");
  };

  const exportBundle = useMemo(() => JSON.stringify({
    schema: "hm-wag-v102-listening-export-v1",
    branchSha,
    sessionSeed: seed,
    exportedAtIso: new Date().toISOString(),
    itemCount: items.length,
    completedCount,
    items: items.map((entry) => {
      const entrySwap = seed ? deterministicBlindSwap(seed, entry.id) : false;
      return {
        id: entry.id,
        feature: entry.feature,
        fixtureId: entry.fixtureId,
        reverseDuplicateOf: entry.reverseDuplicateOf ?? null,
        mapping: {
          A: entrySwap ? entry.challenger.variant : entry.baseline.variant,
          B: entrySwap ? entry.baseline.variant : entry.challenger.variant,
        },
        playback: playback[entry.id] ?? null,
        response: responses[entry.id] ?? null,
        baseline: entry.baseline,
        challenger: entry.challenger,
      };
    }),
  }, null, 2), [branchSha, completedCount, items, playback, responses, seed]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportBundle], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `HarmonyMaker-WAG-v102-listening-${branchSha.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>분리된 선택기 실험 · 실제 제품 미적용</p>
      <h1>WAG v1.0.2 블라인드 청취 평가</h1>
      <p>고정된 반주 + 리드 + 화음 믹스만 듣고 평가해 주세요. 응답을 확정하기 전까지 실험안 이름, 음표, 분석 지표는 표시되지 않습니다.</p>
      <div className={styles.progress}>{completedCount} / {items.length}개 응답 확정</div>
    </header>

    <section className={styles.card}>
      <div className={styles.itemHeader}>
        <div>
          <span>{items.length}개 중 {index + 1}번째 비교</span>
          <h2>{FEATURE_LABELS[item.feature]} 비교</h2>
        </div>
        <code>{item.id}</code>
      </div>
      <div className={styles.playerGrid}>
        <BlindPlayer
          key={`${item.id}:A:${sideA.variant}`}
          label="A"
          side={sideA}
          heard={itemPlayback.heardA}
          onHeard={() => updatePlayback({ heardA: true, invalidA: undefined })}
          onInvalid={(reason) => updatePlayback({ heardA: false, invalidA: reason })}
        />
        <BlindPlayer
          key={`${item.id}:B:${sideB.variant}`}
          label="B"
          side={sideB}
          heard={itemPlayback.heardB}
          onHeard={() => updatePlayback({ heardB: true, invalidB: undefined })}
          onInvalid={(reason) => updatePlayback({ heardB: false, invalidB: reason })}
        />
      </div>

      {!locked ? <div className={styles.votePanel}>
        <label>어느 쪽이 더 좋은가요?
          <select value={preference} onChange={(event) => setPreference(event.target.value as Preference | "")} disabled={!voteEnabled}>
            <option value="">A와 B를 모두 들은 뒤 선택</option>
            <option value="strongly-a">A가 확실히 더 좋음</option>
            <option value="slightly-a">A가 약간 더 좋음</option>
            <option value="tie">차이를 느끼기 어려움 / 동률</option>
            <option value="slightly-b">B가 약간 더 좋음</option>
            <option value="strongly-b">B가 확실히 더 좋음</option>
          </select>
        </label>
        <label>가장 중요한 판단 이유
          <select value={primaryReason} onChange={(event) => setPrimaryReason(event.target.value as PrimaryReason | "")} disabled={!voteEnabled}>
            <option value="">이유 선택</option>
            <option value="singability-tessitura">부르기 편한 음역</option>
            <option value="continuity-no-dropout">중간에 끊기지 않는 연결</option>
            <option value="reentry-naturalness">쉼 뒤 재진입의 자연스러움</option>
            <option value="harmonic-fit">코드·반주와의 화성적 어울림</option>
            <option value="line-naturalness">화음 선율의 자연스러움</option>
            <option value="no-meaningful-difference">의미 있는 차이를 느끼지 못함</option>
            <option value="other">기타</option>
          </select>
        </label>
        <label>판단 확신도
          <select value={confidence} onChange={(event) => setConfidence(event.target.value as Confidence | "")} disabled={!voteEnabled}>
            <option value="">확신도 선택</option>
            <option value="low">낮음</option>
            <option value="medium">보통</option>
            <option value="high">높음</option>
          </select>
        </label>
        <label className={styles.noteLabel}>메모(선택)
          <input
            value={note}
            maxLength={240}
            placeholder="느낀 차이를 간단히 적어도 됩니다."
            onChange={(event) => setNote(event.target.value)}
            disabled={!voteEnabled}
          />
        </label>
        <button
          type="button"
          className={styles.primary}
          disabled={!voteEnabled || !preference || !primaryReason || !confidence}
          onClick={lockResponse}
        >응답 확정 후 결과 보기</button>
      </div> : <div className={styles.reveal}>
        <h3>응답이 확정되었습니다</h3>
        <p>A = <strong>{sideA.variant}</strong> · B = <strong>{sideB.variant}</strong></p>
        <div className={styles.revealGrid}>
          <article><h4>A 음표 및 분석 지표</h4><code>{sideA.pitchLabels.join(" · ")}</code><pre>{JSON.stringify(sideA.metrics, null, 2)}</pre></article>
          <article><h4>B 음표 및 분석 지표</h4><code>{sideB.pitchLabels.join(" · ")}</code><pre>{JSON.stringify(sideB.metrics, null, 2)}</pre></article>
        </div>
      </div>}

      <div className={styles.navigation}>
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}>이전</button>
        <button type="button" onClick={() => goTo(index + 1)} disabled={index === items.length - 1 || !locked}>다음</button>
        <button type="button" onClick={download}>평가 결과 JSON 다운로드</button>
      </div>
    </section>

    <footer className={styles.footer}>
      <p>이 평가는 개발 방향을 정하기 위한 참고 증거입니다. 다수 사용자의 선호를 대표하지 않으며, 결과만으로 WAG v1.0.2가 자동 채택되지는 않습니다.</p>
      <code>{branchSha}</code>
    </footer>
  </main>;
}
