import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { binaryDigest } from "../digest/canonical";
import { LOCAL_CANDIDATE_ARTIFACTS, localCandidateImageBytes, validateLocalCandidate, type LocalCandidateBundle } from "./local-candidate";
import { storeOmrImportHandoff, takeOmrImportHandoff } from "./browser-handoff";
import { createImportRecovery } from "../../import/review/recovery";
import { loadImportRecoveries, saveImportRecovery } from "../../import/review/recovery-store";
import { createStructuralRecovery, replayStructuralRecovery, validateStructuralRecovery, verifiedStructuralCandidate } from "../../import/review/structural-recovery";
import { validateLocalImageResult, type LocalImageJob } from "./local-image";
import { acceptLocalImageWorkspace } from "../../import/workspace/local-image-handoff";
import { ScoreWorkspaceStore } from "../../import/workspace/store";
import { applyWorkspaceCommand } from "../../import/workspace/journal";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";

const enc = new TextEncoder(), digest = (text: string) => binaryDigest(enc.encode(text));
const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note></measure></part></score-partwise>';
async function seal(bundle: LocalCandidateBundle): Promise<LocalCandidateBundle> {
  const artifacts = Object.fromEntries(await Promise.all(LOCAL_CANDIDATE_ARTIFACTS.map(async (key) => [key, { text: bundle.artifacts[key].text, sha256: await digest(bundle.artifacts[key].text) }]))) as LocalCandidateBundle["artifacts"];
  const manifest = "image:" + bundle.image.sha256 + "\n" + [...LOCAL_CANDIDATE_ARTIFACTS].sort().map((key) => key + ":" + artifacts[key].sha256 + "\n").join("");
  return { ...bundle, artifacts, manifestSha256: await digest(manifest) };
}
export async function candidateFixture(): Promise<LocalCandidateBundle> {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6i0AAAAASUVORK5CYII=";
  const image = { base64, sha256: await binaryDigest(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))), mimeType: "image/png" as const, width: 1, height: 1 };
  const files: Record<string, string> = {
    rawXml: xml, candidateXml: xml,
    evidence: JSON.stringify({ schemaVersion: 1, runtimeOracleUsed: false, input: { sha256: image.sha256, size: [1, 1] }, engine: { rawXmlSha256: await digest(xml) },
      sourceEligibility: { approved: false, reason: "Unverified source curve." }, changes: [], candidates: [{ feature: "curve", status: "unresolved", reason: "Unknown endpoints" }],
      unresolvedEventLinks: ["d0p0m0n0"], unresolvedMeasureLinks: ["p0m0"], limitations: ["Curve semantics remain unknown."] }),
    links: JSON.stringify({ events: { d0p0m0n0: { event: { id: "d0p0m0n0", partIndex: 0, measureIndex: 0, noteIndex: 0, voice: "1", onset: "0", duration: "4" }, status: "unresolved" } },
      measures: [{ measure: { id: "p0m0" }, status: "unresolved" }] }),
    geometry: JSON.stringify({ systems: [{ page: 0, originalImageSize: [1, 1] }] }),
    provenance: JSON.stringify({ xmlExactReplay: true, events: [{ id: "d0p0m0n0" }] }), ocr: "[]", slashes: "[]",
  };
  return seal({ version: "hm-local-candidate-v1", manifestSha256: "", image,
    artifacts: Object.fromEntries(LOCAL_CANDIDATE_ARTIFACTS.map((key) => [key, { text: files[key], sha256: "" }])) as LocalCandidateBundle["artifacts"] });
}
beforeEach(() => { Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true }); });

