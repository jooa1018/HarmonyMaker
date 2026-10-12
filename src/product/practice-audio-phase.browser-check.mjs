// Local OfflineAudioContext verification, without a product server or services.
// AUDIO_BROWSER_CHANNEL=msedge and PLAYWRIGHT_MODULE may select local tooling.
import assert from "node:assert/strict";
import { createServer } from "vite";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "@playwright/test");
const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, appType: "custom" });
server.middlewares.use("/phase-check", (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Audio phase verification</title>"); });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.AUDIO_BROWSER_CHANNEL ? { channel: process.env.AUDIO_BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/phase-check`);
  const rows = await page.evaluate(async () => {
    const { schedulePracticeAudio } = await import("/src/product/practice-audio.ts");
    const sampleRate = 44100, frequency = 440 * 2 ** ((72 - 69) / 12);
    async function render(midi, delay) {
      const ctx = new OfflineAudioContext(1, sampleRate * 3, sampleRate);
      const event = { eventId: "lead", trackId: "track:source-lead", kind: "voice", midi: 72, startQuarter: 0, durationQuarter: 4, lyricOnset: false };
      const plan = { totalQuarter: 4, trackIds: ["track:source-lead", "harmony"], trackLabels: {}, trackRoles: { "track:source-lead": "lead", harmony: midi === 60 ? "upper" : "lower" }, effectiveChordTimelineDigest: "test",
        events: midi === null ? [event] : [event, { ...event, eventId: "harmony", trackId: "harmony", midi, startQuarter: delay, durationQuarter: 4 - delay }] };
      const before = JSON.stringify(plan);
      // Stay below the limiter threshold to isolate phase cancellation from its
      // intentional gain reduction when a second voice increases total energy.
      schedulePracticeAudio(ctx, plan, { fromQuarter: 0, secondsPerQuarter: 0.75, startedAt: 0, audible: new Set(plan.trackIds), levels: {}, masterLevel: 0.2 });
      const audio = (await ctx.startRendering()).getChannelData(0);
      if (before !== JSON.stringify(plan)) throw Error("Plan mutated");
      return audio;
    }
    function amplitude(data, start, hz) {
      // Integer-cycle window avoids leakage from the target tone; a Hann window
      // suppresses unrelated harmonics and filter/envelope transients.
      const length = Math.round(150 / hz * sampleRate), offset = Math.round(start * sampleRate);
      let real = 0, imag = 0, weight = 0;
      for (let i = 0; i < length; i++) {
        const w = (1 - Math.cos(2 * Math.PI * i / (length - 1))) / 2;
        const phase = 2 * Math.PI * hz * (offset + i) / sampleRate;
        real += data[offset + i] * w * Math.cos(phase); imag += data[offset + i] * w * Math.sin(phase); weight += w;
      }
      return 2 * Math.hypot(real, imag) / weight;
    }
    const solo = await render(null, 0), rows = [];
    for (const midi of [72, 60, 76]) for (let step = 0; step <= 10; step++) {
      const delay = step / 10, audio = await render(midi, delay), start = delay * 0.75 + 0.3;
      rows.push({ midi, delay, ratio: amplitude(audio, start, frequency) / amplitude(solo, start, frequency) });
    }
    return rows;
  });
  for (const row of rows.filter(row => row.midi !== 76)) assert.ok(row.ratio >= 0.99, JSON.stringify(row));
  // A distinct pitch must not erase the melody either; limiter gain reduction is
  // expected here, so this control checks for a large destructive cancellation.
  for (const row of rows.filter(row => row.midi === 76)) assert.ok(row.ratio >= 0.7, JSON.stringify(row));
  console.log(JSON.stringify({ rows, minimumUnison: Math.min(...rows.filter(r => r.midi === 72).map(r => r.ratio)), minimumOctave: Math.min(...rows.filter(r => r.midi === 60).map(r => r.ratio)) }));
} finally { await browser.close(); await server.close(); }
