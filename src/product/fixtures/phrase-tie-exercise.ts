import { pickupRepeatExercise } from "./pickup-repeat-exercise";

/** Self-authored repeat/ordinary-phrase boundary inputs for tie validation. */
export function phraseTieExercise(boundary: "repeat" | "ordinary", lyrics: boolean): string {
  let xml = pickupRepeatExercise(boundary === "repeat" ? "inside" : "none", false, true);
  if (boundary === "ordinary") xml = xml
    .replace(/<pitch><step>[A-G]<\/step>/gu, "<pitch><step>G</step>")
    .replace(/<root-step>[A-G]<\/root-step>/gu, "<root-step>C</root-step>")
    .replace('<measure number="3">', '<measure number="3"><direction><direction-type><rehearsal>B</rehearsal></direction-type></direction>');
  return lyrics ? xml : xml.replace(/<lyric[\s\S]*?<\/lyric>/gu, "");
}
