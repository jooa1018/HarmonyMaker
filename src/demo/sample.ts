// Step 1 fixture only: ABC is an abcjs adapter input, not a domain or storage model.
export const demoAbc = `X:1
T:HarmonyMaker S/A/T Demo
M:4/4
L:1/4
Q:1/4=100
K:C
%%score S A T
V:S name="Soprano" clef=treble
V:A name="Alto" clef=treble
V:T name="Tenor" clef=treble-8
[V:S] C D E G | G F E D | E F G A | G E D C | F G A G | E D C2 |]
[V:A] G A C E | E D C B, | C D E F | E C B, C | C E F E | C B, C2 |]
[V:T] C, F, A, C | C G, A, G, | A, F, C F, | C A, G, C | A, C F, C | G, G, C,2 |]`;

export const voiceLabels = ["Soprano", "Alto", "Tenor"] as const;
