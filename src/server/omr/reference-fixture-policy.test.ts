import { describe, expect, it } from "vitest";

import { referenceFixtureControlsEnabled } from "./reference-fixture-policy";

describe("OMR reference fixture control policy", () => {
  it("requires the explicit flag and reference mode outside production", () => {
    expect(referenceFixtureControlsEnabled({ NODE_ENV: "development", OMR_PROVIDER_MODE: "reference", OMR_ENABLE_REFERENCE_FIXTURE_CONTROLS: "enabled" })).toBe(true);
    expect(referenceFixtureControlsEnabled({ NODE_ENV: "test", OMR_PROVIDER_MODE: "reference", OMR_ENABLE_REFERENCE_FIXTURE_CONTROLS: "enabled" })).toBe(true);
    expect(referenceFixtureControlsEnabled({ NODE_ENV: "development", OMR_PROVIDER_MODE: "reference" })).toBe(false);
    expect(referenceFixtureControlsEnabled({ NODE_ENV: "development", OMR_PROVIDER_MODE: "real", OMR_ENABLE_REFERENCE_FIXTURE_CONTROLS: "enabled" })).toBe(false);
    expect(referenceFixtureControlsEnabled({ NODE_ENV: "production", OMR_PROVIDER_MODE: "reference", OMR_ENABLE_REFERENCE_FIXTURE_CONTROLS: "enabled" })).toBe(false);
  });
});
