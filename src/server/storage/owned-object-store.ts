import type { BinaryDigest } from "../../domain/digest/canonical";
import type { ObjectReferenceRecord, PrivateRowId } from "../persistence/store";

export interface OwnedObjectPut {
  readonly ownerSessionId: PrivateRowId;
  /** Stable logical identity; one generation retries its exact physical key while newer generations use isolated keys. */
  readonly publicationId: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly expiresAt?: string;
}
export interface OwnedObjectRead {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly binaryDigest: BinaryDigest;
}
export interface OwnedObjectStore {
  put(input: OwnedObjectPut): Promise<ObjectReferenceRecord>;
  get(referenceId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<OwnedObjectRead>;
  head(referenceId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<Omit<OwnedObjectRead, "bytes"> & { readonly byteSize: number; readonly expiresAt?: string }>;
  /** Governance cleanup may reconcile old physical generations while preserving an active current generation. */
  cleanup?(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now?: Date): Promise<void>;
  delete(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now?: Date): Promise<void>;
}
