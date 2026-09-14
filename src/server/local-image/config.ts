import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const HOMR_PIN = "457e7c6518a10ba755db2e60883419e56c4d7369";
export interface LocalImageConfig {
  readonly root: string; readonly compare: string; readonly repository: string; readonly origin: string;
  readonly python: string; readonly node: string; readonly worker: string;
  readonly applicationRevision: string; readonly runnerSha256: string; readonly modelsSha256: string;
  readonly models: readonly {path: string; bytes: number; sha256: string}[];
  readonly runnerFiles: readonly {path:string;sha256:string}[];
}
export function localImageEnabled(env = process.env): boolean { return env.HM_LOCAL_IMAGE_OMR === "1"; }
export async function hashFile(file: string): Promise<string> {
  const digest = createHash("sha256"); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest("hex");
}
export async function loadLocalImageConfig(env = process.env, repository = process.cwd()): Promise<LocalImageConfig> {
  if (!localImageEnabled(env) || process.platform !== "win32") throw new Error("LOCAL_IMAGE_DISABLED");
  const origin = env.HM_LOCAL_IMAGE_ORIGIN ?? "";
  const url = new URL(origin);
  if (url.origin !== origin || url.hostname !== "127.0.0.1" || url.protocol !== "http:" || !url.port) throw new Error("LOCAL_IMAGE_ORIGIN_CONFIG");
  if (!env.HM_LOCAL_IMAGE_ROOT || !path.isAbsolute(env.HM_LOCAL_IMAGE_ROOT)
    || !env.HM_LOCAL_IMAGE_COMPARE || !path.isAbsolute(env.HM_LOCAL_IMAGE_COMPARE)) throw new Error("LOCAL_IMAGE_PATH_CONFIG");
  const compare = await realpath(env.HM_LOCAL_IMAGE_COMPARE), repo = await realpath(repository);
  const python = path.join(compare, "homr-windows-env/Scripts/python.exe"), worker = path.join(repo, "scripts/local-image-worker.mjs");
  await Promise.all([stat(python), stat(worker)]);
  const run = (args: string[], cwd: string) => exec("git", ["-c", `safe.directory=${cwd}`, ...args], { cwd, windowsHide: true, maxBuffer: 1024 * 1024 });
  const homr = path.join(compare, "homr-source");
  if ((await run(["rev-parse", "HEAD"], homr)).stdout.trim() !== HOMR_PIN) throw new Error("LOCAL_IMAGE_MODEL_REVISION");
  const manifest = JSON.parse(await readFile(path.join(compare, "model-manifest.json"), "utf8")) as {models: {path:string;bytes:number;sha256:string}[]};
  const selected = manifest.models.filter(m => /^(homr-source|homr-windows-env)[\\/]/u.test(m.path));
  if (selected.length !== 6) throw new Error("LOCAL_IMAGE_MODELS_MISSING");
  const models = [...selected,
    {path:"audiveris-portable/tessdata/eng.traineddata",bytes:23466654,sha256:"daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047"},
    {path:"audiveris-portable/tessdata/kor.traineddata",bytes:15317715,sha256:"9520bfe9e3cfc38d4a808e036b0287c88a1d37fb80b9a0a23928ddccdd20595b"}];
  for (const model of models) {
    const file = path.resolve(compare, model.path);
    if (!file.startsWith(compare + path.sep) || (await stat(file)).size !== model.bytes || await hashFile(file) !== model.sha256) throw new Error("LOCAL_IMAGE_MODEL_INTEGRITY");
  }
  const files = (await run(["ls-files", "experiments/homr-integration", "src/server/local-image", "src/domain/omr/local-image.ts", "scripts/local-image-worker.mjs"], repo)).stdout.trim().split(/\r?\n/u).filter(Boolean);
  // New files may not be staged during development. Include the fixed worker and
  // application adapter files rather than calling that uncommitted code HEAD.
  for (const name of ["scripts/local-image-worker.mjs", "scripts/local-image-lock.py", "src/server/local-image/disk-lock.mjs", "src/server/local-image/security.ts", "src/server/local-image/config.ts", "src/server/local-image/service.ts", "src/server/local-image/http.ts", "src/domain/omr/local-image.ts"]) if (!files.includes(name)) files.push(name);
  if (!files.includes("experiments/homr-integration/timeline.py")) files.push("experiments/homr-integration/timeline.py");
  const runnerFiles = await Promise.all(files.sort().map(async name => ({path:name,sha256:await hashFile(path.join(repo,name))})));
  return {root:path.resolve(env.HM_LOCAL_IMAGE_ROOT),compare,repository:repo,origin,python,node:process.execPath,worker,
    applicationRevision:(await run(["rev-parse","HEAD"],repo)).stdout.trim(),
    runnerSha256:createHash("sha256").update(runnerFiles.map(file=>`${file.path}:${file.sha256}`).join("\n")).digest("hex"),
    modelsSha256:createHash("sha256").update(JSON.stringify(models)).digest("hex"),models,runnerFiles};
}
