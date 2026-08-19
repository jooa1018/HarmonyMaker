import type { HarmonyProject } from "../domain/project";

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
