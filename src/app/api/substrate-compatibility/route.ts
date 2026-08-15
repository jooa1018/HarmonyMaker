import {
  loadProductionSubstrateConfig,
  ProductionSubstrateConfigurationError,
} from "../../../server/substrate/config";
import { inspectSubstrateCompatibility } from "../../../server/substrate/runtime";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const snapshot = await inspectSubstrateCompatibility(loadProductionSubstrateConfig());
    return Response.json({ status: "compatible", ...snapshot });
  } catch (error) {
    if (error instanceof ProductionSubstrateConfigurationError) {
      return Response.json(
        {
          status: "configuration-required",
          code: error.code,
          missingVariables: error.missingVariables,
        },
        { status: 503 },
      );
    }
    throw error;
  }
}
