import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { NextRequest } from "next/server";
import { mapApiFailure } from "./api";
import { readBoundedJson } from "./omr-api";

function streamedRequest(chunks: readonly Uint8Array[], contentLength?: string) {
  let index = 0;
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      const chunk = chunks[index];
      index += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return {
    request: { headers, body } as NextRequest,
    observations: { get pulls() { return pulls; }, get cancelled() { return cancelled; } },
  };
}

const bytes = (value: string) => new TextEncoder().encode(value);

describe("bounded OMR JSON request reader", () => {
  it("maps retired create replay to a sanitized explicit conflict", async () => {
    const response = await mapApiFailure(new RangeError("OMR_CREATE_REPLAY_UNAVAILABLE"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "OMR_CREATE_REPLAY_UNAVAILABLE",
        messageKo: "이 생성 요청의 이전 OMR 작업은 더 이상 사용할 수 없습니다. 새 요청 키로 다시 시작해 주세요.",
      },
    });
  });

  it("cancels a chunked body shortly after the raw byte limit is crossed", async () => {
    const chunks = Array.from({ length: 32 }, () => new Uint8Array(8 * 1024).fill(0x20));
    const streamed = streamedRequest(chunks);
    await expect(readBoundedJson(streamed.request)).rejects.toThrow("OMR_REQUEST_TOO_LARGE");
    expect(streamed.observations.cancelled).toBe(true);
    expect(streamed.observations.pulls).toBeLessThan(chunks.length);
  });

  it("rejects and cancels immediately after receiving one oversized chunk", async () => {
    const streamed = streamedRequest([new Uint8Array(65).fill(0x20), bytes("not-consumed")]);
    await expect(readBoundedJson(streamed.request, 64)).rejects.toThrow("OMR_REQUEST_TOO_LARGE");
    expect(streamed.observations.cancelled).toBe(true);
    expect(streamed.observations.pulls).toBe(1);
  });

  it("parses bounded JSON split across many chunks without Content-Length", async () => {
    const streamed = streamedRequest([bytes('{"ok"'), bytes(":true,"), bytes('"count"'), bytes(":2}")]);
    await expect(readBoundedJson(streamed.request)).resolves.toEqual({ ok: true, count: 2 });
  });

  it("uses raw UTF-8 bytes rather than JavaScript character count", async () => {
    const payload = bytes('"é"');
    expect(payload.byteLength).toBe(4);
    await expect(readBoundedJson(streamedRequest([payload]).request, 4)).resolves.toBe("é");
    await expect(readBoundedJson(streamedRequest([payload]).request, 3)).rejects.toThrow("OMR_REQUEST_TOO_LARGE");
  });

  it("rejects malformed UTF-8 before JSON parsing", async () => {
    const malformed = new Uint8Array([0x22, 0xc3, 0x28, 0x22]);
    await expect(readBoundedJson(streamedRequest([malformed]).request)).rejects.toThrow("OMR_REQUEST_INVALID");
  });

  it("rejects malformed or unsafe Content-Length before consuming the body", async () => {
    for (const declared of ["-1", "abc", "1.5", "9007199254740992"]) {
      const streamed = streamedRequest([bytes("{}")], declared);
      await expect(readBoundedJson(streamed.request)).rejects.toThrow("OMR_REQUEST_INVALID");
      expect(streamed.observations.pulls).toBe(0);
    }
    const oversized = streamedRequest([bytes("{}")], "65537");
    await expect(readBoundedJson(oversized.request)).rejects.toThrow("OMR_REQUEST_TOO_LARGE");
    expect(oversized.observations.pulls).toBe(0);
  });

  it("keeps the streamed byte count authoritative when a declared size is smaller", async () => {
    const streamed = streamedRequest([new Uint8Array(65).fill(0x20)], "1");
    await expect(readBoundedJson(streamed.request, 64)).rejects.toThrow("OMR_REQUEST_TOO_LARGE");
  });
});
