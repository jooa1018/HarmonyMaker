/** Authored C-major exercises; no user/copyright score is embedded. */
export function tripletExercise(type: "quarter" | "eighth" | "16th", explicit = true): string {
  const unit = type === "quarter" ? 12 : type === "eighth" ? 6 : 3;
  const note = (step:string,duration:number,written:string,extra="")=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${written}</type>${extra}</note>`;
  const measures = ["C","F","G","C"].map((chord,i)=>{
    const steps = [["E","G","E"],["F","A","F"],["G","B","G"],["E","G","E"]][i];
    const group = steps.map((step,j)=>note(step,unit*2/3,type,`<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>${type}</normal-type></time-modification>${explicit && j!==1 ? `<notations><tuplet type="${j===0?"start":"stop"}" number="1"/></notations>`:""}`)).join("");
    const filler = type === "16th" ? note(steps[0],6,"eighth") : "";
    const quarters = type === "quarter" ? 2 : 3;
    return `<measure number="${i+1}">${i===0?'<attributes><divisions>12</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>':""}<harmony><root><root-step>${chord}</root-step></root><kind>major</kind></harmony>${group}${filler}${Array.from({length:quarters},()=>note(steps[0],12,"quarter")).join("")}</measure>`;
  }).join("");
  return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Original ${type} triplet exercise</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
