import { describe, expect, it } from "vitest";
import { parseSafeXml } from "./xml";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "./types";

const encoder = new TextEncoder();

describe("MusicXML XML security boundary", () => {
  it("accepts well-formed XML while preserving safe predefined entities", () => {
    const result = parseSafeXml(encoder.encode("<score-partwise><work><work-title>A &amp; B</work-title></work></score-partwise>"), DEFAULT_IMPORT_SECURITY_LIMITS);
    expect(result.status).toBe("complete");
  });

  it.each([
    ["malformed tag tree", "<score-partwise><part></score-partwise>", "IMPORT_CORRUPT_XML"],
    ["other root", "<!DOCTYPE x><score-partwise/>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["internal subset", "<!DOCTYPE score-partwise []><score-partwise/>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["multiple declarations", "<!DOCTYPE score-partwise><!DOCTYPE score-partwise><score-partwise/>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["declaration after root", "<score-partwise/><!DOCTYPE score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["declaration in root", "<score-partwise><!DOCTYPE score-partwise></score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["standalone ENTITY", "<!ENTITY x 'x'><score-partwise/>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["ENTITY in comment", "<!-- <!ENTITY x 'x'> --><score-partwise/>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["NUL", "<score-partwise>\u0000</score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ...["<", ">", "[", "]"].map(char => [`literal ${char}`, `<!DOCTYPE score-partwise SYSTEM "a${char}b"><score-partwise/>`, "IMPORT_UNSUPPORTED_ELEMENT"]),
    ["local XXE", "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><score-partwise>&e;</score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["remote XXE", "<!DOCTYPE x [<!ENTITY e SYSTEM 'https://example.invalid/e'>]><score-partwise>&e;</score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["entity expansion", "<!DOCTYPE x [<!ENTITY a 'aaaa'><!ENTITY b '&a;&a;'>]><score-partwise>&b;</score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["XInclude", "<score-partwise xmlns:xi='http://www.w3.org/2001/XInclude'><xi:include href='file:///etc/passwd'/></score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
  ])("blocks %s", (_name, xml, code) => {
    const result = parseSafeXml(encoder.encode(xml), DEFAULT_IMPORT_SECURITY_LIMITS);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.diagnostics[0].code).toBe(code);
  });

  it.each([
    ['score-partwise', 'PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"'],
    ['score-partwise', "PUBLIC '-//Recordare//DTD MusicXML 3.1 Partwise//EN' 'http://www.musicxml.org/dtds/partwise.dtd'"],
    ['score-timewise', 'PUBLIC "-//Recordare//DTD MusicXML 4.0 Timewise//EN" "http://www.musicxml.org/dtds/timewise.dtd"'],
    ['score-partwise', 'SYSTEM "https://example.invalid/never-fetch.dtd"'],
    ['score-partwise', ''],
  ])("accepts inert prolog declaration for %s %s", (root, id) => {
    const xml = `<?xml version="1.0"?>\n<!-- export -->\n<!DOCTYPE ${root} ${id}>\n<${root}/>`;
    const result = parseSafeXml(encoder.encode(xml), DEFAULT_IMPORT_SECURITY_LIMITS);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.root.name).toBe(root);
      expect(result.text).toBe(xml); // Preserve original import evidence.
    }
  });

  it("rejects a declared root that differs from the actual root", () => {
    const result = parseSafeXml(encoder.encode("<!DOCTYPE score-timewise><score-partwise/>"), DEFAULT_IMPORT_SECURITY_LIMITS);
    expect(result).toMatchObject({status:"blocked",diagnostics:[{details:{reason:"doctype-root-mismatch"}}]});
  });

  it("blocks XML bytes at the configured size boundary", () => {
    const limits = { ...DEFAULT_IMPORT_SECURITY_LIMITS, maxXmlBytes: 32 };
    const result = parseSafeXml(encoder.encode(`<score-partwise>${"x".repeat(64)}</score-partwise>`), limits);
    expect(result.status).toBe("blocked");
  });

  it("blocks excessive nesting", () => {
    const limits = { ...DEFAULT_IMPORT_SECURITY_LIMITS, maxXmlDepth: 4 };
    const result = parseSafeXml(encoder.encode("<a><b><c><d><e/></d></c></b></a>"), limits);
    expect(result.status).toBe("blocked");
  });
});
