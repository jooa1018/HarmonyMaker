# Self-authored image regression

These two PNGs were rendered from `source.abc` using the repository's abcjs 6.7.0,
at staff widths 780/620, notation scales 1.5/1.0 and device scale 2. The music and
test lyrics were authored for this test; neither image contains user sheet music.

Each image contains two systems, four 4/4 measures, 32 pitched notes, and C, G, Am,
F at the first onset of the respective measures. Every measure has durations
`1/2, 1/2, 1/2, 1/2, 1/4, 3/4, 1/2, 1/2` in quarter-note units. The G text lies
above ascending stems; segmentation must keep the text separate from those stems.

The smoke checks actual provider recognition, exact pitches/durations and chord
onsets, plus the recognized title `Harmony Beam Study` (native Audiveris text OCR).
It does not assert Korean lyric accuracy or establish general recognition quality.
