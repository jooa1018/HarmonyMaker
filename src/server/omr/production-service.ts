import "server-only";

import { semanticDigest } from "../../domain/digest/canonical";
import { OMR_VENDOR_ADAPTER_CONTRACT_VERSION, type OmrQuotaConfig, type OmrVendorAdapter } from "../../domain/omr/contracts";
import type { PrivateRowId } from "../persistence/store";
import type { OwnedObjectStore } from "../storage/owned-object-store";
import { getProductionServices } from "../substrate/services";
import { loadProductionOmrConfig, type ProductionOmrConfig } from "../substrate/config";
import { decodeOmrImagePage } from "./page-decoder";
import { DurableOmrApplicationService, omrQuotaConfig, type OmrApplicationActor, type OmrPageInspection } from "./application-service";
import { withCrossSessionOmrCreateRecovery, type OmrCreateRecoveryRegistry } from "./cross-session-create-recovery";
import { ReferenceOmrVendorAdapter } from "./reference-adapter";
import { REFERENCE_OMR_FIXTURES } from "./reference-fixtures";
import { createOmrVendorAdapter } from "./vendor-factory";
import type { OmrStore } from "./store";

let referenceAdapter: ReferenceOmrVendorAdapter | undefined;

export interface ProductionOmrProviderRegistration {
  readonly providerId: string;
  /** Stable, non-secret provider configuration generation or configuration digest. */
  readonly configurationGeneration: string;
  readonly adapterContractVersion: string;
  readonly adapter: OmrVendorAdapter;
}

export interface ProductionOmrProviderBinding extends ProductionOmrProviderRegistration {
  readonly bindingId: string;
}

export interface ProductionOmrProviderRegistry {
  readonly active: ProductionOmrProviderBinding;
  readonly available: readonly ProductionOmrProviderBinding[];
  resolveAdapter(providerBindingId: string, adapterContractVersion: string, vendorId: string): OmrVendorAdapter | undefined;
}

async function materializeProviderBinding(registration: ProductionOmrProviderRegistration): Promise<ProductionOmrProviderBinding> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/u.test(registration.providerId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(registration.configurationGeneration)
    || registration.adapterContractVersion.length < 1 || registration.adapterContractVersion.length > 128) {
    throw new RangeError("OMR_PROVIDER_BINDING_INVALID");
  }
  const digest = await semanticDigest({
    projectionSchema: "hm-production-omr-provider-binding-v1",
    providerId: registration.providerId,
    configurationGeneration: registration.configurationGeneration,
    adapterContractVersion: registration.adapterContractVersion,
  });
  return Object.freeze({
    ...registration,
    bindingId: `omr-provider:${registration.providerId}:${digest.slice(0, 32)}`,
  });
}

export async function createProductionOmrProviderRegistry(input: {
  readonly active: ProductionOmrProviderRegistration;
  readonly historical?: readonly ProductionOmrProviderRegistration[];
}): Promise<ProductionOmrProviderRegistry> {
  const registrations = [input.active, ...(input.historical ?? [])];
  const available = await Promise.all(registrations.map(materializeProviderBinding));
  const byBindingId = new Map<string, ProductionOmrProviderBinding>();
  for (const binding of available) {
    if (byBindingId.has(binding.bindingId)) throw new RangeError("OMR_PROVIDER_BINDING_INVALID");
    byBindingId.set(binding.bindingId, binding);
  }
  const active = available[0];
  return Object.freeze({
    active,
    available: Object.freeze([...available]),
    resolveAdapter(providerBindingId: string, adapterContractVersion: string, vendorId: string) {
      const binding = byBindingId.get(providerBindingId);
      return binding?.adapterContractVersion === adapterContractVersion && binding.providerId === vendorId
        ? binding.adapter
        : undefined;
    },
  });
}

