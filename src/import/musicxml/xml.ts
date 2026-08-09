import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ImportDiagnosticInput } from "./diagnostics";
import type { ImportSecurityLimits } from "./types";

export type XmlChild = XmlElement | { readonly kind: "text"; readonly value: string };

export interface XmlElement {
  readonly kind: "element";
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlChild[];
}

export type XmlParseResult =
  | { readonly status: "complete"; readonly root: XmlElement; readonly text: string }
  | { readonly status: "blocked"; readonly diagnostics: readonly ImportDiagnosticInput[] };

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function blocked(messageKo: string, reason: string): XmlParseResult {
  return {
    status: "blocked",
    diagnostics: [{
      code: "IMPORT_CORRUPT_XML",
      messageKo,
      details: { reason },
    }],
  };
}

function decodeEntity(entity: string): string {
  const predefined: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\"",
  };
  if (predefined[entity] !== undefined) return predefined[entity];
  const value = entity.startsWith("#x")
    ? Number.parseInt(entity.slice(2), 16)
    : entity.startsWith("#")
      ? Number.parseInt(entity.slice(1), 10)
      : Number.NaN;
  if (!Number.isSafeInteger(value)
    || value <= 0
    || value > 0x10ffff
    || (value >= 0xd800 && value <= 0xdfff)) {
    throw new RangeError("unsupported XML entity");
  }
  return String.fromCodePoint(value);
}

function decodeSafeXmlText(value: string): string {
  return value.replace(/&([^;]{1,20});/gu, (_match, entity: string) => decodeEntity(entity));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attributesOf(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    if (typeof value[key] !== "string") throw new TypeError("XML attribute must be text");
    result[key] = decodeSafeXmlText(value[key]);
  }
  return result;
}

function orderedChild(value: unknown, depth: number, maxDepth: number): XmlChild | undefined {
  if (!isRecord(value)) throw new TypeError("ordered XML node must be a record");
  if (Object.hasOwn(value, "#text")) {
    const text = value["#text"];
    if (typeof text !== "string") throw new TypeError("XML text node must be text");
    return { kind: "text", value: decodeSafeXmlText(text) };
  }
  const names = Object.keys(value).filter((key) => key !== ":@");
  if (names.length !== 1) {
    if (names.length === 0) return undefined;
    throw new TypeError("ordered XML element is ambiguous");
  }
  if (depth > maxDepth) throw new RangeError("XML depth limit exceeded");
  const rawChildren = value[names[0]];
  if (!Array.isArray(rawChildren)) throw new TypeError("ordered XML children must be an array");
  const children = rawChildren
    .map((child) => orderedChild(child, depth + 1, maxDepth))
    .filter((child): child is XmlChild => child !== undefined);
  return {
    kind: "element",
    name: names[0],
    attributes: attributesOf(value[":@"]),
    children,
  };
}

function forbiddenMarkup(text: string): string | undefined {
  if (/<!\s*DOCTYPE\b/iu.test(text)) return "DOCTYPE";
  if (/<!\s*ENTITY\b/iu.test(text)) return "ENTITY";
  if (/<\s*(?:[A-Za-z_][\w.-]*:)?include\b/iu.test(text)
    || /http:\/\/www\.w3\.org\/2001\/XInclude/iu.test(text)) return "XInclude";
  if (/\u0000/u.test(text)) return "NUL";
  return undefined;
}

export function parseSafeXml(
  bytes: Uint8Array,
  limits: ImportSecurityLimits,
): XmlParseResult {
  if (bytes.byteLength === 0) return blocked("XML 파일이 비어 있습니다.", "empty");
  if (bytes.byteLength > limits.maxXmlBytes) {
    return blocked("XML 파일이 허용 크기를 초과했습니다.", "xml-size-limit");
  }
  let text: string;
  try {
    text = utf8Decoder.decode(bytes);
  } catch {
    return blocked("XML 파일은 올바른 UTF-8이어야 합니다.", "invalid-utf8");
  }
  const forbidden = forbiddenMarkup(text);
  if (forbidden) {
    return {
      status: "blocked",
      diagnostics: [{
        code: "IMPORT_UNSUPPORTED_ELEMENT",
        messageKo: `${forbidden}가 포함된 XML은 안전을 위해 가져올 수 없습니다.`,
        details: { reason: `forbidden-${forbidden.toLowerCase()}` },
      }],
    };
  }
  const validation = XMLValidator.validate(text, { allowBooleanAttributes: false });
  if (validation !== true) return blocked("XML 구조가 손상되었거나 닫히지 않은 태그가 있습니다.", "malformed-xml");
  try {
    const parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      removeNSPrefix: true,
      processEntities: false,
      ignoreDeclaration: true,
      ignorePiTags: true,
      maxNestedTags: limits.maxXmlDepth,
    });
    const parsed: unknown = parser.parse(text, false);
    if (!Array.isArray(parsed)) return blocked("XML 최상위 구조를 읽을 수 없습니다.", "invalid-root");
    const roots = parsed
      .map((entry) => orderedChild(entry, 1, limits.maxXmlDepth))
      .filter((entry): entry is XmlElement => entry?.kind === "element");
    if (roots.length !== 1) return blocked("XML에는 하나의 score root가 필요합니다.", "ambiguous-root");
    return { status: "complete", root: roots[0], text };
  } catch (error) {
    return blocked(
      error instanceof RangeError ? "XML 깊이가 안전 한도를 초과했습니다." : "XML 내용을 안전하게 해석하지 못했습니다.",
      error instanceof Error ? error.message : "parser-failed",
    );
  }
}

export function xmlChildren(element: XmlElement, name: string): readonly XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === "element" && child.name === name);
}

export function xmlChild(element: XmlElement, name: string): XmlElement | undefined {
  return xmlChildren(element, name)[0];
}

export function xmlText(element: XmlElement | undefined): string | undefined {
  if (!element) return undefined;
  const text = element.children
    .filter((child): child is { readonly kind: "text"; readonly value: string } => child.kind === "text")
    .map((child) => child.value)
    .join("")
    .trim();
  return text.length > 0 ? text.normalize("NFC") : undefined;
}

export function xmlDescendants(element: XmlElement, name: string): readonly XmlElement[] {
  const result: XmlElement[] = [];
  const visit = (current: XmlElement): void => {
    for (const child of current.children) {
      if (child.kind !== "element") continue;
      if (child.name === name) result.push(child);
      visit(child);
    }
  };
  visit(element);
  return result;
}
