export type ImportStartupRead<Handoff, Recovery> =
  | { readonly kind: "handoff"; readonly handoff: Handoff }
  | { readonly kind: "saved"; readonly saved: readonly Recovery[] }
  | { readonly kind: "stale" };

/** A later explicit input owns the screen even when a startup storage read finishes last. */
export async function readImportStartup<Handoff, Recovery>(
  isCurrent: () => boolean,
  takeHandoff: () => Promise<Handoff | undefined>,
  loadSaved: () => Promise<readonly Recovery[]>,
): Promise<ImportStartupRead<Handoff, Recovery>> {
  if (!isCurrent()) return { kind: "stale" };
  try {
    const handoff = await takeHandoff();
    if (!isCurrent()) return { kind: "stale" };
    if (handoff) return { kind: "handoff", handoff };
    const saved = await loadSaved();
    if (!isCurrent()) return { kind: "stale" };
    return { kind: "saved", saved };
  } catch (error) {
    if (!isCurrent()) return { kind: "stale" };
    throw error;
  }
}
