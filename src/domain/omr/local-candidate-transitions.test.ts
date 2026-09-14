import { describe, expect, it } from "vitest";
import { validateCandidateTransitions } from "./local-candidate-transitions";
import { inspectMusicXmlWorkspace } from "../../import/musicxml/parser-core";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../../import/musicxml/types";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as versions } from "../../app/algorithm-version-registry";

const raw = '<score-partwise><part-list><score-part id="P"><part-name>Independent</part-name></score-part></part-list><part id="P"><measure number="arbitrary"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type></note></measure></part></score-partwise>';
const candidate = raw.replace('<measure number="arbitrary">', '<measure number="arbitrary" implicit="yes">');
const change = {feature:"timeline-extent",ruleVersion:"hm-automatic-timeline-v1",measureId:"p0m0",before:null,after:'<implicit value="yes" />'};
describe("timeline candidate transition boundary", () => {
  it("replays only an explicitly recorded implicit flag", () => {
    expect(() => validateCandidateTransitions(raw,candidate,[change])).not.toThrow();
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
