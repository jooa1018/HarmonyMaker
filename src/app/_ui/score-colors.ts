import type { ProductTrackRoleRegistry } from "../../product/track-roles";

const VOICE_COLOR: Record<string, string> = { lead: "var(--hm-melody)", lower: "var(--hm-alto)", upper: "var(--hm-tenor)" };
export function scoreVoiceRoles(registry: ProductTrackRoleRegistry): Readonly<Record<string, string>> {
  return Object.fromEntries(registry.generatedTracks.map(track => {
    const roles = [...new Set(track.placements.map(placement => placement.placementRole))];
    return [track.harmonyRole.toLowerCase(), roles.length === 1 ? roles[0] : "other"];
  }));
}
export function voiceIdsInOrder(abc: string): string[] {
  const score = abc.match(/^%%score\s+(.+)$/m);
  if (score) return score[1].replace(/[()[\]{}|]/g, " ").trim().split(/\s+/).filter(Boolean);
  return [...new Set([...abc.matchAll(/^V:\s*(\S+)/gm)].map(match => match[1]))];
}
export function voiceColorVars(abc: string, roles: Readonly<Record<string, string>> = {}): Record<`--hm-v${number}`, string> {
  return Object.fromEntries(voiceIdsInOrder(abc).map((id, index) => [`--hm-v${index}`, VOICE_COLOR[roles[id] ?? id] ?? (/^rhythm/.test(id) ? "var(--hm-muted)" : "currentColor")]));
}
export function stripAbcTitle(abc: string): string { return abc.replace(/^T:.*(?:\r?\n|$)/gm, ""); }
