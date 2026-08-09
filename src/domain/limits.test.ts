import { describe, expect, it } from "vitest";
import {
  CORE_INPUT_LIMITS,
  validateCoreInputLimits,
  type CoreInputCountKey,
} from "./limits";

describe("CoreInputLimits single authority", () => {
  it.each(Object.entries(CORE_INPUT_LIMITS) as [CoreInputCountKey, number][])(
    "accepts %s at the exact boundary and blocks boundary + 1",
    (limit, maximum) => {
      expect(validateCoreInputLimits({ [limit]: maximum })).toEqual([]);
      expect(validateCoreInputLimits({ [limit]: maximum + 1 })).toEqual([{
        limit,
        actual: maximum + 1,
        maximum,
      }]);
    },
  );
});
