import type { BinaryDigest } from "../../domain/digest/canonical";
import type { ObjectReferenceRecord, PrivateRowId } from "../persistence/store";

export interface OwnedObjectPut {
  readonly ownerSessionId: PrivateRowId;
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
  delete(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now?: Date): Promise<void>;
}
