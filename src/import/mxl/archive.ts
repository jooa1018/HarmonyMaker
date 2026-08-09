import { unzipSync } from "fflate";
import type { ImportDiagnosticInput } from "../musicxml/diagnostics";
import type { ImportSecurityLimits } from "../musicxml/types";
import { parseSafeXml, xmlChildren, type XmlElement } from "../musicxml/xml";

interface ArchiveEntry {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly isDirectory: boolean;
}

export type MxlExtractionResult =
  | { readonly status: "complete"; readonly musicXmlBytes: Uint8Array; readonly rootfilePath: string }
  | { readonly status: "blocked"; readonly diagnostics: readonly ImportDiagnosticInput[] };

function unsafe(reason: string, messageKo: string): MxlExtractionResult {
  return {
    status: "blocked",
    diagnostics: [{
      code: "IMPORT_ARCHIVE_UNSAFE",
      messageKo,
      details: { reason },
    }],
  };
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError("truncated ZIP field");
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError("truncated ZIP field");
  return (bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000) >>> 0;
}

function findEocd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (u32(bytes, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function decodeArchiveName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((value) => value > 0x7f)) throw new RangeError("non-UTF-8 ZIP path");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes).normalize("NFC");
}

function validatePath(name: string, limits: ImportSecurityLimits): string {
  if (new TextEncoder().encode(name).byteLength > limits.maxArchivePathBytes) throw new RangeError("ZIP path too long");
  if (name.length === 0 || name.includes("\u0000") || name.includes("\\")) throw new RangeError("unsafe ZIP path");
  if (name.startsWith("/") || /^[A-Za-z]:/u.test(name)) throw new RangeError("absolute ZIP path");
  const directory = name.endsWith("/");
  const segments = name.split("/");
  if (directory) segments.pop();
  if (segments.length === 0 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new RangeError("traversing ZIP path");
  }
  return `${segments.join("/")}${directory ? "/" : ""}`;
}

function containsZip64Extra(bytes: Uint8Array, offset: number, length: number): boolean {
  const end = offset + length;
  let cursor = offset;
  while (cursor + 4 <= end) {
    const kind = u16(bytes, cursor);
    const size = u16(bytes, cursor + 2);
    cursor += 4;
    if (cursor + size > end) throw new RangeError("truncated ZIP extra field");
    if (kind === 0x0001) return true;
    cursor += size;
  }
  return cursor !== end;
}

function inspectArchive(bytes: Uint8Array, limits: ImportSecurityLimits): readonly ArchiveEntry[] {
  if (bytes.byteLength < 22 || u32(bytes, 0) !== 0x04034b50) throw new RangeError("invalid ZIP magic");
  if (bytes.byteLength > limits.maxArchiveBytes) throw new RangeError("ZIP size limit exceeded");
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new RangeError("missing ZIP directory");
  const commentLength = u16(bytes, eocd + 20);
  if (eocd + 22 + commentLength !== bytes.byteLength) throw new RangeError("trailing or truncated ZIP data");
  const disk = u16(bytes, eocd + 4);
  const centralDisk = u16(bytes, eocd + 6);
  const entriesOnDisk = u16(bytes, eocd + 8);
  const entryCount = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new RangeError("multi-disk ZIP is unsupported");
  if (entryCount === 0 || entryCount > limits.maxArchiveEntries) throw new RangeError("ZIP entry count limit exceeded");
  if (centralOffset + centralSize !== eocd || centralOffset >= eocd) throw new RangeError("invalid ZIP directory bounds");
  const names = new Set<string>();
  const localOffsets = new Set<number>();
  const dataRanges: Array<{ readonly start: number; readonly end: number }> = [];
  const entries: ArchiveEntry[] = [];
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(bytes, cursor) !== 0x02014b50) throw new RangeError("invalid ZIP central entry");
    const versionMadeBy = u16(bytes, cursor + 4);
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const crc32 = u32(bytes, cursor + 16);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const entryCommentLength = u16(bytes, cursor + 32);
    const diskStart = u16(bytes, cursor + 34);
    const externalAttributes = u32(bytes, cursor + 38);
    const localHeaderOffset = u32(bytes, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (end > centralOffset + centralSize) throw new RangeError("truncated ZIP central entry");
    if ((flags & 0x41) !== 0) throw new RangeError("encrypted ZIP entry");
    if (method !== 0 && method !== 8) throw new RangeError("unsupported ZIP compression");
    if (diskStart !== 0) throw new RangeError("multi-disk ZIP entry");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new RangeError("ZIP64 entry is unsupported");
    }
    if (containsZip64Extra(bytes, cursor + 46 + nameLength, extraLength)) throw new RangeError("ZIP64 extra field is unsupported");
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = validatePath(decodeArchiveName(rawName, (flags & 0x800) !== 0), limits);
    if (names.has(name)) throw new RangeError("duplicate normalized ZIP path");
    names.add(name);
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const hostOs = versionMadeBy >>> 8;
    if (hostOs === 3 && (unixMode & 0o170000) === 0o120000) throw new RangeError("ZIP symlink entry");
    if (compressedSize > limits.maxEntryCompressedBytes
      || uncompressedSize > limits.maxEntryUncompressedBytes) throw new RangeError("ZIP entry size limit exceeded");
    if (uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > limits.maxCompressionRatio)) {
      throw new RangeError("ZIP entry decompression ratio exceeded");
    }
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes
      || totalUncompressed / Math.max(1, totalCompressed) > limits.maxCompressionRatio) {
      throw new RangeError("ZIP total decompression limit exceeded");
    }
    if (localOffsets.has(localHeaderOffset)) throw new RangeError("duplicate ZIP local header");
    localOffsets.add(localHeaderOffset);
    if (u32(bytes, localHeaderOffset) !== 0x04034b50) throw new RangeError("invalid ZIP local header");
    const localFlags = u16(bytes, localHeaderOffset + 6);
    const localMethod = u16(bytes, localHeaderOffset + 8);
    const localCrc32 = u32(bytes, localHeaderOffset + 14);
    const localCompressedSize = u32(bytes, localHeaderOffset + 18);
    const localUncompressedSize = u32(bytes, localHeaderOffset + 22);
    const localNameLength = u16(bytes, localHeaderOffset + 26);
    const localExtraLength = u16(bytes, localHeaderOffset + 28);
    if (localFlags !== flags || localMethod !== method) throw new RangeError("conflicting ZIP local entry");
    const usesDataDescriptor = (flags & 0x8) !== 0;
    if ((!usesDataDescriptor && (localCrc32 !== crc32
      || localCompressedSize !== compressedSize
      || localUncompressedSize !== uncompressedSize))
      || (usesDataDescriptor && ((localCrc32 !== 0 && localCrc32 !== crc32)
        || (localCompressedSize !== 0 && localCompressedSize !== compressedSize)
        || (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)))) {
      throw new RangeError("conflicting ZIP local sizes");
    }
    const localNameStart = localHeaderOffset + 30;
    const localName = validatePath(
      decodeArchiveName(bytes.subarray(localNameStart, localNameStart + localNameLength), (localFlags & 0x800) !== 0),
      limits,
    );
    if (localName !== name) throw new RangeError("conflicting ZIP entry path");
    if (containsZip64Extra(bytes, localNameStart + localNameLength, localExtraLength)) throw new RangeError("ZIP64 local extra field is unsupported");
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new RangeError("ZIP entry data exceeds directory boundary");
    dataRanges.push({ start: localHeaderOffset, end: dataEnd });
    const isDirectory = name.endsWith("/");
    if (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) throw new RangeError("ZIP directory has payload");
    entries.push({ name, compressedSize, uncompressedSize, localHeaderOffset, isDirectory });
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize) throw new RangeError("ZIP directory entry count mismatch");
  dataRanges.sort((left, right) => left.start - right.start);
  if (dataRanges.some((range, index) => index > 0 && range.start < dataRanges[index - 1].end)) {
    throw new RangeError("overlapping ZIP local entries");
  }
  return entries;
}

