import { Suspense } from "react";
import Link from "next/link";
import { ScoreWorkspaceClient } from "./ScoreWorkspaceClient";

export const metadata={title:"악보 작업 공간 · HarmonyMaker"};
export default function ScoreWorkspacePage() {
  return <main><header><Link href="/">← 시작</Link><h1>악보 작업 공간</h1><p>원본을 보며 후보를 교정하고 저장합니다. 확인한 편곡 대상만 기존 Source·WAG로 전달합니다.</p></header><Suspense fallback={<p>로컬 초안을 여는 중…</p>}><ScoreWorkspaceClient/></Suspense></main>;
}
