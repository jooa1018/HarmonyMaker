"use client";
import Link from "next/link";
// Screen markup transcribed from the approved mockup. The preview controller supplies fixture state.
import { AppBar, PartPicker, CtaBar, FileDrop, LeadQuestionChoices, CopyPromptButton, LibraryList, NotesFold } from "./controls";
import { PracticePanel, ScoreNotation, MiniPlayerBar } from "./practice";
import { ShareSheet } from "./ShareSheet";
import { Icon } from "./Icon";
import { BrandMark } from "./BrandMark";
import { GUIDE_PROMPT } from "./guide-prompt";
import { partialTitle } from "./format";
import type { PreviewController } from "./preview-controller";
export function Screen01start({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={false} />
<ol className="hm-steps" aria-label="진행 단계"><li className="is-now">1 악보 올리기</li><li>2 파트 고르기</li><li>3 화음 듣기</li></ol>
<h1 className="hm-title">내 악보로 화음 만들기</h1>
<p className="hm-lede">MusicXML 악보를 올리고 화음 파트를 고르면 바로 만들어 드려요.</p>
<FileDrop state="ready" onFile={ui.chooseFile} />
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
export function Screen02parts({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={false} />
<ol className="hm-steps" aria-label="진행 단계"><li className="is-done">1 악보 올리기</li><li className="is-now">2 파트 고르기</li><li>3 화음 듣기</li></ol>
<section className="hm-song" aria-label="올린 악보">
<div className="hm-song-top">
<div>
<div className="hm-song-label">올린 악보</div>
<h1 className="hm-song-title">시냇가에 심은 나무</h1>
<div className="hm-song-file">sinaetga.musicxml</div>
</div>
<button className="hm-song-change" type="button" onClick={ui.reset}>다른 파일</button>
</div>
<div className="hm-chips"><span className="hm-chip">G장조</span><span className="hm-chip">4/4</span><span className="hm-chip">24마디</span><span className="hm-chip">가사 1절</span></div>
</section>
<h2 className="hm-section-title" id="parts-s2">화음 파트를 고르세요</h2>
<PartPicker value={ui.part} onChange={ui.setPart} recommended={ui.screen === "02-parts" ? "alto" : undefined} />
<p className="hm-small">{"\"추천\"은 이 곡의 멜로디 높이를 보고 골랐어요."}</p>
<NotesFold notes={ui.notes} />
<CtaBar choice={ui.part} checked={ui.rights} onCheck={ui.setRights} onGenerate={ui.generate} compact={ui.screen === "03-lead"} />
</div>
</div>
); }
export function Screen03lead({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={false} />
<ol className="hm-steps" aria-label="진행 단계"><li className="is-done">1 악보 올리기</li><li className="is-now">2 파트 고르기</li><li>3 화음 듣기</li></ol>
<section className="hm-song" aria-label="올린 악보">
<div className="hm-song-top">
<div><div className="hm-song-label">올린 악보</div><h1 className="hm-song-title">주의 길을 걸어요</h1></div>
<button className="hm-song-change" type="button" onClick={ui.reset}>다른 파일</button>
</div>
</section>
<div className="hm-notice is-ask">
<div className="hm-notice-head">
<Icon name="ask" />
<div>
<h2 className="hm-notice-title">멜로디가 어느 성부인지 골라 주세요</h2>
<p className="hm-notice-text">악보에 성부가 두 개 있어요. 화음은 멜로디를 기준으로 만들어요.</p>
</div>
</div>
<LeadQuestionChoices />
</div>
<h2 className="hm-section-title" id="parts-s3">화음 파트를 고르세요</h2>
<PartPicker value={ui.part} onChange={ui.setPart} recommended={ui.screen === "02-parts" ? "alto" : undefined} />
<CtaBar choice={ui.part} checked={ui.rights} onCheck={ui.setRights} onGenerate={ui.generate} compact={ui.screen === "03-lead"} />
</div>
</div>
); }
export function Screen04fix({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={false} />
<ol className="hm-steps" aria-label="진행 단계"><li className="is-done">1 악보 올리기</li><li className="is-now">2 파트 고르기</li><li>3 화음 듣기</li></ol>
<h1 className="hm-title">만들기 전에 고칠 곳이 있어요</h1>
<div className="hm-notice is-warn">
<div className="hm-notice-head">
<Icon name="alert" />
<div>
<h2 className="hm-notice-title"><span className="hm-num">12</span>번째 마디의 박자가 맞지 않아요</h2>
<p className="hm-notice-text">음표 길이를 더하면 4/4박보다 짧아요. 쉼표나 음표가 빠졌는지 원본과 비교해 주세요.</p>
</div>
</div>
<ol className="hm-howto">
<li>MuseScore에서 그 마디를 원본과 비교해 고쳐요.</li>
<li>파일 → 내보내기 → MusicXML로 다시 저장해요.</li>
<li>여기에 다시 올려요.</li>
</ol>
</div>
<button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.reset}>다른 파일 올리기</button>
<button className="hm-btn hm-btn-text" type="button" onClick={ui.openWorkspace}>고급 편집에서 직접 고치기</button>
</div>
</div>
); }
export function Screen05unsupported({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={false} />
<ol className="hm-steps" aria-label="진행 단계"><li className="is-done">1 악보 올리기</li><li className="is-now">2 파트 고르기</li><li>3 화음 듣기</li></ol>
<h1 className="hm-title">이 악보는 아직 화음을 만들 수 없어요</h1>
<div className="hm-notice is-stop">
<div className="hm-notice-head">
<Icon name="stop" />
<div>
<h2 className="hm-notice-title"><span className="hm-num">17</span>번째 마디부터 조가 바뀌어요</h2>
<p className="hm-notice-text">G장조에서 A장조로 바뀌어요. 조가 바뀌기 전까지만 잘라서 올려 주세요.</p>
</div>
</div>
</div>
<div className="hm-supported">
<b>지금 만들 수 있는 악보</b>
<ul>
<li>박자 2/4 · 3/4 · 4/4 · 6/8 · 12/8</li>
<li>곡 중간에 조가 바뀌지 않는 악보</li>
<li>코드 기호(C, G7 같은)가 적힌 악보</li>
</ul>
</div>
<button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.reset}>다른 파일 올리기</button>
</div>
</div>
); }
export function Screen06making() { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={false} />
<ol className="hm-steps" aria-label="진행 단계"><li className="is-done">1 악보 올리기</li><li className="is-done">2 파트 고르기</li><li className="is-now">3 화음 듣기</li></ol>
<div className="hm-making" role="status" aria-live="polite">
<svg className="hm-making-staff" viewBox="0 0 280 56" aria-hidden="true">
<g className="st"><path d="M0 8h280M0 18h280M0 28h280M0 38h280M0 48h280"></path></g>
<ellipse className="nh" cx="34" cy="38" rx="6" ry="4.4" transform="rotate(-18 34 38)"></ellipse>
<ellipse className="nh" cx="86" cy="28" rx="6" ry="4.4" transform="rotate(-18 86 28)"></ellipse>
<ellipse className="nh" cx="138" cy="33" rx="6" ry="4.4" transform="rotate(-18 138 33)"></ellipse>
<ellipse className="nh" cx="190" cy="23" rx="6" ry="4.4" transform="rotate(-18 190 23)"></ellipse>
<ellipse className="nh" cx="242" cy="28" rx="6" ry="4.4" transform="rotate(-18 242 28)"></ellipse>
<g className="playhead"><path className="head" d="M16 2v52"></path></g>
</svg>
<h2>화음 만드는 중</h2>
<p>시냇가에 심은 나무 · 24마디 · 알토와 테너</p>
<p>잠시만 기다려 주세요. 이 화면을 닫지 마세요.</p>
</div>
</div>
</div>
); }
export function Screen07result({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page is-wide">
<AppBar shared={false} library={false} />
<div className="hm-result">
<section className="hm-result-head">
<h1 className="hm-result-title">시냇가에 심은 나무</h1>
<p className="hm-result-meta">G장조 · 4/4 · 24마디</p>
<div className="hm-chips"><span className="hm-chip"><span className="hm-dot is-melody"></span>멜로디</span><span className="hm-chip"><span className="hm-dot is-alto"></span>알토</span><span className="hm-chip"><span className="hm-dot is-tenor"></span>테너</span></div>
</section>
<div className="hm-result-side">
<div className="hm-actions">
<button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.openShare}><Icon name="share" />팀원과 공유</button>
<div className="hm-btn-row">
<button className="hm-btn hm-btn-secondary" type="button" onClick={ui.download}><Icon name="download" />MusicXML 받기</button>
<button className="hm-btn hm-btn-secondary" type="button" aria-label="다른 파트로 다시 만들기" onClick={ui.otherPart}><Icon name="refresh" />다른 파트로</button>
</div>
</div>
<PracticePanel player={ui.player} />
</div>
<section className="hm-score" aria-label="악보">
<div className="hm-score-head"><b>악보</b><span className="hm-small">한 줄에 2마디</span></div>
<ScoreNotation source="full" />
<p className="hm-score-legend">테너 보표의 &apos;8&apos;은 적힌 음보다 한 옥타브 낮게 부른다는 뜻이에요.</p>
</section>
<details className="hm-fold">
<summary>고급 편집</summary>
<ul><li><Link href="/workspace">음 하나씩 고치기, 후보 비교<small>프로젝트 워크스페이스에서 열려요</small></Link></li></ul>
</details>
</div>
</div>
</div>
); }
export function Screen08partial({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page is-wide">
<AppBar shared={false} library={false} />
<div className="hm-result">
<section className="hm-result-head">
<h1 className="hm-result-title">시냇가에 심은 나무</h1>
<p className="hm-result-meta">G장조 · 4/4 · 24마디</p>
</section>
<div className="hm-banner" role="status">
<Icon name="alert" />
<div>
<p className="hm-banner-title">{partialTitle("테너", [3])}</p>
<p className="hm-banner-text">이 마디는 테너 음역 안에서 규칙에 맞는 화음을 찾지 못했어요.</p>
<div className="hm-chips"><span className="hm-chip is-done">알토 완료</span><span className="hm-chip is-partial">테너 일부</span></div>
</div>
</div>
<div className="hm-result-side">
<div className="hm-actions">
<button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.openShare}><Icon name="share" />팀원과 공유</button>
<div className="hm-btn-row">
<button className="hm-btn hm-btn-secondary" type="button" onClick={ui.download}><Icon name="download" />MusicXML 받기</button>
<button className="hm-btn hm-btn-secondary" type="button" aria-label="다른 파트로 다시 만들기" onClick={ui.otherPart}><Icon name="refresh" />다른 파트로</button>
</div>
</div>
</div>
<section className="hm-score" aria-label="악보">
<div className="hm-score-head"><b>악보</b><span className="hm-small">한 줄에 2마디</span></div>
<ScoreNotation source="partial" />
</section>
</div>
</div>
</div>
); }
export function Screen09share({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page" aria-hidden="true" inert><header className="hm-appbar"><span className="hm-brand"><BrandMark />HarmonyMaker</span></header><section className="hm-result-head"><h1 className="hm-result-title">시냇가에 심은 나무</h1><p className="hm-result-meta">G장조 · 4/4 · 24마디</p></section><div style={{ height: "96px" }} /></div>
<ShareSheet initialCreated onClose={ui.closeShare} />
</div>
); }
export function Screen10library() { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={true} />
<h1 className="hm-title">내 악보</h1>
<p className="hm-lede">이 기기에 저장한 화음이에요. 다른 기기에서는 보이지 않아요.</p>
<LibraryList />
</div>
</div>
); }
export function Screen11guide() { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={false} library={false} />
<h1 className="hm-title">사진 악보를 MusicXML로</h1>
<p className="hm-lede">사진이나 PDF 악보는 ChatGPT로 MusicXML을 만든 뒤, MuseScore에서 한 번 확인하고 올려 주세요.</p>
<ol className="hm-guide">
<li className="hm-gstep">
<span className="hm-gnum">1</span>
<div>
<h2>ChatGPT에서 프로젝트 만들기</h2>
<p>프로젝트 지침에 아래 내용을 붙여 넣어요. 한 번만 하면 돼요.</p>
<div className="hm-prompt">
<div className="hm-prompt-top"><span>프로젝트 지침</span><CopyPromptButton /></div>
<pre id="prompt-text" tabIndex={0}>{GUIDE_PROMPT}</pre>
</div>
</div>
</li>
<li className="hm-gstep"><span className="hm-gnum">2</span><div><h2>악보 사진 올리기</h2><p>{"프로젝트 안에서 새 대화를 열고 사진을 올린 뒤 \"변환해 줘\"라고 보내요."}</p></div></li>
<li className="hm-gstep"><span className="hm-gnum">3</span><div><h2>MuseScore로 원본과 비교하기</h2><p>{"무료 MuseScore Studio로 받은 파일을 열고 원본과 마디마다 비교해 고쳐요. ChatGPT가 \"불확실\"이라고 적은 마디부터 보세요. "}<a href="https://musescore.org" target="_blank" rel="noopener">musescore.org</a></p></div></li>
<li className="hm-gstep"><span className="hm-gnum">4</span><div><h2>다시 내보내서 올리기</h2><p>파일 → 내보내기 → MusicXML로 저장한 뒤 HarmonyMaker 첫 화면에 올려요.</p></div></li>
</ol>
</div>
</div>
); }
export function Screen12shared({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page">
<AppBar shared={true} library={false} />
<section className="hm-result-head">
<h1 className="hm-result-title">시냇가에 심은 나무</h1>
<p className="hm-lede">{"팀원이 공유한 연습 악보예요. 내 파트를 \"솔로\"로 들으며 연습해 보세요."}</p>
<div className="hm-chips"><span className="hm-chip"><span className="hm-dot is-melody"></span>멜로디</span><span className="hm-chip"><span className="hm-dot is-alto"></span>알토</span><span className="hm-chip"><span className="hm-dot is-tenor"></span>테너</span></div>
</section>
<PracticePanel player={ui.player} />
<section className="hm-score" aria-label="악보">
<div className="hm-score-head"><b>악보</b></div>
<ScoreNotation source="full" />
<p className="hm-score-legend">테너 보표의 &apos;8&apos;은 적힌 음보다 한 옥타브 낮게 부른다는 뜻이에요.</p>
</section>
<Link className="hm-linkcard" href="/">
<span className="hm-linkcard-icon"><Icon name="music" /></span>
<span className="hm-linkcard-text"><b>내 악보로도 화음을 만들어 보세요</b><span>MusicXML만 있으면 바로 만들어요</span></span>
<Icon name="right" />
</Link>
<div className="hm-footer"><span>HarmonyMaker로 만든 연습 악보</span><button className="hm-btn hm-btn-text hm-btn-sm" type="button" onClick={ui.report}><Icon name="flag" />문제 신고</button></div>
</div>
</div>
); }
export function ScreenAreading({ ui }: { ui: PreviewController }) { return (
<div className="hm"><div className="hm-page">
<FileDrop state="reading" onFile={ui.chooseFile} />
</div></div>
); }
export function ScreenBdragover({ ui }: { ui: PreviewController }) { return (
<div className="hm"><div className="hm-page">
<FileDrop state="dragover" onFile={ui.chooseFile} />
</div></div>
); }
export function ScreenCunreadable({ ui }: { ui: PreviewController }) { return (
<div className="hm"><div className="hm-page">
<div className="hm-notice is-stop">
<div className="hm-notice-head"><Icon name="stop" /><div><h2 className="hm-notice-title">이 파일에서 악보를 읽을 수 없어요</h2><p className="hm-notice-text">MuseScore에서 파일 → 내보내기 → MusicXML로 다시 저장해 올려 주세요.</p></div></div>
</div>
<button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.reset}>다른 파일 올리기</button>
</div></div>
); }
export function ScreenDsharebefore({ ui }: { ui: PreviewController }) { return (
<div className="hm"><div className="hm-page">
<ShareSheet standalone onClose={ui.closeShare} />
</div></div>
); }
export function ScreenElibraryempty() { return (
<div className="hm"><div className="hm-page">
<div className="hm-empty">
<span className="hm-empty-icon"><Icon name="music" /></span>
<b>아직 만든 화음이 없어요</b>
<p className="hm-small">악보를 올리면 만든 화음이 여기에 쌓여요.</p>
<Link className="hm-btn hm-btn-primary" href="/">악보 올리기</Link>
</div>
</div></div>
); }
export function ScreenFminibar({ ui }: { ui: PreviewController }) { return (
<div className="hm" style={{"padding": "0", "gap": "0"}}>
<div style={{"height": "72px", "background": "var(--hm-surface)", "borderBottom": "1px solid var(--hm-line)", "display": "grid", "placeItems": "center"}} className="hm-small">… 악보를 읽으며 스크롤하는 중 …</div>
<MiniPlayerBar player={ui.player} />
</div>
); }
export function Screendesktopresult({ ui }: { ui: PreviewController }) { return (
<div className="hm">
<div className="hm-page is-wide">
<AppBar currentLibrary />
<div className="hm-result">
<section className="hm-result-head">
<h1 className="hm-result-title" style={{"fontSize": "30px"}}>시냇가에 심은 나무</h1>
<p className="hm-result-meta">G장조 · 4/4 · 24마디</p>
<div className="hm-chips"><span className="hm-chip"><span className="hm-dot is-melody"></span>멜로디</span><span className="hm-chip"><span className="hm-dot is-alto"></span>알토</span><span className="hm-chip"><span className="hm-dot is-tenor"></span>테너</span></div>
</section>
<div className="hm-result-side">
<div className="hm-actions">
<button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.openShare}><Icon name="share" />팀원과 공유</button>
<div className="hm-btn-row">
<button className="hm-btn hm-btn-secondary" type="button" onClick={ui.download}><Icon name="download" />MusicXML 받기</button>
<button className="hm-btn hm-btn-secondary" type="button" aria-label="다른 파트로 다시 만들기" onClick={ui.otherPart}><Icon name="refresh" />다른 파트로</button>
</div>
</div>
<PracticePanel player={ui.player} />
</div>
<section className="hm-score" aria-label="악보">
<div className="hm-score-head"><b>악보</b><span className="hm-small">한 줄에 4마디</span></div>
<ScoreNotation source="full8" />
<p className="hm-score-legend">테너 보표의 &apos;8&apos;은 적힌 음보다 한 옥타브 낮게 부른다는 뜻이에요.</p>
</section>
</div>
</div>
</div>
); }
export const screens = {
"01-start": Screen01start,
"02-parts": Screen02parts,
"03-lead": Screen03lead,
"04-fix": Screen04fix,
"05-unsupported": Screen05unsupported,
"06-making": Screen06making,
"07-result": Screen07result,
"08-partial": Screen08partial,
"09-share": Screen09share,
"10-library": Screen10library,
"11-guide": Screen11guide,
"12-shared": Screen12shared,
"A-reading": ScreenAreading,
"B-dragover": ScreenBdragover,
"C-unreadable": ScreenCunreadable,
"D-share-before": ScreenDsharebefore,
"E-library-empty": ScreenElibraryempty,
"F-minibar": ScreenFminibar,
"desktop-result": Screendesktopresult
};
