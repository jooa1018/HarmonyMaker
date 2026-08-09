import { semanticDigest } from "../../domain/digest/canonical";
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticLocation,
  DiagnosticSeverity,
} from "../../domain/diagnostics";

export interface ImportDiagnosticInput {
  readonly code: DiagnosticCode;
  readonly severity?: DiagnosticSeverity;
  readonly messageKo: string;
  readonly location?: DiagnosticLocation;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export async function materializeImportDiagnostics(
  inputs: readonly ImportDiagnosticInput[],
): Promise<readonly Diagnostic[]> {
  const projected = await Promise.all(inputs.map(async (input) => ({
    input,
    key: await semanticDigest({
      code: input.code,
      severity: input.severity ?? "blocking",
      location: input.location ?? null,
      details: input.details ?? null,
    }),
  })));
  projected.sort((left, right) => left.input.code < right.input.code
    ? -1
    : left.input.code > right.input.code
      ? 1
      : left.key < right.key
        ? -1
        : left.key > right.key
          ? 1
          : 0);
  const counts = new Map<string, number>();
  return projected.map(({ input, key }) => {
    const ordinal = counts.get(`${input.code}:${key}`) ?? 0;
    counts.set(`${input.code}:${key}`, ordinal + 1);
    return {
      id: `dg:${input.code}:${key}:${ordinal}`,
      code: input.code,
      severity: input.severity ?? "blocking",
      messageKo: input.messageKo,
      ...(input.location ? { location: input.location } : {}),
      ...(input.details ? { details: input.details } : {}),
    };
  });
}

export function diagnosticInputsFromDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly ImportDiagnosticInput[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    messageKo: diagnostic.messageKo,
    ...(diagnostic.location ? { location: diagnostic.location } : {}),
    ...(diagnostic.details ? { details: diagnostic.details } : {}),
  }));
}
