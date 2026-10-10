import { AppBar } from "../_ui/controls";
import { partsLabelKo } from "../_ui/format";
export function MakingState({ title, measureCount, parts }: { title: string; measureCount?: number; parts: readonly ("alto" | "tenor")[] }) { return (
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
<p>{title}{measureCount !== undefined && ` · ${measureCount}마디`} · {partsLabelKo(parts)}</p>
<p>잠시만 기다려 주세요. 이 화면을 닫지 마세요.</p>
</div>
</div>
</div>
); }
