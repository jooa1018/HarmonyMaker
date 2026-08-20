import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getProductionServices = vi.hoisted(() => vi.fn());
vi.mock("../substrate/services", () => ({ getProductionServices }));

import { NextRequest } from "next/server";
import { GET as listReports } from "../../app/api/internal/moderation/reports/route";
import { POST as claimReport } from "../../app/api/internal/moderation/reports/[reportId]/claim/route";
import { POST as resolveReport } from "../../app/api/internal/moderation/reports/[reportId]/resolve/route";

const key = Buffer.alloc(32, 9).toString("base64url");

afterEach(() => { delete process.env.INTERNAL_OPERATIONS_KEY; getProductionServices.mockReset(); });

describe("moderation route authorization boundary", () => {
  it("rejects list/claim/resolve before service or database composition", async () => {
    process.env.INTERNAL_OPERATIONS_KEY = key;
    const list = await listReports(new NextRequest("https://hm.test/api/internal/moderation/reports"));
    const claim = await claimReport(new NextRequest("https://hm.test/api/internal/moderation/reports/1/claim", { method: "POST", body: JSON.stringify({ moderatorId: "moderator-A" }) }), { params: Promise.resolve({ reportId: "1" }) });
    const resolve = await resolveReport(new NextRequest("https://hm.test/api/internal/moderation/reports/1/resolve", { method: "POST", body: JSON.stringify({ claimToken: "claim", resolution: "dismissed" }) }), { params: Promise.resolve({ reportId: "1" }) });
    expect([list.status, claim.status, resolve.status]).toEqual([403, 403, 403]);
    expect(getProductionServices).not.toHaveBeenCalled();
  });
});
