# Local candidate Review handoff

The provider and recognition rules are unchanged. This connection packages already
generated outputs; it does not run homr/OCR or accept evaluation truth or previous
correction histories.

```powershell
python experiments/homr-integration/package_review.py --candidate C:\private\candidate --image C:\private\score.png --output C:\private\score.review.json
npm run dev -- --hostname 127.0.0.1 --port 3194
```

Open `/import` and choose **로컬 OMR 후보 묶음 열기**. The existing IndexedDB OMR
handoff delivers the candidate and original page to the existing recovery/Review.
This is a local result, not a successful call to the configured provider.

The bundle preserves exact UTF-8 artifacts, original image bytes, SHA-256 bindings,
predicted event identities, coordinate evidence, automatic changes and unresolved
records. Validation checks image dimensions and hashes, raw event identities,
unresolved inventories and whether the recorded A→C changes match the candidate.
It establishes file correspondence, not original musical correctness or an
authenticated engine signature. Attention estimates remain estimates. The trace
viewer refers to the initial automatic candidate even after manual edits.

The basic recovery editor preserves the bundle when editing and reloading. The
existing structural recovery copies the full attachment and seeds a document-wide
review obligation at its first measure. Resolving that obligation requires actual
original comparison, not a checkbox to make validation green. Original evidence
and initial unresolved statuses remain immutable in the attachment; subsequent
manual resolution is a separate, auditable operation.

Source remains blocked without bound evidence and the existing complete-score
structural review. Reimporting a marked XML alone cannot remove the obligation,
including through structural recovery. This conservative bridge reuses the
existing inventory/context/coverage forms, which themselves add substantial UI
work even when an automatic candidate has correct notes. Musical repairs and
that verification overhead must be reported separately.

No new note, lyric, mode, tempo or voice editing capabilities are added here.
If existing operations cannot repair or verify the candidate reasonably, retain
the failure and stop. Review exports contain the original attachment, explicit
operations, unresolved state and an unconfirmed candidate. They are not Source
or project exports.

Tests with private existing outputs:

```powershell
$env:HM_LOCAL_REVIEW_EVIDENCE = 'C:\private\review-trial'
npx vitest run src/domain/omr/local-candidate.test.ts experiments/homr-integration/review-handoff.test.ts
python experiments/homr-integration/review_ui.py --output C:\private\review-trial --case example --actions C:\private\explicit-ui-actions.json
```

The UI driver uses isolated browser profiles, blocks non-localhost page requests,
never writes IndexedDB directly, and records each explicit action. Action files
are written after inspecting the original, not generated from an oracle. Its
automation timings are not estimates of human editing time. Failed selectors
must be distinguished from actual product limitations.
