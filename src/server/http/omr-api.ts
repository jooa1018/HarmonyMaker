import "server-only";

import type { NextRequest } from "next/server";

import type { OmrJobHandle } from "../../domain/omr/contracts";
import type { SemanticDigest } from "../../domain/digest/canonical";
import type { InputSourceKind } from "../../domain/omr/input";
import type { RightsBasis, RightsMetadata } from "../../domain/source/model";
import { getProductionServices } from "../substrate/services";
import { SESSION_COOKIE_NAME } from "../security/session";
import { getProductionOmrApplicationService } from "../omr/production-service";
import { authorizeMutation } from "./api";
import { readBoundedStructuredJson } from "./bounded-json";

const RIGHTS_BASES: readonly RightsBasis[] = ["self-authored", "public-domain", "licensed", "user-confirmed-rights"];
const SOURCE_KINDS: readonly InputSourceKind[] = ["digital-pdf", "scanned-pdf", "camera-photo"];

export async function readBoundedJson(request: NextRequest, maxBytes = 64 * 1024): Promise<unknown> {
  return readBoundedStructuredJson(request, {
    maxBytes,
    invalidCode: "OMR_REQUEST_INVALID",
    tooLargeCode: "OMR_REQUEST_TOO_LARGE",
  });
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")?.trim()
    ?? "0.0.0.0";
}

export async function authorizeOmr(request: NextRequest, mutation: boolean) {
  const authorized = mutation
    ? await authorizeMutation(request)
    : await (async () => {
      const services = await getProductionServices();
      const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
      if (!token) throw new RangeError("OMR_JOB_UNAVAILABLE");
      return { services, record: await services.sessions.verify(token) };
    })();
  return {
    record: authorized.record,
    application: await getProductionOmrApplicationService({ sessionId: authorized.record.id, clientIp: clientIp(request) }),
  };
}

export function omrHandle(value: string): OmrJobHandle {
  return value as OmrJobHandle;
}

function parseRights(value: unknown): RightsMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("OMR_REQUEST_INVALID");
  const record = value as Record<string, unknown>;
  if (!RIGHTS_BASES.includes(record.basis as RightsBasis) || !Array.isArray(record.allowedUses)
    || !record.allowedUses.every((item) => ["generation", "evaluation", "share", "provider-transfer"].includes(String(item)))) throw new RangeError("OMR_REQUEST_INVALID");
  return {
    basis: record.basis as RightsBasis, allowedUses: record.allowedUses as RightsMetadata["allowedUses"],
    ...(typeof record.sourceReference === "string" ? { sourceReference: record.sourceReference } : {}),
    ...(typeof record.licenseNote === "string" ? { licenseNote: record.licenseNote } : {}),
    ...(typeof record.confirmedAt === "string" ? { confirmedAt: record.confirmedAt } : {}),
  };
}

export function parseCreateJobBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("OMR_REQUEST_INVALID");
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.pageCount) || !SOURCE_KINDS.includes(record.sourceKind as InputSourceKind)
    || !Array.isArray(record.pages) || record.pages.length !== record.pageCount
    || record.pages.some((page, index) => !page || typeof page !== "object" || Array.isArray(page)
      || (page as Record<string, unknown>).pageIndex !== index
      || typeof (page as Record<string, unknown>).pageDigest !== "string"
      || !/^[0-9a-f]{64}$/u.test((page as Record<string, unknown>).pageDigest as string)
      || !["image/png", "image/jpeg"].includes(String((page as Record<string, unknown>).mimeType)))
    || record.providerTransferConsent !== true || typeof record.idempotencyKey !== "string"
    || record.idempotencyKey.length < 1 || record.idempotencyKey.length > 256
    || typeof record.consentCapabilitySnapshotDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(record.consentCapabilitySnapshotDigest)) throw new RangeError("OMR_REQUEST_INVALID");
  return {
    pageCount: record.pageCount as number,
    pages: (record.pages as Array<Record<string, unknown>>).map((page) => ({ pageIndex: page.pageIndex as number, pageDigest: page.pageDigest as import("../../domain/digest/canonical").BinaryDigest, mimeType: page.mimeType as "image/png" | "image/jpeg" })),
    sourceKind: record.sourceKind as Extract<InputSourceKind, "digital-pdf" | "scanned-pdf" | "camera-photo">,
    rights: parseRights(record.rights), providerTransferConsent: true as const,
    consentCapabilitySnapshotDigest: record.consentCapabilitySnapshotDigest as SemanticDigest,
    idempotencyKey: record.idempotencyKey,
  };
}

export function parseVendorInputBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("OMR_REQUEST_INVALID");
  const record = value as Record<string, unknown>;
  if (typeof record.requestId !== "string" || record.requestId.length < 1 || record.requestId.length > 128) throw new RangeError("OMR_REQUEST_INVALID");
  if (record.kind === "select-instrument" && typeof record.choice === "string") return { kind: record.kind, requestId: record.requestId, choice: record.choice } as const;
  if (record.kind === "confirm-page-order" && Array.isArray(record.pageIndices) && record.pageIndices.every(Number.isSafeInteger)) return { kind: record.kind, requestId: record.requestId, pageIndices: record.pageIndices as number[] } as const;
  if (record.kind === "vendor-specific" && typeof record.schemaId === "string" && record.schemaId.length > 0 && record.schemaId.length <= 128
    && record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)) {
    const payload = record.payload as Readonly<Record<string, unknown>>;
    if (Object.keys(payload).length > 32 || JSON.stringify(payload).length > 8_192
      || Object.entries(payload).some(([key, item]) => key.length < 1 || key.length > 128
        || !["string", "number", "boolean"].includes(typeof item)
        || (typeof item === "string" && item.length > 8_192)
        || (typeof item === "number" && !Number.isFinite(item)))) throw new RangeError("OMR_REQUEST_INVALID");
    return { kind: record.kind, requestId: record.requestId, schemaId: record.schemaId, payload: payload as Readonly<Record<string, string | number | boolean>> } as const;
  }
  throw new RangeError("OMR_REQUEST_INVALID");
}
