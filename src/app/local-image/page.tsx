import { Suspense } from "react";
import Link from "next/link";
import { LocalImageClient } from "./LocalImageClient";
export const metadata={title:"악보 이미지로 시작 · HarmonyMaker"};
export default function LocalImagePage(){return <main><header><Link href="/">← 시작</Link><h1>악보 이미지로 시작</h1><p>PNG/JPEG 원본을 이 컴퓨터에서 인식하고, 후보를 원본과 대조해 교정합니다.</p></header><Suspense fallback={<p>로컬 작업 상태를 확인하는 중…</p>}><LocalImageClient/></Suspense></main>;}
