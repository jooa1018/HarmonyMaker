import { canonicalJson } from "../../domain/digest/canonical";
import type { Diagnostic } from "../../domain/diagnostics";
import { recoveryXmlRoot, serializeRecoveryXml } from "../review/recovery";
import { xmlChild, xmlChildren, xmlDescendants, xmlText, type XmlElement } from "../musicxml/xml";
import type { WorkspaceOrigin, WorkspaceState } from "./model";

export interface WorkspaceNotationFeature {
  readonly eventId: string;
  /** Exact immutable note-local locator, not a broad ornament category. */
  readonly feature: string;
  readonly xml: string;
  readonly originalMeasureId: string;
  readonly originalCandidateKey: string;
  readonly partOrdinal: number;
  readonly measureOrdinal: number;
  readonly noteOrdinal: number;
}
interface OriginalNote {
  readonly eventId: string;
  readonly originalMeasureId: string;
  readonly originalCandidateKey: string;
  readonly partOrdinal: number;
  readonly measureOrdinal: number;
  readonly noteOrdinal: number;
  readonly features: readonly WorkspaceNotationFeature[];
}
let inventoryCache: { readonly xml: string; readonly notes: readonly OriginalNote[] } | undefined;
function originalNotes(origin: WorkspaceOrigin): readonly OriginalNote[] {
  // Legacy structural recovery substitutes its own event identities. Guessing
  // their raw-note ordinal would remove the wrong symbol; refuse that operation.
  if (origin.kind === "legacy-recovery") throw new RangeError("WORKSPACE_NOTATION_ORIGIN_UNMAPPABLE");
  if (inventoryCache?.xml === origin.xml) return inventoryCache.notes;
  const notes: OriginalNote[] = [];
  for (const [partOrdinal, part] of xmlChildren(recoveryXmlRoot(origin.xml), "part").entries()) {
    for (const [measureOrdinal, measure] of xmlChildren(part, "measure").entries()) {
      for (const [noteOrdinal, note] of xmlChildren(measure, "note").entries()) {
        const staff = Number(xmlText(xmlChild(note, "staff")) ?? "1"), voice = (xmlText(xmlChild(note, "voice")) ?? "1").normalize("NFC");
        if (!Number.isSafeInteger(staff) || staff < 1) continue;
        const identity = { eventId: `p${partOrdinal}m${measureOrdinal}n${noteOrdinal}`, originalMeasureId: `p${partOrdinal}m${measureOrdinal}`,
          originalCandidateKey: `lead:p:${partOrdinal}:s:${staff}:v:${voice.length}:${voice}`, partOrdinal, measureOrdinal, noteOrdinal };
        const features: WorkspaceNotationFeature[] = [];
        const append = (feature: string, node: XmlElement) => features.push({ ...identity, feature, xml: serializeRecoveryXml(node) });
        for (const name of ["grace", "cue", "time-modification"]) {
          for (const [index, node] of xmlChildren(note, name).entries()) append(`${name}:${index}`, node);
        }
        const counts = new Map<string, number>();
        for (const [index, container] of xmlDescendants(note, "ornaments").entries()) {
          const children = container.children.filter((child): child is XmlElement => child.kind === "element");
          for (const child of children) {
            const ordinal = counts.get(child.name) ?? 0; counts.set(child.name, ordinal + 1);
            append(`ornament:${child.name}:${ordinal}`, child);
          }
          // Empty or unusual containers must not disappear as a side effect of
          // removing a sibling trill. Their explicit locator stays unresolved.
          if (!children.length || Object.keys(container.attributes).length || container.children.some(child => child.kind === "text" && child.value.trim())) {
            append(`ornament-container:${index}`, container);
          }
        }
        if (features.length) notes.push({ ...identity, features });
      }
    }
  }
  inventoryCache = { xml: origin.xml, notes };
  return notes;
}
export function workspaceNotationInventory(origin: WorkspaceOrigin): readonly WorkspaceNotationFeature[] {
  return structuredClone(originalNotes(origin).flatMap(note => note.features));
}
export function remainingWorkspaceNotation(state: WorkspaceState, origin: WorkspaceOrigin): readonly WorkspaceNotationFeature[] {
  return workspaceNotationInventory(origin).filter(feature => !state.notationRemovals?.some(removed => removed.eventId === feature.eventId && removed.feature === feature.feature));
}
export function removeWorkspaceNotation(state: WorkspaceState, origin: WorkspaceOrigin | undefined, eventId: string, feature: string): WorkspaceState {
  if (!origin) throw new RangeError("WORKSPACE_NOTATION_ORIGIN_REQUIRED");
  const found = state.music?.parts.some(part => part.measures.some(measure => measure.leadEvents.some(event => event.workspaceEventId === eventId)
    || measure.unresolvedEvents?.some(event => event.id === eventId)));
  if (!found || !remainingWorkspaceNotation(state, origin).some(item => item.eventId === eventId && item.feature === feature)) {
    throw new RangeError("WORKSPACE_NOTATION_TARGET_INVALID");
  }
  return { ...state, notationTracking: true, notationRemovals: [...(state.notationRemovals ?? []), { eventId, feature }] };
}

