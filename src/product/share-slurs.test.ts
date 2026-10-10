import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { semanticDigest } from "../domain/digest/canonical";
import { decodePracticeShare, encodePracticeShare, isPracticeSharePayload, type PracticeSharePayload } from "../domain/share";
import { decompressPracticeShare, PRACTICE_SHARE_MAX_COMPRESSED_BYTES, practiceSharePlaintext } from "../domain/share-compression";
import { prepareQuickHarmony, generateQuickHarmony } from "./quick-harmony";
import { materializeActiveArrangement } from "./render";
import { materializePracticeShare } from "./practice-share";
import { materializeSharedPractice } from "./shared-practice";
import { importHarmonyProject } from "./project-transfer";
import { encodeProductUrlShare, decodeProductUrlShare, PRODUCT_URL_SHARE_LIMIT, urlShareFits } from "./share-url";
import { arrangementRenderDocumentToAbc } from "./score-adapter";
import { buildPlaybackPlan } from "./playback-plan";

let payload: PracticeSharePayload;
beforeAll(async()=>{
  let i=0;
  const xml=readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml",import.meta.url),"utf8").replaceAll("</note>",()=>{
    i++; return ([1,4].includes(i)?`<notations><slur number="1" type="${i===1?"start":"stop"}"/></notations>`:"")+"</note>";
  });
  const prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"self-authored-slur.musicxml"});
  const result=await generateQuickHarmony(prep,{parts:["alto","tenor"],rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  if(result.status!=="complete")throw new Error(result.status);
  const materialized=materializeActiveArrangement(result.project,"standard");
  payload=materializePracticeShare({project:result.project,presetId:"standard",materialized,workspaceShareConfirmedForThisExport:true});
  const shared=materializeSharedPractice(payload);
  expect(shared.document.sourceLeadTrack.atoms.map(a=>a.slurs)).toEqual(materialized.document.sourceLeadTrack.atoms.map(a=>a.slurs));
  const sounds=(p:ReturnType<typeof buildPlaybackPlan>)=>p.events.map(e=>[e.startQuarter,e.durationQuarter,e.midi]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
  expect(sounds(buildPlaybackPlan(shared.document,shared.trackRoles))).toEqual(sounds(buildPlaybackPlan(materialized.document,materialized.trackRoles)));
  const notation={title:result.project.source.title,key:result.project.source.defaultKey,tempo:result.project.source.defaultTempo};
  expect(arrangementRenderDocumentToAbc(shared.document,shared.trackRoles,notation)).toBe(arrangementRenderDocumentToAbc(materialized.document,materialized.trackRoles,notation));
});

it("round-trips slurs in V5 through canonical JSON and the bounded URL codec",()=>{
  expect(payload.schemaVersion).toBe(5);
  expect(decodePracticeShare(encodePracticeShare(payload))).toEqual(payload);
  const encoded=encodeProductUrlShare(payload);
  expect(urlShareFits(encoded)).toBe(true);
  expect(decodeProductUrlShare(encoded)).toEqual(payload);
});

it("keeps the pre-change V4 canonical bytes for the frozen legacy project and still opens it",async()=>{
  const project=await importHarmonyProject(readFileSync(new URL("./fixtures/auto-draft-v1-auto.json",import.meta.url),"utf8"));
  const old=materializePracticeShare({project,presetId:"standard",materialized:materializeActiveArrangement(project,"standard"),workspaceShareConfirmedForThisExport:true});
  expect(old.schemaVersion).toBe(4);
  // Captured by running the serializer at 526f84b, before V5 was implemented.
  expect(await semanticDigest(old)).toBe("2997ff7a2094c715476b6ea62b90cd896a8f49a104917fbdbf178c4eebe4d95b");
  expect(materializeSharedPractice(decodeProductUrlShare(encodeProductUrlShare(old))).document.sourceLeadTrack.atoms.length).toBeGreaterThan(0);
});

it.each(["legacy","open","unmatched","invalid-number","generated","unknown-field"])("rejects malformed or misplaced slurs: %s",mode=>{
  const copy=JSON.parse(JSON.stringify(payload));
  const events=copy.arrangement.tracks[0].events;
  if(mode==="legacy")copy.schemaVersion=4;
  if(mode==="open")delete events[3].slurs;
  if(mode==="unmatched")events[0].slurs[0].type="continue";
  if(mode==="invalid-number")events[0].slurs[0].number=17;
  if(mode==="generated")copy.arrangement.tracks[1].events[0].slurs=events[0].slurs;
  if(mode==="unknown-field")events[0].slurs[0].ignored=true;
  expect(isPracticeSharePayload(copy)).toBe(false);
});

it("retains plaintext, compressed and URL size limits for V5",()=>{
  const huge={...payload,lyrics:Array.from({length:140},(_,i)=>({id:`ly:${i}`,text:"가".repeat(2048),verse:1,syllabic:"single" as const,extend:false}))};
  expect(isPracticeSharePayload(huge)).toBe(true);
  expect(()=>practiceSharePlaintext(huge)).toThrow("SHARE_PAYLOAD_TOO_LARGE");
  expect(()=>decompressPracticeShare(new Uint8Array(PRACTICE_SHARE_MAX_COMPRESSED_BYTES+1))).toThrow("SHARE_PAYLOAD_TOO_LARGE");
  expect(urlShareFits("A".repeat(PRODUCT_URL_SHARE_LIMIT+1))).toBe(false);
  expect(()=>decodeProductUrlShare("A".repeat(PRODUCT_URL_SHARE_LIMIT+1))).toThrow("SHARE_PAYLOAD_TOO_LARGE");
});
