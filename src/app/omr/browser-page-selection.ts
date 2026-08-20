export interface OmrPageSelectionToken {
  readonly generation: number;
  readonly signal: AbortSignal;
}

/**
 * Browser-only authority for page preparation. It prevents a stale async file
 * selection from publishing after a newer selection or a manifest start has
 * become authoritative.
 */
export class OmrPageSelectionAuthority {
  private generation = 0;
  private active?: { readonly generation: number; readonly controller: AbortController };
  private startReservation?: number;
  private manifestLocked = false;

  beginSelection(): OmrPageSelectionToken {
    if (this.manifestLocked || this.startReservation !== undefined) {
      throw new RangeError("OMR_BROWSER_MANIFEST_ACTIVE");
    }
    this.active?.controller.abort();
    const controller = new AbortController();
    const generation = ++this.generation;
    this.active = { generation, controller };
    return { generation, signal: controller.signal };
  }

  assertCurrent(token: OmrPageSelectionToken): void {
    if (token.signal.aborted || token.generation !== this.generation
      || this.active?.generation !== token.generation
      || this.startReservation !== undefined || this.manifestLocked) {
      throw new RangeError("OMR_PAGE_SELECTION_SUPERSEDED");
    }
  }

  finishSelection(token: OmrPageSelectionToken): boolean {
    if (this.active?.generation !== token.generation) return false;
    this.active = undefined;
    return true;
  }

  reserveStart(): number {
    if (this.manifestLocked) throw new RangeError("OMR_BROWSER_MANIFEST_ACTIVE");
    if (this.active) throw new RangeError("OMR_PAGE_PREPARATION_ACTIVE");
    if (this.startReservation !== undefined) throw new RangeError("OMR_START_ALREADY_RESERVED");
    this.startReservation = this.generation;
    return this.generation;
  }

  assertStartReservation(generation: number): void {
    if (this.manifestLocked || this.startReservation !== generation || this.generation !== generation) {
      throw new RangeError("OMR_PAGE_SELECTION_SUPERSEDED");
    }
  }

  installManifest(generation: number): void {
    this.assertStartReservation(generation);
    this.startReservation = undefined;
    this.manifestLocked = true;
  }

  adoptManifest(): void {
    this.active?.controller.abort();
    this.active = undefined;
    this.startReservation = undefined;
    this.generation += 1;
    this.manifestLocked = true;
  }

  releaseStart(generation: number): void {
    if (this.startReservation === generation) this.startReservation = undefined;
  }

  clearManifest(): void {
    this.active?.controller.abort();
    this.active = undefined;
    this.startReservation = undefined;
    this.generation += 1;
    this.manifestLocked = false;
  }

  abortSelection(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }

  get preparing(): boolean { return this.active !== undefined; }
  get locked(): boolean { return this.manifestLocked || this.startReservation !== undefined; }
}
