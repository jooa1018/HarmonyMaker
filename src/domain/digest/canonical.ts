import { isFraction } from "../fraction";

export type SemanticDigest = string & { readonly __brand: "SemanticDigest" };
export type BinaryDigest = string & { readonly __brand: "BinaryDigest" };
export type CanonicalPrimitive = null | boolean | number | string;
export type CanonicalValue =
  | CanonicalPrimitive
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalCodecError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalCodecError";
  }
}

function quote(text: string): string {
  return JSON.stringify(text.normalize("NFC"));
}

function encode(value: unknown, ancestors: ReadonlySet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return quote(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalCodecError("canonical numbers must be finite safe integers");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new CanonicalCodecError(`unsupported canonical value: ${typeof value}`);
  }
  if (typeof value !== "object") throw new CanonicalCodecError("unsupported canonical value");
  if (ancestors.has(value)) throw new CanonicalCodecError("canonical value must be acyclic");
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new CanonicalCodecError("sparse arrays are forbidden");
    }
    return `[${value.map((entry) => encode(entry, nextAncestors)).join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalCodecError("canonical objects must be plain records");
  }
  if ("n" in value && "d" in value && !isFraction(value)) {
    throw new CanonicalCodecError("fraction-shaped values must be normalized Fractions");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${quote(key)}:${encode(record[key], nextAncestors)}`).join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return encode(value, new Set());
}

export function compareCanonicalValues(left: unknown, right: unknown): -1 | 0 | 1 {
  const leftJson = canonicalJson(left);
  const rightJson = canonicalJson(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

export function sortByCanonicalProjection<T>(
  values: readonly T[],
  project: (value: T) => unknown,
): readonly T[] {
  return [...values].sort((left, right) => compareCanonicalValues(project(left), project(right)));
}

export function canonicalUtf8(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ownedBytes = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", ownedBytes.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function semanticDigest(value: unknown): Promise<SemanticDigest> {
  return (await sha256Hex(canonicalUtf8(value))) as SemanticDigest;
}

export async function binaryDigest(bytes: Uint8Array): Promise<BinaryDigest> {
  return (await sha256Hex(bytes)) as BinaryDigest;
}

export function isSha256LowerHex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export async function semanticId(prefix: string, projection: unknown): Promise<string> {
  if (!/^[a-z][a-z0-9-]*$/.test(prefix)) throw new RangeError("semantic ID prefix is invalid");
  return `${prefix}:${await semanticDigest(projection)}`;
}
