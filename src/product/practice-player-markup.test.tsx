import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProductPracticePlayer } from "./ProductPracticePlayer";
import type { PlaybackPlan } from "./playback-plan";

const plan: PlaybackPlan = {events:[],trackIds:["track:source-lead","track:h1","track:band"],
  trackLabels:{"track:source-lead":"Lead","track:h1":"Lower / H1","track:band":"Band"},
  totalQuarter:16,effectiveChordTimelineDigest:"test"};

// Captured before hook extraction: existing workspace/share chrome stays exact.
it.each([false,true])("preserves the existing player markup (readOnly=%s)",readOnly=>{
  expect(renderToStaticMarkup(<ProductPracticePlayer abc="X:1\nK:C\nC|" plan={plan}
    tempo={{bpm:80,beatUnit:4,dotted:false}} identity="markup" readOnly={readOnly}
    {...(readOnly?{initialSettings:{speedPercent:75,selectedTrackIndex:1,accompanimentEnabled:false}}:{})} />)).toMatchSnapshot();
});
