import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { loadAccompanimentConfig } from "../accompaniment/deterministic";
import type { AlgorithmExecutionRegistry } from "../domain/registries";
import { loadFrozenWagAuthority } from "../grammar/authority";

export async function loadProductExecutionRegistry(): Promise<AlgorithmExecutionRegistry> {
  const [authority, accompaniment] = await Promise.all([loadFrozenWagAuthority(), loadAccompanimentConfig()]);
  return {
    versions: APPLICATION_ALGORITHM_VERSION_REGISTRY,
    configDigests: {
      ...authority.wagOwnedConfigDigests,
      accompanimentConfigDigest: accompaniment.configDigest,
      diagnosticRegistryDigest: authority.diagnostics.registryDigest,
    },
  };
}
