import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { importMusicXml } from "../musicxml/parser";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../musicxml/types";
import { extractMusicXmlFromMxl } from "./archive";

const score = `<score-partwise><work><work-title>MXL</work-title></work><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="100"/></direction><harmony><root><root-step>C</root-step></root><kind>major</kind></harmony><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note></measure></part></score-partwise>`;
const TEST_ALGORITHM_VERSIONS = {
  performanceExpanderVersion: "repeat-v1",
  chordTimelineResolverVersion: "chord-timeline-v1",
  sourceLeadAtomizerVersion: "source-lead-atomizer-v1",
} as const;

function container(root = "score.musicxml"): string {
  return `<?xml version="1.0"?><container><rootfiles><rootfile full-path="${root}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
}

function validMxl(): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(container()),
    "score.musicxml": strToU8(score),
  }, { mtime: new Date("1980-01-01T00:00:00Z") });
}

function setU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function setU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function getU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000) >>> 0;
}

function findSignature(bytes: Uint8Array, signature: readonly number[], start = 0): number {
  for (let index = start; index <= bytes.length - signature.length; index += 1) {
    if (signature.every((value, ordinal) => bytes[index + ordinal] === value)) return index;
  }
  return -1;
}

describe("MXL archive security boundary", () => {
  it("imports a valid container and only its declared rootfile", async () => {
    const result = await importMusicXml(validMxl(), {
      algorithmVersions: TEST_ALGORITHM_VERSIONS,
      originalFileName: "safe.mxl",
      identityFactory: () => "doc:mxl-test",
    });
    expect(result.status).toBe("review-required");
    if (result.status === "review-required") expect(result.draft.containerKind).toBe("mxl");
  });

  it.each([
    ["parent traversal", "../score.musicxml"],
    ["backslash traversal", "..\\score.musicxml"],
    ["absolute path", "/score.musicxml"],
    ["drive path", "C:/score.musicxml"],
  ])("blocks %s", (_name, unsafePath) => {
    const archive = zipSync({
      "META-INF/container.xml": strToU8(container(unsafePath)),
      [unsafePath]: strToU8(score),
    });
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks excessive decompression ratio before root extraction", () => {
    const archive = zipSync({
      "META-INF/container.xml": strToU8(container()),
      "score.musicxml": strToU8(`<score-partwise>${"A".repeat(500_000)}</score-partwise>`),
    });
    const result = extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS);
    expect(result.status).toBe("blocked");
  });

  it("blocks missing container.xml", () => {
    const archive = zipSync({ "score.musicxml": strToU8(score) });
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks missing rootfile target", () => {
    const archive = zipSync({ "META-INF/container.xml": strToU8(container("missing.musicxml")) });
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks conflicting rootfiles", () => {
    const ambiguous = "<container><rootfiles><rootfile full-path=\"a.musicxml\"/><rootfile full-path=\"b.musicxml\"/></rootfiles></container>";
    const archive = zipSync({
      "META-INF/container.xml": strToU8(ambiguous),
      "a.musicxml": strToU8(score),
      "b.musicxml": strToU8(score),
    });
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks a rootfile path that escapes even when archive entries are otherwise safe", () => {
    const archive = zipSync({
      "META-INF/container.xml": strToU8(container("../score.musicxml")),
      "score.musicxml": strToU8(score),
    });
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks duplicate normalized central-directory paths", () => {
    const archive = zipSync({
      "META-INF/container.xml": strToU8(container("a.xml")),
      "a.xml": strToU8(score),
      "b.xml": strToU8(score),
    });
    const firstCentral = findSignature(archive, [0x50, 0x4b, 0x01, 0x02]);
    const secondCentral = findSignature(archive, [0x50, 0x4b, 0x01, 0x02], firstCentral + 4);
    const thirdCentral = findSignature(archive, [0x50, 0x4b, 0x01, 0x02], secondCentral + 4);
    expect(thirdCentral).toBeGreaterThanOrEqual(0);
    archive[thirdCentral + 46] = "a".charCodeAt(0);
    const localOffset = getU32(archive, thirdCentral + 42);
    archive[localOffset + 30] = "a".charCodeAt(0);
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks Unix symlink entries", () => {
    const archive = zipSync({
      "META-INF/container.xml": [strToU8(container()), { os: 3, attrs: 0o120777 * 65_536 }],
      "score.musicxml": strToU8(score),
    });
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks encrypted-entry flags", () => {
    const archive = Uint8Array.from(validMxl());
    const local = findSignature(archive, [0x50, 0x4b, 0x03, 0x04]);
    const central = findSignature(archive, [0x50, 0x4b, 0x01, 0x02]);
    expect(local).toBeGreaterThanOrEqual(0);
    expect(central).toBeGreaterThanOrEqual(0);
    setU16(archive, local + 6, 1);
    setU16(archive, central + 8, 1);
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks local/central flag and size contradictions", () => {
    const flagMismatch = Uint8Array.from(validMxl());
    const local = findSignature(flagMismatch, [0x50, 0x4b, 0x03, 0x04]);
    expect(local).toBeGreaterThanOrEqual(0);
    setU16(flagMismatch, local + 6, 0x8);
    expect(extractMusicXmlFromMxl(flagMismatch, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");

    const sizeMismatch = Uint8Array.from(validMxl());
    const sizeLocal = findSignature(sizeMismatch, [0x50, 0x4b, 0x03, 0x04]);
    expect(sizeLocal).toBeGreaterThanOrEqual(0);
    setU32(sizeMismatch, sizeLocal + 22, getU32(sizeMismatch, sizeLocal + 22) + 1);
    expect(extractMusicXmlFromMxl(sizeMismatch, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });

  it("blocks archive size and entry-count limits", () => {
    const archive = validMxl();
    expect(extractMusicXmlFromMxl(archive, {
      ...DEFAULT_IMPORT_SECURITY_LIMITS,
      maxArchiveBytes: archive.byteLength - 1,
    }).status).toBe("blocked");
    expect(extractMusicXmlFromMxl(archive, {
      ...DEFAULT_IMPORT_SECURITY_LIMITS,
      maxArchiveEntries: 1,
    }).status).toBe("blocked");
  });

  it("blocks malformed ZIP magic and malformed container XML", () => {
    expect(extractMusicXmlFromMxl(new Uint8Array([1, 2, 3]), DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
    const archive = zipSync({
      "META-INF/container.xml": strToU8("<container><rootfiles>"),
      "score.musicxml": strToU8(score),
    });
    expect(extractMusicXmlFromMxl(archive, DEFAULT_IMPORT_SECURITY_LIMITS).status).toBe("blocked");
  });
});
