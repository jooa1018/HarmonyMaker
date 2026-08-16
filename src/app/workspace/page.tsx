import { Suspense } from "react";
import { WorkspaceClient } from "./WorkspaceClient";

export default function WorkspacePage() {
  return <main><Suspense fallback={<p className="status">프로젝트를 여는 중…</p>}><WorkspaceClient /></Suspense></main>;
}
