import type { RendererTier } from "./types";

export interface RendererEvidenceStatus {
  readonly tier: RendererTier;
  readonly machineSmoke: "NOT_RUN" | "PASS" | "FAIL";
  readonly humanAudition: "NOT_RUN" | "HEARD_COMPLETE" | "INVALID";
  readonly beautyCeilingEstablished: boolean;
  readonly note: string;
}

export const RENDERER_TIERS: readonly RendererEvidenceStatus[] = [
  { tier: "POOR", machineSmoke: "NOT_RUN", humanAudition: "NOT_RUN", beautyCeilingEstablished: false, note: "Deliberately weak reference renderer for sensitivity checks." },
  { tier: "COMPETENT_PLAIN", machineSmoke: "NOT_RUN", humanAudition: "NOT_RUN", beautyCeilingEstablished: false, note: "Neutral, intelligible development renderer; the default evidence tier." },
  { tier: "HIGH", machineSmoke: "NOT_RUN", humanAudition: "NOT_RUN", beautyCeilingEstablished: false, note: "Infrastructure slot only. No renderer-beauty conclusion is established without valid human evidence." },
] as const;

export function assertRendererClaim(status: RendererEvidenceStatus): void {
  if (status.beautyCeilingEstablished && status.humanAudition !== "HEARD_COMPLETE") {
    throw new Error("RENDERER_BEAUTY_CLAIM_REQUIRES_HEARD_COMPLETE");
  }
}
