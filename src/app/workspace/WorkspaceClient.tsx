"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ChangeEvent } from "react";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import type { ArrangementPresetId } from "../../domain/config";
import type { ChordToneSpec } from "../../domain/chord/model";
import { canonicalJson } from "../../domain/digest/canonical";
import type { ArrangementOutputEdit } from "../../domain/edit/model";
import { outputEditId } from "../../domain/ids";
import type { VariantStageLocks } from "../../domain/locks";
import type { TexturePatternId, VoiceActivityDirective } from "../../domain/plans";
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
import { completedShareRecoveryTransport, dispatchShareCreateReadOnlyRecovery, dispatchShareCreateRecovery, dispatchShareOwnerReconciliation, pendingShareRecoveryTransport } from "../../product/share-create-api";
import { allowShareCreateFreshIntent, bindShareCreateSession, completeShareCreateRecovery, IndexedDbShareCreateRecoveryStore, prepareShareCreateRecovery, restoredShareCreateUiAuthority, ShareCreateOperationGate } from "../../product/share-create-recovery";
import { generateProjectVariant, regenerationBoundary, wagInputFromProject } from "../../product/workspace";
import {
  authoritativeWorkspaceProject,
  deleteWorkspaceProjectAndNavigate,
  WorkspaceRouteController,
} from "../../product/workspace-route-state";
import { activeOutputEditsForCandidate, canonicalLockScopeKey, canonicalLockTargets, compactEditedArrangementHistory, lockFromCanonicalTarget, outputEditTargetId, staleBoundaryPresentation, upsertCanonicalStageLock, upsertEditedSnapshotHistory, type UiStageLock } from "../../product/workspace-controls";
import { ProductPracticePlayer } from "../../product/ProductPracticePlayer";
import styles from "./workspace.module.css";

const PRESETS: readonly ArrangementPresetId[] = ["simple", "standard", "full"];
const PROJECTIONS: readonly ScoreProjection[] = ["full", "lead", "upper", "lower"];
const TEXTURES: readonly TexturePatternId[] = ["UNISON", "UNISON_TO_SPLIT", "TWO_PART_PARALLEL", "ACCENT_BLOCK", "SUSTAINED_PAD", "SUSPENSION_RELEASE"];
const ACTIVITY_VALUES = ["rest", "lead-derived:unison-double", "lead-derived:octave-double", "independent-note:independent-harmony", "sustain:sustained-pad", "sustain:independent-harmony"] as const;
type ActivityValue = typeof ACTIVITY_VALUES[number];
type EditKind = "replace-pitch" | "replace-event-note" | "replace-event-rest" | "set-tie";

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
function toneKey(tone: ChordToneSpec): string { return `${tone.degree}:${tone.alteration}`; }
function activityValue(activity: VoiceActivityDirective): ActivityValue {
  if (activity.state === "rest") return "rest";
  if (activity.state === "lead-derived") return `lead-derived:${activity.behavior}`;
  if (activity.state === "independent-note") return "independent-note:independent-harmony";
  return `sustain:${activity.behavior}`;
}
function parseActivity(value: ActivityValue): VoiceActivityDirective {
  if (value === "rest") return { state: "rest" };
  const [state, behavior] = value.split(":");
  if (state === "lead-derived") return { state, behavior: behavior as "unison-double" | "octave-double" };
  if (state === "independent-note") return { state, behavior: "independent-harmony" };
  return { state: "sustain", behavior: behavior as "sustained-pad" | "independent-harmony" };
}

