import Link from "next/link";

export default function Home() {
  return <main><header><p className="eyebrow">HARMONYMAKER</p><h1>내 악보로 만드는 보컬 화음</h1><p>원본을 확인하며 후보를 교정하고, 확정한 음악으로 화음과 연습 악보를 만듭니다.</p></header>
    <section className="panel"><h2>시작할 자료를 선택하세요</h2>
      <p><Link className="button-link primary" href="/local-image">악보 이미지로 시작 · PNG/JPG/JPEG →</Link></p>
      <p><Link className="button-link" href="/score-workspace">MusicXML/MXL 악보 열기 →</Link></p>
      <p><Link className="button-link" href="/score-workspace">저장한 작업 공간 열기 →</Link></p>
      <p><Link className="button-link" href="/workspace">프로젝트 열기 →</Link></p>
      <p>이미지는 설치된 로컬 인식 환경에서 처리합니다. 원본·후보를 대조한 뒤 Source를 확정하며, 인식 완료만으로 음악을 승인하지 않습니다.</p>
      <details><summary>기존 입력 경로</summary><p><Link href="/import">MusicXML과 Quick Review</Link> · <Link href="/omr">기존 사진·PDF OMR</Link></p></details>
      <p><small>초안과 프로젝트는 이 브라우저의 IndexedDB에 저장됩니다. 로컬 인식 작업의 원본·결과는 실행한 컴퓨터에 보존합니다.</small></p>
    </section></main>;
}