function extractOne(bytes: Uint8Array, name: string): Uint8Array {
  const extracted = unzipSync(bytes, { filter: (file) => file.name === name });
  const value = extracted[name];
  if (!(value instanceof Uint8Array)) throw new RangeError("ZIP target extraction failed");
  return value;
}

function rootfilePaths(container: XmlElement): readonly string[] {
  if (container.name !== "container") throw new RangeError("invalid MXL container root");
  const rootfiles = xmlChildren(container, "rootfiles");
  if (rootfiles.length !== 1) throw new RangeError("ambiguous MXL rootfiles");
  return xmlChildren(rootfiles[0], "rootfile").map((rootfile) => rootfile.attributes["full-path"] ?? "");
}

export function extractMusicXmlFromMxl(
  bytes: Uint8Array,
  limits: ImportSecurityLimits,
): MxlExtractionResult {
  let entries: readonly ArchiveEntry[];
  try {
    entries = inspectArchive(bytes, limits);
  } catch (error) {
    return unsafe(
      error instanceof Error ? error.message : "archive-preflight-failed",
      "MXL 보안 검사에 실패했습니다.",
    );
  }
  const containerEntry = entries.find((entry) => entry.name === "META-INF/container.xml" && !entry.isDirectory);
  if (!containerEntry) return unsafe("missing-container", "MXL에 META-INF/container.xml이 없습니다.");
  try {
    const containerBytes = extractOne(bytes, containerEntry.name);
    const parsedContainer = parseSafeXml(containerBytes, limits);
    if (parsedContainer.status === "blocked") return unsafe("malformed-container", "MXL container.xml이 올바르지 않습니다.");
    const paths = [...new Set(rootfilePaths(parsedContainer.root))];
    if (paths.length !== 1) return unsafe("ambiguous-rootfile", "MXL rootfile이 없거나 서로 충돌합니다.");
    const normalizedRoot = validatePath(paths[0], limits);
    if (normalizedRoot.endsWith("/")) return unsafe("rootfile-directory", "MXL rootfile이 파일을 가리키지 않습니다.");
    const rootEntry = entries.find((entry) => entry.name === normalizedRoot && !entry.isDirectory);
    if (!rootEntry) return unsafe("missing-rootfile-target", "MXL rootfile 대상이 archive에 없습니다.");
    const musicXmlBytes = extractOne(bytes, rootEntry.name);
    if (musicXmlBytes.byteLength > limits.maxXmlBytes) return unsafe("rootfile-size-limit", "MXL의 MusicXML이 허용 크기를 초과했습니다.");
    return { status: "complete", musicXmlBytes, rootfilePath: rootEntry.name };
  } catch (error) {
    return unsafe(
      error instanceof Error ? error.message : "archive-extraction-failed",
      "MXL에서 MusicXML을 안전하게 추출하지 못했습니다.",
    );
  }
}

export const __mxlSecurityInternals = { inspectArchive };
