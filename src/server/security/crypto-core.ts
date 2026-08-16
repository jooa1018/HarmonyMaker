import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const AEAD_ENVELOPE_VERSION = 1 as const;
export const AEAD_ALGORITHM = "aes-256-gcm" as const;
export const AEAD_NONCE_BYTES = 12;
export const OPAQUE_TOKEN_BYTES = 32;

export interface AeadEnvelopeV1 {
  readonly version: 1;
  readonly algorithm: "aes-256-gcm";
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authenticationTag: string;
  readonly associatedDataVersion?: string;
}

function requireKey(key: Uint8Array): Buffer {
  if (key.byteLength !== 32) throw new RangeError("AEAD_KEY_LENGTH_INVALID");
  return Buffer.from(key);
}

function decodeBase64Url(value: string, code: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new RangeError(code);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new RangeError(code);
  return decoded;
}

export function encryptAeadV1(
  plaintext: Uint8Array,
  key: Uint8Array,
  options: {
    readonly nonce?: Uint8Array;
    readonly associatedDataVersion?: string;
  } = {},
): AeadEnvelopeV1 {
  const nonce = options.nonce ? Buffer.from(options.nonce) : randomBytes(AEAD_NONCE_BYTES);
  if (nonce.byteLength !== AEAD_NONCE_BYTES) throw new RangeError("AEAD_NONCE_LENGTH_INVALID");
  const cipher = createCipheriv(AEAD_ALGORITHM, requireKey(key), nonce);
  if (options.associatedDataVersion) {
    cipher.setAAD(Buffer.from(options.associatedDataVersion, "utf8"));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Object.freeze({
    version: AEAD_ENVELOPE_VERSION,
    algorithm: AEAD_ALGORITHM,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
    ...(options.associatedDataVersion
      ? { associatedDataVersion: options.associatedDataVersion }
      : {}),
  });
}

export function decryptAeadV1(envelope: AeadEnvelopeV1, key: Uint8Array): Uint8Array {
  if (envelope.version !== AEAD_ENVELOPE_VERSION || envelope.algorithm !== AEAD_ALGORITHM) {
    throw new RangeError("AEAD_ENVELOPE_VERSION_UNSUPPORTED");
  }
  const nonce = decodeBase64Url(envelope.nonce, "AEAD_ENVELOPE_MALFORMED");
  const tag = decodeBase64Url(envelope.authenticationTag, "AEAD_ENVELOPE_MALFORMED");
  const ciphertext = decodeBase64Url(envelope.ciphertext, "AEAD_ENVELOPE_MALFORMED");
  if (nonce.byteLength !== AEAD_NONCE_BYTES || tag.byteLength !== 16) {
    throw new RangeError("AEAD_ENVELOPE_MALFORMED");
  }
  try {
    const decipher = createDecipheriv(AEAD_ALGORITHM, requireKey(key), nonce);
    if (envelope.associatedDataVersion) {
      decipher.setAAD(Buffer.from(envelope.associatedDataVersion, "utf8"));
    }
    decipher.setAuthTag(tag);
    return Uint8Array.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    throw new RangeError("AEAD_AUTHENTICATION_FAILED");
  }
}

export function generateOpaqueToken(bytes = OPAQUE_TOKEN_BYTES): string {
  if (!Number.isSafeInteger(bytes) || bytes < 16) throw new RangeError("TOKEN_ENTROPY_TOO_LOW");
  return randomBytes(bytes).toString("base64url");
}

export function keyedTokenHash(token: string, key: Uint8Array, purpose: string): string {
  if (key.byteLength < 32) throw new RangeError("HMAC_KEY_LENGTH_INVALID");
  if (!purpose) throw new RangeError("HMAC_PURPOSE_REQUIRED");
  return createHmac("sha256", Buffer.from(key))
    .update(purpose, "utf8")
    .update("\0", "utf8")
    .update(token, "utf8")
    .digest("hex");
}

export function timingSafeHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
