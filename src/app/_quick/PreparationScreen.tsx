"use client";
import { AppBar, NotesFold, PartPicker } from "../_ui/controls";
import { Icon } from "../_ui/Icon";
import { ctaLabel, titleFromFileName } from "../_ui/format";
import { harmonyChoice, questionKind, unansweredQuestions } from "./selection";
import type { QuickPreparationController } from "./useQuickPreparation";
import type { QuickHarmonyChoice } from "../../product/quick-harmony";

export function PreparationScreen({ ui, onGenerate, onEdit }: {
  ui: QuickPreparationController;
  onGenerate: (choice: QuickHarmonyChoice) => void;
  onEdit: () => void;
}) {
  const prep = ui.preparation;
  if (!prep) return null;
  const summary = prep.summary;
  const questions = unansweredQuestions(prep, ui.selection);
  const current = questions[0] ?? prep.questions.at(-1);
  const needsEdit = current && questionKind(current) === "edit";
  const unsupported = prep.status === "unsupported";
  const choice = harmonyChoice(prep, ui.selection);
  const selectable = !unsupported && !needsEdit;
  if (unsupported && !prep.workspace) return <div className="hm"><div className="hm-page">
    {prep.reasons.map(notice => <div className="hm-notice is-stop" key={notice.id}><div className="hm-notice-head"><Icon name="stop" /><div><h2 className="hm-notice-title">{notice.messageKo}</h2><p className="hm-notice-text">{notice.actionKo}</p></div></div></div>)}
    <button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.reset}>다른 파일 올리기</button>
    <details className="hm-fold"><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{JSON.stringify(prep.details, null, 2)}</pre></div></details>
  </div></div>;
  return <div className="hm"><div className="hm-page">
    <AppBar />
    <ol className="hm-steps" aria-label="진행 단계"><li className="is-done">1 악보 올리기</li><li className="is-now">2 파트 고르기</li><li>3 화음 듣기</li></ol>
    {selectable ? <section className="hm-song" aria-label="올린 악보"><div className="hm-song-top"><div>
      <div className="hm-song-label">올린 악보</div>
      <h1 className="hm-song-title">{summary?.title ?? titleFromFileName(ui.fileName)}</h1>
      {summary && <div className="hm-song-file">{ui.fileName}</div>}
    </div><button className="hm-song-change" type="button" onClick={ui.reset}>다른 파일</button></div>
      {summary && <div className="hm-chips"><span className="hm-chip">{summary.keyLabelKo}</span><span className="hm-chip">{summary.meters.join(" · ")}</span><span className="hm-chip">{summary.measureCount}마디</span><span className="hm-chip">{summary.hasLyrics ? `가사 ${summary.verseCount}절` : "가사 없음"}</span></div>}
    </section> : <h1 className="hm-title">{unsupported ? "이 악보는 아직 화음을 만들 수 없어요" : "만들기 전에 고칠 곳이 있어요"}</h1>}
    {(unsupported ? prep.reasons : current ? [current] : []).map(notice => <div className={`hm-notice ${unsupported ? "is-stop" : needsEdit ? "is-warn" : "is-ask"}`} key={notice.id}>
      <div className="hm-notice-head"><Icon name={unsupported ? "stop" : needsEdit ? "alert" : "ask"} /><div><h2 className="hm-notice-title">{notice.messageKo}</h2><p className="hm-notice-text">{notice.actionKo}</p></div></div>
      {!unsupported && !needsEdit && <div className="hm-choices" role="radiogroup" aria-label="악보 확인">{notice.choices.map(answer => <label className={`hm-choice${[ui.selection.answers.lead, ui.selection.answers.unreadPrintedChords].includes(answer.value) ? " is-selected" : ""}`} key={answer.value}>
        <input type="radio" name={`question-${notice.id}`} checked={[ui.selection.answers.lead, ui.selection.answers.unreadPrintedChords].includes(answer.value)} onChange={() => answer.value === "edit-in-workspace" ? onEdit() : questionKind(notice) === "lead" ? ui.setLead(answer.value) : ui.setCarry()} />
        <span>{answer.labelKo}</span>
      </label>)}</div>}
      {needsEdit && <ol className="hm-howto"><li>MuseScore에서 그 마디를 원본과 비교해 고쳐요.</li><li>파일 → 내보내기 → MusicXML로 다시 저장해요.</li><li>여기에 다시 올려요.</li></ol>}
    </div>)}
    {unsupported && prep.workspace && <div className="hm-supported"><b>지금 만들 수 있는 악보</b><ul><li>박자 2/4 · 3/4 · 4/4 · 6/8 · 12/8</li><li>곡 중간에 조가 바뀌지 않는 악보</li><li>코드 기호(C, G7 같은)가 적힌 악보</li></ul></div>}
    {selectable ? <>
      <h2 className="hm-section-title">화음 파트를 고르세요</h2>
      <PartPicker value={ui.selection.part} onChange={ui.setPart} recommended={summary?.recommendedPart} />
      {summary && <p className="hm-small">&quot;추천&quot;은 이 곡의 멜로디 높이를 보고 골랐어요.</p>}
      <NotesFold notes={prep.notes} />
      <div className="hm-cta"><label className={`hm-check${ui.selection.rights ? " is-checked" : ""}`}><input type="checkbox" checked={ui.selection.rights} onChange={e => ui.setRights(e.target.checked)} /><span className="hm-check-text">이 악보로 화음을 만들 권리가 있음을 확인합니다.{summary && <small>직접 만든 곡, 저작권이 끝난 곡, 사용 허락을 받은 곡이면 괜찮아요.</small>}</span></label>
        <button className="hm-btn hm-btn-primary hm-btn-block" type="button" disabled={!choice} onClick={() => { if (choice) onGenerate(choice); }}>{ctaLabel(ui.selection.part)}</button>
        {!ui.selection.rights && <p className="hm-cta-help">권리 확인에 체크하면 만들 수 있어요.</p>}
      </div>
    </> : <><button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.reset}>다른 파일 올리기</button>{needsEdit && <button className="hm-btn hm-btn-text" type="button" onClick={onEdit}>고급 편집에서 직접 고치기</button>}</>}
    <details className="hm-fold"><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{JSON.stringify(prep.details, null, 2)}</pre></div></details>
  </div></div>;
}
