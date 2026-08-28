# Audiveris OMR provider integration

## Selected provider

HarmonyMaker supports a self-hosted Audiveris provider for printed Common Western Music Notation.

```text
ENGINE = Audiveris 5.10.2
LICENSE = AGPL-3.0-only
PER_REQUEST_LICENSE_FEE = 0
TRANSFER_FORMAT = canonical image/png
OUTPUT = MusicXML
EVIDENCE = page-level only
INTERACTIVE_PROVIDER_INPUT = unsupported
```

Audiveris is not expected to achieve perfect recognition. HarmonyMaker's Quick Review remains mandatory before project generation.

## Temporary Render deployment

The repository root `Dockerfile` runs only the provider service. Vercel ignores this Dockerfile.
`render.yaml` configures an ephemeral free Render service for testing. Free instances can sleep, restart and lose provider-local jobs; the provider therefore reports `supportsIdempotency=false` unless persistent `/data` storage is explicitly supplied.

Required service environment:

```text
HM_AUDIVERIS_API_KEY=<at least 32 random characters>
HM_AUDIVERIS_RETENTION_SECONDS=3600
HM_AUDIVERIS_DURABLE_STORAGE=0
JAVA_TOOL_OPTIONS=-Xmx384m -Djava.awt.headless=true
```

HarmonyMaker Preview environment:

```text
OMR_PROVIDER_MODE=real
OMR_AUDIVERIS_BASE_URL=https://<render-service-host>
OMR_AUDIVERIS_API_KEY=<same provider key>
OMR_AUDIVERIS_CONFIGURATION_GENERATION=audiveris-5.10.2-render-temp-v1
OMR_AUDIVERIS_REQUEST_TIMEOUT_MS=180000
```

The ordinary OMR encryption/HMAC keys and persistence substrate variables remain required.

## Local Docker

```bash
docker build -t harmonymaker-audiveris .
docker run --rm -p 8001:8000 \
  -e HM_AUDIVERIS_API_KEY="replace-with-at-least-32-characters" \
  -v harmonymaker-audiveris-data:/data \
  harmonymaker-audiveris
```

When the volume is persistent across restarts, set `HM_AUDIVERIS_DURABLE_STORAGE=1`.

## Provider contract

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | health/version/source disclosure |
| GET | `/source` | AGPL source URL |
| GET | `/v1/capabilities` | HarmonyMaker capability snapshot |
| POST | `/v1/jobs` | create/replay a job |
| PUT | `/v1/jobs/{id}/pages/{index}` | upload canonical PNG |
| POST | `/v1/jobs/{id}/start` | start asynchronous recognition |
| GET | `/v1/jobs/{id}/status` | poll status |
| GET | `/v1/jobs/{id}/result` | fetch MusicXML |
| GET | `/v1/jobs/{id}/metadata` | page digest/geometry evidence input |
| POST | `/v1/jobs/{id}/cancel` | cancel processing |
| DELETE | `/v1/jobs/{id}` | delete provider data |
| GET | `/v1/jobs/{id}/retention` | retention disclosure |

## Limitations

- The free Render instance has limited CPU/RAM and is for temporary evaluation, not production.
- The temporary instance may cold-start and may lose provider-local jobs after restart.
- Evidence is page-level; symbol/measure evidence is not claimed.
- Rights-safe corpus calibration and production-live retention/idempotency verification remain external work.
