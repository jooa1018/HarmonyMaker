import { Icon } from "./Icon";

export function ActionTiles({ onAudio, onDownload, onOther, disabledAudio = false, preparing = false }: {
  onAudio: () => void; onDownload: () => void; onOther: () => void; disabledAudio?: boolean; preparing?: boolean;
}) {
  return <div className="hm-tiles3">
    <button className="hm-tile" type="button" aria-label="연습 음원 받기" disabled={disabledAudio} onClick={onAudio}><Icon name="headphones" /><span>연습 음원</span></button>
    <button className="hm-tile" type="button" aria-label="MusicXML 받기" onClick={onDownload}><Icon name="download" /><span>MusicXML</span></button>
    <button className="hm-tile" type="button" aria-label="다른 파트로 다시 만들기" disabled={preparing} onClick={onOther}><Icon name="refresh" /><span>{preparing ? "악보 읽는 중…" : "다른 파트로"}</span></button>
  </div>;
}
