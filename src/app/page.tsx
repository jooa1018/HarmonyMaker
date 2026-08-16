import Link from "next/link";

export default function Home() {
  return <main><header><p className="eyebrow">HARMONYMAKER v0 · PRODUCT CORE</p><h1>내 악보로 만드는 보컬 화음</h1><p>MusicXML을 검토한 뒤, 고정된 WAG v1.0.1 lifecycle로 재현 가능한 후보와 연습 악보를 만듭니다.</p></header><section className="panel"><h2>정본 workflow 시작</h2><p>Source 가져오기 → Quick Review → 가수/track/preset → generation → score/practice → export/share</p><p><Link className="button-link primary" href="/import">MusicXML 가져오기와 Quick Review →</Link></p><p><small>프로젝트는 기본적으로 이 브라우저의 IndexedDB에 저장됩니다. 계정이나 클라우드 프로젝트 동기화는 사용하지 않습니다.</small></p></section></main>;
}
