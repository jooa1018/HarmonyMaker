import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "../../domain/fraction";
import { tupletUnit, type SourceTuplet } from "../../domain/source/tuplets";
import { xmlChild, xmlChildren, xmlDescendants, xmlText, type XmlElement } from "./xml";

interface Member { note: XmlElement; measure: number; onset: Fraction; duration: Fraction; written: SourceTuplet["normalType"]; normal: SourceTuplet["normalType"]; number: number; start: boolean; stop: boolean; valid: boolean }
const supportedType = (value: string | undefined): value is SourceTuplet["normalType"] => value === "quarter" || value === "eighth" || value === "16th";

function consistentNotation(mark: XmlElement, normal: string | undefined): boolean {
  return ([['tuplet-actual',3],['tuplet-normal',2]] as const).every(([name,number]) => {
    const descriptions=xmlChildren(mark,name);
    return descriptions.length<=1 && descriptions.every(description => {
      const counts=xmlChildren(description,'tuplet-number'),types=xmlChildren(description,'tuplet-type');
      return counts.length<=1 && counts.every(count=>Number(xmlText(count))===number)
        && types.length<=1 && types.every(type=>xmlText(type)===normal)
        && xmlChildren(description,'tuplet-dot').length===0;
    });
  });
}

/** Only returns complete, unambiguous groups. Unsupported notes remain absent
 * and are reported by the normal importer diagnostics, never silently stripped. */
export function supportedMusicXmlTuplets(part: XmlElement): ReadonlyMap<XmlElement, readonly SourceTuplet[]> {
  const voices = new Map<string, Member[]>();
  const measureDurations: Fraction[] = [];
  let divisions = 1;
  let meter = fraction(4);
  for (const [measureIndex,measure] of xmlChildren(part,"measure").entries()) {
    let cursor = fraction(0), maximum = fraction(0);
    for (const child of measure.children) {
      if (child.kind !== "element") continue;
      if (child.name === "attributes") {
        const value = Number(xmlText(xmlChild(child,"divisions")));
        if (Number.isSafeInteger(value) && value > 0) divisions = value;
        const time = xmlChild(child,"time"), beats = Number(time && xmlText(xmlChild(time,"beats"))), denominator = Number(time && xmlText(xmlChild(time,"beat-type")));
        if (Number.isSafeInteger(beats) && beats > 0 && Number.isSafeInteger(denominator) && denominator > 0) meter = fraction(beats*4,denominator);
      }
      if (["backup","forward"].includes(child.name)) {
        const value = Number(xmlText(xmlChild(child,"duration")));
        if (Number.isSafeInteger(value) && value > 0) cursor = child.name === "backup" ? subtractFractions(cursor,fraction(value,divisions)) : addFractions(cursor,fraction(value,divisions));
        if (compareFractions(cursor,maximum)>0) maximum=cursor;
      }
      if (child.name !== "note") continue;
      const durationValue = Number(xmlText(xmlChild(child,"duration")));
      const duration = Number.isSafeInteger(durationValue) && durationValue > 0 ? fraction(durationValue,divisions) : fraction(0);
      const onset = cursor;
      if (!xmlChild(child,"chord")) cursor = addFractions(cursor,duration);
      if (compareFractions(cursor,maximum)>0) maximum=cursor;
      const voice = `${xmlText(xmlChild(child,"staff")) ?? "1"}:${xmlText(xmlChild(child,"voice")) ?? "1"}`;
      const tm = xmlChildren(child,"time-modification"), marks = xmlDescendants(child,"tuplet");
      const written = xmlText(xmlChild(child,"type")), normal = tm[0] && (xmlText(xmlChild(tm[0],"normal-type")) ?? written);
      const number = Number(marks[0]?.attributes.number ?? "1");
      const expected = supportedType(written) ? tupletUnit(written) : fraction(0);
      const valid = tm.length === 1 && Number(xmlText(xmlChild(tm[0],"actual-notes"))) === 3 && Number(xmlText(xmlChild(tm[0],"normal-notes"))) === 2
        && supportedType(written) && supportedType(normal) && compareFractions(duration,fraction(expected.n*2,expected.d*3)) === 0
        && !xmlChild(child,"dot") && !xmlChild(tm[0],"normal-dot") && !xmlChild(child,"chord")
        && !xmlChild(child,"grace") && !xmlChild(child,"cue") && !xmlChild(child,"unpitched") && !xmlDescendants(child,"ornaments").length
        && xmlChildren(child,"type").length === 1 && xmlChildren(child,"duration").length === 1
        && xmlChildren(tm[0],"actual-notes").length === 1 && xmlChildren(tm[0],"normal-notes").length === 1 && xmlChildren(tm[0],"normal-type").length <= 1
        && marks.length <= 1 && marks.every(mark => ["start","stop"].includes(mark.attributes.type) && consistentNotation(mark,normal))
        && Number.isSafeInteger(number) && number >= 1 && number <= 16;
      const entries = voices.get(voice) ?? [];
      entries.push({note:child,measure:measureIndex,onset,duration,written:written as SourceTuplet["normalType"],normal:normal as SourceTuplet["normalType"],number,start:marks[0]?.attributes.type === "start",stop:marks[0]?.attributes.type === "stop",valid});
      voices.set(voice,entries);
    }
    measureDurations.push(measure.attributes.implicit === "yes" && maximum.n > 0 ? maximum : meter);
  }
  const result = new Map<XmlElement, readonly SourceTuplet[]>();
  for (const members of voices.values()) {
    for (let i=0;i<members.length;i++) {
      const first = members[i]; if (!first.valid || first.stop) continue;
      const group: Member[] = [];
      if (first.start) {
        for (let j=i;j<members.length;j++) {
          const item=members[j];
          if (!item.valid || item.normal !== first.normal || j>i && item.start || (item.start || item.stop) && item.number !== first.number) break;
          group.push(item); if (item.stop) break;
        }
        if (!group.at(-1)?.stop) continue;
      } else {
        const next=members.slice(i,i+3);
        if (next.length!==3 || next.some(item=>!item.valid || item.start || item.stop || item.measure!==first.measure || item.written!==first.written || item.normal!==first.normal)) continue;
        group.push(...next);
      }
      let sum=fraction(0), contiguous=true;
      for (const [index,item] of group.entries()) {
        const previous=group[index-1];
        if (previous && (item.measure === previous.measure ? compareFractions(addFractions(previous.onset,previous.duration),item.onset)!==0 : item.measure !== previous.measure+1 || item.onset.n!==0 || compareFractions(addFractions(previous.onset,previous.duration),measureDurations[previous.measure])!==0)) contiguous=false;
        sum=addFractions(sum,item.duration);
      }
      const unit=tupletUnit(first.normal);
      if (!contiguous || compareFractions(sum,fraction(unit.n*2,unit.d))!==0) continue;
      // abcjs 6.7 does not close (3:2:1 and changes the following notes' times.
      // A cross-bar singleton cannot be faithfully displayed: reject at import.
      const bars = [...new Set(group.map(item => item.measure))];
      if (bars.length > 1 && bars.some(bar => group.filter(item => item.measure === bar).length === 1)) continue;
      for (const [index,item] of group.entries()) result.set(item.note,[{number:first.number,actualNotes:3,normalNotes:2,normalType:first.normal,...(index===0?{start:true as const}:{}),...(index===group.length-1?{stop:true as const}:{})}]);
      i+=group.length-1;
    }
  }
  return result;
}
