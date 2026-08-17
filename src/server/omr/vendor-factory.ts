import "server-only";

import type { OmrVendorAdapter } from "../../domain/omr/contracts";

export type OmrProviderMode = "unconfigured" | "reference" | "real";

export function createOmrVendorAdapter(input: {
  readonly mode: OmrProviderMode;
  readonly nodeEnvironment: string | undefined;
  readonly referenceAdapter?: OmrVendorAdapter;
  readonly realAdapter?: OmrVendorAdapter;
}): OmrVendorAdapter {
  if (input.mode === "reference") {
    if (input.nodeEnvironment === "production" || !input.referenceAdapter) throw new RangeError("OMR_REFERENCE_PROVIDER_PROHIBITED");
    return input.referenceAdapter;
  }
  if (input.mode === "real") {
    if (!input.realAdapter) throw new RangeError("OMR_PROVIDER_UNCONFIGURED");
    return input.realAdapter;
  }
  throw new RangeError("OMR_PROVIDER_UNCONFIGURED");
}
