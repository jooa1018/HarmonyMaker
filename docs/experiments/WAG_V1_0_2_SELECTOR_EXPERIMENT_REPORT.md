# WAG v1.0.2 Selector Experiment — Implementation Report

Status: full automated verification in progress.

Core experiment implementation: `a40aa2ab8b0cd7c5ea5651174790ec1b879c0c84`.

Listening-UI state corrections:

- `a0c26277600ae10a43b69de489a59824011c2e0e`
- `4da8a384ec87220d5badfc199408967277187183`

The experiment is isolated from production WAG v1.0.1, leaves the frozen selector/config/diagnostic artifacts unchanged, and does not authorize a grammar-version change. This report will be finalized only after typecheck, lint, full tests, production build, and browser smoke pass.
