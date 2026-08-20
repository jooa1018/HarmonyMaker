import "server-only";

import type { NextRequest } from "next/server";

import type { AbuseReportResolution, AbuseReportStatus, PrivateRowId } from "../persistence/store";
import { timingSafeHashEquals } from "../security/crypto-core";
import { readBoundedStructuredJson } from "./bounded-json";

export function internalBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function authorizeInternalRequest(request: Request, environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = environment.INTERNAL_OPERATIONS_KEY;
  const supplied = internalBearer(request);
  if (!configured || !/^[A-Za-z0-9_-]+$/u.test(configured)) throw new RangeError("INTERNAL_AUTHORITY_INVALID");
  const bytes = Buffer.from(configured, "base64url");
  if (bytes.byteLength < 32 || bytes.toString("base64url") !== configured || !timingSafeHashEquals(configured, supplied)) {
    throw new RangeError("INTERNAL_AUTHORITY_INVALID");
  }
  return supplied;
}

export function moderationReportId(value: string): PrivateRowId {
  if (!/^[1-9][0-9]{0,18}$/u.test(value)) throw new RangeError("MODERATION_REQUEST_INVALID");
  return value as PrivateRowId;
}

export function moderationStatus(value: string | null): AbuseReportStatus | undefined {
  if (value === null) return undefined;
  if (value !== "pending" && value !== "claimed" && value !== "resolved") throw new RangeError("MODERATION_REQUEST_INVALID");
  return value;
}

export async function readInternalJson(request: NextRequest): Promise<unknown> {
  return readBoundedStructuredJson(request, { maxBytes: 8 * 1024, invalidCode: "MODERATION_REQUEST_INVALID", tooLargeCode: "MODERATION_REQUEST_TOO_LARGE" });
}

export function parseModerationClaim(value: unknown): { readonly moderatorId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("MODERATION_REQUEST_INVALID");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.moderatorId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{1,127}$/u.test(record.moderatorId)) throw new RangeError("MODERATION_REQUEST_INVALID");
  return { moderatorId: record.moderatorId };
}

export function parseModerationResolution(value: unknown): { readonly claimToken: string; readonly resolution: AbuseReportResolution } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("MODERATION_REQUEST_INVALID");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.claimToken !== "string"
    || (record.resolution !== "dismissed" && record.resolution !== "takedown")) throw new RangeError("MODERATION_REQUEST_INVALID");
  return { claimToken: record.claimToken, resolution: record.resolution };
}
