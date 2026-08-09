import { ScorePlayer } from "@/demo/ScorePlayer";
import Link from "next/link";

export default function Home() {
  return <main><header><p className="eyebrow">STEP 1 · 소리 먼저</p><h1>HarmonyMaker</h1><p>저작권 없는 6마디 S/A/T 테스트 악구</p><p><Link href="/import">MusicXML 가져오기와 Quick Review →</Link></p></header><ScorePlayer /></main>;
}
