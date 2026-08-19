import type { HarmonyProject } from "../domain/project";
import type { LocalProjectRecord, LocalProjectStore } from "./local-project-store";

export type WorkspaceLoadStatus = "idle" | "loading" | "loaded" | "missing" | "corrupt";

export interface WorkspaceRouteState {
  readonly requestedId: string;
  readonly loadedId?: string;
  readonly loadStatus: WorkspaceLoadStatus;
  readonly project?: HarmonyProject;
}

export type WorkspaceRouteAction =
  | { readonly type: "request"; readonly requestedId: string }
  | { readonly type: "loaded"; readonly requestedId: string; readonly loadedId: string; readonly project: HarmonyProject }
  | { readonly type: "missing"; readonly requestedId: string }
  | { readonly type: "corrupt"; readonly requestedId: string }
  | { readonly type: "saved"; readonly requestedId: string; readonly loadedId: string; readonly project: HarmonyProject };

export function initialWorkspaceRouteState(requestedId: string): WorkspaceRouteState {
  return { requestedId, loadStatus: requestedId ? "loading" : "idle" };
}

export function reduceWorkspaceRoute(
  state: WorkspaceRouteState,
  action: WorkspaceRouteAction,
): WorkspaceRouteState {
  if (action.type === "request") {
    return { requestedId: action.requestedId, loadStatus: action.requestedId ? "loading" : "idle" };
  }
  if (action.requestedId !== state.requestedId) return state;
  if (action.type === "missing" || action.type === "corrupt") {
    return { requestedId: state.requestedId, loadStatus: action.type };
  }
  if (action.loadedId !== action.requestedId) {
    return { requestedId: state.requestedId, loadStatus: "corrupt" };
  }
  return {
    requestedId: state.requestedId,
    loadedId: action.loadedId,
    loadStatus: "loaded",
    project: action.project,
  };
}

export function authoritativeWorkspaceProject(
  state: WorkspaceRouteState,
  currentRequestedId: string,
): HarmonyProject | undefined {
  return state.loadStatus === "loaded"
    && state.requestedId === currentRequestedId
    && state.loadedId === currentRequestedId
    ? state.project
    : undefined;
}

export interface WorkspaceMutationAuthority {
  readonly projectId: string;
  readonly project: HarmonyProject;
}

export function authoritativeWorkspaceSaveRecord(
  state: WorkspaceRouteState,
  currentRequestedId: string,
  project: HarmonyProject,
  updatedAt: string,
): { readonly projectId: string; readonly project: HarmonyProject; readonly updatedAt: string } {
  const authority = requireWorkspaceMutationAuthority(state, currentRequestedId);
  return { projectId: authority.projectId, project, updatedAt };
}

export function requireWorkspaceMutationAuthority(
  state: WorkspaceRouteState,
  currentRequestedId: string,
  expectedProjectId?: string,
): WorkspaceMutationAuthority {
  const project = authoritativeWorkspaceProject(state, currentRequestedId);
  if (!project || !state.loadedId) throw new RangeError("WORKSPACE_PROJECT_AUTHORITY_UNAVAILABLE");
  if (expectedProjectId !== undefined && state.loadedId !== expectedProjectId) {
    throw new RangeError("WORKSPACE_PROJECT_AUTHORITY_SUPERSEDED");
  }
  return { projectId: state.loadedId, project };
}

export function workspaceMutationStillCurrent(
  state: WorkspaceRouteState,
  currentRequestedId: string,
  authorityId: string,
): boolean {
  return authoritativeWorkspaceProject(state, currentRequestedId) !== undefined
    && state.loadedId === authorityId;
}

export type WorkspaceRouteLoadOutcome =
  | { readonly status: "idle"; readonly requestedId: ""; readonly applied: true }
  | { readonly status: "loaded"; readonly requestedId: string; readonly applied: boolean; readonly record: LocalProjectRecord }
  | { readonly status: "missing" | "corrupt"; readonly requestedId: string; readonly applied: boolean };

export interface WorkspaceRouteSaveOutcome {
  readonly applied: boolean;
  readonly record: LocalProjectRecord;
}

export interface WorkspaceRouteDeleteOutcome {
  readonly applied: boolean;
  readonly deletedProjectId: string;
}

/**
 * The executable route authority used by the browser workspace. It owns the
 * deferred LocalProjectStore completion fence as well as the pure state
 * transition, so the tested authority is the production load/save authority.
 */
