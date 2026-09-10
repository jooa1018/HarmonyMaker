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

For local recognition comparisons, build the repository root Dockerfile.
Audiveris 5.10.2 bundles Tesseract **5.5.1** and calls `OEM_TESSERACT_ONLY`; the
Ubuntu CLI is a separate Tesseract 5.3.4 installation. Merely listing languages
does not prove that native OCR can initialize or recognize any text.

The native `eng` and `kor` files come from the official `tesseract-ocr/tessdata`
repository at commit `590567f20dc044f6948a8e2c61afc714c360ad0e` (tag `4.0.0`).
`native-tessdata.sha256` pins both downloads. The wrapper selects this legacy
compatible data through `HM_AUDIVERIS_NATIVE_TESSDATA` (`/opt/audiveris-tessdata`).
It overrides `TESSDATA_PREFIX` only in the engine child process. Independent
chord OCR uses explicit OEM 1 and `HM_AUDIVERIS_CHORD_TESSDATA`, retaining the
Ubuntu LSTM model under `/usr/share/tesseract-ocr/5/tessdata`.

The packaged launcher's Xms512m/Xmx8G settings are removed so they cannot silently
override runtime limits. The wrapper appends a native heap budget of Xms32m/Xmx256m
to leave room for native OCR and image buffers; `HM_AUDIVERIS_JVM_LIMITS` is the
dedicated deployment override. No service compute plan is raised by this change.
`scripts/native-ocr-smoke.py` checks two self-authored images through the real
provider: title recognition, all 32 pitches/durations and all four chord onsets.
CI runs the service at 512 MiB and 0.1 CPU. It does not test general lyric quality.

Native OCR can return only some chords. Supplementation preserves each measure
that already has harmony and considers only empty measures, still subject to the
whole-page/system correspondence gate. Staff-connected stems are excluded from
the temporary chord segmentation mask so they do not join text boxes; the source
image and Audiveris recognition frame remain unchanged.

Export decoding and chord OCR run in a worker thread so the event loop can
continue serving status requests. Owner deletion waits for that file-writing
worker before removing its workspace, preventing crop files from reappearing.

References: [Audiveris languages](https://audiveris.github.io/audiveris/_pages/guides/main/languages/),
[official Tesseract data families](https://tesseract-ocr.github.io/tessdoc/Data-Files.html).
