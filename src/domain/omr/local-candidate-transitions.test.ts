import { describe, expect, it } from "vitest";
import { validateCandidateTransitions } from "./local-candidate-transitions";
import { inspectMusicXmlWorkspace } from "../../import/musicxml/parser-core";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../../import/musicxml/types";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as versions } from "../../app/algorithm-version-registry";

const raw = '<score-partwise><part-list><score-part id="P"><part-name>Independent</part-name></score-part></part-list><part id="P"><measure number="arbitrary"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type></note></measure></part></score-partwise>';
const candidate = raw.replace('<measure number="arbitrary">', '<measure number="arbitrary" implicit="yes">');
const change = {feature:"timeline-extent",ruleVersion:"hm-automatic-timeline-v1",measureId:"p0m0",before:null,after:'<implicit value="yes" />'};
describe("timeline candidate transition boundary", () => {
  it("retracts only a replayed exact automatic lyric and preserves user text and notes", () => {
    const lyric='<lyric number="1"><text>가</text></lyric>';
    const add={feature:"lyric",eventIds:["d0p0m0n0"],before:null,after:lyric};
    const retract={feature:"lyric-retraction",ruleVersion:"hm-lyric-recovery-v1",eventIds:["d0p0m0n0"],before:lyric,after:null};
    expect(()=>validateCandidateTransitions(raw,raw,[add,retract])).not.toThrow();
    expect(()=>validateCandidateTransitions(raw,raw,[retract])).toThrow();
    expect(()=>validateCandidateTransitions(raw,raw,[add,{...retract,before:'<lyric><text>다</text></lyric>'}])).toThrow();
    expect(()=>validateCandidateTransitions(raw,raw,[add,{...retract,ruleVersion:'unknown'}])).toThrow();
    expect(()=>validateCandidateTransitions(raw.replace('</note>',lyric+'</note>'),raw,[retract])).toThrow();
    expect(()=>validateCandidateTransitions(raw,raw.replace('<step>E</step>','<step>F</step>'),[add,retract])).toThrow();
  });
  it("replays exact automatic lyric revisions without widening musical or user-lyric authority", () => {
    const first='<lyric number="1"><syllabic>single</syllabic><text>가</text></lyric>';
    const next='<lyric number="1"><syllabic>single</syllabic><text>나</text><extend /></lyric>';
    const add={feature:"lyric",eventIds:["d0p0m0n0"],before:null,after:first};
    const revise={feature:"lyric-recovery",ruleVersion:"hm-lyric-recovery-v1",eventIds:["d0p0m0n0"],before:first,after:next};
    const output=raw.replace('</note>',next+'</note>');
    expect(()=>validateCandidateTransitions(raw,output,[add,revise])).not.toThrow();
    expect(()=>validateCandidateTransitions(raw,output,[revise])).toThrow();
    expect(()=>validateCandidateTransitions(raw,output,[add,{...revise,before:next}])).toThrow();
    expect(()=>validateCandidateTransitions(raw,output,[add,{...revise,ruleVersion:"unknown"}])).toThrow();
    expect(()=>validateCandidateTransitions(raw.replace('</note>',first+'</note>'),output,[revise])).toThrow();
    expect(()=>validateCandidateTransitions(raw,output.replace('<step>E</step>','<step>F</step>'),[add,revise])).toThrow();
    const wrongVerse=next.replace('number="1"','number="2"');
    expect(()=>validateCandidateTransitions(raw,raw.replace('</note>',wrongVerse+'</note>'),[add,{...revise,after:wrongVerse}])).toThrow();
    const verse={feature:"lyric-verse",ruleVersion:"hm-lyric-recovery-v1",eventIds:["d0p0m0n0"],before:null,after:wrongVerse};
    expect(()=>validateCandidateTransitions(raw,raw.replace('</note>',first+wrongVerse+'</note>'),[add,verse])).not.toThrow();
    expect(()=>validateCandidateTransitions(raw,raw.replace('</note>',first+first+'</note>'),[add,{...verse,after:first}])).toThrow();
    const second=wrongVerse.replace('<text>나</text>','<text>다</text>');
    const secondEdit={...revise,before:wrongVerse,after:second};
    expect(()=>validateCandidateTransitions(raw,raw.replace('</note>',first+second+'</note>'),[add,verse,secondEdit])).not.toThrow();
    expect(()=>validateCandidateTransitions(raw.replace('</note>',first+'</note>'),raw.replace('</note>',next+wrongVerse+'</note>'),[verse,revise])).toThrow();
  });
  it("replays only an explicitly recorded implicit flag", () => {
    expect(() => validateCandidateTransitions(raw,candidate,[change])).not.toThrow();
    expect(() => validateCandidateTransitions(raw,candidate,[{...change,ruleVersion:"hm-automatic-timeline-v1.1"}])).not.toThrow();
    expect(() => validateCandidateTransitions(raw,candidate,[])).toThrow("LOCAL_CANDIDATE_TRANSITION_INVALID");
    expect(() => validateCandidateTransitions(raw,candidate,[{...change,before:"yes"}])).toThrow();
    expect(() => validateCandidateTransitions(raw,candidate,[{...change,ruleVersion:"unknown"}])).toThrow();
  });
  it("rejects forged music, range and arbitrary attributes even with a matching timeline history", () => {
    for (const altered of [candidate.replace('<step>E</step>','<step>F</step>'),candidate.replace('<duration>1</duration>','<duration>2</duration>'),candidate.replace('number="arbitrary"','number="rewritten"'),candidate.replace('<beats>4</beats>','<beats>2</beats>')]) {
      expect(() => validateCandidateTransitions(raw,altered,[change])).toThrow("LOCAL_CANDIDATE_TRANSITION_INVALID");
    }
    expect(() => validateCandidateTransitions(raw,candidate,[{...change,after:'<implicit value="yes" extra="invalid" />'}])).toThrow();
  });
  it("uses the existing importer implicit clock and retains every local note", async () => {
    const parse = (xml:string) => inspectMusicXmlWorkspace(new TextEncoder().encode(xml),{originalFileName:"independent.xml",algorithmVersions:versions,securityLimits:DEFAULT_IMPORT_SECURITY_LIMITS,identityFactory:()=>"timeline-independent"});
    const before=await parse(raw),after=await parse(candidate);
    expect(before.status).toBe("review-required");expect(after.status).toBe("review-required");
    if(before.status!=="review-required"||after.status!=="review-required")throw Error("fixture import failed");
    expect(after.draft.parts[0].measures[0].duration).toEqual({n:1,d:2});
    expect(before.draft.parts[0].measures[0].duration).toEqual({n:4,d:1});
    expect(after.draft.parts[0].measures[0].leadEvents).toEqual(before.draft.parts[0].measures[0].leadEvents);
  });
});
