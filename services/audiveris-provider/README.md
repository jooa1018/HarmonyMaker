# HarmonyMaker Audiveris provider

This service wraps the official Audiveris 5.10.2 engine behind the HarmonyMaker OMR vendor contract.
It is licensed under AGPL-3.0-only and exposes `/source` and a source URL from `/health`.

Local Docker:

```bash
docker build -t hm-audiveris .
docker run --rm -p 8001:8000 \
  -e HM_AUDIVERIS_API_KEY="replace-with-at-least-32-characters" \
  hm-audiveris
```

The service accepts canonical PNG pages, combines them into a multi-page TIFF and invokes Audiveris in batch mode. Jobs are retained for one hour by default. Set `HM_AUDIVERIS_DURABLE_STORAGE=1` only when `/data` is backed by persistent storage.
