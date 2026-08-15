import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import freezeManifest from "../../docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.freeze.json";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { createDiagnosticRegistry, type DiagnosticCode, type DiagnosticDefinition } from "../domain/diagnostics";
import { binaryDigest, semanticDigest } from "../domain/digest/canonical";
import {
  FROZEN_WAG_AUTHORITY,
  loadFrozenWagAuthority,
  WAG_OWNED_CONFIG_DIGEST_BINDINGS,
} from "./authority";
import grammarPayload from "./worship-arrangement-grammar-v1.0.1.canonical.json";

const FILE_DIGESTS = {
  "README_APPLY.md": "5c8c704fc0e5ab51adb628022aeaf7e97b33b287610b1fd5533a177b65fd4ede",
  "docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.md": "ee09ded709273cc6468f1fd3f1df319d04458716f6ad911a878bffdb9b4498d5",
  "docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.freeze.json": "3ded5968b34d7fbd48a3f58f22b67370a8ec4ea36fbd4e0ed834c81d5ed080ba",
  "src/grammar/worship-arrangement-grammar-v1.0.1.canonical.json": "676780f8ceacda6d88c5724156f84f95fb5b337b4d13d16342f5342cb617330d",
  "src/grammar/wag-v1-diagnostic-baseline.canonical.json": "0fa15cf0652e41b1509df0f8d140bfa165726a6799a83b19eed59b58dbbbab4c",
  "src/grammar/wag-v1-diagnostic-extension.canonical.json": "4be25a0ae3cc28812b85da585e1ef6f0aa2f0ce5fc560e34177aa49eee06379b",
} as const;

describe("frozen WAG v1.0.1 authority", () => {
  it("installs every contract artifact byte-identically", async () => {
    for (const [path, expected] of Object.entries(FILE_DIGESTS)) {
      const bytes = await readFile(join(process.cwd(), path));
      expect(await binaryDigest(bytes)).toBe(expected);
    }
  });

  it("loads the exact semantic authorities and all 99 diagnostic definitions", async () => {
    const authority = await loadFrozenWagAuthority();
    expect(authority.grammarConfigDigest).toBe(FROZEN_WAG_AUTHORITY.grammarConfigDigest);
    expect(authority.presetProfiles.presetProfileDigest).toBe(FROZEN_WAG_AUTHORITY.presetProfileDigest);
    expect(authority.diagnostics.registryDigest).toBe(FROZEN_WAG_AUTHORITY.diagnosticRegistryDigest);
    expect(Object.keys(authority.diagnostics.definitions)).toHaveLength(99);
    expect(authority.presetProfiles.profiles).toEqual(grammarPayload.presetProfiles);
  });

  it("binds every frozen algorithm version and WAG-owned config digest", () => {
    expect(APPLICATION_ALGORITHM_VERSION_REGISTRY).toEqual(freezeManifest.algorithmVersions);
    expect(WAG_OWNED_CONFIG_DIGEST_BINDINGS).toEqual(freezeManifest.algorithmConfigDigestBindings);
  });

  it("keeps the full registry digest invariant under definition insertion order", async () => {
    const authority = await loadFrozenWagAuthority();
    const reversed = Object.fromEntries(
      Object.entries(authority.diagnostics.definitions).reverse(),
    ) as Readonly<Record<DiagnosticCode, DiagnosticDefinition>>;
    const rebuilt = await createDiagnosticRegistry(FROZEN_WAG_AUTHORITY.diagnosticRegistryVersion, reversed);
    expect(rebuilt.registryDigest).toBe(FROZEN_WAG_AUTHORITY.diagnosticRegistryDigest);
  });

  it("detects semantic config drift and rejects non-exact diagnostic code sets", async () => {
    expect(await semanticDigest({ ...grammarPayload, grammarVersion: "tampered" }))
      .not.toBe(FROZEN_WAG_AUTHORITY.grammarConfigDigest);
    const authority = await loadFrozenWagAuthority();
    const missing = { ...authority.diagnostics.definitions } as Partial<Record<DiagnosticCode, DiagnosticDefinition>>;
    delete missing.WAG_V1_ROLE_PREVIEW_PARITY_MISMATCH;
    await expect(createDiagnosticRegistry(
      FROZEN_WAG_AUTHORITY.diagnosticRegistryVersion,
      missing as Readonly<Record<DiagnosticCode, DiagnosticDefinition>>,
    )).rejects.toThrow("exactly the accepted code set");
  });
});
