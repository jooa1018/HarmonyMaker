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

Result selection checks the saved `.omr` book's score inventory before decoding
or chord OCR. Multiple movements are a terminal `AUDIVERIS_OUTPUT_INCOMPLETE`
failure: the provider does not return the first movement as the whole input.
Conflicting exports or separate artifacts without a proven single result fail
with `AUDIVERIS_OUTPUT_AMBIGUOUS`. Only matching XML/MXL serializations of the
same artifact may be treated as duplicates. No filename-based musical ordering,
size-based choice, automatic concatenation, or timing repair is performed.
Original engine exports and `.omr` stay in the job workspace under the existing
retention/deletion policy; no partial `result.musicxml` is published. This guard
detects output-selection loss, not every recognition omission within a score.

For local recognition comparisons, build this Dockerfile (or the repository
root Dockerfile) and verify `tesseract --list-langs` includes both `eng` and `kor`.
Matching the Audiveris version alone is insufficient: an older local image can
lack Korean language data even when a mounted wrapper requests `eng+kor`.
