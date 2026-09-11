# Local homr integration experiment

Runnable, isolated candidate generation. This directory is not imported by the app or provider. Outputs are unverified hypotheses and must stay with their `evidence.json`. The MusicXML importer does **not** currently consume that sidecar or enforce its eligibility flag.

Requires the preserved Windows comparison directory, its homr virtual environment, pinned source and models, observation wrapper, and Audiveris-distributed Tesseract libraries/data. It installs nothing, does not contact an image service, and accepts no correction history or evaluation reference as recognition input.

From the repository root, with absolute private paths:

```powershell
$compare = 'C:\private\engine-compare-2026-09-11.private'
$output = 'C:\private\new-integration-run'
$inputImage = 'C:\private\score.png'
$py = Join-Path $compare 'homr-windows-env/Scripts/python.exe'
& $py experiments/homr-integration/run_local.py --compare $compare --out "$output-metrics" --seconds 600 --ram 2048 -- $py experiments/homr-integration/from_image.py --compare $compare --image $inputImage --out $output --language eng
```

For a saved inference, add `--cache C:\private\saved-homr-run` to `from_image.py`. The cached input must match the raster SHA-256. This is fresh automatic supplementation of saved inference, not a new homr recognition run. Use `eng+kor` for Korean text. Output directories must be new when using the public command.

The process sequence is homr inference → process exit → physical geometry replay → existing chord OCR → lyric OCR → numeral OCR → slash corroboration. The observer records parent/child Windows working set and commit. Its process limit is not a Linux cgroup test. It also stops on sustained low host memory or the deadline. Native libraries are extracted only into the new experiment's directories. No Docker cleanup is performed.

Outputs:

- `raw-homr/`: untouched inference and observation outputs when inference was requested.
- `candidate/A-homr.raw.musicxml`, `B-chords.candidate.musicxml`, `C-integrated.candidate.musicxml`.
- `geometry/`: source segmentation geometry and replayed staff rasters, with exact pixel and XML replay checks.
- `source-links.json`: predicted-event identity, source glyph support, ambiguous associations.
- `ocr.raw.json`, original/prepared OCR crops, `slash-pixel-candidates.json`.
- `evidence.json`: before/after changes, original boxes, source methods, association evidence and unresolved candidates.

The coordinate layer uses original raster units. It reverses the exact homr resize/crop/dewarp transform, requires the saved staff raster to reproduce identically, and rejects unknown crop translations. Attention positions remain estimates. Event correspondence also requires a source glyph at the predicted diatonic staff position; bar correspondence requires physical barlines and multiple independent event anchors. It never joins bars by count or uses MusicXML rendering coordinates as input coordinates.

The existing chord segmentation, preparation, parser and MusicXML writer are reused. A local Tesseract C API adapter replaces only the unavailable Windows CLI boundary. These legacy-compatible data files are not identical to the Linux provider's separate LSTM data bundle. Conflicting chord qualities/basses and competing locations remain unresolved.

Known scope limits:

- One staff per system; event/bar correspondence is incomplete, especially around undetected rests and unpitched rhythm.
- Lyrics are OCR word/Hangul-symbol candidates. Single visible units may be attached; multi-verse, internal syllabification and melisma/extend reconstruction are not implemented. The default single-unit encoding is not proof of lyric fidelity.
- Meter recognition requires paired source numerals and OCR agreement. It never fixes durations by filling a bar. Small raster notation remains unreliable.
- Slash replacement requires source diagonal shape, a connecting stem, one beam, a unique uncorroborated pitched token, an existing physical bar mapping, and an agreeing eighth duration. Independently corroborated pitched notes and existing ties/slurs are withheld. Other rhythms, missing tokens, original curve meanings and endpoints remain unresolved.
- Tempo, title, general text directions, key/flow repair and Source promotion are not supplied by this prototype.
- Recognition success, generated candidate counts, fixed sequence metrics, and actual user correction effort are different measures.

Evaluation is separate: `evaluate_stages.py` invokes the preserved v1.2 normalizer/comparator only after recognition. It retains the same event serialization and alignment, while separately reporting voice/onset/tie/context, harmony position/bass, and lyric semantics plus event/voice correspondence. It must not be imported by recognition.

Verification:

```powershell
& $py -m unittest discover -s experiments/homr-integration -p 'test_*.py'
$env:HM_LOCAL_INTEGRATION_EVIDENCE = 'C:\private\homr-integration-2026-09-12.private'
node node_modules/vitest/vitest.mjs run src/import experiments/homr-integration/app-import.test.ts
# Start the actual app locally, then use the existing Playwright environment:
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3194
# In another shell:
python experiments/homr-integration/verify_ui.py --evidence $env:HM_LOCAL_INTEGRATION_EVIDENCE
```

The private case adapter expects the saved `runs/<case>/v6` layout. It uploads actual candidate files and checks the existing importer/Review; it supplies no defaults, confirmations or downstream bypass.

homr is pinned to `457e7c6518a10ba755db2e60883419e56c4d7369` and declares [AGPL-3.0](https://github.com/liebharc/homr/blob/457e7c6518a10ba755db2e60883419e56c4d7369/LICENSE). Tesseract [5.5.1 code](https://github.com/tesseract-ocr/tesseract/blob/5.5.1/LICENSE) and [tessdata](https://github.com/tesseract-ocr/tessdata) declare Apache-2.0. Model assets, transitive notices and AGPL obligations still need a product-distribution assessment; no license clearance or provider replacement is claimed here. Third-party code/models are not vendored into this directory.
