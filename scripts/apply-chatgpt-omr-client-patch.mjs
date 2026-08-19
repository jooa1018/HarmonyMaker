import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after) {
  const current = readFileSync(path, "utf8");
  if (!current.includes(before)) throw new Error(`PATCH_CONTEXT_MISSING:${path}`);
  writeFileSync(path, current.replace(before, after));
}

replaceOnce(
  "src/app/omr/OmrClient.tsx",
  `  const pageSelectionRef = useRef(new OmrPageSelectionAuthority());
  const pageSelection = pageSelectionRef.current;`,
  `  const [pageSelection] = useState(() => new OmrPageSelectionAuthority());`,
);
replaceOnce(
  "src/app/omr/OmrClient.tsx",
  `    return () => { active = false; };
  }, []);

  const discardInvalidManifest`,
  `    return () => { active = false; };
  }, [pageSelection]);

  const discardInvalidManifest`,
);
replaceOnce(
  "src/server/omr/cross-session-create-recovery.ts",
  `  async recordCreate(_input: OmrCreateRecoveryAuthority & { readonly idempotencyKeyHash: string }): Promise<void> {`,
  `  async recordCreate(): Promise<void> {`,
);
