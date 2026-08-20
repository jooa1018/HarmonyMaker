import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { binaryDigest } from "../../domain/digest/canonical";
import { OmrVendorCallError } from "../../domain/omr/contracts";
import { AudiverisHttpOmrAdapter } from "./audiveris-http-adapter";

const apiKey = "provider-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const jobId = "12345678-1234-4123-8123-123456789abc";
const pageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function adapter(): AudiverisHttpOmrAdapter {
  return new AudiverisHttpOmrAdapter({ baseUrl: "https://provider.example.test", apiKey, requestTimeoutMs: 5_000 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Audiveris HTTP OMR adapter", () => {
  it("executes the provider contract and derives canonical page evidence/mapping", async () => {
    const pageDigest = await binaryDigest(pageBytes);
    const calls: RequestInfo[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(input as RequestInfo);
      const url = String(input);
      if (url.endsWith("/v1/capabilities")) return json({
        vendorId: "audiveris",
        vendorDisplayName: "Audiveris 5.10.2 self-hosted",
        supportedMimeTypes: ["image/png"],
        transferMimeType: "image/png",
        maxPages: 12,
        evidenceGranularity: "page",
        supportsDeletion: true,
        retentionDisclosure: true,
        supportsIdempotency: false,
        supportsInteractiveInput: false,
        canDeleteImmediately: true,
        retentionPolicyReference: "self-hosted:3600s:ephemeral",
        externalTransfer: true,
        estimatedCreditPerPage: 1,
      });
      if (url.endsWith("/v1/jobs") && init?.method === "POST") return json({ jobId });
      if (url.includes("/pages/0") && init?.method === "PUT") return new Response(null, { status: 204 });
      if (url.endsWith("/start")) return new Response(null, { status: 202 });
      if (url.endsWith("/status")) return json({ kind: "processing", progressBp: 5000 });
      if (url.endsWith("/result")) return new Response("<?xml version=\"1.0\"?><score-partwise version=\"4.0\"></score-partwise>");
      if (url.endsWith("/metadata")) return json({ pages: [{ pageIndex: 0, pageDigest, widthPixels: 100, heightPixels: 200 }] });
      if (url.endsWith("/retention")) return json({ vendorDeletesAt: "2026-08-20T10:00:00Z", canDeleteImmediately: true, policyReference: "self-hosted" });
      if (url.endsWith(`/${jobId}`) && init?.method === "DELETE") return json({ status: "deleted" });
      if (url.endsWith("/cancel")) return new Response(null, { status: 204 });
      throw new Error(`unexpected URL ${url}`);
    }));

    const subject = adapter();
    expect((await subject.getCapabilities()).vendorId).toBe("audiveris");
    expect(await subject.createVendorJob({ pageCount: 1, idempotencyKey: "create-key-xxxxxxxx" })).toBe(jobId);
    await subject.uploadPage(jobId as never, {
      pageIndex: 0,
      pageDigest,
      mimeType: "image/png",
      idempotencyKey: "upload-key-xxxxxxxx",
      bytes: new Blob([pageBytes], { type: "image/png" }),
    });
    await subject.startVendorJob(jobId as never, { idempotencyKey: "start-key-xxxxxxxx" });
    expect(await subject.getVendorStatus(jobId as never)).toEqual({ kind: "processing", progressBp: 5000 });
    const evidence = await subject.getEvidence(jobId as never);
    expect(evidence).toMatchObject({
      granularity: "page",
      frames: [{ pageIndex: 0, imageDigest: pageDigest, widthPixels: 100, heightPixels: 200 }],
      evidence: [{ granularity: "page", vendorId: "audiveris" }],
    });
    expect(evidence.providerBundleDigest).toMatch(/^[0-9a-f]{64}$/u);
    const mapping = await subject.getNormalizationMapping(jobId as never);
    expect(mapping.mappings).toEqual([]);
    expect(mapping.vendorResultDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(await subject.getRetentionInfo(jobId as never)).toMatchObject({ canDeleteImmediately: true, policyReference: "self-hosted" });
    expect(await subject.deleteVendorJob(jobId as never, { idempotencyKey: "delete-key-xxxxxxxx" })).toEqual({ status: "deleted" });
    await subject.cancelVendorJob(jobId as never, { idempotencyKey: "cancel-key-xxxxxxxx" });
    expect(calls.length).toBeGreaterThan(5);
  });

  it("classifies create transport ambiguity and deterministic provider rejection", async () => {
    const subject = adapter();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("socket closed")));
    await expect(subject.createVendorJob({ pageCount: 1, idempotencyKey: "create-key-xxxxxxxx" }))
      .rejects.toMatchObject({ outcome: "outcome-uncertain" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ detail: "invalid request" }, 422)));
    try {
      await subject.createVendorJob({ pageCount: 1, idempotencyKey: "create-key-xxxxxxxx" });
      throw new Error("expected create rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(OmrVendorCallError);
      expect((error as OmrVendorCallError).outcome).toBe("definitive-rejection");
    }
  });

  it("fails closed on malformed provider status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ kind: "processing", progressBp: 50_000 })));
    await expect(adapter().getVendorStatus(jobId as never)).rejects.toThrow("OMR_PROVIDER_CONTRACT_INVALID");
  });
});
