import Link from "next/link";

import { referenceFixtureControlsEnabled } from "../../server/omr/reference-fixture-policy";
import { OmrClient } from "./OmrClient";

export default function OmrPage() {
  const fixtureControlsEnabled = referenceFixtureControlsEnabled(process.env);
  return (
    <main>
      <header>
        <p className="eyebrow">HARMONYMAKER v0 · STEP 10</p>
        <h1>사진·PDF 악보 인식</h1>
        <p>페이지 품질과 전송 권리를 먼저 확인하고, 인식 증거를 검토한 뒤 정본 MusicXML Quick Review로 넘깁니다.</p>
        <p><Link href="/">← Product Core</Link> · <Link href="/import">MusicXML 직접 가져오기</Link></p>
      </header>
      <OmrClient fixtureControlsEnabled={fixtureControlsEnabled} />
    </main>
  );
}
