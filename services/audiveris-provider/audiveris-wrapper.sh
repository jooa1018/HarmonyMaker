#!/bin/sh
set -eu

# HarmonyMaker accepts lead-sheet images where chord symbols above the staff are
# part of the source authority. Audiveris deliberately disables chord-name OCR
# by default because it can create collateral OCR damage on scores that do not
# contain chord symbols. This provider is explicitly the lead-sheet OMR path, so
# enable that processing switch for every engine invocation.
#
# OCR language context matters for mixed-language lead sheets: the sheet scanner
# runs one Tesseract pass over the cleaned page before chord-name role inference.
# Keep English available for chord symbols and include Korean by default for the
# current product corpus, while allowing deployments to override the language set.
ocr_languages="${HM_AUDIVERIS_OCR_LANGUAGES:-eng+kor}"

exec /usr/local/bin/audiveris \
  -constant org.audiveris.omr.sheet.ProcessingSwitches.chordNames=true \
  -constant "org.audiveris.omr.text.Language.defaultSpecification=${ocr_languages}" \
  "$@"
