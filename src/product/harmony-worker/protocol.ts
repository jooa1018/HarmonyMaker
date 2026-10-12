import type { PracticeSettings, PracticeSharePayload } from "../../domain/share";
import type { RightsBasis } from "../../domain/source/model";
import type { QuickHarmonyAnswer, QuickHarmonyChoice, QuickHarmonyNotice, QuickHarmonyPartResult, QuickHarmonySummary } from "../quick-harmony";
import type { HarmonyProjectDescription, ProjectPracticeView } from "../project-view";

/** Opaque, realm-local references; never serialized as project authority. */
export type PreparationHandle = string & { readonly __preparation: unique symbol };
export type ProjectHandle = string & { readonly __project: unique symbol };
export interface PreparationView {
  readonly handle: PreparationHandle;
  readonly status: "ready" | "needs-input" | "unsupported";
  readonly summary?: QuickHarmonySummary;
  readonly questions: readonly QuickHarmonyNotice[];
  readonly reasons: readonly QuickHarmonyNotice[];
  readonly notes: readonly QuickHarmonyNotice[];
}
export interface ProjectView {
  readonly handle: ProjectHandle;
  readonly projectId: string | null;
  readonly updatedAt: string | null;
  readonly rightsBasis: RightsBasis;
  readonly description: HarmonyProjectDescription;
  readonly practice: ProjectPracticeView;
}
export type GenerationView =
  | { readonly status: "saved"; readonly project: ProjectView }
  | { readonly status: "needs-input" | "unsupported" | "blocked"; readonly preparation: PreparationView; readonly parts: readonly QuickHarmonyPartResult[] };
export interface ShareConfirmation {
  readonly rightsConfirmed: true;
  readonly confirmedAt: string;
  readonly playbackDefaults?: PracticeSettings;
}
export interface WorkerOperations {
  ping: { input: null; output: null };
  prepare: { input: { readonly bytes: Uint8Array; readonly fileName: string }; output: PreparationView };
  /** Answer is a full replacement preview. Generate still receives the final complete choice. */
  answer: { input: { readonly handle: PreparationHandle; readonly answer: QuickHarmonyAnswer }; output: PreparationView };
  generate: { input: { readonly handle: PreparationHandle; readonly choice: QuickHarmonyChoice }; output: GenerationView };
  open: { input: { readonly projectId: string }; output: ProjectView | null };
  list: { input: null; output: readonly { readonly projectId: string; readonly updatedAt: string }[] };
  delete: { input: { readonly projectId: string }; output: null };
  importProject: { input: { readonly encoded: string }; output: ProjectView };
  saveProject: { input: { readonly handle: ProjectHandle; readonly projectId: string; readonly updatedAt: string }; output: ProjectView };
  exportProject: { input: { readonly handle: ProjectHandle }; output: string };
  exportMusicXml: { input: { readonly handle: ProjectHandle }; output: string };
  sharePayload: { input: { readonly handle: ProjectHandle; readonly confirmation: ShareConfirmation }; output: PracticeSharePayload };
  openShare: { input: { readonly payload: unknown }; output: ProjectPracticeView };
  release: { input: { readonly handle: PreparationHandle | ProjectHandle }; output: null };
}
export type Operation = keyof WorkerOperations;
export type WorkerStage = "loading" | "preparing" | "generating" | "verifying" | "committing" | "view";
export type Request = { [K in Operation]: {
  readonly kind: "request"; readonly generation: number; readonly id: number;
  readonly operation: K; readonly input: WorkerOperations[K]["input"];
} }[Operation];
export type ClientMessage = Request | { readonly kind: "commit"; readonly generation: number; readonly id: number };
export type WorkerMessage =
  | { readonly kind: "ready"; readonly protocol: 1 }
  | { readonly kind: "stage"; readonly generation: number; readonly id: number; readonly stage: WorkerStage }
  | { readonly kind: "commit-ready"; readonly generation: number; readonly id: number }
  | { readonly kind: "result"; readonly generation: number; readonly id: number; readonly value: unknown }
  | { readonly kind: "error"; readonly generation: number; readonly id: number; readonly code: string; readonly messageKo: string; readonly projectId?: string };

export class HarmonyWorkerError extends Error {
  constructor(readonly code: string, messageKo: string, readonly projectId?: string) { super(messageKo); this.name = "HarmonyWorkerError"; }
}
