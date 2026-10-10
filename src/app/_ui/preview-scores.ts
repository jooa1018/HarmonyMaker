// Self-written demonstration score from the approved mockup.
  const HEAD = 'X:1\nT:시냇가에 심은 나무\nM:4/4\nL:1/4\nQ:1/4=80\nK:G\n%%score lead lower upper\n' +
    'V:lead name="멜로디" clef=treble\nV:lower name="알토" clef=treble\nV:upper name="테너" clef=treble-8\n';
  const LEAD = '[V:lead] "G"B B "D/F#"A d | "Em"B G "C"E G | "Am"A c "D7"B A | "G"G2 G2 |]\nw: 시 냇 가 에 심 은 나 무 철 을 따 라 열 매\n';
  const LOWER = '[V:lower] G G F A | G E C E | E A F F | D2 D2 |]\n';
  const UPPER_FULL = '[V:upper] d d d f | e B G c | c e d c | B2 B2 |]\n';
  const UPPER_PARTIAL = '[V:upper] d d d f | e B G c | z4 | B2 B2 |]\n';
  const LEAD8 = '[V:lead] "G"B B "D/F#"A d | "Em"B G "C"E G | "Am"A c "D7"B A | "G"G2 G2 | "C"c c "G/B"B G | "Am"A A "D"F A | "G/B"G B "C"c "D"A | "G"G2 G2 |]\n' +
    'w: 시 냇 가 에 심 은 나 무 철 을 따 라 열 매 를 맺 으 며 그 잎 사 귀 가 마 르 지 않 네\n';
  const LOWER8 = '[V:lower] G G F A | G E C E | E A F F | D2 D2 | E E D D | E E D F | D G G F | D2 D2 |]\n';
  const UPPER8 = '[V:upper] d d d f | e B G c | c e d c | B2 B2 | e e d B | c c A d | B d e d | B2 B2 |]\n';
  export const SOURCES = { full: HEAD + LEAD + LOWER + UPPER_FULL, partial: HEAD + LEAD + LOWER + UPPER_PARTIAL, full8: HEAD + LEAD8 + LOWER8 + UPPER8 };
