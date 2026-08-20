export interface DisplayedStoredShareAuthority {
  readonly key: string;
  readonly token: string;
}

export type StoredShareReportOutcome = "accepted" | "failed" | "superseded";

function sameAuthority(left: DisplayedStoredShareAuthority | undefined, right: DisplayedStoredShareAuthority): boolean {
  return left?.key === right.key && left.token === right.token;
}

export async function submitStoredShareReport(input: {
  readonly authority: DisplayedStoredShareAuthority;
  readonly currentAuthority: () => DisplayedStoredShareAuthority | undefined;
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<StoredShareReportOutcome> {
  const fetcher = input.fetcher ?? fetch;
  const current = () => sameAuthority(input.currentAuthority(), input.authority);
  if (!current() || input.signal?.aborted) return "superseded";
  try {
    const bootstrap = await fetcher("/api/session", { method: "POST", ...(input.signal ? { signal: input.signal } : {}) });
    const session = await bootstrap.json() as { csrfToken?: string };
    if (!current() || input.signal?.aborted) return "superseded";
    if (!bootstrap.ok || !session.csrfToken) return "failed";
    const response = await fetcher(`/api/shares/${encodeURIComponent(input.authority.token)}/report`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken },
      body: JSON.stringify({ category: "rights-or-abuse" }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!current() || input.signal?.aborted) return "superseded";
    return response.ok ? "accepted" : "failed";
  } catch {
    return current() && !input.signal?.aborted ? "failed" : "superseded";
  }
}
