#!/bin/sh
set -eu

# HarmonyMaker accepts lead-sheet images where chord symbols above the staff are
# part of the source authority. Audiveris deliberately disables chord-name OCR
# by default because it can create collateral OCR damage on scores that do not
# contain chord symbols. This provider is explicitly the lead-sheet OMR path, so
# enable that processing switch for every engine invocation without changing
# Audiveris' other factory defaults.
exec /usr/local/bin/audiveris \
  -constant org.audiveris.omr.sheet.ProcessingSwitches.chordNames=true \
  "$@"