export class WorkspaceRouteController {
  private stateValue: WorkspaceRouteState;
  private requestGeneration = 0;
  private readonly listeners = new Set<(state: WorkspaceRouteState) => void>();

  constructor(
    private readonly store: LocalProjectStore,
    initialRequestedId = "",
  ) {
    this.stateValue = initialWorkspaceRouteState(initialRequestedId);
  }

  get state(): WorkspaceRouteState { return this.stateValue; }

  subscribe(listener: (state: WorkspaceRouteState) => void): () => void {
    this.listeners.add(listener);
    listener(this.stateValue);
    return () => { this.listeners.delete(listener); };
  }

  private transition(action: WorkspaceRouteAction): boolean {
    const next = reduceWorkspaceRoute(this.stateValue, action);
    if (next === this.stateValue) return false;
    this.stateValue = next;
    for (const listener of this.listeners) listener(next);
    return true;
  }

  async request(requestedId: string): Promise<WorkspaceRouteLoadOutcome> {
    const generation = ++this.requestGeneration;
    this.transition({ type: "request", requestedId });
    if (!requestedId) return { status: "idle", requestedId: "", applied: true };
    try {
      const record = await this.store.load(requestedId);
      if (!record) {
        return {
          status: "missing",
          requestedId,
          applied: generation === this.requestGeneration
            && this.transition({ type: "missing", requestedId }),
        };
      }
      const applied = generation === this.requestGeneration && this.transition({
        type: "loaded",
        requestedId,
        loadedId: record.projectId,
        project: record.project,
      });
      return record.projectId === requestedId
        ? { status: "loaded", requestedId, applied, record }
        : { status: "corrupt", requestedId, applied };
    } catch {
      return {
        status: "corrupt",
        requestedId,
        applied: generation === this.requestGeneration
          && this.transition({ type: "corrupt", requestedId }),
      };
    }
  }

  beginMutation(currentRequestedId: string, expectedProjectId?: string): WorkspaceMutationAuthority {
    return requireWorkspaceMutationAuthority(this.stateValue, currentRequestedId, expectedProjectId);
  }

  mutationStillCurrent(currentRequestedId: string, authorityId: string): boolean {
    return workspaceMutationStillCurrent(this.stateValue, currentRequestedId, authorityId);
  }

  async saveProject(
    currentRequestedId: string,
    project: HarmonyProject,
    updatedAt: string,
    expectedProjectId?: string,
  ): Promise<WorkspaceRouteSaveOutcome> {
    const authority = this.beginMutation(currentRequestedId, expectedProjectId);
    const record = authoritativeWorkspaceSaveRecord(
      this.stateValue,
      currentRequestedId,
      project,
      updatedAt,
    );
    await this.store.save(record);
    if (!this.mutationStillCurrent(currentRequestedId, authority.projectId)) {
      return { applied: false, record };
    }
    return {
      applied: this.transition({
        type: "saved",
        requestedId: authority.projectId,
        loadedId: authority.projectId,
        project,
      }),
      record,
    };
  }

  async deleteProject(currentRequestedId: string): Promise<WorkspaceRouteDeleteOutcome> {
    const authority = this.beginMutation(currentRequestedId);
    await this.store.delete(authority.projectId);
    return {
      applied: this.mutationStillCurrent(currentRequestedId, authority.projectId),
      deletedProjectId: authority.projectId,
    };
  }

  async runMutation(
    currentRequestedId: string,
    operation: (authority: WorkspaceMutationAuthority) => Promise<HarmonyProject>,
    updatedAt: string,
  ): Promise<WorkspaceRouteSaveOutcome | { readonly applied: false; readonly superseded: true }> {
    const authority = this.beginMutation(currentRequestedId);
    const project = await operation(authority);
    if (!this.mutationStillCurrent(currentRequestedId, authority.projectId)) {
      return { applied: false, superseded: true };
    }
    return this.saveProject(currentRequestedId, project, updatedAt, authority.projectId);
  }
}

/** Delete the exact loaded record and navigate only while that route authority is still current. */
export async function deleteWorkspaceProjectAndNavigate(
  controller: WorkspaceRouteController,
  currentRequestedId: string,
  navigate: () => void,
): Promise<WorkspaceRouteDeleteOutcome> {
  const outcome = await controller.deleteProject(currentRequestedId);
  if (outcome.applied) navigate();
  return outcome;
}
