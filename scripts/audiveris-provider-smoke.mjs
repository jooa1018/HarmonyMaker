import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [baseUrl, apiKey, pagePath, ...flags] = process.argv.slice(2);
if (!baseUrl || !apiKey || !pagePath) {
  throw new Error("usage: node scripts/audiveris-provider-smoke.mjs <baseUrl> <apiKey> <page.png> [--require-harmony]");
}
const requireHarmony = flags.includes("--require-harmony");
const auth = { Authorization: `Bearer ${apiKey}` };
const page = await readFile(pagePath);
const digest = createHash("sha256").update(page).digest("hex");
const key = `smoke-${crypto.randomUUID()}`;
const request = async (path, init = {}) => {
  const response = await fetch(`${baseUrl.replace(/\/$/u, "")}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response;
};
const health = await (await request("/health")).json();
const capabilities = await (await request("/v1/capabilities")).json();
const job = await (await request("/v1/jobs", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageCount: 1, idempotencyKey: `${key}-create` }),
})).json();
await request(`/v1/jobs/${job.jobId}/pages/0`, {
  method: "PUT",
  headers: { "Content-Type": "image/png", "Idempotency-Key": `${key}-upload`, "X-Page-Digest": digest },
  body: page,
});
await request(`/v1/jobs/${job.jobId}/start`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: `${key}-start` }),
});
let status;
for (let attempt = 0; attempt < 180; attempt += 1) {
  status = await (await request(`/v1/jobs/${job.jobId}/status`)).json();
  if (status.kind === "completed") break;
  if (status.kind === "failed") throw new Error(JSON.stringify(status));
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (status?.kind !== "completed") throw new Error(`provider did not complete: ${JSON.stringify(status)}`);
const result = await (await request(`/v1/jobs/${job.jobId}/result`)).text();
if (!result.includes("<score-partwise") && !result.includes("<score-timewise")) throw new Error("result is not MusicXML");
if (/<!DOCTYPE\b/u.test(result) || /<!ENTITY\b/u.test(result)) {
  throw new Error("result retains XML declarations rejected by the HarmonyMaker importer");
}
const harmonyCount = (result.match(/<harmony\b/gu) ?? []).length;
if (requireHarmony && harmonyCount === 0) {
  throw new Error("real chord-name OCR fixture produced no MusicXML harmony elements");
}
const metadata = await (await request(`/v1/jobs/${job.jobId}/metadata`)).json();
await request(`/v1/jobs/${job.jobId}`, { method: "DELETE", headers: { "Idempotency-Key": `${key}-delete` } });
console.log(JSON.stringify({ health, capabilities, jobId: job.jobId, metadata, musicXmlBytes: Buffer.byteLength(result), harmonyCount }, null, 2));