/** Only exact parser unsupported-note diagnoses can be resolved here. Other
 * unsupported constructs, local OMR uncertainties and original evidence stay. */
export function synchronizeWorkspaceNotation(state: WorkspaceState, origin: WorkspaceOrigin, seed: WorkspaceState): WorkspaceState {
  if (!state.notationTracking || !state.music || !seed.music) return state;
  if (origin.kind === "legacy-recovery") return state;
  const notes = originalNotes(origin);
  const mapping = new Map<string, OriginalNote>();
  for (const diagnostic of seed.music.diagnostics) {
    if (diagnostic.code !== "IMPORT_UNSUPPORTED_ELEMENT" || diagnostic.details?.issue !== "unsupported-lead-note") continue;
    const details = diagnostic.details;
    const candidates = notes.filter(note => note.partOrdinal === details.partOrdinal && note.measureOrdinal === details.measureOrdinal && note.originalCandidateKey === details.candidateKey);
    const ordinal = Number(/:(\d+)$/u.exec(diagnostic.id)?.[1]);
    const note = Number.isSafeInteger(ordinal) ? candidates[ordinal] : undefined;
    if (!note) throw new RangeError("WORKSPACE_NOTATION_DIAGNOSTIC_UNMAPPABLE");
    mapping.set(diagnostic.id, note);
  }
  const replacements = new Map<string, Diagnostic | undefined>();
  const currentLocations = new Map<string, { readonly measureId: string; readonly candidateKey: string; readonly partOrdinal: number; readonly measureOrdinal: number }>();
  for (const part of state.music.parts) for (const measure of part.measures) {
    for (const event of [...measure.leadEvents.map(event => ({ id: event.workspaceEventId, candidateKey: event.candidateKey })), ...(measure.unresolvedEvents ?? [])]) {
      if (event.id) currentLocations.set(event.id, { measureId: measure.workspaceMeasureId!, candidateKey: event.candidateKey, partOrdinal: part.partOrdinal, measureOrdinal: measure.ordinal });
    }
  }
  for (const diagnostic of seed.music.diagnostics) {
    const note = mapping.get(diagnostic.id); if (!note) continue;
    const location = currentLocations.get(note.eventId);
    const pending = note.features.some(feature => !state.notationRemovals?.some(removed => removed.eventId === note.eventId && removed.feature === feature.feature));
    if (state.removedEventIds?.includes(note.eventId) || !pending) { replacements.set(diagnostic.id, undefined); continue; }
    if (!location) { replacements.set(diagnostic.id, diagnostic); continue; }
    const moved = location.partOrdinal !== note.partOrdinal || location.measureOrdinal !== note.measureOrdinal || location.candidateKey !== note.originalCandidateKey || location.measureId !== note.originalMeasureId;
    replacements.set(diagnostic.id, moved ? { ...diagnostic, details: { ...diagnostic.details, partOrdinal: location.partOrdinal, measureOrdinal: location.measureOrdinal,
      candidateKey: location.candidateKey, workspaceEventId: note.eventId, workspaceMeasureId: location.measureId } } : diagnostic);
  }
  const diagnostics = state.music.diagnostics.flatMap(diagnostic => replacements.has(diagnostic.id) ? replacements.get(diagnostic.id) ? [replacements.get(diagnostic.id)!] : [] : [diagnostic]);
  const issues = state.issues.flatMap(issue => {
    const id = issue.evidenceRef.startsWith("import-diagnostic/") ? issue.evidenceRef.slice("import-diagnostic/".length) : undefined;
    if (!id || !mapping.has(id)) return [issue];
    const diagnostic = replacements.get(id); if (!diagnostic) return [];
    const note = mapping.get(id)!, location = currentLocations.get(note.eventId);
    const originalIssue = seed.issues.find(original => original.id === issue.id) ?? issue;
    if (!location || location.measureId === note.originalMeasureId && location.candidateKey === note.originalCandidateKey) return [originalIssue];
    return [{ ...originalIssue, scope: { kind: "measure" as const, measureId: location.measureId, voiceKey: location.candidateKey }, targetIds: [location.measureId, note.eventId] }];
  });
  if (canonicalJson(diagnostics) === canonicalJson(state.music.diagnostics) && canonicalJson(issues) === canonicalJson(state.issues)) return state;
  return { ...state, music: { ...state.music, diagnostics }, issues };
}