async function imageJobFixture(){
  let bundle=await candidateFixture();const now="2026-09-13T00:00:00.000Z",id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const job:LocalImageJob={id,fileName:"independent-fixture.png",mimeType:"image/png",bytes:localCandidateImageBytes(bundle).length,width:1,height:1,language:"eng",createdAt:now,updatedAt:now,sequence:4,phase:"candidate-ready",
    execution:{schema:"hm-local-image-v1",jobId:id,inputSha256:bundle.image.sha256,requestSha256:"a".repeat(64),applicationRevision:"b".repeat(40),runnerSha256:"c".repeat(64),modelsSha256:"d".repeat(64),homrRevision:"e".repeat(40),cacheReused:false,actor:"ui-test"}};
  const evidence={...JSON.parse(bundle.artifacts.evidence.text),execution:job.execution};
  bundle=await seal({...bundle,artifacts:{...bundle.artifacts,evidence:{text:JSON.stringify(evidence),sha256:""}}});
  const text=JSON.stringify(bundle);return{bundle,text,job:{...job,resultSha256:await digest(text)}};
}
describe("fresh image job to persistent workspace",()=>{
  it("binds original bytes, exact evidence and execution without approving unresolved music",async()=>{
    const {job,text,bundle}=await imageJobFixture(),record=await acceptLocalImageWorkspace(job,text,V);
    expect(record.workspace.origin.localCandidate).toEqual(bundle);expect(record.workspace.operations).toEqual([]);
    expect(JSON.parse(record.workspace.origin.localCandidate!.artifacts.evidence.text).sourceEligibility.approved).toBe(false);
    expect((await new ScoreWorkspaceStore().load(record.workspace.id))!.workspace.digest).toBe(record.workspace.digest);
  });
  it("reopening a job retains later corrections and two-tab first saves converge",async()=>{
    const {job,text}=await imageJobFixture();const [a,b]=await Promise.all([acceptLocalImageWorkspace(job,text,V),acceptLocalImageWorkspace(job,text,V)]);
    expect(a.workspace.digest).toBe(b.workspace.digest);const store=new ScoreWorkspaceStore();
    const corrected=await applyWorkspaceCommand(a.workspace,a.workspace,{kind:"title",title:"User correction retained"},{id:"op:fixture",note:"independent test correction",actor:"ui-test",at:"2026-09-13T00:01:00.000Z"});
    await store.save({workspace:corrected,storageRevision:1,updatedAt:"2026-09-13T00:01:00.000Z"},0);
    const reopened=await acceptLocalImageWorkspace(job,text,V);expect(reopened.workspace.revision).toBe(1);expect(reopened.workspace.historyDigest).toBe(corrected.historyDigest);
  });
  it("rejects swapped job/image/revision/cache metadata even when bundle hashes are resealed",async()=>{
    const {job,text,bundle}=await imageJobFixture();
    for(const patch of [{inputSha256:"f".repeat(64)},{applicationRevision:"f".repeat(40)},{runnerSha256:"f".repeat(64)},{modelsSha256:"f".repeat(64)},{jobId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},{cacheReused:true}]){
      const changed=await seal({...bundle,artifacts:{...bundle.artifacts,evidence:{text:JSON.stringify({...JSON.parse(bundle.artifacts.evidence.text),execution:{...job.execution,...patch}}),sha256:""}}});
      const edited=JSON.stringify(changed);await expect(validateLocalImageResult({...job,resultSha256:await digest(edited)},edited)).rejects.toThrow("LOCAL_IMAGE_RESULT_MISMATCH");
    }
    await expect(acceptLocalImageWorkspace({...job,phase:"recognizing"},text,V)).rejects.toThrow("LOCAL_IMAGE_RESULT_MISMATCH");
    expect(await new ScoreWorkspaceStore().list()).toEqual([]);
  });
});
describe("local candidate handoff", () => {
  it("retains image, exact files and unresolved records through handoff, storage and structural recovery", async () => {
    const bundle = await candidateFixture(), bytes = enc.encode(xml), sha = await binaryDigest(localCandidateImageBytes(bundle));
    await storeOmrImportHandoff({ fileName: "candidate.musicxml", mimeType: "application/xml", bytes, localCandidate: bundle,
      pageImages: [{ pageIndex: 0, rawDigest: sha, canonicalPageDigest: sha, mimeType: "image/png", bytes: localCandidateImageBytes(bundle) }] });
    const handoff = (await takeOmrImportHandoff())!;
    expect(handoff.omrProviderResult).toBeUndefined();
    expect(handoff.localCandidate).toEqual(bundle);
    const recovery = await createImportRecovery(bytes, "candidate.musicxml");
    await saveImportRecovery({ id: handoff.handoffId, updatedAt: new Date().toISOString(), recovery, pages: handoff.pageImages, localCandidate: bundle });
    const restored = (await loadImportRecoveries())[0];
    expect(restored.localCandidate).toEqual(bundle); expect(restored.recovery.operations).toHaveLength(0);
    const workspace = await createStructuralRecovery("test", [{ id: restored.id, recovery, localCandidate: restored.localCandidate }]);
    expect(Object.values((await replayStructuralRecovery(workspace)).uncertainties)[0]).toContain("전체 대조");
    expect((await validateStructuralRecovery(workspace)).issues.join(" ")).toContain("원본 의미 미확정");
    await expect(verifiedStructuralCandidate(workspace)).rejects.toThrow("RECOVERY_STRUCTURE_UNRESOLVED");
    const marked = xml.replace("<part-list>", '<identification><miscellaneous><miscellaneous-field name="harmonymaker-local-candidate">Unverified</miscellaneous-field></miscellaneous></identification><part-list>');
    await expect(createStructuralRecovery("without-evidence", [{ id: "marked", recovery: await createImportRecovery(enc.encode(marked), "a.xml") }])).rejects.toThrow("RECOVERY_LOCAL_EVIDENCE_REQUIRED");
  });
  it("rejects swapped XML, image, sidecars and page binding rather than dropping evidence", async () => {
    const b = await candidateFixture();
    await expect(validateLocalCandidate({ ...b, image: { ...b.image, width: 2 } })).rejects.toThrow();
    await expect(validateLocalCandidate({ ...b, artifacts: { ...b.artifacts, candidateXml: { ...b.artifacts.candidateXml, text: xml + " " } } })).rejects.toThrow();
    await expect(validateLocalCandidate({ ...b, artifacts: { ...b.artifacts, evidence: { ...b.artifacts.evidence, text: "{}" } } })).rejects.toThrow();
    await expect(storeOmrImportHandoff({ fileName: "a.xml", mimeType: "application/xml", bytes: enc.encode(xml + " "), localCandidate: b, pageImages: [] })).rejects.toThrow();
  });
  it("checks semantic bindings even when a changed manifest was rehashed", async () => {
    const b = await candidateFixture(), evidence = JSON.parse(b.artifacts.evidence.text);
    const swapped = await seal({ ...b, artifacts: { ...b.artifacts, candidateXml: { text: xml.replace("<step>C</step>", "<step>D</step>"), sha256: "" } } });
    await expect(validateLocalCandidate(swapped)).rejects.toThrow("LOCAL_CANDIDATE_TRANSITION_INVALID");
    const altered = (key: "evidence" | "links", text: string) => seal({ ...b, artifacts: { ...b.artifacts, [key]: { text, sha256: "" } } });
    await expect(validateLocalCandidate(await altered("evidence", JSON.stringify({ ...evidence, unresolvedEventLinks: [] })))).rejects.toThrow();
    await expect(validateLocalCandidate(await altered("evidence", JSON.stringify({ ...evidence, sourceEligibility: { approved: true, reason: "fake resolution" } })))).rejects.toThrow();
    const links = JSON.parse(b.artifacts.links.text); links.events.d0p0m0n0.event.noteIndex = 9;
    await expect(validateLocalCandidate(await altered("links", JSON.stringify(links)))).rejects.toThrow();
    await expect(validateLocalCandidate(await altered("evidence", JSON.stringify({ ...evidence, candidates: [{ sourceBox: [0, 0, 2, 1] }] })))).rejects.toThrow();
  });
});
