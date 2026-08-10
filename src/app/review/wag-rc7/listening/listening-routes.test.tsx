import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  RC7_COMPLETION_COOKIE,
  RC7_SESSION_COOKIE,
} from "../../../../review/wag-rc7/listening/session";
import type {
  Rc7EvaluatorResult,
  Rc7EvaluatorSessionPayload,
} from "../../../../review/wag-rc7/listening/types";
import WagRc7ListeningPage from "./page";
import { POST as completeSession } from "./complete/route";
import { POST as revealSession } from "./reveal/route";
import { POST as startSession } from "./session/route";

describe("rc.7 controlled listening HTTP boundary", () => {
  it("renders an evaluator-only cold start with no precomputed corpus metadata", () => {
    const html = renderToStaticMarkup(<WagRc7ListeningPage />);
    expect(html).toContain("Start Listening Session");
    expect(html).not.toContain("D-BUSY-CHORUS-ACCENT");
    expect(html).not.toContain("SUSPENSION_RELEASE");
    expect(html).not.toContain("candidateId");
    expect(html).not.toContain("winner");
    expect(html).not.toContain("mapping");
  });

  it("keeps mapping private until a complete evaluator response is accepted", async () => {
    const startResponse = await startSession(new NextRequest(
      "http://localhost/review/wag-rc7/listening/session",
      { method: "POST" },
    ));
    expect(startResponse.status).toBe(200);
    expect(startResponse.headers.get("cache-control")).toBe("no-store");
    const setCookie = startResponse.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${RC7_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");

    const sessionCookie = startResponse.cookies.get(RC7_SESSION_COOKIE)?.value;
    expect(sessionCookie).toBeTruthy();
    const payload = await startResponse.json() as Rc7EvaluatorSessionPayload;
    const publicJson = JSON.stringify(payload);
    expect(payload).toMatchObject({ comparisonCount: 18, sectionCount: 4 });
    for (const key of [
      "caseId",
      "preset",
      "texture",
      "candidateId",
      "opportunityKey",
      "cost",
      "winner",
      "runner-up",
      "mapping",
      "riskTags",
    ]) {
      expect(publicJson).not.toContain(`\"${key}\"`);
    }

    const earlyReveal = await revealSession(new NextRequest(
      "http://localhost/review/wag-rc7/listening/reveal",
      {
        method: "POST",
        headers: { cookie: `${RC7_SESSION_COOKIE}=${sessionCookie}` },
      },
    ));
    expect(earlyReveal.status).toBe(403);
    expect(await earlyReveal.json()).toEqual({ error: "LISTENING_COMPLETION_REQUIRED" });

    const result = completeResult(payload);
    const completionResponse = await completeSession(new NextRequest(
      "http://localhost/review/wag-rc7/listening/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${RC7_SESSION_COOKIE}=${sessionCookie}`,
        },
        body: JSON.stringify(result),
      },
    ));
    expect(completionResponse.status).toBe(200);
    expect(completionResponse.headers.get("cache-control")).toBe("no-store");
    expect(await completionResponse.json()).toEqual({ result });
    const completionCookie = completionResponse.cookies.get(RC7_COMPLETION_COOKIE)?.value;
    expect(completionCookie).toBeTruthy();
    expect(completionResponse.headers.get("set-cookie")).toContain("HttpOnly");

    const revealResponse = await revealSession(new NextRequest(
      "http://localhost/review/wag-rc7/listening/reveal",
      {
        method: "POST",
        headers: {
          cookie: `${RC7_SESSION_COOKIE}=${sessionCookie}; ${RC7_COMPLETION_COOKIE}=${completionCookie}`,
        },
      },
    ));
    expect(revealResponse.status).toBe(200);
    expect(revealResponse.headers.get("cache-control")).toBe("no-store");
    const reveal = await revealResponse.json() as {
      readonly schema: string;
      readonly comparisons: readonly unknown[];
      readonly sections: readonly unknown[];
    };
    expect(reveal).toMatchObject({
      schema: "hm-wag-rc7-listening-reveal-v1",
    });
    expect(reveal.comparisons).toHaveLength(18);
    expect(reveal.sections).toHaveLength(4);
    expect(JSON.stringify(reveal)).toContain("caseId");
    expect(JSON.stringify(reveal)).toContain("grammarRelation");
  }, 120_000);
});

function completeResult(payload: Rc7EvaluatorSessionPayload): Rc7EvaluatorResult {
  return {
    schema: "hm-wag-rc7-evaluator-result-v1",
    sessionId: payload.sessionId,
    comparisons: payload.comparisons.map((entry) => ({
      comparisonOrdinal: entry.ordinal,
      naturalnessChoice: "A",
      densityChoice: "similar",
      entryExitChoice: "B",
      optionalNote: "",
    })),
    sections: payload.sections.map((entry) => ({
      sectionOrdinal: entry.ordinal,
      densityChoice: "appropriate",
      entryExitChoice: "natural",
      liftChoice: "appropriate",
      fatigueChoice: "none",
      naturalnessChoice: 4,
      optionalNote: "",
    })),
  };
}
