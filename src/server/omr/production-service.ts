import "server-only";

import type { PrivateRowId } from "../persistence/store";
import { getProductionServices } from "../substrate/services";
import { loadProductionOmrConfig } from "../substrate/config";
import { decodeOmrImagePage } from "./page-decoder";
import { DurableOmrApplicationService, omrQuotaConfig } from "./application-service";
import { ReferenceOmrVendorAdapter } from "./reference-adapter";
import { REFERENCE_OMR_FIXTURES } from "./reference-fixtures";
import { createOmrVendorAdapter } from "./vendor-factory";

let referenceAdapter: ReferenceOmrVendorAdapter | undefined;

export async function getProductionOmrApplicationService(input: {
  readonly sessionId: PrivateRowId;
  readonly clientIp: string;
}): Promise<DurableOmrApplicationService> {
  const [services, config] = await Promise.all([getProductionServices(), Promise.resolve(loadProductionOmrConfig())]);
  if (!referenceAdapter && config.providerMode === "reference") referenceAdapter = new ReferenceOmrVendorAdapter(REFERENCE_OMR_FIXTURES, {
    vendorId: "hm-reference", supportedMimeTypes: ["image/png"], maxPages: 12, evidenceGranularity: "measure",
    supportsDeletion: true, retentionDisclosure: true, supportsIdempotency: true, supportsInteractiveInput: true, estimatedCreditPerPage: 1,
  });
  const adapter = createOmrVendorAdapter({
    mode: config.providerMode,
    nodeEnvironment: process.env.NODE_ENV,
    ...(referenceAdapter ? { referenceAdapter } : {}),
  });
  return new DurableOmrApplicationService({
    store: services.omrStore, objects: services.objects, adapter,
    handleHmacKey: config.handleHmacKey, vendorJobEncryptionKey: config.vendorJobEncryptionKey,
    quota: omrQuotaConfig(config.dailyGlobalCreditCeiling),
    actor: { sessionId: input.sessionId, ipOwnerHash: services.quota.ipHash(input.clientIp) },
    inspectPage: async ({ bytes, mimeType, pageIndex }) => {
      if (mimeType !== "image/png" && mimeType !== "image/jpeg") throw new RangeError("OMR_INPUT_FORMAT_UNSUPPORTED");
      const decoded = await decodeOmrImagePage({ bytes, declaredMimeType: mimeType, pageIndex });
      return { bytes: decoded.bytes, digest: decoded.pageDigest, mimeType: decoded.mimeType, width: decoded.width, height: decoded.height, quality: decoded.quality };
    },
  });
}
