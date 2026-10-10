import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { loadAccompanimentConfig } from "../accompaniment/deterministic";
import type { AlgorithmExecutionRegistry } from "../domain/registries";
import { WAG_1_1_VERSIONS } from "../grammar/versions";
import { loadFrozenWagAuthority } from "../grammar/authority";

export async function loadProductExecutionRegistry(): Promise<AlgorithmExecutionRegistry> {
  const [authority, authority11, accompaniment] = await Promise.all([loadFrozenWagAuthority(), loadFrozenWagAuthority("grammar-v1.1"), loadAccompanimentConfig()]);
  const registry11: AlgorithmExecutionRegistry = { versions: WAG_1_1_VERSIONS, configDigests: {
    ...authority11.wagOwnedConfigDigests,
    accompanimentConfigDigest: accompaniment.configDigest, diagnosticRegistryDigest: authority.diagnostics.registryDigest,
  } };
  return {
    compatible: { "grammar-v1.1": registry11 },
    versions: APPLICATION_ALGORITHM_VERSION_REGISTRY,
    configDigests: {
      ...authority.wagOwnedConfigDigests,
      accompanimentConfigDigest: accompaniment.configDigest,
      diagnosticRegistryDigest: authority.diagnostics.registryDigest,
    },
  };
}
