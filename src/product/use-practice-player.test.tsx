// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePracticePlayer, type PracticePlayerController } from "./use-practice-player";
import { ProductPracticePlayer } from "./ProductPracticePlayer";
import type { PlaybackPlan } from "./playback-plan";
import { schedulePracticeAudio, updatePracticeAudioMix, releasePracticeAudio } from "./practice-audio";

const {renderAbc}=vi.hoisted(()=>({renderAbc:vi.fn()}));
vi.mock("abcjs",()=>({default:{renderAbc}}));
vi.mock("./practice-audio",async importOriginal=>({
  ...await importOriginal<typeof import("./practice-audio")>(),
  schedulePracticeAudio:vi.fn(()=>({nodes:[]})), updatePracticeAudioMix:vi.fn(), releasePracticeAudio:vi.fn(),
}));
class Audio {
  static instances: Audio[]=[];
  currentTime=0;
  suspend=vi.fn(async():Promise<void>=>undefined);
  resume=vi.fn(async():Promise<void>=>undefined);
  close=vi.fn(async()=>undefined);
  constructor(readonly options?: AudioContextOptions){Audio.instances.push(this);}
}
const plan:PlaybackPlan={events:[],trackIds:["track:source-lead","track:a","track:b"],totalQuarter:4,
  effectiveChordTimelineDigest:"test",trackLabels:{"track:source-lead":"멜로디","track:a":"테너","track:b":"알토"},
  trackRoles:{"track:a":"upper","track:b":"lower"}};
