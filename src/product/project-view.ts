import { generateDeterministicAccompaniment } from "../accompaniment/deterministic";
import { isKeySignature } from "../domain/pitch";
import type { HarmonyProject } from "../domain/project";
import { quickHarmonyParts } from "../domain/quick-harmony-policy";
import type { TempoSpec } from "../domain/source/model";
import { buildPlaybackPlan, type PlaybackPlan } from "./playback-plan";
import { projectPartStatus, recordedPartReason } from "./project-part-status";
import { materializeActiveArrangement, type MaterializedArrangement } from "./render";
import { arrangementRenderDocumentToAbc } from "./score-adapter";
import { productTrackRoles } from "./track-roles";

export interface HarmonyProjectDescription {
  readonly title: string | null;
  readonly keyLabelKo: string;
  readonly meters: readonly string[];
  readonly measureCount: number;
  readonly parts: readonly {
    readonly role: "upper" | "lower" | "other";
    readonly label: string;
    readonly part?: "alto" | "tenor";
    readonly status?: "complete" | "partial" | "missing";
    readonly missingMeasures?: readonly number[];
    readonly reasonKo?: string;
  }[];
}

/** Best-effort synchronous display data. Never an integrity or playback authority. */
export function describeHarmonyProject(project: HarmonyProject): HarmonyProjectDescription {
  let result: HarmonyProjectDescription = {title:null,keyLabelKo:"조성 확인 필요",meters:[],measureCount:0,parts:[]};
  try {
    const source=project.source;
    result={...result,title:typeof source.title === "string" ? source.title.trim() || null : null};
    const measures=Array.isArray(source.sourceMeasures) ? source.sourceMeasures : [];
    const key=measures[0]?.key ?? source.defaultKey;
    if(isKeySignature(key)){
      const accidental=({[-2]:"bb",[-1]:"b",0:"",1:"#",2:"##"} as const)[key.tonic.alter];
      result={...result,keyLabelKo:`${key.tonic.step}${accidental}${key.mode === "major" ? "장조" : "단조"}`};
    }
    result={...result,measureCount:measures.length,meters:[...new Set(measures.flatMap(m=>m?.time ? [`${m.time.numerator}/${m.time.denominator}`] : []))]};
    const preset=project.selectedPresetId ?? "standard";
    let materialized: MaterializedArrangement | undefined;
    try {materialized=materializeActiveArrangement(project,preset);} catch { /* Details remain readable without active output. */ }
    let requested:ReturnType<typeof quickHarmonyParts>;
    try {requested=quickHarmonyParts(source);} catch { /* Malformed optional metadata is not display authority. */ }
    const parts=project.trackPlans.filter(t=>t.kind === "generated-harmony" && t.enabled)
      .sort((a,b)=>a.canonicalOrdinal-b.canonicalOrdinal).map(track=>{
        const part=requested?.[track.canonicalOrdinal-1];
        let role: "upper" | "lower" | "other" = part ? part === "tenor" ? "upper" : "lower" : "other";
        let label=part ? part === "tenor" ? "테너" : "알토" : track.displayLabel;
        try {
          const metadata=productTrackRoles(project,preset,[track.id]).byTrackPlanId[track.id];
          const placements=new Set(metadata.placements.map(p=>p.placementRole));
          role=placements.size===1 ? [...placements][0] : "other";
          label=metadata.label;
        } catch { /* Keep the recorded track label when role metadata is unavailable. */ }
        const coverage = materialized ? projectPartStatus(project,materialized.document,track.id) : undefined;
        const reasonKo = part && coverage ? recordedPartReason(project,preset,track.id,part,coverage) : undefined;
        return {role,label,...(part ? {part} : {}),...coverage,...(reasonKo ? {reasonKo} : {})};
      });
    result={...result,parts};
  } catch { /* Best effort even for incomplete legacy records; never throw from list rendering. */ }
  return result;
}

export type ProjectPracticeView =
  | { readonly status: "available"; readonly abc: string; readonly plan: PlaybackPlan; readonly tempo: TempoSpec; readonly identity: string }
  | { readonly status: "unavailable"; readonly code: string };

/** Callers pass a loaded project. Preserve existing integrity rejections. */
export async function projectPracticeView(project: HarmonyProject): Promise<ProjectPracticeView> {
  try {
    const materialized=materializeActiveArrangement(project,project.selectedPresetId ?? "standard");
    // Capture owned input before the first await: concurrent calls and later
    // edits cannot mix one artifact with another call's notation or band.
    const {document,trackRoles}=structuredClone({document:materialized.document,trackRoles:materialized.trackRoles});
    const notation=structuredClone({title:project.source.title,tempo:project.source.defaultTempo,key:project.source.defaultKey});
    const abc=arrangementRenderDocumentToAbc(document,trackRoles,notation);
    const accompaniment=await generateDeterministicAccompaniment(document.effectiveChordTimeline);
    return {status:"available",abc,plan:buildPlaybackPlan(document,trackRoles,accompaniment),tempo:notation.tempo,identity:`${materialized.artifactDigest}:full`};
  } catch(error) {
    if(error instanceof RangeError && ["ACTIVE_ARRANGEMENT_UNAVAILABLE","PROJECT_AUTHORITY_STALE","ABC_SERIALIZATION_UNAVAILABLE"].includes(error.message))
      return {status:"unavailable",code:error.message};
    throw error;
  }
}
