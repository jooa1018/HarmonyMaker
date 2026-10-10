import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { prepareQuickHarmony, generateQuickHarmony } from "./quick-harmony";
import { exportHarmonyProject } from "./project-transfer";

// Opt-in timing harness: one warm-up followed by three measured generations.
// HM_BENCHMARK_OUTPUT points to a report outside the repository.
it.skipIf(!process.env.HM_BENCHMARK_OUTPUT)("benchmarks a 120-measure original trio", async () => {
  const original = readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml", import.meta.url), "utf8");
  const measures = [...original.matchAll(/<measure\b[^>]*>[\s\S]*?<\/measure>/gu)].map(match => match[0]);
  const expanded = Array.from({length:120}, (_, i) => measures[i % measures.length].replace(/number="\d+"/u, `number="${i + 1}"`)).join("");
  const xml = original.replace(/<measure\b[\s\S]*<\/measure>/u, expanded);
  const prep = await prepareQuickHarmony({bytes: new TextEncoder().encode(xml), fileName:"original-120.musicxml"});
  expect(prep.status).toBe("ready");
  const samples: number[] = [];
  const hashes: string[] = [];
  for(let i = 0; i < 4; i++) {
    const start = performance.now();
    const result = await generateQuickHarmony(prep, {parts:["alto","tenor"], rightsConfirmed:true, confirmedAt:"2026-10-10T00:00:00.000Z"});
    const ms = performance.now() - start;
    expect(result.status).toBe("complete");
    if(result.status !== "complete")throw new Error(result.status);
    expect(result.project.source.sourceMeasures).toHaveLength(120);
    hashes.push(createHash("sha256").update(await exportHarmonyProject(result.project)).digest("hex"));
    if(i > 0)samples.push(ms);
  }
  expect(new Set(hashes).size).toBe(1);
  const report = {measures:120, parts:["alto","tenor"], warmupRuns:1, generationMs:samples, medianMs:[...samples].sort((a,b)=>a-b)[1], projectSha256:hashes[0]};
  writeFileSync(process.env.HM_BENCHMARK_OUTPUT!, JSON.stringify(report,null,2));
}, 600_000);
