import type { ArrangementPresetId } from "@/domain/config";
import { RC7_PRESET_ORDER, RC7_REVIEW_BOUNDARY } from "@/review/wag-rc7/constants";
import { runRc7ReferenceCaseById } from "@/review/wag-rc7/harness";

function isPreset(value: string | null): value is ArrangementPresetId {
  return value !== null && RC7_PRESET_ORDER.some((preset) => preset === value);
}

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly caseId: string }> },
) {
  const presetValue = new URL(request.url).searchParams.get("preset");
  if (!isPreset(presetValue)) {
    return Response.json(
      { error: "RC7_REVIEW_PRESET_INVALID", allowed: RC7_PRESET_ORDER },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { caseId } = await context.params;
    const output = await runRc7ReferenceCaseById(caseId, { presetOverride: presetValue });
    return new Response(`${JSON.stringify(output, null, 2)}\n`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${caseId}-${presetValue}-rc7-review.json"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-HarmonyMaker-Authority": "isolated-review-only",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RC7_REVIEW_GENERATION_FAILED";
    const notFound = message.startsWith("RC7_REVIEW_CASE_NOT_FOUND:");
    return Response.json(
      { error: message, authorityBoundary: RC7_REVIEW_BOUNDARY },
      { status: notFound ? 404 : 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
