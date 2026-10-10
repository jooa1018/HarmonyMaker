import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { prepareQuickHarmony } from "./quick-harmony";

const declaration='<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">';
const plain=readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml",import.meta.url),"utf8");
const xml=plain.replace('<score-partwise',declaration+'<score-partwise');
it.each([false,true])("prepares a standard MusicXML declaration, MXL=%s",async archive=>{
  const bytes=archive?zipSync({"META-INF/container.xml":strToU8('<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),"score.musicxml":strToU8(xml)}):strToU8(xml);
  const prepared=await prepareQuickHarmony({bytes,fileName:archive?"test.mxl":"test.musicxml"});
  expect(prepared.status).toBe("ready");
  expect(prepared.summary).toEqual((await prepareQuickHarmony({bytes:strToU8(plain),fileName:"plain.musicxml"})).summary);
});
it.each([
  [strToU8('<!DOCTYPE score-partwise []><score-partwise/>'),"forbidden-doctype"],
  [strToU8('<score-partwise>'),"malformed-xml"],
  [new Uint8Array([0xff]),"invalid-utf8"],
  [new Uint8Array(4_000_001),"xml-size-limit"],
  [strToU8('<score-timewise/>'),"unsupported-score-root"],
])("retains concrete file failure details: %s %s",async(bytes,reason)=>{
  const prepared=await prepareQuickHarmony({bytes,fileName:"test.musicxml"});
  expect(prepared.status).toBe("unsupported");
  expect(prepared.details.importDiagnostics?.[0].details?.reason).toBe(reason);
});
