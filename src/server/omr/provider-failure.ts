import { OmrVendorCallError } from "../../domain/omr/contracts";

export type OmrProviderFailureClass =
  | "vendor-terminal"
  | "contract-integrity"
  | "transient-provider"
  | "transient-local"
  | "binding-unavailable";

export interface OmrProviderFailureClassification {
  readonly failureClass: OmrProviderFailureClass;
  readonly code: string;
}

export type OmrProviderFailureOrigin = "provider" | "local";

const CONTRACT_INTEGRITY_CODES = new Set([
  "OMR_PROVIDER_CAPABILITY_MISSING",
  "OMR_PROVIDER_CONTRACT_INVALID",
  "OMR_RESULT_INTEGRITY_FAILED",
  "OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED",
  "OMR_EVIDENCE_TARGET_UNMAPPED",
]);

function normalizedContractCode(message: string): string | undefined {
  if (CONTRACT_INTEGRITY_CODES.has(message)) return message;
  if (message.startsWith("OMR_EVIDENCE_CODEC_FAILED:")) return "OMR_EVIDENCE_CODEC_FAILED";
  return undefined;
}

export class OmrProviderContractError extends RangeError {
  constructor(readonly code: string, readonly originalError?: unknown) {
    super(code);
    this.name = "OmrProviderContractError";
  }
}

export function classifyOmrProviderFailure(
  error: unknown,
  origin: OmrProviderFailureOrigin,
): OmrProviderFailureClassification {
  if (error instanceof OmrProviderContractError) {
    return { failureClass: "contract-integrity", code: error.code };
  }
  if (error instanceof RangeError) {
    if (error.message === "OMR_PROVIDER_BINDING_UNAVAILABLE") {
      return { failureClass: "binding-unavailable", code: error.message };
    }
    const contractCode = normalizedContractCode(error.message);
    if (contractCode) return { failureClass: "contract-integrity", code: contractCode };
  }
  if (error instanceof OmrVendorCallError && error.outcome === "definitive-rejection") {
    return { failureClass: "vendor-terminal", code: "OMR_VENDOR_OPERATION_FAILED" };
  }
  return origin === "local"
    ? { failureClass: "transient-local", code: "OMR_LOCAL_STORAGE_TRANSIENT" }
    : { failureClass: "transient-provider", code: "OMR_VENDOR_OPERATION_FAILED" };
}

export function asOmrProviderContractError(
  error: unknown,
  fallbackCode = "OMR_PROVIDER_CONTRACT_INVALID",
): OmrProviderContractError {
  const classified = classifyOmrProviderFailure(error, "provider");
  return classified.failureClass === "contract-integrity"
    ? new OmrProviderContractError(classified.code, error)
    : new OmrProviderContractError(fallbackCode, error);
}
