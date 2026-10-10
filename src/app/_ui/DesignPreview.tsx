"use client";
import { useState } from "react";
import { screens } from "./screens";
import { usePreviewController } from "./preview-controller";
import { ShareSheet } from "./ShareSheet";

export type PreviewScreen = keyof typeof screens;
function Scene({ screen, navigate }: { screen: PreviewScreen; navigate: (screen: string) => void }) {
  const ui = usePreviewController(screen, navigate);
  const Screen = screens[screen];
  return <><div aria-hidden={ui.shareOpen || undefined} inert={ui.shareOpen}><Screen ui={ui} /></div>{ui.shareOpen && <div className="hm"><ShareSheet onClose={ui.closeShare} /></div>}{ui.message && <div className="hm"><div className="hm-page"><p className="hm-notice" role="status">{ui.message}</p></div></div>}</>;
}
/** Review-only fixture state. Engine, persistence, network sharing and audio are connected in subsequent PRs. */
export function DesignPreview({ initialScreen = "01-start" }: { initialScreen?: PreviewScreen }) {
  const [screen, setScreen] = useState<PreviewScreen>(initialScreen);
  function navigate(value: string) { if (value in screens) setScreen(value as PreviewScreen); }
  return <Scene key={screen} screen={screen} navigate={navigate} />;
}
