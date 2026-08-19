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

/** Pure route/key authority used by reducer-level tests and non-async callers. */
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

interface WorkspaceControllerMutationAuthority {
  /** Opaque route/revision token. Existing browser callers pass this field back unchanged. */
  readonly projectId: string;
  readonly loadedProjectId: string;
  readonly loadedUpdatedAt: string;
  readonly routeGeneration: number;
  readonly revisionGeneration: number;
  readonly project: HarmonyProject;
}

interface LoadedRevisionAuthority {
  readonly projectId: string;
  readonly updatedAt: string;
  readonly routeGeneration: number;
  readonly revisionGeneration: number;
}

function controllerAuthorityId(authority: LoadedRevisionAuthority): string {
  return JSON.stringify([
    authority.projectId,
    authority.updatedAt,
    authority.routeGeneration,
    authority.revisionGeneration,
  ]);
}

function monotonicUpdatedAt(requested: string, previous: string): string {
  const requestedTime = Date.parse(requested);
  const previousTime = Date.parse(previous);
  if (Number.isFinite(requestedTime) && Number.isFinite(previousTime) && requestedTime <= previousTime) {
    return new Date(previousTime + 1).toISOString();
  }
  return requested;
}

/**
 * The executable route authority used by the browser workspace. It owns the
 * deferred LocalProjectStore completion fence as well as the pure state
 * transition, so the tested authority is the production load/save authority.
 */
export class WorkspaceRouteController {
  private stateValue: WorkspaceRouteState;
  private requestGeneration = 0;
  private revisionGeneration = 0;
  private loadedRevision?: LoadedRevisionAuthority;
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

  private currentControllerAuthority(currentRequestedId: string): WorkspaceControllerMutationAuthority {
    const project = authoritativeWorkspaceProject(this.stateValue, currentRequestedId);
    const loaded = this.loadedRevision;
    if (!project || !this.stateValue.loadedId || !loaded
      || loaded.projectId !== this.stateValue.loadedId
      || loaded.routeGeneration !== this.requestGeneration) {
      throw new RangeError("WORKSPACE_PROJECT_AUTHORITY_UNAVAILABLE");
    }
    return {
      projectId: controllerAuthorityId(loaded),
      loadedProjectId: loaded.projectId,
      loadedUpdatedAt: loaded.updatedAt,
      routeGeneration: loaded.routeGeneration,
      revisionGeneration: loaded.revisionGeneration,
      project,
    };
  }

  async request(requestedId: string): Promise<WorkspaceRouteLoadOutcome> {
    const generation = ++this.requestGeneration;
    this.loadedRevision = undefined;
    this.transition({ type: "request", requestedId });
    if (!requestedId) return { status: "idle", requestedId: "", applied: true };
    try {
      const record = await this.store.load(requestedId);
      if (!record) {
        const applied = generation === this.requestGeneration
          && this.transition({ type: "missing", requestedId });
        if (applied) this.loadedRevision = undefined;
        return { status: "missing", requestedId, applied };
      }
      const applied = generation === this.requestGeneration && this.transition({
        type: "loaded",
        requestedId,
        loadedId: record.projectId,
        project: record.project,
      });
      if (applied && record.projectId === requestedId) {
        this.loadedRevision = {
          projectId: record.projectId,
          updatedAt: record.updatedAt,
          routeGeneration: generation,
          revisionGeneration: ++this.revisionGeneration,
        };
      } else if (applied) this.loadedRevision = undefined;
      return record.projectId === requestedId
        ? { status: "loaded", requestedId, applied, record }
        : { status: "corrupt", requestedId, applied };
    } catch {
      const applied = generation === this.requestGeneration
        && this.transition({ type: "corrupt", requestedId });
      if (applied) this.loadedRevision = undefined;
      return { status: "corrupt", requestedId, applied };
    }
  }

  beginMutation(currentRequestedId: string, expectedAuthorityId?: string): WorkspaceControllerMutationAuthority {
    const authority = this.currentControllerAuthority(currentRequestedId);
    if (expectedAuthorityId !== undefined
      && expectedAuthorityId !== authority.projectId
      && expectedAuthorityId !== authority.loadedProjectId) {
      throw new RangeError("WORKSPACE_PROJECT_AUTHORITY_SUPERSEDED");
    }
    return authority;
  }

  mutationStillCurrent(currentRequestedId: string, authorityId: string): boolean {
    try {
      const current = this.currentControllerAuthority(currentRequestedId);
      return authorityId === current.projectId || authorityId === current.loadedProjectId;
    } catch {
      return false;
    }
  }

  async saveProject(
    currentRequestedId: string,
    project: HarmonyProject,
    updatedAt: string,
    expectedAuthorityId?: string,
  ): Promise<WorkspaceRouteSaveOutcome> {
    const authority = this.beginMutation(currentRequestedId, expectedAuthorityId);
    const nextUpdatedAt = monotonicUpdatedAt(updatedAt, authority.loadedUpdatedAt);
    const record = {
      projectId: authority.loadedProjectId,
      project,
      updatedAt: nextUpdatedAt,
    };
    const persisted = await this.store.saveIfCurrent(
      record,
      authority.loadedUpdatedAt,
      () => this.mutationStillCurrent(currentRequestedId, authority.projectId),
    );
    if (!persisted || !this.mutationStillCurrent(currentRequestedId, authority.projectId)) {
      return { applied: false, record };
    }
    const applied = this.transition({
      type: "saved",
      requestedId: authority.loadedProjectId,
      loadedId: authority.loadedProjectId,
      project,
    });
    if (applied) {
      this.loadedRevision = {
        projectId: authority.loadedProjectId,
        updatedAt: nextUpdatedAt,
        routeGeneration: authority.routeGeneration,
        revisionGeneration: ++this.revisionGeneration,
      };
    }
    return { applied, record };
  }

  async deleteProject(currentRequestedId: string): Promise<WorkspaceRouteDeleteOutcome> {
    const authority = this.beginMutation(currentRequestedId);
    const deleted = await this.store.deleteIfCurrent(
      authority.loadedProjectId,
      authority.loadedUpdatedAt,
      () => this.mutationStillCurrent(currentRequestedId, authority.projectId),
    );
    const applied = deleted && this.mutationStillCurrent(currentRequestedId, authority.projectId);
    if (applied) {
      this.loadedRevision = undefined;
      this.revisionGeneration += 1;
    }
    return {
      applied,
      deletedProjectId: authority.loadedProjectId,
    };
  }

  async runMutation(
    currentRequestedId: string,
    operation: (authority: WorkspaceControllerMutationAuthority) => Promise<HarmonyProject>,
    updatedAt: string,
  ): Promise<WorkspaceRouteSaveOutcome | { readonly applied: false; readonly superseded: true }> {
    const authority = this.beginMutation(currentRequestedId);
    const project = await operation(authority);
    if (!this.mutationStillCurrent(currentRequestedId, authority.projectId)) {
      return { applied: false, superseded: true };
    }
    const outcome = await this.saveProject(currentRequestedId, project, updatedAt, authority.projectId);
    return outcome.applied ? outcome : { applied: false, superseded: true };
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
