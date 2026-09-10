import { xmlChild, xmlChildren, xmlText, type XmlElement } from "./xml";

export interface SlashNotationStyle {
  readonly rhythmic: boolean;
  readonly exceptVoices: ReadonlySet<string>;
}
export type SlashNotationState = Map<number, SlashNotationStyle | null>;
/** MusicXML measure-style number scopes a staff; an omitted number applies to all. */
export function updateSlashNotation(state: SlashNotationState, attributes: XmlElement): void {
  for (const measureStyle of xmlChildren(attributes, "measure-style")) {
    const slash = xmlChild(measureStyle, "slash");
    if (!slash) continue;
    const staff = measureStyle.attributes.number === undefined ? 0 : Number(measureStyle.attributes.number);
    if (!Number.isSafeInteger(staff) || staff < 0 || (staff === 0 && measureStyle.attributes.number !== undefined)
      || !["start", "stop"].includes(slash.attributes.type)
      || (slash.attributes["use-stems"] !== undefined && !["yes", "no"].includes(slash.attributes["use-stems"]))) {
      throw new RangeError("INVALID_SLASH_NOTATION");
    }
    if (staff === 0) state.clear();
    state.set(staff, slash.attributes.type === "stop" ? null : {
      rhythmic: slash.attributes["use-stems"] === "yes",
      exceptVoices: new Set(xmlChildren(slash, "except-voice").map((voice) => xmlText(voice) ?? "")),
    });
  }
}
export function slashNotationForVoice(state: SlashNotationState, staff: number, voice: string): SlashNotationStyle | undefined {
  const style = state.has(staff) ? state.get(staff) : state.get(0);
  return style && !style.exceptVoices.has(voice) ? style : undefined;
}
