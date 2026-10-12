import { expect, it } from "vitest";
import { buildPlaybackPlan, defaultLeadOctave, practiceMeasureAt, practiceSeekQuarter, type PlaybackPlan } from "./playback-plan";
import { fraction } from "../domain/fraction";
import type { ArrangementRenderDocument } from "../domain/generation/model";

function navigation(numerator: number, denominator: 4 | 8, pickup?: number) {
  const duration = numerator * 4 / denominator;
  const measures = [pickup ?? duration, duration, duration].map((length, i) => ({
    sourceMeasureNumber: i === 2 ? 1 : i + 1, performanceIndex: i, sourceMeasureId: String(i), occurrenceId: String(i), occurrenceIndexForSource: i === 2 ? 1 : 0,
    time: {numerator, denominator, beatGroups: denominator === 8 ? Array(numerator/3).fill(3) : Array(numerator).fill(1)}, duration: fraction(length * 2, 2),
  }));
  const document = {measures,sourceLeadTrack:{trackPlanId:"track:source-lead",atoms:[],atomizationDigest:"test"},generatedHarmonyTracks:[],effectiveChordTimeline:{digest:"test"},lyricTokens:[]} as unknown as ArrangementRenderDocument;
  return buildPlaybackPlan(document,{generatedTracks:[],byTrackPlanId:{}});
}

it.each([[4,4,1],[3,4,1],[6,8,1.5],[12,8,1.5]] as const)("snaps %s/%s to its beats and preserves printed repeat numbers",(n,d,beat)=>{
  const plan=navigation(n,d),bar=n*4/d;
  expect(practiceSeekQuarter(plan,bar+beat+0.2)).toBe(bar+beat);
  expect(practiceMeasureAt(plan,bar*2+0.2)).toMatchObject({number:1,startQuarter:bar*2});
  expect(practiceSeekQuarter(plan,-3)).toBe(0);
  expect(practiceSeekQuarter(plan,Infinity)).toBe(bar*3-beat);
  expect(practiceSeekQuarter(plan,NaN)).toBe(0);
});

it("keeps partial beats in a pickup and uses the following measure's own origin",()=>{
  const simple=navigation(4,4,1);
  expect(practiceSeekQuarter(simple,0.9)).toBe(0);
  expect(practiceSeekQuarter(simple,1.9)).toBe(1);
  const compound=navigation(6,8,2);
  expect(compound.measures?.[0].beatStarts).toEqual([0,0.5]);
  expect(practiceSeekQuarter(compound,0.4)).toBe(0);
  expect(practiceSeekQuarter(compound,0.6)).toBe(0.5);
  expect(practiceSeekQuarter(compound,3.6)).toBe(3.5);
});

it("lowers only tenor-only practice by default, never below E2, without guessing labels",()=>{
  const base=navigation(4,4);
  const make=(roles:PlaybackPlan['trackRoles'],midi=52):PlaybackPlan=>({...base,trackIds:["track:source-lead","h1","h2"],trackLabels:{h1:"테너"},trackRoles:roles,
    events:[{eventId:"l",trackId:"track:source-lead",kind:"voice",midi,startQuarter:0,durationQuarter:1,lyricOnset:false}]});
  expect(defaultLeadOctave(make({h1:"upper"}))).toBe(-1);
  expect(defaultLeadOctave(make({h1:"upper"},51))).toBe(0);
  expect(defaultLeadOctave(make({h1:"upper",h2:"lower"}))).toBe(0);
  expect(defaultLeadOctave(make({h1:"lower"}))).toBe(0);
  expect(defaultLeadOctave(make(undefined))).toBe(0);
  expect(defaultLeadOctave({...make({h1:"upper"}),events:[]})).toBe(0);
});
