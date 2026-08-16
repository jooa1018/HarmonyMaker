import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";

import { semanticDigest, type SemanticDigest } from "../../domain/digest/canonical";
import { decodePracticeShare, encodePracticeShare, isPracticeSharePayload, type PracticeSharePayload } from "../../domain/share";
import type { RightsBasis } from "../../domain/source/model";
import type { GovernanceStore, PrivateRowId } from "../persistence/store";
import { decryptAeadV1, encryptAeadV1, generateOpaqueToken, keyedTokenHash, timingSafeHashEquals } from "../security/crypto-core";

export const SHARE_DEFAULT_TTL_DAYS = 180;
export const SHARE_MAX_PLAINTEXT_BYTES = 256 * 1024;
export const URL_SHARE_MAX_ENCODED_BYTES = 6000;
const SHARE_UNAVAILABLE = "SHARE_UNAVAILABLE";

export type ShareCreationChoice =
  | { readonly kind: "url"; readonly fragment: string; readonly payloadDigest: SemanticDigest }
  | { readonly kind: "store"; readonly token: string; readonly ownerDeleteSecret: string; readonly payloadDigest: SemanticDigest; readonly expiresAt: string };

function payloadBytes(payload: PracticeSharePayload): Uint8Array { return strToU8(encodePracticeShare(payload)); }

export function encodeUrlShare(payload: PracticeSharePayload): string {
  const compressed = gzipSync(payloadBytes(payload), { level: 9 });
  return Buffer.from(compressed).toString("base64url");
}
export function decodeUrlShare(encoded: string): PracticeSharePayload {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new RangeError("SHARE_PAYLOAD_INVALID");
  try { return decodePracticeShare(strFromU8(gunzipSync(Buffer.from(encoded, "base64url")))); }
  catch { throw new RangeError("SHARE_PAYLOAD_INVALID"); }
}

export class ShareStoreService {
  constructor(
    private readonly store: GovernanceStore,
    private readonly encryptionKey: Uint8Array,
    private readonly tokenHashKey: Uint8Array,
    private readonly deleteHashKey: Uint8Array,
    private readonly internalOperationsKey: Uint8Array,
  ) {}

  private tokenHash(token: string): string { return keyedTokenHash(token, this.tokenHashKey, "share-token-v1"); }
  private deleteVerifier(secret: string): string { return keyedTokenHash(secret, this.deleteHashKey, "share-owner-delete-v1"); }

  async create(input: { readonly ownerSessionId: PrivateRowId; readonly payload: PracticeSharePayload; readonly rightsBasis: RightsBasis; readonly now?: Date; readonly forceStore?: boolean }): Promise<ShareCreationChoice> {
    if (!isPracticeSharePayload(input.payload) || input.payload.rightsShareConfirmed !== true) throw new RangeError("SHARE_RIGHTS_REQUIRED");
    const encodedUrl = encodeUrlShare(input.payload);
    const decoded = decodeUrlShare(encodedUrl);
    if (encodePracticeShare(decoded) !== encodePracticeShare(input.payload)) throw new RangeError("SHARE_ROUNDTRIP_FAILED");
    const payloadDigest = await semanticDigest(input.payload);
    if (!input.forceStore && Buffer.byteLength(encodedUrl, "utf8") <= URL_SHARE_MAX_ENCODED_BYTES) {
      return { kind: "url", fragment: encodedUrl, payloadDigest };
    }
    const plaintext = payloadBytes(input.payload);
    if (plaintext.byteLength > SHARE_MAX_PLAINTEXT_BYTES) throw new RangeError("SHARE_PAYLOAD_TOO_LARGE");
    const token = generateOpaqueToken();
    const ownerDeleteSecret = generateOpaqueToken();
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + SHARE_DEFAULT_TTL_DAYS * 86_400_000).toISOString();
    await this.store.createShare({
      ownerSessionId: input.ownerSessionId,
      tokenHash: this.tokenHash(token),
      deleteSecretVerifier: this.deleteVerifier(ownerDeleteSecret),
      payloadDigest,
      encryptedPayload: encryptAeadV1(plaintext, this.encryptionKey, { associatedDataVersion: "practice-share-v3" }),
      plaintextSize: plaintext.byteLength,
      rightsBasis: input.rightsBasis,
      lifecycle: "active",
      createdAt: now.toISOString(),
      expiresAt,
    });
    return { kind: "store", token, ownerDeleteSecret, payloadDigest, expiresAt };
  }

  async read(token: string, now = new Date()): Promise<PracticeSharePayload> {
    const record = await this.store.findShareByTokenHash(this.tokenHash(token));
    if (!record || record.lifecycle !== "active" || record.expiresAt <= now.toISOString()) throw new RangeError(SHARE_UNAVAILABLE);
    try {
      const plaintext = decryptAeadV1(record.encryptedPayload, this.encryptionKey);
      if (plaintext.byteLength !== record.plaintextSize) throw new Error("size");
      const payload = decodePracticeShare(strFromU8(plaintext));
      if (!timingSafeHashEquals(await semanticDigest(payload), record.payloadDigest)) throw new Error("digest");
      return payload;
    } catch { throw new RangeError(SHARE_UNAVAILABLE); }
  }

  async ownerDelete(token: string, ownerDeleteSecret: string, now = new Date()): Promise<void> {
    const record = await this.store.findShareByTokenHash(this.tokenHash(token));
    const supplied = this.deleteVerifier(ownerDeleteSecret);
    if (!record || !timingSafeHashEquals(record.deleteSecretVerifier, supplied)) throw new RangeError(SHARE_UNAVAILABLE);
    await this.store.transitionShare({ id: record.id, lifecycle: "deleted", at: now.toISOString() });
    await this.store.createAudit({ eventKind: "share-owner-delete", shareRecordId: record.id, outcome: "accepted", createdAt: now.toISOString() });
  }

  async report(input: { readonly token: string; readonly reporterSessionId?: PrivateRowId; readonly category: string; readonly detail?: string; readonly now?: Date }): Promise<{ readonly accepted: true }> {
    if (!/^[a-z][a-z0-9-]{1,31}$/u.test(input.category) || (input.detail?.length ?? 0) > 500) throw new RangeError("ABUSE_REPORT_INVALID");
    const record = await this.store.findShareByTokenHash(this.tokenHash(input.token));
    await this.store.createAbuseReport({
      reporterSessionId: input.reporterSessionId,
      ...(record ? { shareRecordId: record.id } : {}),
      opaqueReferenceHash: this.tokenHash(input.token), category: input.category,
      ...(input.detail ? { detail: input.detail } : {}), createdAt: (input.now ?? new Date()).toISOString(),
    });
    return { accepted: true };
  }

  async takedown(input: { readonly token: string; readonly authorization: string; readonly now?: Date }): Promise<void> {
    const expected = Buffer.from(this.internalOperationsKey).toString("base64url");
    if (!timingSafeHashEquals(expected, input.authorization)) throw new RangeError("INTERNAL_AUTHORITY_INVALID");
    const record = await this.store.findShareByTokenHash(this.tokenHash(input.token));
    if (!record) return;
    const now = input.now ?? new Date();
    await this.store.transitionShare({ id: record.id, lifecycle: "disabled", at: now.toISOString() });
    await this.store.createAudit({ eventKind: "share-takedown", shareRecordId: record.id, outcome: "accepted", createdAt: now.toISOString() });
  }
}

export async function chooseShareTransport(input: Parameters<ShareStoreService["create"]>[0], service: ShareStoreService): Promise<ShareCreationChoice> {
  return service.create(input);
}
