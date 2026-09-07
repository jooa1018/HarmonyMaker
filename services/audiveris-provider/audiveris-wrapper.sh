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

# The provider creates a temporary recognition-only TIFF after retaining the
# original upload/digest/evidence. Normalize that TIFF in place so margin-heavy
# phone images and small chord text reach Audiveris at a useful pixel scale.
# Failure is non-fatal: the untouched TIFF remains valid input.
last_arg=""
for arg in "$@"; do
  last_arg="$arg"
done
if [ -n "$last_arg" ] && [ -f "$last_arg" ]; then
  python3 /app/recognition_preprocess.py "$last_arg" || \
    echo "HarmonyMaker recognition preprocessing skipped after failure" >&2
fi

# Set this only for Audiveris, never for the provider's separate LSTM chord OCR.
# The dedicated variable also avoids a pre-existing TESSDATA_PREFIX pointing to
# distribution LSTM-only data silently breaking native legacy initialization.
export TESSDATA_PREFIX="${HM_AUDIVERIS_NATIVE_TESSDATA:-/opt/audiveris-tessdata}"
# Native OCR allocates memory outside the Java heap. Keep room for eng+kor and
# image/native buffers in the existing 512 MiB test-service envelope. Appending
# wins over a pre-existing general JAVA_TOOL_OPTIONS heap value; a deployment
# can explicitly supply a different native budget through this dedicated knob.
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} ${HM_AUDIVERIS_JVM_LIMITS:--Xms32m -Xmx256m}"

exec /usr/local/bin/audiveris \
  -constant org.audiveris.omr.sheet.ProcessingSwitches.chordNames=true \
  -constant "org.audiveris.omr.text.Language.defaultSpecification=${ocr_languages}" \
  "$@"
