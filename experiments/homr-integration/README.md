# Local homr integration experiment

Runnable, isolated candidate generation. The opt-in local-image service invokes this runner as a local child process; it is not bundled into browser code or the remote provider. Outputs are unverified hypotheses. The local [Review handoff](REVIEW.md) carries the original raster, candidate and exact sidecars together; XML with the prototype notice cannot finalize Source without bound evidence and a verified recovery revision.

## Chord Recovery v1 (2026-09-15)

`chord_recovery.py`는 실제 `pipeline.py`의 코드 판독/부착 단계에 연결된다. 온전한 획 crop과 기존 전처리 OCR을 코드 전용으로 병행하고, 전체 문자열의 판독 계열·정확한 코드 문법·동일 원본의 직접 판독된 기호를 대조한다. 부분 문자 판독이 코드 품질이나 slash bass를 조용히 바꾸지 못한다. 전역 음악 문맥이나 평가 기준으로 미판독 코드를 채우지 않는다. geometry·OCR 원문·canonical 값·대안·부착 근거는 `evidence.chordRecovery`와 후보 레코드에 남는다.

시간축 v1.1 물리 구간, 여러 시스템에서 관측한 인쇄 정렬, 고유한 원본 event column을 이용해 위치를 붙인다. 쉼표는 기존 token과 원본 잉크를 함께 요구한다. 지속음 위 offset을 기록해도 음표·시간·tie를 변경하지 않는다. 같은 onset의 중복 검출은 보류하고, 다른 위치의 반복 인쇄는 보존한다. 재적용 시 기존 동일 코드는 유지하고 충돌은 거절한다. 모든 결과는 원본 대조가 필요한 자동 후보다.

서비스의 요청 hash에는 `hm-chord-recovery-v1`, runner hash에는 새 모듈이 포함된다. 선택적인 `HM_LOCAL_CHORD_BUILD=1`은 `.next-local-chord`에 로컬 production build를 분리한다. 원본·모델·정답·교정 이력은 이 저장소에 포함하지 않는다. 독립 합성 계약은 `test_chord_recovery.py`, 실제 이미지 평가는 비공개 인계에 있으며 서로 다른 증거다. 현재 실제 사례와 남은 누락/미확정은 [Source 경계 인계](../../docs/implementation/SOURCE_BOUNDARY_V1.md)에 기록한다.

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
