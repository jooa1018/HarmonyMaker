interface ReferenceFixtureEnvironment {
  readonly NODE_ENV?: string;
  readonly OMR_PROVIDER_MODE?: string;
  readonly OMR_ENABLE_REFERENCE_FIXTURE_CONTROLS?: string;
}

export function referenceFixtureControlsEnabled(environment: ReferenceFixtureEnvironment): boolean {
  return environment.NODE_ENV !== "production"
    && environment.OMR_PROVIDER_MODE === "reference"
    && environment.OMR_ENABLE_REFERENCE_FIXTURE_CONTROLS === "enabled";
}
