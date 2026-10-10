"use client";
import { useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { usePreviewPlayer } from "./practice";
import type { PartChoice } from "./format";

export function usePreviewController(screen: string, navigate: (screen: string) => void) {
  const [part, setPart] = useState<PartChoice>(screen === "03-lead" ? "both" : "alto");
  const [rights, setRights] = useState(screen === "03-lead");
  const [audioOpen, setAudioOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const shareTrigger = useRef<HTMLButtonElement>(null);
  const player = usePreviewPlayer(screen);
  return {
    notes: [{ messageKo: "악보에 빠르기 표시가 없어서 연습용 빠르기 ♩=80을 썼어요." }],
    screen, part, setPart, rights, setRights, player, shareOpen, audioOpen, message,
    openAudio() { setAudioOpen(true); },
    closeAudio() { if (audioOpen) setAudioOpen(false); else navigate("07-result"); },
    chooseFile(file: File) { navigate(/\.(musicxml|mxl|xml)$/i.test(file.name) ? "02-parts" : "C-unreadable"); },
    reset() { navigate("01-start"); },
    generate() { if (rights && part) navigate("06-making"); },
    openWorkspace() { router.push("/score-workspace"); },
    otherPart() { navigate("02-parts"); },
    openShare(event: MouseEvent<HTMLButtonElement>) { shareTrigger.current = event.currentTarget; setShareOpen(true); },
    closeShare() { if (shareOpen) { setShareOpen(false); requestAnimationFrame(() => shareTrigger.current?.focus({ preventScroll: true })); } else navigate("07-result"); },
    download() { setMessage("화면 미리보기예요. MusicXML 받기는 실제 연결 뒤에 사용할 수 있어요."); },
    report() { setMessage("화면 미리보기예요. 문제 신고는 실제 연결 뒤에 사용할 수 있어요."); },
  };
}
export type PreviewController = ReturnType<typeof usePreviewController>;
