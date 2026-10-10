"use client";
import Link from "next/link";
import { AppBar, FileDrop } from "../_ui/controls";
import { Icon } from "../_ui/Icon";
import type { QuickPreparationController } from "./useQuickPreparation";
export function QuickStart({ ui }: { ui: Pick<QuickPreparationController, "chooseFile" | "reading" | "fileName"> }) { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={false} />
<ol className="hm-steps" aria-label="진행 단계"><li className="is-now">1 악보 올리기</li><li>2 파트 고르기</li><li>3 화음 듣기</li></ol>
<h1 className="hm-title">내 악보로 화음 만들기</h1>
<p className="hm-lede">MusicXML 악보를 올리고 화음 파트를 고르면 바로 만들어 드려요.</p>
<FileDrop state={ui.reading ? "reading" : "ready"} fileName={ui.fileName} onFile={ui.chooseFile} />
<p className="hm-privacy"><Icon name="lock" />파일은 서버로 보내지 않고 이 기기에서만 처리돼요.</p>
<Link className="hm-linkcard" href="/guide">
<span className="hm-linkcard-icon"><Icon name="camera" /></span>
<span className="hm-linkcard-text"><b>사진 악보만 있나요?</b><span>사진 악보를 MusicXML로 만드는 방법</span></span>
<Icon name="right" />
</Link>
<details className="hm-fold">
<summary>고급 도구</summary>
<ul>
<li><Link href="/score-workspace">악보 작업 공간<small>원본을 보존하며 마디마다 고치기</small></Link></li>
<li><Link href="/workspace">프로젝트 워크스페이스<small>후보 비교, 음 하나씩 수정</small></Link></li>
<li><Link href="/import">MusicXML 자세히 가져오기<small>멜로디·코드·구간·음역·권리를 직접 확인</small></Link></li>
</ul>
</details>
</div>
</div>
); }