const input={abc:"X:1\nK:C\nC|",plan,tempo:{bpm:120,beatUnit:4,dotted:false} as const,identity:"one"};
let root:Root,container:HTMLDivElement,player:PracticePlayerController;
let resize:()=>void;
function Harness(props: Parameters<typeof usePracticePlayer>[0]){
  const controller=usePracticePlayer(props);
  const {scoreRef}=controller;
  useLayoutEffect(()=>{player=controller;});
  return <div ref={scoreRef}/>;
}
async function mount(props=input){await act(async()=>{root.render(<Harness {...props}/>);});}
async function advance(quarters:number){
  const audio=Audio.instances.at(-1)!;
  const options=vi.mocked(schedulePracticeAudio).mock.calls.at(-1)![2];
  audio.currentTime=options.startedAt+quarters*options.secondsPerQuarter;
  await act(async()=>{vi.advanceTimersByTime(40);});
}
beforeEach(()=>{
  vi.useFakeTimers();vi.clearAllMocks();Audio.instances=[];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("AudioContext",Audio);
  vi.stubGlobal("ResizeObserver",class {constructor(callback:()=>void){resize=callback;}observe(){}disconnect(){}});
  vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockReturnValue(600);
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

it("plays, pauses, resumes from the exact paused position and finishes",async()=>{
  await mount();expect(player.scoreReady).toBe(true);
  await act(async()=>player.play());expect(player.phase).toBe("playing");
  await advance(1);expect(player.positionQuarter).toBeCloseTo(1);
  await act(async()=>player.pause());expect(player.phase).toBe("paused");
  expect(releasePracticeAudio).toHaveBeenCalledTimes(1);
  await act(async()=>player.play());expect(vi.mocked(schedulePracticeAudio).mock.calls.at(-1)![2].fromQuarter).toBeCloseTo(1);
  await advance(4);expect(player.phase).toBe("finished");expect(player.positionQuarter).toBe(0);
  await act(async()=>player.play());expect(vi.mocked(schedulePracticeAudio).mock.calls.at(-1)![2].fromQuarter).toBe(0);
});

it("resets on speed change and supports restart then play in one event",async()=>{
  await mount();await act(async()=>player.play());await advance(1);
  await act(async()=>player.setSpeed(50));
  expect(player.phase).toBe("ready");expect(player.positionQuarter).toBe(0);expect(player.secondsPerQuarter).toBe(1);
  await act(async()=>player.play());await advance(2);await act(async()=>player.pause());
  await act(async()=>{player.restart();player.play();});
  expect(vi.mocked(schedulePracticeAudio).mock.calls.at(-1)![2].fromQuarter).toBe(0);
});

it("keeps one solo, independent mutes, live levels and no fabricated band track",async()=>{
  await mount();expect(player.tracks.map(t=>t.role)).toEqual(["lead","upper","lower"]);
  expect(player.tracks.some(t=>t.kind==="band")).toBe(false);
  await act(async()=>player.play());
  await act(async()=>{player.toggleSolo("track:a");player.toggleSolo("track:b");player.toggleMute("track:a");player.setBandEnabled(false);player.setLevel("track:b",9);player.setMasterLevel(9);});
  expect(player.solo).toBe("track:b");expect(player.muted.has("track:a")).toBe(true);
  expect(player.levels["track:b"]).toBe(2);expect(player.masterLevel).toBe(1);
  expect(vi.mocked(updatePracticeAudioMix).mock.calls.at(-1)![1].audible).toEqual(new Set(["track:b"]));
  await act(async()=>player.toggleSolo("track:b"));expect(player.solo).toBeUndefined();
  expect(Audio.instances).toHaveLength(1);
});

it("does not infer roles from labels and treats source/band IDs as fixed",async()=>{
  await mount({...input,plan:{...plan,trackIds:[...plan.trackIds,"track:band"],trackRoles:undefined}});
  expect(player.tracks.map(t=>t.role)).toEqual(["lead","other","other","band"]);
});

it("redraws with the supplied line length and releases audio on identity change",async()=>{
  await mount();expect(renderAbc.mock.calls.at(-1)![2].wrap.preferredMeasuresPerLine).toBe(4);
  await act(async()=>player.play());
  await act(async()=>root.render(<Harness {...input} identity="two" preferredMeasuresPerLine={2} initialSettings={{speedPercent:75,selectedTrackIndex:2,accompanimentEnabled:false}}/>));
  expect(releasePracticeAudio).toHaveBeenCalledTimes(1);
  expect(player.phase).toBe("ready");expect(player.speed).toBe(75);expect(player.solo).toBe("track:b");
  expect(renderAbc.mock.calls.at(-1)![2].wrap.preferredMeasuresPerLine).toBe(2);
  vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockReturnValue(400);
  await act(async()=>resize());expect(renderAbc.mock.calls.at(-1)![2].staffwidth).toBe(376);
});

it("cancels a pending audio start when restarted",async()=>{
  let resume!:()=>void;
  await mount();
  // Override only the next context's suspend promise via the constructor entry point.
  vi.stubGlobal("AudioContext",class extends Audio {suspend=vi.fn(()=>new Promise<void>(resolve=>{resume=resolve;}));});
  await act(async()=>player.play());expect(player.phase).toBe("starting");
  await act(async()=>{player.restart();resume();});
  expect(player.phase).toBe("ready");expect(schedulePracticeAudio).not.toHaveBeenCalled();
});

it("retains separate legacy Play-from-start and Resume buttons",async()=>{
  await act(async()=>root.render(<ProductPracticePlayer {...input}/>));
  const button=(name:string)=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent===name)!;
  await act(async()=>button("Play").click());
  const audio=Audio.instances.at(-1)!;audio.currentTime=1.05;
  await act(async()=>button("Pause").click());
  await act(async()=>button("Resume").click());expect(vi.mocked(schedulePracticeAudio).mock.calls.at(-1)![2].fromQuarter).toBeGreaterThan(0);
  await act(async()=>button("Pause").click());
  await act(async()=>button("Play").click());expect(vi.mocked(schedulePracticeAudio).mock.calls.at(-1)![2].fromQuarter).toBe(0);
});


it("requests the optional playback session only on Play/Resume and preserves startup order",async()=>{
  const writes:string[]=[];
  vi.stubGlobal("navigator",{audioSession:{set type(value:string){writes.push(value);}}});
  await mount();expect(writes).toEqual([]);expect(Audio.instances).toHaveLength(0);
  await act(async()=>{player.toggleMute("track:a");player.setSpeed(75);});
  expect(writes).toEqual([]);
  await act(async()=>player.play());expect(writes).toEqual(["playback"]);
  const audio=Audio.instances[0];
  expect(audio.options).toEqual({latencyHint:"playback"});
  expect(vi.mocked(schedulePracticeAudio).mock.calls.at(-1)![2].lookahead).toBe(true);
  expect(audio.suspend.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(schedulePracticeAudio).mock.invocationCallOrder[0]);
  expect(vi.mocked(schedulePracticeAudio).mock.invocationCallOrder[0]).toBeLessThan(audio.resume.mock.invocationCallOrder[0]);
  await act(async()=>player.play());expect(writes).toHaveLength(1);
  await act(async()=>player.pause());await act(async()=>player.play());expect(writes).toEqual(["playback","playback"]);
});

it.each([{}, {audioSession:{set type(_value:string){throw new Error("unsupported");}}}])("plays without usable Audio Session support",async navigator=>{
  vi.stubGlobal("navigator",navigator);
  await mount();await act(async()=>player.play());
  expect(player.phase).toBe("playing");expect(player.error).toBeUndefined();
});

it("returns to ready with the requested message when resume rejects and allows retry",async()=>{
  vi.stubGlobal("AudioContext",class extends Audio {resume=vi.fn(async()=>{throw new Error("NotAllowedError");});});
  await mount();await act(async()=>player.play());
  expect(player.phase).toBe("ready");
  expect(player.error).toBe("소리를 켜지 못했어요. 재생 버튼을 다시 눌러 주세요.");
  expect(releasePracticeAudio).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal("AudioContext",Audio);
  await act(async()=>player.play());expect(player.phase).toBe("playing");expect(player.error).toBeUndefined();
});

it("times out resume at three seconds and a late resolution cannot restart disposed audio",async()=>{
  let resolve!:()=>void;
  vi.stubGlobal("AudioContext",class extends Audio {resume=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));});
  await mount();await act(async()=>player.play());
  await act(async()=>{await vi.advanceTimersByTimeAsync(2999);});expect(player.phase).toBe("starting");
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
  expect(player.phase).toBe("ready");expect(player.error).toBe("소리를 켜지 못했어요. 재생 버튼을 다시 눌러 주세요.");
  expect(releasePracticeAudio).toHaveBeenCalledTimes(1);
  await act(async()=>resolve());expect(player.phase).toBe("ready");expect(vi.getTimerCount()).toBe(0);
});

it("does not let a replaced resume timeout overwrite the new session",async()=>{
  vi.stubGlobal("AudioContext",class extends Audio {resume=vi.fn(()=>new Promise<void>(()=>{}));});
  await mount();await act(async()=>player.play());
  await act(async()=>player.restart());
  vi.stubGlobal("AudioContext",Audio);
  await act(async()=>player.play());
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
  expect(player.phase).toBe("playing");expect(player.error).toBeUndefined();
  expect(releasePracticeAudio).toHaveBeenCalledTimes(1);
});
