"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import type { ArrangementPresetId } from "../../domain/config";
import type { ArrangementOutputEdit } from "../../domain/edit/model";
import { outputEditId } from "../../domain/ids";
import type { HarmonyProject } from "../../domain/project";
import type { SpelledPitch } from "../../domain/pitch";
import { materializeEditedArrangement } from "../../product/edited-arrangement";
import { IndexedDbProjectStore } from "../../product/local-project-store";
import { replaceStageLocks } from "../../product/locks";
import { exportArrangementMusicXml } from "../../product/musicxml-export";
import { buildPlaybackPlan } from "../../product/playback-plan";
import { confirmShareRights, materializePracticeShare } from "../../product/practice-share";
import { exportHarmonyProject, importHarmonyProject } from "../../product/project-transfer";
import { canDefaultExportOrShare, projectRenderDocument, selectActiveCandidate, selectActiveSnapshot, type MaterializedArrangement, type ScoreProjection } from "../../product/render";
import { arrangementRenderDocumentToAbc } from "../../product/score-adapter";
import { encodeProductUrlShare, urlShareFits } from "../../product/share-url";
import { generateProjectVariant, regenerationBoundary, wagInputFromProject } from "../../product/workspace";
import { ProductPracticePlayer } from "../../product/ProductPracticePlayer";
import styles from "./workspace.module.css";

const PRESETS: readonly ArrangementPresetId[] = ["simple", "standard", "full"];
const PROJECTIONS: readonly ScoreProjection[] = ["full", "lead", "upper", "lower"];

