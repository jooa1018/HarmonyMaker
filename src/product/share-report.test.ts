import { describe, expect, it, vi } from "vitest";

import { submitStoredShareReport, type DisplayedStoredShareAuthority } from "./share-report";

describe("stored share report locator authority", () => {
  it("does not POST A after delayed session bootstrap is superseded by navigation to B", async () => {
    const authorityA = { key: "stored:A", token: "stored-token-A1234" } as const;
    let displayed: DisplayedStoredShareAuthority | undefined = authorityA;
    let resolveBootstrap!: (response: Response) => void;
    const bootstrap = new Promise<Response>((resolve) => { resolveBootstrap = resolve; });
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/session") return bootstrap;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const fetcher = fetchMock as unknown as typeof fetch;

    const reporting = submitStoredShareReport({ authority: authorityA, currentAuthority: () => displayed, fetcher });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    displayed = { key: "stored:B", token: "stored-token-B1234" };
    resolveBootstrap(new Response(JSON.stringify({ ok: true, csrfToken: "csrf-A" }), { status: 200 }));

    await expect(reporting).resolves.toBe("superseded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/report"))).toBe(false);
  });
});
