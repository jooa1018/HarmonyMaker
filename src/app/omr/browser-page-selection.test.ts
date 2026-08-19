import { describe, expect, it } from "vitest";

import { OmrPageSelectionAuthority } from "./browser-page-selection";

describe("OMR browser page selection authority", () => {
  it("supersedes a slow old preparation with a newer selection", () => {
    const authority = new OmrPageSelectionAuthority();
    const slow = authority.beginSelection();
    const current = authority.beginSelection();
    expect(slow.signal.aborted).toBe(true);
    expect(() => authority.assertCurrent(slow)).toThrow("OMR_PAGE_SELECTION_SUPERSEDED");
    expect(() => authority.assertCurrent(current)).not.toThrow();
    expect(authority.finishSelection(current)).toBe(true);
  });

  it("blocks start while preparation is active and blocks selection after start reservation", () => {
    const authority = new OmrPageSelectionAuthority();
    const token = authority.beginSelection();
    expect(() => authority.reserveStart()).toThrow("OMR_PAGE_PREPARATION_ACTIVE");
    authority.finishSelection(token);
    const generation = authority.reserveStart();
    expect(() => authority.beginSelection()).toThrow("OMR_BROWSER_MANIFEST_ACTIVE");
    expect(() => authority.assertStartReservation(generation)).not.toThrow();
    authority.installManifest(generation);
    expect(authority.locked).toBe(true);
  });

  it("unlocks only after the exact manifest lifecycle is cleared", () => {
    const authority = new OmrPageSelectionAuthority();
    const token = authority.beginSelection();
    authority.finishSelection(token);
    const generation = authority.reserveStart();
    authority.installManifest(generation);
    expect(() => authority.beginSelection()).toThrow("OMR_BROWSER_MANIFEST_ACTIVE");
    authority.clearManifest();
    expect(() => authority.beginSelection()).not.toThrow();
  });

  it("adopts a restored manifest and aborts an obsolete preparation", () => {
    const authority = new OmrPageSelectionAuthority();
    const token = authority.beginSelection();
    authority.adoptManifest();
    expect(token.signal.aborted).toBe(true);
    expect(authority.locked).toBe(true);
    expect(() => authority.assertCurrent(token)).toThrow("OMR_PAGE_SELECTION_SUPERSEDED");
  });
});