function safeName(value: string): string { return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80) || "harmonymaker"; }
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function parsePitch(text: string): SpelledPitch | undefined {
  const match = /^([A-G])(bb|b|#|##)?(-?\d+)$/u.exec(text.trim());
  if (!match) return undefined;
  const accidental = match[2] ?? "";
  const alter = ({ bb: -2, b: -1, "": 0, "#": 1, "##": 2 } as const)[accidental as "bb" | "b" | "" | "#" | "##"];
  return { step: match[1] as SpelledPitch["step"], alter, octave: Number(match[3]) };
}
function short(value: string): string { return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-8)}` : value; }

export function WorkspaceClient() {
  const search = useSearchParams();
  const router = useRouter();
  const projectId = search.get("project") ?? "";
  const [project, setProject] = useState<HarmonyProject>();
  const [projection, setProjection] = useState<ScoreProjection>("full");
  const [message, setMessage] = useState(() => projectId ? "로컬 프로젝트를 확인하는 중…" : "프로젝트 ID가 없습니다. Quick Review에서 시작해 주세요.");
  const [busy, setBusy] = useState(false);
  const [pitchText, setPitchText] = useState("C4");
  const [shareUrl, setShareUrl] = useState<string>();
  const [storedShare, setStoredShare] = useState<{ token: string; ownerDeleteSecret: string; csrfToken: string }>();

  const saveProject = useCallback(async (next: HarmonyProject, status = "이 브라우저에 저장했습니다.") => {
    if (!projectId) throw new RangeError("PROJECT_ID_MISSING");
    await new IndexedDbProjectStore().save({ projectId, updatedAt: new Date().toISOString(), project: next });
    setProject(next); setMessage(status);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void new IndexedDbProjectStore().load(projectId).then((record) => {
      if (!active) return;
      if (!record) setMessage("이 브라우저에서 프로젝트를 찾을 수 없습니다.");
      else { setProject(record.project); setMessage(`로컬 저장본 ${new Date(record.updatedAt).toLocaleString()} 로드 완료`); }
    }).catch(() => setMessage("IndexedDB 프로젝트를 열지 못했습니다."));
    return () => { active = false; };
  }, [projectId]);

  const presetId = project?.selectedPresetId ?? "standard";
  const variant = project?.variants[presetId];
  const materialized = useMemo<MaterializedArrangement | undefined>(() => {
    if (!project) return undefined;
    try { return projectRenderDocument(project, presetId, projection); } catch { return undefined; }
  }, [presetId, project, projection]);
  const [accompanimentState, setAccompanimentState] = useState<{ readonly identity: string; readonly value: Awaited<ReturnType<typeof generateDeterministicAccompaniment>> }>();
  useEffect(() => {
    if (!materialized) return;
    let active = true;
    const identity = `${materialized.artifactDigest}:${projection}`;
    void generateDeterministicAccompaniment(materialized.document.effectiveChordTimeline).then((value) => { if (active) setAccompanimentState({ identity, value }); });
    return () => { active = false; };
  }, [materialized, projection]);
  const accompaniment = materialized && accompanimentState?.identity === `${materialized.artifactDigest}:${projection}` ? accompanimentState.value : undefined;
  const abc = useMemo(() => materialized && project ? arrangementRenderDocumentToAbc(materialized.document, materialized.trackRoles, { title: project.source.title, tempo: project.source.defaultTempo, key: project.source.defaultKey }) : undefined, [materialized, project]);
  const playbackPlan = useMemo(() => materialized ? buildPlaybackPlan(materialized.document, materialized.trackRoles, accompaniment) : undefined, [accompaniment, materialized]);

  const choosePreset = async (nextPreset: ArrangementPresetId) => {
    if (!project) return;
    await saveProject({ ...project, selectedPresetId: nextPreset }, `${nextPreset} preset을 선택했습니다.`);
    setProjection("full"); setShareUrl(undefined);
  };

  const generate = async () => {
    if (!project) return;
    setBusy(true); setMessage(`${regenerationBoundary(project.variants[presetId] ?? { lifecycle: "empty", presetId, diagnostics: [] }) === "none" ? "Intent" : "stale boundary"}부터 정본 lifecycle을 실행하는 중…`);
    try {
      const outcome = await generateProjectVariant(project, presetId);
      if (outcome.status === "blocked") setMessage(`blocked · ${outcome.stage} · ${outcome.diagnostics.map((item) => item.code).join(", ") || "진단 없음"}`);
      else await saveProject(outcome.project, `${outcome.status} · 후보 ${outcome.execution.generation.result.candidates.length}개 · 독립 Validator 통과 결과 저장`);
      setShareUrl(undefined);
    } catch (error) { setMessage(error instanceof Error ? error.message : "생성에 실패했습니다."); }
    finally { setBusy(false); }
  };

  const chooseCandidate = async (candidateId: string) => { if (project) await saveProject(selectActiveCandidate(project, presetId, candidateId), "active candidate를 변경했습니다."); };
  const chooseSnapshot = async (snapshotId: string) => { if (project) await saveProject(selectActiveSnapshot(project, presetId, snapshotId), "edited snapshot을 선택했습니다."); };

  const addPitchLock = async () => {
    if (!project || !variant || variant.lifecycle !== "generation-attempted") return;
    const candidateId = variant.activeArrangement?.kind === "candidate" ? variant.activeArrangement.candidateId : variant.generationResult.candidates[0]?.id;
    const candidate = variant.generationResult.candidates.find((item) => item.id === candidateId);
    const eventEntry = candidate && Object.entries(candidate.generatedEventsByTrack).flatMap(([trackPlanId, events]) => events.flatMap((event) => event.kind === "note" ? [{ trackPlanId, event }] : []))[0];
    const phraseId = variant.intentPlan.phraseIntents[0]?.phraseId;
    if (!eventEntry || !phraseId) { setMessage("잠글 수 있는 생성 음표가 없습니다."); return; }
    const locks = [...(project.locksByPreset[presetId]?.solver ?? []), { id: `lock:pitch:${(project.locksByPreset[presetId]?.solver.length ?? 0)}`, kind: "pitch" as const, presetId, phraseId, trackPlanId: eventEntry.trackPlanId, position: eventEntry.event.range.start, pitch: eventEntry.event.pitch }];
    await saveProject(replaceStageLocks(project, presetId, "solver", locks), "PitchLock을 추가했습니다. 기존 결과는 generation부터 stale입니다.");
  };

  const applyPitchEdit = async () => {
    if (!project || !variant || variant.lifecycle !== "generation-attempted" || variant.staleness) return;
    const candidateId = variant.activeArrangement?.kind === "candidate" ? variant.activeArrangement.candidateId : variant.generationResult.candidates[0]?.id;
    const candidate = variant.generationResult.candidates.find((item) => item.id === candidateId);
    const event = candidate && Object.values(candidate.generatedEventsByTrack).flat().find((item) => item.kind === "note");
    const pitch = parsePitch(pitchText);
    if (!candidate || !event || event.kind !== "note" || !pitch) { setMessage("편집 음정을 C4, Bb3처럼 입력해 주세요."); return; }
    const editOrdinal = variant.outputEdits.filter((item) => item.baseCandidateId === candidate.id).length;
    const edit: ArrangementOutputEdit = { id: outputEditId(presetId, candidate.contentDigest, editOrdinal), kind: "replace-pitch", presetId, baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal, eventId: event.id, pitch };
    setBusy(true);
    try {
      const result = await materializeEditedArrangement({ lifecycleInput: await wagInputFromProject(project, presetId), intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [...variant.outputEdits.filter((item) => item.baseCandidateId === candidate.id), edit] });
      if (result.status === "blocked") { setMessage(`편집 blocked · ${result.diagnostics.map((item) => item.code).join(", ")}`); return; }
      const nextVariant = { ...variant, outputEdits: [...variant.outputEdits, edit], editedSnapshots: [...variant.editedSnapshots, result.snapshot], activeArrangement: { kind: "edited-snapshot" as const, snapshotId: result.snapshot.id }, diagnostics: result.diagnostics };
      await saveProject({ ...project, variants: { ...project.variants, [presetId]: nextVariant } }, `EditedArrangementSnapshot ${result.snapshot.status} · 독립 Validator/metrics 재실행 완료`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "편집을 적용하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const exportMusicXml = () => {
    if (!project || !materialized || !canDefaultExportOrShare(materialized)) return;
    download(`${safeName(project.source.title)}-${presetId}.musicxml`, exportArrangementMusicXml(materialized.document, materialized.trackRoles, { title: project.source.title, ...(project.source.composer ? { composer: project.source.composer } : {}), key: project.source.defaultKey }), "application/vnd.recordare.musicxml+xml");
  };
  const exportProject = async () => { if (project) download(`${safeName(project.source.title)}.harmonymaker.json`, await exportHarmonyProject(project), "application/json"); };
  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try { await saveProject(await importHarmonyProject(await file.text()), "정본 프로젝트 파일을 검증하고 로드했습니다."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "프로젝트 파일이 손상되었습니다."); }
  };
  const deleteLocal = async () => { if (!projectId) return; await new IndexedDbProjectStore().delete(projectId); router.push("/"); };

  const createShare = async () => {
    if (!project || !materialized || !canDefaultExportOrShare(materialized)) return;
    setBusy(true); setShareUrl(undefined);
    try {
      const withRights = confirmShareRights(project, new Date().toISOString());
      const payload = materializePracticeShare({ project: withRights, presetId, materialized, playbackDefaults: { speedPercent: 100, accompanimentEnabled: true } });
      const encoded = encodeProductUrlShare(payload);
      if (urlShareFits(encoded)) {
        const url = `${window.location.origin}/share#p=${encoded}`;
        setShareUrl(url); await saveProject(withRights, `URL share ${new TextEncoder().encode(encoded).byteLength} bytes · 서버 저장 없음`);
      } else {
        const sessionResponse = await fetch("/api/session", { method: "POST" });
        const session = await sessionResponse.json() as { ok: boolean; csrfToken?: string; error?: { messageKo?: string } };
        if (!sessionResponse.ok || !session.csrfToken) throw new Error(session.error?.messageKo ?? "서버 저장 기능을 사용할 수 없습니다.");
        const response = await fetch("/api/shares", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken }, body: JSON.stringify({ payload, rightsBasis: project.source.rights.basis, idempotencyKey: crypto.randomUUID() }) });
        const body = await response.json() as { ok: boolean; share?: { token: string; ownerDeleteSecret: string }; error?: { messageKo?: string } };
        if (!response.ok || !body.share) throw new Error(body.error?.messageKo ?? "ShareStore 저장에 실패했습니다.");
        setStoredShare({ ...body.share, csrfToken: session.csrfToken });
        setShareUrl(`${window.location.origin}/share?token=${encodeURIComponent(body.share.token)}`);
        await saveProject(withRights, "암호화 ShareStore에 저장했습니다. 삭제 비밀은 이 화면에만 유지됩니다.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "공유를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };

  const deleteStoredShare = async () => {
    if (!storedShare) return;
    const response = await fetch(`/api/shares/${encodeURIComponent(storedShare.token)}`, { method: "DELETE", headers: { "content-type": "application/json", "x-csrf-token": storedShare.csrfToken }, body: JSON.stringify({ ownerDeleteSecret: storedShare.ownerDeleteSecret }) });
    if (response.ok) { setStoredShare(undefined); setShareUrl(undefined); setMessage("ShareStore 공유를 소유자 삭제했습니다."); }
    else setMessage("ShareStore 공유를 삭제하지 못했습니다.");
  };

  if (!project) return <><header><p className="eyebrow">PRODUCT CORE · WORKSPACE</p><h1>프로젝트 워크스페이스</h1></header><section className="panel"><p className="status">{message}</p><p><Link href="/import">Quick Review에서 시작하기 →</Link></p></section></>;
  const candidates = variant?.lifecycle === "generation-attempted" ? variant.generationResult.candidates : [];
  const snapshots = variant?.lifecycle === "generation-attempted" ? variant.editedSnapshots : [];
  const activeId = variant?.lifecycle === "generation-attempted" ? variant.activeArrangement?.kind === "candidate" ? variant.activeArrangement.candidateId : variant.activeArrangement?.snapshotId : undefined;
  const status = variant?.lifecycle === "generation-attempted" ? variant.generationResult.status : variant?.lifecycle ?? "empty";

  return <>
    <header className={styles.header}><div><p className="eyebrow">PRODUCT CORE · CANONICAL WORKSPACE</p><h1>{project.source.title}</h1><p>{project.source.composer ?? "작곡자 미기재"} · {project.source.defaultKey.tonic.step}{project.source.defaultKey.mode === "minor" ? " minor" : " major"}</p></div><Link href="/import">새 Source 가져오기</Link></header>
    <p className="status" aria-live="polite">{message}</p>

    <section className="panel">
      <h2>1. Setup · generation</h2>
      <div className={styles.controls}><label>Preset <select value={presetId} onChange={(event) => void choosePreset(event.target.value as ArrangementPresetId)}>{PRESETS.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button className="primary" type="button" disabled={busy} onClick={() => void generate()}>{busy ? "실행 중…" : variant?.staleness ? `${variant.staleness.staleFrom}부터 재생성` : "정본 화음 생성"}</button></div>
      <dl className={styles.grid}><div><dt>상태</dt><dd data-testid="generation-status">{status}</dd></div><div><dt>가수 / track</dt><dd>{project.performers.length} / {project.trackPlans.length}</dd></div><div><dt>candidate</dt><dd>{candidates.length}</dd></div><div><dt>stale boundary</dt><dd>{variant ? regenerationBoundary(variant) : "none"}</dd></div></dl>
      <ul>{project.assignments.map((assignment) => <li key={assignment.trackPlanId}>{assignment.trackPlanId} → {project.performers.find((item) => item.id === assignment.performerId)?.displayName}</li>)}</ul>
      {variant && variant.lifecycle !== "empty" ? <details><summary>Intent / Activity / Anchor plan 검사</summary><p><code>{short(variant.intentPlan.intentPlanDigest)}</code>{"activityPlan" in variant ? <> · <code>{short(variant.activityPlan.activityPlanDigest)}</code></> : null}{"anchorPlan" in variant ? <> · <code>{short(variant.anchorPlan.anchorPlanDigest)}</code></> : null}</p></details> : null}
    </section>

    {candidates.length > 0 ? <section className="panel"><h2>2. 결과 선택 · 투영</h2><div className={styles.choiceRow}>{candidates.map((candidate, index) => <button type="button" aria-pressed={activeId === candidate.id} key={candidate.id} onClick={() => void chooseCandidate(candidate.id)}>Candidate {index + 1} · {candidate.candidateStatus} · {short(candidate.contentDigest)}</button>)}</div>{snapshots.length ? <div className={styles.choiceRow}>{snapshots.map((snapshot) => <button type="button" aria-pressed={activeId === snapshot.id} key={snapshot.id} onClick={() => void chooseSnapshot(snapshot.id)}>Snapshot · {snapshot.status}</button>)}</div> : null}<div className={styles.choiceRow}>{PROJECTIONS.map((value) => <button type="button" key={value} aria-pressed={projection === value} onClick={() => setProjection(value)}>{value}</button>)}</div>{materialized ? <p>active {materialized.artifactKind} · <strong>{materialized.validity}</strong> · <code>{short(materialized.artifactDigest)}</code></p> : <p className="status error">active artifact가 stale이거나 없습니다.</p>}</section> : null}

    {abc && playbackPlan && materialized ? <><section className="panel"><h2>3. Score · practice</h2><p>Lead / Upper / Lower / full 투영과 deterministic band가 같은 ArrangementRenderDocument에서 생성됩니다.</p></section><ProductPracticePlayer key={`${materialized.artifactDigest}:${projection}`} abc={abc} plan={playbackPlan} tempo={project.source.defaultTempo} identity={`${materialized.artifactDigest}:${projection}`} /></> : null}

    {variant?.lifecycle === "generation-attempted" ? <section className="panel"><h2>4. Locks · candidate-bound edit</h2><div className={styles.controls}><button type="button" disabled={Boolean(variant.staleness)} onClick={() => void addPitchLock()}>첫 생성 음표 PitchLock</button><label>첫 생성 음표 교체 <input value={pitchText} onChange={(event) => setPitchText(event.target.value)} aria-label="replacement pitch" /></label><button type="button" disabled={busy || Boolean(variant.staleness)} onClick={() => void applyPitchEdit()}>Snapshot materialize</button></div><p>Intent {project.locksByPreset[presetId]?.intent.length ?? 0} · Activity {project.locksByPreset[presetId]?.activity.length ?? 0} · Anchor {project.locksByPreset[presetId]?.anchor.length ?? 0} · Solver {project.locksByPreset[presetId]?.solver.length ?? 0}</p><p>편집은 candidate ID/digest에 묶이고, 독립 Validator와 metrics를 다시 실행합니다. invalid snapshot은 검사할 수 있지만 기본 export/share는 차단됩니다.</p></section> : null}

    <section className="panel"><h2>5. Export · local save · project transfer</h2><div className={styles.controls}><button type="button" disabled={!materialized || !canDefaultExportOrShare(materialized)} onClick={exportMusicXml}>MusicXML 다운로드</button><button type="button" onClick={() => void saveProject(project)}>로컬 저장</button><button type="button" onClick={() => void exportProject()}>프로젝트 내보내기</button><label className={styles.fileButton}>프로젝트 가져오기<input hidden type="file" accept="application/json,.json" onChange={(event) => void importProject(event)} /></label><button type="button" onClick={() => void deleteLocal()}>로컬 삭제</button></div></section>

    <section className="panel"><h2>6. 읽기 전용 연습 공유</h2><p>현재 권리 근거: <strong>{project.source.rights.basis}</strong>. 공유 버튼은 share 권리를 명시적으로 확인하고 compact PracticeShare v3만 만듭니다.</p><button className="primary" type="button" disabled={busy || !materialized || !canDefaultExportOrShare(materialized)} onClick={() => void createShare()}>권리 확인 후 공유 만들기</button>{shareUrl ? <p className="status"><a href={shareUrl}>{shareUrl}</a></p> : null}{storedShare ? <button type="button" onClick={() => void deleteStoredShare()}>ShareStore 공유 소유자 삭제</button> : null}</section>
  </>;
}
