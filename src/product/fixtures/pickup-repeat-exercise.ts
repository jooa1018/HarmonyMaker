/** Self-authored exercises; no user score is included. */
export function pickupRepeatExercise(mode: "outside" | "inside" | "volta" | "none" = "outside", rest = false, printed = false): string {
  const attributes = '<attributes><divisions>2</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
  const chord = (step: string) => `<harmony><root><root-step>${step}</root-step></root><kind>major</kind></harmony>`;
  const note = (step: string, eighth = false) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${eighth ? 1 : 2}</duration><type>${eighth ? "eighth" : "quarter"}</type><lyric number="1"><syllabic>single</syllabic><text>라</text></lyric></note>`;
  const forward = '<barline location="left"><repeat direction="forward"/></barline>';
  const backward = '<barline location="right"><repeat direction="backward"/></barline>';
  const pickup = `<measure number="0" implicit="yes">${attributes}${mode === "inside" ? forward : ""}${printed ? chord("C") : ""}${rest ? '<note><rest/><duration>1</duration><type>eighth</type></note>' : ""}${note("G", true)}</measure>`;
  const melody = [["E", "G", "E", "G"], ["F", "A", "F", "A"], ["G", "B", "G", "B"], ["E", "G", "E", "C"]];
  const bars = ["C", "F", "G", "C"].map((c, i) => `<measure number="${i + 1}">${i === 0 && (mode === "outside" || mode === "volta") ? forward : ""}${mode === "volta" && i >= 2 ? `<barline location="left"><ending number="${i - 1}" type="start"/></barline>` : ""}${chord(c)}${melody[i].map(s => note(s)).join("")}${mode === "volta" && i >= 2 ? `<barline location="right"><ending number="${i - 1}" type="${i === 2 ? "stop" : "discontinue"}"/>${i === 2 ? '<repeat direction="backward"/>' : ""}</barline>` : i === 3 && mode !== "none" ? backward : ""}</measure>`).join("");
  return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Original pickup ${mode}${rest ? " rest" : ""} exercise</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">${pickup}${bars}</part></score-partwise>`;
}

/** Same original melody, with its one pickup chord printed after the leading rest. */
export function printedPickupExercise(mode: "outside" | "inside" | "volta" | "none" = "outside"): string {
  return pickupRepeatExercise(mode, true, true)
    .replace(/(<harmony>[\s\S]*?<\/harmony>)(<note><rest\/>[\s\S]*?<\/note>)/u, "$2$1");
}
