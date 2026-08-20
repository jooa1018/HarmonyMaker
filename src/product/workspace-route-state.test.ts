import { describe, expect, it } from "vitest";
import type { HarmonyProject } from "../domain/project";
import {
  authoritativeWorkspaceProject,
  authoritativeWorkspaceSaveRecord,
  initialWorkspaceRouteState,
  reduceWorkspaceRoute,
  requireWorkspaceMutationAuthority,
  workspaceMutationStillCurrent,
} from "./workspace-route-state";

const project = (title: string) => ({ source: { title } }) as HarmonyProject;

describe("route-keyed workspace project authority", () => {
  it("clears A synchronously for A→B loading and never retains it for missing/corrupt B", () => {
    const loadedA = reduceWorkspaceRoute(initialWorkspaceRouteState("A"), { type: "loaded", requestedId: "A", loadedId: "A", project: project("A") });
    expect(authoritativeWorkspaceProject(loadedA, "B")).toBeUndefined();
    expect(() => requireWorkspaceMutationAuthority(loadedA, "B")).toThrow("WORKSPACE_PROJECT_AUTHORITY_UNAVAILABLE");
    const loadingB = reduceWorkspaceRoute(loadedA, { type: "request", requestedId: "B" });
    expect(authoritativeWorkspaceProject(loadingB, "B")).toBeUndefined();
    expect(reduceWorkspaceRoute(loadingB, { type: "missing", requestedId: "B" })).toEqual({ requestedId: "B", loadStatus: "missing" });
    expect(reduceWorkspaceRoute(loadingB, { type: "corrupt", requestedId: "B" })).toEqual({ requestedId: "B", loadStatus: "corrupt" });
  });

  it("ignores stale A completion after B and supports exact B→A back navigation", () => {
    const loadingB = reduceWorkspaceRoute(initialWorkspaceRouteState("A"), { type: "request", requestedId: "B" });
    const staleA = reduceWorkspaceRoute(loadingB, { type: "loaded", requestedId: "A", loadedId: "A", project: project("A") });
    expect(staleA).toBe(loadingB);
    const loadedB = reduceWorkspaceRoute(staleA, { type: "loaded", requestedId: "B", loadedId: "B", project: project("B") });
    const loadingA = reduceWorkspaceRoute(loadedB, { type: "request", requestedId: "A" });
    const loadedA = reduceWorkspaceRoute(loadingA, { type: "loaded", requestedId: "A", loadedId: "A", project: project("A2") });
    expect(authoritativeWorkspaceProject(loadedA, "A")?.source.title).toBe("A2");
  });

  it("rejects mismatched record keys and every mutation while route authority is unavailable", () => {
    const mismatched = reduceWorkspaceRoute(initialWorkspaceRouteState("B"), { type: "loaded", requestedId: "B", loadedId: "A", project: project("A") });
    expect(mismatched.loadStatus).toBe("corrupt");
    for (const operation of ["save", "generation", "edit", "share", "select"]) {
      expect(() => requireWorkspaceMutationAuthority(initialWorkspaceRouteState("B"), "B"), operation).toThrow("WORKSPACE_PROJECT_AUTHORITY_UNAVAILABLE");
    }
  });

  it("fences save/generation/edit/share completion after the route changes", () => {
    const loadedA = reduceWorkspaceRoute(initialWorkspaceRouteState("A"), { type: "loaded", requestedId: "A", loadedId: "A", project: project("A") });
    const authority = requireWorkspaceMutationAuthority(loadedA, "A");
    expect(authority.projectId).toBe("A");
    const loadingB = reduceWorkspaceRoute(loadedA, { type: "request", requestedId: "B" });
    for (const operation of ["save", "generation", "edit", "share"]) {
      expect(workspaceMutationStillCurrent(loadingB, "B", authority.projectId), operation).toBe(false);
    }
    const loadedB = reduceWorkspaceRoute(loadingB, { type: "loaded", requestedId: "B", loadedId: "B", project: project("B") });
    for (const operation of ["save", "generation", "edit", "share"]) {
      expect(() => requireWorkspaceMutationAuthority(loadedB, "B", authority.projectId), operation)
        .toThrow("WORKSPACE_PROJECT_AUTHORITY_SUPERSEDED");
    }
  });

  it("persists the exact loaded key/value and never retargets an A save to B", () => {
    const loadedA = reduceWorkspaceRoute(initialWorkspaceRouteState("A"), { type: "loaded", requestedId: "A", loadedId: "A", project: project("A") });
    const nextA = project("A saved");
    const record = authoritativeWorkspaceSaveRecord(loadedA, "A", nextA, "2026-08-19T00:00:00.000Z");
    expect(record).toEqual({ projectId: "A", project: nextA, updatedAt: "2026-08-19T00:00:00.000Z" });
    expect(() => authoritativeWorkspaceSaveRecord(loadedA, "B", project("B forged"), "2026-08-19T00:00:01.000Z"))
      .toThrow("WORKSPACE_PROJECT_AUTHORITY_UNAVAILABLE");
  });
});