export function WorkspaceClient() {
  const search = useSearchParams();
  const router = useRouter();
  const projectId = search.get("project") ?? "";
  const projectStore = useMemo(() => new IndexedDbProjectStore(), []);
  const routeController = useMemo(() => new WorkspaceRouteController(projectStore), [projectStore]);
  const [routeState, setRouteState] = useState(routeController.state);
  useLayoutEffect(() => routeController.subscribe(setRouteState), [routeController]);
  const project = authoritativeWorkspaceProject(routeState, projectId);
  const [projection, setProjection] = useState<ScoreProjection>("full");
  const [messageState, setMessageState] = useState<{ readonly projectId: string; readonly value: string }>(() => ({
    projectId,
    value: projectId ? "로컬 프로젝트를 확인하는 중…" : "프로젝트 ID가 없습니다. Quick Review에서 시작해 주세요.",
  }));
  const message = !projectId
    ? "프로젝트 ID가 없습니다. Quick Review에서 시작해 주세요."
    : routeState.requestedId !== projectId || routeState.loadStatus === "loading"
      ? "로컬 프로젝트를 확인하는 중…"
      : messageState.projectId === projectId ? messageState.value : "로컬 프로젝트를 확인하는 중…";
  const setMessage = useCallback((value: string) => setMessageState({ projectId, value }), [projectId]);
  const [busy, setBusy] = useState(false);
  const [pitchText, setPitchText] = useState("C4");
  const [lockTargetKey, setLockTargetKey] = useState("");
  const [lockTexture, setLockTexture] = useState<TexturePatternId>("UNISON");
  const [lockPlacement, setLockPlacement] = useState<"upper" | "lower">("upper");
  const [lockActivity, setLockActivity] = useState<ActivityValue>("rest");
  const [lockAnchorTone, setLockAnchorTone] = useState("");
  const [lockAnchorRelation, setLockAnchorRelation] = useState<"unison" | "octave">("unison");
  const [editTargetId, setEditTargetId] = useState("");
  const [editKind, setEditKind] = useState<EditKind>("replace-pitch");
  const [tieStart, setTieStart] = useState(false);
  const [tieStop, setTieStop] = useState(false);
  const [shareUrlState, setShareUrlState] = useState<{ readonly projectId: string; readonly value?: string }>({ projectId });
  const [storedShareState, setStoredShareState] = useState<{ readonly projectId: string; readonly value?: { token: string; ownerDeleteSecret: string } }>({ projectId });
  const [shareFreshAllowedState, setShareFreshAllowedState] = useState<{ readonly projectId: string; readonly value: boolean }>({ projectId, value: false });
  const shareUrl = shareUrlState.projectId === projectId ? shareUrlState.value : undefined;
  const storedShare = storedShareState.projectId === projectId ? storedShareState.value : undefined;
  const shareFreshAllowed = shareFreshAllowedState.projectId === projectId && shareFreshAllowedState.value;
  const setShareUrl = useCallback((value: string | undefined) => setShareUrlState({ projectId, ...(value ? { value } : {}) }), [projectId]);
  const setStoredShare = useCallback((value: { token: string; ownerDeleteSecret: string } | undefined) => setStoredShareState({ projectId, ...(value ? { value } : {}) }), [projectId]);
  const setShareFreshAllowed = useCallback((value: boolean) => setShareFreshAllowedState({ projectId, value }), [projectId]);
  const shareOperationGate = useMemo(() => new ShareCreateOperationGate(), []);
  const shareRecoveryStore = useMemo(() => new IndexedDbShareCreateRecoveryStore(), []);

  const saveProject = useCallback(async (next: HarmonyProject, status = "이 브라우저에 저장했습니다.", expectedProjectId?: string) => {
    const outcome = await routeController.saveProject(
      projectId,
      next,
      new Date().toISOString(),
      expectedProjectId,
    );
    if (outcome.applied) setMessage(status);
  }, [projectId, routeController, setMessage]);

  useEffect(() => {
    let active = true;
    void routeController.request(projectId).then((outcome) => {
      if (!active || !outcome.applied) return;
      if (outcome.status === "missing") {
        setMessage("이 브라우저에서 프로젝트를 찾을 수 없습니다.");
      } else if (outcome.status === "corrupt") {
        setMessage("IndexedDB 프로젝트를 열지 못했거나 저장본이 손상되었습니다.");
      } else if (outcome.status === "loaded") {
        setMessage(`로컬 저장본 ${new Date(outcome.record.updatedAt).toLocaleString()} 로드 완료`);
      }
    });
    return () => { active = false; };
  }, [projectId, routeController, setMessage]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void shareRecoveryStore.load(projectId).then((envelope) => {
      if (!active || !envelope) return;
      const authority = restoredShareCreateUiAuthority(envelope);
      setShareFreshAllowed(authority.freshIntentAllowed);
      setStoredShare(authority.createdResponse);
      setShareUrl(authority.createdResponse ? `${window.location.origin}/share?token=${encodeURIComponent(authority.createdResponse.token)}` : undefined);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [projectId, shareRecoveryStore, setShareFreshAllowed, setShareUrl, setStoredShare]);

  const presetId = project?.selectedPresetId ?? "standard";
  const variant = project?.variants[presetId];
  const activeCandidate = useMemo(() => {
    if (!variant || variant.lifecycle !== "generation-attempted") return undefined;
    const active = variant.activeArrangement;
    const candidateId = active?.kind === "candidate"
      ? active.candidateId
      : active?.kind === "edited-snapshot"
        ? variant.editedSnapshots.find((snapshot) => snapshot.id === active.snapshotId)?.baseCandidateId
        : undefined;
    return variant.generationResult.candidates.find((candidate) => candidate.id === candidateId) ?? variant.generationResult.candidates[0];
  }, [variant]);
  const lockTargets = useMemo(() => project && variant?.lifecycle === "generation-attempted"
    ? canonicalLockTargets({ project, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate: activeCandidate })
    : [], [activeCandidate, project, variant]);
  const selectedLockTarget = lockTargets.find((target) => target.key === lockTargetKey) ?? lockTargets[0];
  const anchorToneOptions = useMemo(() => {
    if (!project || project.chordTimelineState.status !== "resolved" || selectedLockTarget?.kind !== "anchor" || selectedLockTarget.directive.kind !== "chord-tone") return [];
    const chordSpanId = selectedLockTarget.directive.chordSpanId;
    const span = project.chordTimelineState.timeline.spans.find((candidate) => candidate.id === chordSpanId);
    return span?.parseResult.status === "ok" ? span.parseResult.chord.tones : [];
  }, [project, selectedLockTarget]);
  const editTargets = useMemo(() => activeCandidate ? Object.entries(activeCandidate.generatedEventsByTrack).flatMap(([trackPlanId, events]) => events.map((event) => ({ trackPlanId, event, label: `${trackPlanId} · ${event.range.start.performanceMeasureIndex}:${event.range.start.offset.n}/${event.range.start.offset.d} · ${event.kind} · ${event.id}` }))) : [], [activeCandidate]);
  const selectedEditTarget = editTargets.find((target) => target.event.id === editTargetId) ?? editTargets[0];
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
    const operationProjectId = routeController.beginMutation(projectId).projectId;
    setBusy(true); setMessage(`${regenerationBoundary(project.variants[presetId] ?? { lifecycle: "empty", presetId, diagnostics: [] }) === "none" ? "Intent" : "stale boundary"}부터 정본 lifecycle을 실행하는 중…`);
    try {
      const outcome = await generateProjectVariant(project, presetId);
      if (outcome.status === "blocked") await saveProject(outcome.project, `blocked · ${outcome.stage} · ${outcome.diagnostics.map((item) => item.code).join(", ") || "진단 없음"} · 시도 권위 저장`, operationProjectId);
      else await saveProject(outcome.project, `${outcome.status} · 후보 ${outcome.execution.generation.result.candidates.length}개 · 독립 Validator 통과 결과 저장`, operationProjectId);
      setShareUrl(undefined);
    } catch (error) {
      if (routeController.mutationStillCurrent(projectId, operationProjectId)) setMessage(error instanceof Error ? error.message : "생성에 실패했습니다.");
    }
    finally { setBusy(false); }
  };

  const chooseCandidate = async (candidateId: string) => { if (project) await saveProject(selectActiveCandidate(project, presetId, candidateId), "active candidate를 변경했습니다."); };
  const chooseSnapshot = async (snapshotId: string) => { if (project) await saveProject(selectActiveSnapshot(project, presetId, snapshotId), "edited snapshot을 선택했습니다."); };

  const chooseLockTarget = (key: string) => {
    setLockTargetKey(key);
    const target = lockTargets.find((candidate) => candidate.key === key);
    if (!target) return;
    if (target.kind === "texture") setLockTexture(target.defaultTexture);
    if (target.kind === "placement-role") setLockPlacement(target.defaultPlacementRole);
    if (target.kind === "activity") setLockActivity(activityValue(target.defaultActivity));
    if (target.kind === "anchor" && target.directive.kind === "chord-tone") setLockAnchorTone(toneKey(target.directive.selectedTone));
    if (target.kind === "anchor" && target.directive.kind === "lead-derived") setLockAnchorRelation(target.directive.relation);
    if (target.kind === "pitch") setPitchText(`${target.defaultPitch.step}${target.defaultPitch.alter === -2 ? "bb" : target.defaultPitch.alter === -1 ? "b" : target.defaultPitch.alter === 1 ? "#" : target.defaultPitch.alter === 2 ? "##" : ""}${target.defaultPitch.octave}`);
  };

  const applyLock = async () => {
    if (!project || !selectedLockTarget) return;
    const byStage = project.locksByPreset[presetId] ?? { intent: [], activity: [], anchor: [], solver: [] };
    const allLocks = Object.values(byStage).flat() as UiStageLock[];
    const usedOrdinals = new Set(allLocks.flatMap((lock) => /:(\d+)$/u.exec(lock.id)?.[1]).map(Number));
    let ordinal = 0; while (usedOrdinals.has(ordinal)) ordinal += 1;
    const pitch = parsePitch(pitchText);
    if (selectedLockTarget.kind === "pitch" && !pitch) { setMessage("Solver lock 음정을 C4, Bb3처럼 입력해 주세요."); return; }
    const anchorTone = anchorToneOptions.find((tone) => toneKey(tone) === lockAnchorTone);
    let lock = lockFromCanonicalTarget({
      presetId, target: selectedLockTarget, ordinal, texture: lockTexture, placementRole: lockPlacement,
      activity: parseActivity(lockActivity), ...(pitch ? { pitch } : {}), ...(anchorTone ? { anchorTone } : {}), anchorRelation: lockAnchorRelation,
    });
    const current = byStage[selectedLockTarget.stage] as readonly UiStageLock[];
    const existing = current.find((candidate) => canonicalLockScopeKey(candidate) === canonicalLockScopeKey(lock));
    if (existing) lock = { ...lock, id: existing.id } as UiStageLock;
    const next = replaceStageLocks(project, presetId, selectedLockTarget.stage, upsertCanonicalStageLock(current, lock));
    const boundary = next.variants[presetId]?.staleness?.staleFrom ?? (selectedLockTarget.stage === "solver" ? "generation" : selectedLockTarget.stage);
    await saveProject(next, `${selectedLockTarget.stage} lock ${existing ? "교체" : "생성"} · ${staleBoundaryPresentation(boundary)}`);
  };

  const removeLock = async (stage: keyof VariantStageLocks, id: string) => {
    if (!project) return;
    const byStage = project.locksByPreset[presetId] ?? { intent: [], activity: [], anchor: [], solver: [] };
    const next = replaceStageLocks(project, presetId, stage, byStage[stage].filter((lock) => lock.id !== id));
    const boundary = next.variants[presetId]?.staleness?.staleFrom ?? (stage === "solver" ? "generation" : stage);
    await saveProject(next, `${stage} lock 제거 · ${staleBoundaryPresentation(boundary)}`);
  };

  const applyOutputEdit = async () => {
    if (!project || !variant || variant.lifecycle !== "generation-attempted" || variant.staleness || !activeCandidate || !selectedEditTarget) return;
    const operationProjectId = routeController.beginMutation(projectId).projectId;
    const event = selectedEditTarget.event;
    const pitch = parsePitch(pitchText);
    if ((editKind === "replace-pitch" || editKind === "replace-event-note") && !pitch) { setMessage("편집 음정을 C4, Bb3처럼 입력해 주세요."); return; }
    if ((editKind === "replace-pitch" || editKind === "set-tie") && event.kind !== "note") { setMessage("이 편집 종류는 note 이벤트만 대상으로 합니다."); return; }
    const historicalEdits = variant.outputEdits.filter((item) => item.baseCandidateId === activeCandidate.id);
    const baseEdits = activeOutputEditsForCandidate(variant, activeCandidate.id);
    const existing = baseEdits.find((item) => outputEditTargetId(item) === event.id);
    const provisionalOrdinal = existing?.editOrdinal ?? Math.max(-1, ...historicalEdits.map((item) => item.editOrdinal)) + 1;
    const provisionalCommon = { id: existing?.id ?? outputEditId(presetId, activeCandidate.contentDigest, provisionalOrdinal), presetId, baseCandidateId: activeCandidate.id, baseCandidateDigest: activeCandidate.contentDigest, editOrdinal: provisionalOrdinal } as const;
    const provisionalEdit: ArrangementOutputEdit = editKind === "replace-pitch"
      ? { ...provisionalCommon, kind: "replace-pitch", eventId: event.id, pitch: pitch! }
      : editKind === "replace-event-note"
        ? { ...provisionalCommon, kind: "replace-event", oldEventId: event.id, replacement: { kind: "note", pitch: pitch!, tieStart, tieStop } }
        : editKind === "replace-event-rest"
          ? { ...provisionalCommon, kind: "replace-event", oldEventId: event.id, replacement: { kind: "rest" } }
          : { ...provisionalCommon, kind: "set-tie", eventId: event.id, tieStart, tieStop };
    const identical = existing !== undefined && canonicalJson(existing) === canonicalJson(provisionalEdit);
    const editOrdinal = identical ? existing.editOrdinal : Math.max(-1, ...historicalEdits.map((item) => item.editOrdinal)) + 1;
    const edit = identical ? existing : { ...provisionalEdit, id: outputEditId(presetId, activeCandidate.contentDigest, editOrdinal), editOrdinal } as ArrangementOutputEdit;
    const nextBaseEdits = [...baseEdits.filter((item) => outputEditTargetId(item) !== event.id), edit].sort((left, right) => left.editOrdinal - right.editOrdinal);
    setBusy(true);
    try {
      const result = await materializeEditedArrangement({ lifecycleInput: await wagInputFromProject(project, presetId), intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate: activeCandidate, edits: nextBaseEdits });
      if (result.status === "blocked") { setMessage(`편집 blocked · ${result.diagnostics.map((item) => item.code).join(", ")}`); return; }
      const outputEdits = identical ? variant.outputEdits : [...variant.outputEdits, edit];
      const history = compactEditedArrangementHistory({
        outputEdits,
        editedSnapshots: upsertEditedSnapshotHistory(variant.editedSnapshots, result.snapshot),
        activeSnapshotId: result.snapshot.id,
      });
      const nextVariant = { ...variant, outputEdits: history.outputEdits, editedSnapshots: history.editedSnapshots, activeArrangement: { kind: "edited-snapshot" as const, snapshotId: result.snapshot.id }, diagnostics: result.diagnostics };
      await saveProject({ ...project, variants: { ...project.variants, [presetId]: nextVariant } }, `EditedArrangementSnapshot ${result.snapshot.status} · 독립 Validator/metrics 재실행 완료`, operationProjectId);
    } catch (error) {
      if (routeController.mutationStillCurrent(projectId, operationProjectId)) setMessage(error instanceof Error ? error.message : "편집을 적용하지 못했습니다.");
    }
    finally { setBusy(false); }
  };

  const exportMusicXml = () => {
    if (!project || !materialized || !canDefaultExportOrShare(materialized)) return;
    download(`${safeName(project.source.title)}-${presetId}.musicxml`, exportArrangementMusicXml(materialized.document, materialized.trackRoles, { title: project.source.title, ...(project.source.composer ? { composer: project.source.composer } : {}), key: project.source.defaultKey, tempo: project.source.defaultTempo }), "application/vnd.recordare.musicxml+xml");
  };
  const exportProject = async () => { if (project) download(`${safeName(project.source.title)}.harmonymaker.json`, await exportHarmonyProject(project), "application/json"); };
  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const operationProjectId = routeController.beginMutation(projectId).projectId;
    try { await saveProject(await importHarmonyProject(await file.text()), "정본 프로젝트 파일을 검증하고 로드했습니다.", operationProjectId); }
    catch (error) {
      if (routeController.mutationStillCurrent(projectId, operationProjectId)) setMessage(error instanceof Error ? error.message : "프로젝트 파일이 손상되었습니다.");
    }
  };
  const deleteLocal = async () => {
    if (!projectId) return;
    await deleteWorkspaceProjectAndNavigate(routeController, projectId, () => router.push("/"));
  };

  const createShare = async (explicitFreshIntent = false) => {
    if (!project || !materialized || !canDefaultExportOrShare(materialized)) return;
    const operationProjectId = routeController.beginMutation(projectId).projectId;
    if (!shareOperationGate.tryBegin()) return;
    setBusy(true); setShareUrl(undefined);
    try {
      const withRights = confirmShareRights(project, new Date().toISOString());
      const payload = materializePracticeShare({ project: withRights, presetId, materialized, playbackDefaults: { speedPercent: 100, accompanimentEnabled: true } });
      const encoded = encodeProductUrlShare(payload);
      if (urlShareFits(encoded)) {
        const url = `${window.location.origin}/share#p=${encoded}`;
        setShareUrl(url); await saveProject(withRights, `URL share ${new TextEncoder().encode(encoded).byteLength} bytes · 서버 저장 없음`, operationProjectId);
      } else {
        let envelope = await prepareShareCreateRecovery({
          store: shareRecoveryStore,
          projectId,
          canonicalRequest: { payload, rightsBasis: project.source.rights.basis },
          explicitFreshIntent,
          generateId: () => crypto.randomUUID(),
          now: new Date(),
        });
        const sessionResponse = await fetch("/api/session", { method: "POST" });
        const session = await sessionResponse.json() as { ok: boolean; csrfToken?: string; sessionAuthority?: string; expiresAt?: string; error?: { messageKo?: string } };
        if (!sessionResponse.ok || !session.csrfToken || !session.sessionAuthority || !session.expiresAt) throw new Error(session.error?.messageKo ?? "서버 저장 기능을 사용할 수 없습니다.");
        const { csrfToken, sessionAuthority, expiresAt } = session;
        if (completedShareRecoveryTransport(envelope, sessionAuthority) === "owner-reconcile") {
          const reconciliation = await dispatchShareOwnerReconciliation({ envelope });
          if (!routeController.mutationStillCurrent(projectId, operationProjectId)) return;
          if (reconciliation.kind === "active") {
            if (!envelope.createdResponse) throw new RangeError("SHARE_OWNER_RECONCILE_INVALID");
            setStoredShare(envelope.createdResponse);
            setShareFreshAllowed(false);
            setShareUrl(`${window.location.origin}/share?token=${encodeURIComponent(envelope.createdResponse.token)}`);
            await saveProject(withRights, "소유자 복구 권위로 기존 ShareStore 공유가 active임을 확인했습니다.", operationProjectId);
            return;
          }
          if (reconciliation.kind === "fresh-allowed") {
            envelope = await allowShareCreateFreshIntent({ store: shareRecoveryStore, envelope, reason: reconciliation.reason === "owner-deleted" ? "owner-deleted" : "retired-replay", now: new Date() });
            setShareFreshAllowed(true);
            setMessage(reconciliation.reason === "owner-deleted"
              ? "소유자 삭제가 확정되었습니다. 명시적 새 공유 요청을 시작할 수 있습니다."
              : "이전 공유 만료가 확정되었습니다. 명시적 새 공유 요청을 시작할 수 있습니다.");
            return;
          }
          if (reconciliation.kind === "retain") {
            setMessage(`ShareStore 소유자 복구 결과가 확정되지 않았습니다(${reconciliation.code}). 새 공유는 시작하지 않습니다.`);
            return;
          }
          throw new RangeError(reconciliation.code);
        }
        const crossSessionRecovery = pendingShareRecoveryTransport(envelope, sessionAuthority) === "cross-session-recovery";
        const outcome = crossSessionRecovery
          ? await dispatchShareCreateReadOnlyRecovery({ envelope, csrfToken })
          : await (async () => {
            envelope = await bindShareCreateSession({ store: shareRecoveryStore, envelope, sessionAuthority, sessionExpiresAt: expiresAt, now: new Date() });
            return dispatchShareCreateRecovery({ envelope, csrfToken });
          })();
        if (!routeController.mutationStillCurrent(projectId, operationProjectId)) return;
        if (outcome.kind === "retain") {
          setMessage(`ShareStore 응답이 확정되지 않았습니다(${outcome.code}). 저장된 동일 요청/K1의 read-only 복구만 유지합니다.`);
          return;
        }
        if (outcome.kind === "fresh-allowed") {
          envelope = await allowShareCreateFreshIntent({
            store: shareRecoveryStore,
            envelope,
            reason: outcome.code === "SHARE_CREATE_DETERMINISTIC_NO_EFFECT" ? "deterministic-no-effect" : "retired-replay",
            now: new Date(),
          });
          setShareFreshAllowed(true);
          setMessage(outcome.code === "SHARE_CREATE_DETERMINISTIC_NO_EFFECT"
            ? "이전 요청에 durable 공유 효과가 없음이 확정되었습니다. 명시적 새 요청을 시작할 수 있습니다."
            : "이전 공유가 확정적으로 만료되었습니다. 명시적 새 요청을 시작할 수 있습니다.");
          return;
        }
        if (outcome.kind === "conflict") throw new RangeError("SHARE_CREATE_RECOVERY_CONFLICT");
        if (outcome.kind === "rejected") throw new RangeError(outcome.code);
        const recovered = outcome.response;
        await completeShareCreateRecovery({ store: shareRecoveryStore, envelope, response: recovered, now: new Date() });
        if (!routeController.mutationStillCurrent(projectId, operationProjectId)) return;
        setStoredShare(recovered);
        setShareFreshAllowed(false);
        setShareUrl(`${window.location.origin}/share?token=${encodeURIComponent(recovered.token)}`);
        await saveProject(withRights, "암호화 ShareStore에 저장했고 복구·삭제 권위를 IndexedDB에 보존했습니다.", operationProjectId);
      }
    } catch (error) {
      if (routeController.mutationStillCurrent(projectId, operationProjectId)) setMessage(error instanceof Error ? error.message : "공유를 만들지 못했습니다.");
    }
    finally { shareOperationGate.finish(); setBusy(false); }
  };

  const deleteStoredShare = async () => {
    if (!storedShare) return;
    const bootstrap = await fetch("/api/session", { method: "POST" });
    const session = await bootstrap.json() as { csrfToken?: string };
    if (!bootstrap.ok || !session.csrfToken) { setMessage("ShareStore 삭제 권한을 확인하지 못했습니다."); return; }
    const response = await fetch(`/api/shares/${encodeURIComponent(storedShare.token)}`, { method: "DELETE", headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken }, body: JSON.stringify({ ownerDeleteSecret: storedShare.ownerDeleteSecret }) });
    if (response.ok) { await shareRecoveryStore.delete(projectId); setStoredShare(undefined); setShareFreshAllowed(false); setShareUrl(undefined); setMessage("ShareStore 공유를 소유자 삭제했고 로컬 복구 권위를 제거했습니다."); }
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
      <dl className={styles.grid}><div><dt>상태</dt><dd data-testid="generation-status">{status}</dd></div><div><dt>가수 / track</dt><dd>{project.performers.length} / {project.trackPlans.length}</dd></div><div><dt>candidate</dt><dd>{candidates.length}</dd></div><div><dt>stale boundary / regeneration</dt><dd data-testid="stale-boundary">{staleBoundaryPresentation(variant ? regenerationBoundary(variant) : "none")}</dd></div></dl>
      <ul>{project.assignments.map((assignment) => <li key={assignment.trackPlanId}>{assignment.trackPlanId} → {project.performers.find((item) => item.id === assignment.performerId)?.displayName}</li>)}</ul>
      {variant && variant.lifecycle !== "empty" ? <details><summary>Intent / Activity / Anchor plan 검사</summary><p><code>{short(variant.intentPlan.intentPlanDigest)}</code>{"activityPlan" in variant ? <> · <code>{short(variant.activityPlan.activityPlanDigest)}</code></> : null}{"anchorPlan" in variant ? <> · <code>{short(variant.anchorPlan.anchorPlanDigest)}</code></> : null}</p></details> : null}
    </section>

    {candidates.length > 0 ? <section className="panel"><h2>2. 결과 선택 · 투영</h2><div className={styles.choiceRow}>{candidates.map((candidate, index) => <button type="button" aria-pressed={activeId === candidate.id} key={candidate.id} onClick={() => void chooseCandidate(candidate.id)}>Candidate {index + 1} · {candidate.candidateStatus} · {short(candidate.contentDigest)}</button>)}</div>{snapshots.length ? <div className={styles.choiceRow}>{snapshots.map((snapshot) => <button type="button" aria-pressed={activeId === snapshot.id} key={snapshot.id} onClick={() => void chooseSnapshot(snapshot.id)}>Snapshot · {snapshot.status}</button>)}</div> : null}<div className={styles.choiceRow}>{PROJECTIONS.map((value) => <button type="button" key={value} aria-pressed={projection === value} onClick={() => setProjection(value)}>{value}</button>)}</div>{materialized ? <p>active {materialized.artifactKind} · <strong>{materialized.validity}</strong> · <code>{short(materialized.artifactDigest)}</code></p> : <p className="status error">active artifact가 stale이거나 없습니다.</p>}</section> : null}

    {abc && playbackPlan && materialized ? <><section className="panel"><h2>3. Score · practice</h2><p>Lead / Upper / Lower / full 투영과 deterministic band가 같은 ArrangementRenderDocument에서 생성됩니다.</p></section><ProductPracticePlayer key={`${materialized.artifactDigest}:${projection}`} abc={abc} plan={playbackPlan} tempo={project.source.defaultTempo} identity={`${materialized.artifactDigest}:${projection}`} /></> : null}

    {variant?.lifecycle === "generation-attempted" ? <section className="panel"><h2>4. Locks · candidate-bound edit</h2>
      <h3>Canonical stage locks</h3>
      <div className={styles.controls}>
        <label>Target <select data-testid="lock-target" value={selectedLockTarget?.key ?? ""} onChange={(event) => chooseLockTarget(event.target.value)}>{lockTargets.map((target) => <option key={target.key} value={target.key}>{target.stage} · {target.label}</option>)}</select></label>
        {selectedLockTarget?.kind === "texture" ? <label>Texture <select value={lockTexture} onChange={(event) => setLockTexture(event.target.value as TexturePatternId)}>{TEXTURES.map((texture) => <option value={texture} key={texture}>{texture}</option>)}</select></label> : null}
        {selectedLockTarget?.kind === "placement-role" ? <label>Placement <select value={lockPlacement} onChange={(event) => setLockPlacement(event.target.value as "upper" | "lower")}><option value="upper">upper</option><option value="lower">lower</option></select></label> : null}
        {selectedLockTarget?.kind === "activity" ? <label>Activity <select value={lockActivity} onChange={(event) => setLockActivity(event.target.value as ActivityValue)}>{ACTIVITY_VALUES.map((value) => <option value={value} key={value}>{value}</option>)}</select></label> : null}
        {selectedLockTarget?.kind === "anchor" && selectedLockTarget.directive.kind === "chord-tone" ? <label>Chord tone <select value={lockAnchorTone || toneKey(selectedLockTarget.directive.selectedTone)} onChange={(event) => setLockAnchorTone(event.target.value)}>{anchorToneOptions.map((tone) => <option value={toneKey(tone)} key={toneKey(tone)}>degree {tone.degree} · alter {tone.alteration}</option>)}</select></label> : null}
        {selectedLockTarget?.kind === "anchor" && selectedLockTarget.directive.kind === "lead-derived" ? <label>Relation <select value={lockAnchorRelation} onChange={(event) => setLockAnchorRelation(event.target.value as "unison" | "octave")}><option value="unison">unison</option><option value="octave">octave</option></select></label> : null}
        {selectedLockTarget?.kind === "anchor" && selectedLockTarget.directive.kind === "planned-nct" ? <span>canonical planned-nct endpoints / resolution</span> : null}
        {selectedLockTarget?.kind === "pitch" ? <label>Pitch <input value={pitchText} onChange={(event) => setPitchText(event.target.value)} aria-label="solver lock pitch" /></label> : null}
        <button type="button" disabled={!selectedLockTarget} onClick={() => void applyLock()}>Lock 생성 / 교체</button>
      </div>
      <ul data-testid="stage-locks">{(Object.entries(project.locksByPreset[presetId] ?? { intent: [], activity: [], anchor: [], solver: [] }) as Array<[keyof VariantStageLocks, readonly UiStageLock[]]>).flatMap(([stage, locks]) => locks.map((lock) => <li key={lock.id}>{stage} · {lock.kind} · {canonicalLockScopeKey(lock)} <button type="button" onClick={() => void removeLock(stage, lock.id)}>제거</button></li>))}</ul>
      <p>Intent {project.locksByPreset[presetId]?.intent.length ?? 0} · Activity {project.locksByPreset[presetId]?.activity.length ?? 0} · Anchor {project.locksByPreset[presetId]?.anchor.length ?? 0} · Solver {project.locksByPreset[presetId]?.solver.length ?? 0}</p>
      <h3>Canonical output edits</h3>
      <div className={styles.controls}>
        <label>Event <select data-testid="edit-target" value={selectedEditTarget?.event.id ?? ""} onChange={(event) => setEditTargetId(event.target.value)}>{editTargets.map((target) => <option key={target.event.id} value={target.event.id}>{target.label}</option>)}</select></label>
        <label>Edit <select value={editKind} onChange={(event) => setEditKind(event.target.value as EditKind)}><option value="replace-pitch">replace-pitch</option><option value="replace-event-note">replace-event · note</option><option value="replace-event-rest">replace-event · rest</option><option value="set-tie">set-tie</option></select></label>
        {editKind === "replace-pitch" || editKind === "replace-event-note" ? <label>Pitch <input value={pitchText} onChange={(event) => setPitchText(event.target.value)} aria-label="replacement pitch" /></label> : null}
        {editKind === "replace-event-note" || editKind === "set-tie" ? <><label><input type="checkbox" checked={tieStart} onChange={(event) => setTieStart(event.target.checked)} /> tieStart</label><label><input type="checkbox" checked={tieStop} onChange={(event) => setTieStop(event.target.checked)} /> tieStop</label></> : null}
        <button type="button" disabled={busy || Boolean(variant.staleness) || !selectedEditTarget} onClick={() => void applyOutputEdit()}>Snapshot materialize</button>
      </div>
      {variant.staleness ? <p className="status error">편집 차단 · {staleBoundaryPresentation(variant.staleness.staleFrom)} 완료 후 candidate-bound 편집을 다시 선택하세요.</p> : null}
      <p>편집은 canonical event ID와 candidate ID/digest에 묶이며 replace-pitch, replace-event(note/rest), set-tie를 지원합니다. 독립 Validator와 전체 metrics를 다시 실행하고 invalid snapshot의 기본 export/share를 차단합니다.</p>
    </section> : null}

    <section className="panel"><h2>5. Export · local save · project transfer</h2><div className={styles.controls}><button type="button" disabled={!materialized || !canDefaultExportOrShare(materialized)} onClick={exportMusicXml}>MusicXML 다운로드</button><button type="button" onClick={() => void saveProject(project)}>로컬 저장</button><button type="button" onClick={() => void exportProject()}>프로젝트 내보내기</button><label className={styles.fileButton}>프로젝트 가져오기<input hidden type="file" accept="application/json,.json" onChange={(event) => void importProject(event)} /></label><button type="button" onClick={() => void deleteLocal()}>로컬 삭제</button></div></section>

    <section className="panel"><h2>6. 읽기 전용 연습 공유</h2><p>현재 권리 근거: <strong>{project.source.rights.basis}</strong>. 공유 버튼은 share 권리를 명시적으로 확인하고 compact PracticeShare v4를 만듭니다.</p><button className="primary" type="button" disabled={busy || !materialized || !canDefaultExportOrShare(materialized)} onClick={() => void createShare(false)}>권리 확인 후 공유 만들기 / 복구</button>{shareFreshAllowed ? <button type="button" disabled={busy} onClick={() => void createShare(true)}>만료된 요청 대신 명시적으로 새 공유 만들기</button> : null}{shareUrl ? <p className="status"><a href={shareUrl}>{shareUrl}</a></p> : null}{storedShare ? <button type="button" onClick={() => void deleteStoredShare()}>ShareStore 공유 소유자 삭제</button> : null}</section>
  </>;
}
