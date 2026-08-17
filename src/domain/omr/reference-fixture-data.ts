import type { BinaryDigest } from "../digest/canonical";

export const REFERENCE_OMR_PAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAQQAAAFUCAIAAABN5NWqAAAACXBIWXMAAAPoAAAD6AG1e1JrAAACv0lEQVR42u3bwQkAQAgDwfTftIJdRGZKOFjOTzLAiScAMYAYQAwgBhADiAHEAGIAMYAYQAwgBhADiAHEAGIAMYAYQAwgBhADiAHEAC9jCFTxM4AzCcQAYgAxgBhADCAGEAOIAcQAYgAxgBhADCAGEAOIAcQANtBgAw3OJBADiAHEAGIAMYAYQAwgBhADIAYQA4gBxABiADGAGEAMYAMNNtDgTAIxgBhADCAGEAOIAcQAYgAxgBhADCAGEAOIAcQAYgAxgA002ECDnwHEAGIAMYAYQAwgBkAMIAYQA4gBxABiADGAGEAMIAYQA9hAgw00OJNADCAGEAOIAcQAYgAxgBhADCAGEAOIAcQAYgAxgBhADCAGG2hsoMHPAGIAMYAYPAGIAcQAYgAxgBhADCAGEAOIAcQAYgAxgBhADGADDTbQ4EwCMYAYQAwgBhADiAHEAGIAMYAYQAwgBhADiAHEAGIAMYAYbKCxgQbEAGIAMYAYQAwgBhADiAHEAGIAMYAYQAwgBhADiAHEAGIAG2iwgQZnEogBxABiADGAGEAMIAYQA4gBxABiADGAGEAMIAYQAyAGsIHGBtrPAGIAMYAYQAwgBhADiAHEAGIAMYAYQAwgBhADiAHEAGIAMYANNNhAgzMJxABiADGAGEAMIAYQA4gBxABiADGAGEAMgBhADCAGEAPYQGMD7WcAMYAYQAwgBhADiAHEAGIAMYAYQAwgBhADiAHEAGIAMYAYwAYabKDBmQRiADGAGEAMIAYQA4gBxABiADEAYgAxgBhADCAGEAOIAWygwQYanEkgBhADiAHEAGIAMYAYQAwgBhADiAHEAGIAMYAYQAwgBrCBBhtocCaBGEAMIAYQA4gBxABiAMQAYgAxgBhADCAGEAOIAcQAYgAxgBhADCAGEAOIAcQAYgAxgBhADCAGEAOIAcQAhRaojdiQuuWJvAAAAABJRU5ErkJggg==";
export const REFERENCE_OMR_PAGE_DIGEST = "1a44f490518992a9746591a7a58198f8e81db896c9f12545b9307b053351c211" as BinaryDigest;
export const REFERENCE_OMR_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>HarmonyMaker Reference OMR Fixture</work-title></work>
  <part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><harmony><root><root-step>C</root-step></root><kind>major</kind></harmony><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>
</score-partwise>`;

export function referenceOmrPageBytes(): Uint8Array {
  const binary = globalThis.atob(REFERENCE_OMR_PAGE_BASE64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
