import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { prepareQuickHarmony, generateQuickHarmony } from "./quick-harmony";
import { readVerifiedWorkspace } from "../import/workspace/journal";
import { summarizeQuickHarmonyMelody } from "./quick-harmony-summary";

const original = readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml", import.meta.url),"utf8");
async function summary(xml: string) {
  const prep = await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"summary.musicxml"});
  const request = prep.details.assessment?.request;
  if(!prep.workspace || !request?.lead)throw new Error("missing melody");
  const {state} = await readVerifiedWorkspace(prep.workspace);
  const value=summarizeQuickHarmonyMelody(state.music!,{...request,lead:request.lead});
  expect(prep.summary).toEqual(value);
  return value;
}

it.each([["major","G장조"],["minor","E단조"]] as const)("summarizes explicit %s keys",async(mode,label)=>{
  const xml=original.replace("<fifths>0</fifths>",`<fifths>1</fifths><mode>${mode}</mode>`);
  expect((await summary(xml)).keyLabelKo).toBe(label);
});

it("counts printed measures and distinct lyric verses before repeat expansion",async()=>{
  const xml=original.replace("<note>",'<barline location="left"><repeat direction="forward"/></barline><note>')
    .replace("</note>",'<lyric number="1"><text>한</text></lyric><lyric number="3"><text>둘</text></lyric></note>')
    .replace("</measure></part>",'<barline location="right"><repeat direction="backward"/></barline></measure></part>');
  const value=await summary(xml);
  expect(value).toMatchObject({measureCount:4,hasLyrics:true,verseCount:2,meters:["4/4"],recommendedPart:"tenor"});
  expect(await summary(xml)).toEqual(value);
});

it("preserves the importer title placeholder, zero verses without lyrics, and the auto median threshold",async()=>{
  const xml=original.replace(/<work>[\s\S]*?<\/work>/u,"").replaceAll("<octave>4</octave>","<octave>5</octave>");
  expect(await summary(xml)).toMatchObject({title:"제목 없음",hasLyrics:false,verseCount:0,recommendedPart:"alto"});
});

it("reports mixed meters in printed order without duplicate entries",async()=>{
  const xml=original.replace(/<measure number="2">([\s\S]*?)<\/measure>/u,(_,content:string)=>
    '<measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>'
      +content.replace(/<note>(?:(?!<note>)[\s\S])*?<\/note>$/u,"")+'</measure>')
    .replace('<measure number="3">','<measure number="3"><attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>');
  expect((await summary(xml)).meters).toEqual(["4/4","3/4"]);
});

it.each([4,5])("matches the engine auto part for octave %i",async octave=>{
  const xml=original.replaceAll("<octave>4</octave>",`<octave>${octave}</octave>`);
  const prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"summary.musicxml"});
  const result=await generateQuickHarmony(prep,{parts:"auto",rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  if(result.status!=="complete" && result.status!=="partial")throw new Error(result.status);
  expect(result.parts[0].part).toBe((await summary(xml)).recommendedPart);
});