export function createProductionOmrApplicationService(input: {
  readonly store: OmrStore;
  readonly createRecoveryRegistry?: OmrCreateRecoveryRegistry;
  readonly objects: OwnedObjectStore;
  readonly providers: ProductionOmrProviderRegistry;
  readonly handleHmacKey: Uint8Array;
  readonly vendorJobEncryptionKey: Uint8Array;
  readonly quota: OmrQuotaConfig;
  readonly actor: OmrApplicationActor;
  readonly inspectPage: (input: { readonly bytes: Uint8Array; readonly mimeType: string; readonly pageIndex: number }) => Promise<OmrPageInspection>;
  readonly now?: () => Date;
}): DurableOmrApplicationService {
  const active = input.providers.active;
  const store = input.createRecoveryRegistry
    ? withCrossSessionOmrCreateRecovery(input.store, input.createRecoveryRegistry)
    : input.store;
  return new DurableOmrApplicationService({
    store,
    objects: input.objects,
    adapter: active.adapter,
    providerBindingId: active.bindingId,
    providerVendorId: active.providerId,
    adapterContractVersion: active.adapterContractVersion,
    resolveAdapter: (bindingId, contractVersion, vendorId) => input.providers.resolveAdapter(bindingId, contractVersion, vendorId),
    handleHmacKey: input.handleHmacKey,
    vendorJobEncryptionKey: input.vendorJobEncryptionKey,
    quota: input.quota,
    actor: input.actor,
    inspectPage: input.inspectPage,
    ...(input.now ? { now: input.now } : {}),
  });
}

async function defaultProviderRegistry(config: ProductionOmrConfig): Promise<ProductionOmrProviderRegistry> {
  if (!referenceAdapter && config.providerMode === "reference") referenceAdapter = new ReferenceOmrVendorAdapter(REFERENCE_OMR_FIXTURES, {
    vendorId: "hm-reference", supportedMimeTypes: ["image/png", "image/jpeg"], maxPages: 12, evidenceGranularity: "measure",
    supportsDeletion: true, retentionDisclosure: true, supportsIdempotency: true, supportsInteractiveInput: true, estimatedCreditPerPage: 1,
  });
  const adapter = createOmrVendorAdapter({
    mode: config.providerMode,
    nodeEnvironment: process.env.NODE_ENV,
    ...(referenceAdapter ? { referenceAdapter } : {}),
  });
  if (config.providerMode !== "reference") throw new RangeError("OMR_PROVIDER_UNCONFIGURED");
  return createProductionOmrProviderRegistry({
    active: {
      providerId: "hm-reference",
      configurationGeneration: "reference-fixtures-v1",
      adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION,
      adapter,
    },
  });
}

export async function getProductionOmrApplicationService(input: {
  readonly sessionId: PrivateRowId;
  readonly clientIp: string;
}): Promise<DurableOmrApplicationService> {
  const [services, config] = await Promise.all([getProductionServices(), Promise.resolve(loadProductionOmrConfig())]);
  const providers = await defaultProviderRegistry(config);
  return createProductionOmrApplicationService({
    store: services.omrStore, createRecoveryRegistry: services.omrCreateRecovery,
    objects: services.objects, providers,
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

/** Scheduler-only composition. It can reclaim local/current rows without inventing a real provider adapter. */
export async function getProductionOmrCleanupApplicationService(): Promise<DurableOmrApplicationService> {
  const [services, config] = await Promise.all([getProductionServices(), Promise.resolve(loadProductionOmrConfig())]);
  if (config.providerMode === "reference") {
    const providers = await defaultProviderRegistry(config);
    return createProductionOmrApplicationService({
      store: services.omrStore, createRecoveryRegistry: services.omrCreateRecovery,
      objects: services.objects, providers,
      handleHmacKey: config.handleHmacKey, vendorJobEncryptionKey: config.vendorJobEncryptionKey,
      quota: omrQuotaConfig(config.dailyGlobalCreditCeiling),
      actor: { sessionId: "0" as PrivateRowId, ipOwnerHash: services.quota.ipHash("scheduled-cleanup") },
      inspectPage: async () => { throw new RangeError("OMR_SCHEDULER_UPLOAD_PROHIBITED"); },
    });
  }
  const unavailableAdapter = new Proxy({} as OmrVendorAdapter, {
    get: () => async () => { throw new RangeError("OMR_PROVIDER_BINDING_UNAVAILABLE"); },
  });
  return new DurableOmrApplicationService({
    store: services.omrStore, objects: services.objects, adapter: unavailableAdapter,
    providerBindingId: "omr-provider:scheduler-unconfigured", providerVendorId: "scheduler-unconfigured",
    adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION, resolveAdapter: () => undefined,
    handleHmacKey: config.handleHmacKey, vendorJobEncryptionKey: config.vendorJobEncryptionKey,
    quota: omrQuotaConfig(config.dailyGlobalCreditCeiling),
    actor: { sessionId: "0" as PrivateRowId, ipOwnerHash: services.quota.ipHash("scheduled-cleanup") },
    inspectPage: async () => { throw new RangeError("OMR_SCHEDULER_UPLOAD_PROHIBITED"); },
  });
}
