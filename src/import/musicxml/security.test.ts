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
    ["DOCTYPE", "<!DOCTYPE score-partwise><score-partwise/>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["local XXE", "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><score-partwise>&e;</score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["remote XXE", "<!DOCTYPE x [<!ENTITY e SYSTEM 'https://example.invalid/e'>]><score-partwise>&e;</score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["entity expansion", "<!DOCTYPE x [<!ENTITY a 'aaaa'><!ENTITY b '&a;&a;'>]><score-partwise>&b;</score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
    ["XInclude", "<score-partwise xmlns:xi='http://www.w3.org/2001/XInclude'><xi:include href='file:///etc/passwd'/></score-partwise>", "IMPORT_UNSUPPORTED_ELEMENT"],
  ])("blocks %s", (_name, xml, code) => {
    const result = parseSafeXml(encoder.encode(xml), DEFAULT_IMPORT_SECURITY_LIMITS);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.diagnostics[0].code).toBe(code);
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
