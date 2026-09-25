// Local OMR runtime readiness check. Read-only: hashes files, reads git HEAD.
// Usage: node scripts/check-omr-runtime.mjs <runtime-dir>   (or HM_LOCAL_IMAGE_COMPARE)
// Exit 0 = ready. Otherwise prints each missing/mismatched item with its preparation step.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(repo, "docs/implementation/omr-runtime/runtime-manifest.json"), "utf8"));
const root = process.argv[2] ?? process.env.HM_LOCAL_IMAGE_COMPARE;
const problems = [];
const need = (ok, item, fix) => { if (!ok) problems.push({ item, fix }); return ok; };
const hash = file => new Promise((resolve, reject) => { const h = createHash("sha256"); createReadStream(file).on("data", d => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject); });

if (!need(root && path.isAbsolute(root) && existsSync(root), "runtime directory (HM_LOCAL_IMAGE_COMPARE)", "외부 런타임 폴더의 절대 경로를 인자 또는 HM_LOCAL_IMAGE_COMPARE로 지정하세요 (docs/implementation/OMR_RUNTIME.md 1절).")) {
  console.log(JSON.stringify({ ready: false, problems }, null, 2)); process.exit(2);
}
const homr = path.join(root, "homr-source");
let head = "";
try { head = execFileSync("git", ["-c", `safe.directory=${homr}`, "-C", homr, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* reported below */ }
need(head === manifest.homrRevision, `homr-source git HEAD = ${manifest.homrRevision} (현재 ${head || "없음"})`, `git clone ${manifest.homrSource.split(" ")[0]} homr-source && git -C homr-source checkout ${manifest.homrRevision}`);
const python = path.join(root, "homr-windows-env/Scripts/python.exe");
let version = "";
if (need(existsSync(python), "homr-windows-env/Scripts/python.exe", `Python ${manifest.python} 가상환경을 homr-windows-env에 만들고 docs/implementation/omr-runtime/homr-windows-freeze.txt 로 설치 후 homr-source를 editable 설치하세요.`)) {
  try { version = execFileSync(python, ["--version"], { encoding: "utf8" }).trim(); } catch { /* reported below */ }
  need(version === `Python ${manifest.python}`, `Python ${manifest.python} (현재 ${version || "실행 불가"})`, "같은 minor 버전으로 가상환경을 다시 만드세요.");
  try {
    const frozen = execFileSync(python, ["-m", "pip", "freeze", "--exclude-editable"], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean).map(s => s.toLowerCase()).sort();
    const pinned = readFileSync(path.join(repo, "docs/implementation/omr-runtime/homr-windows-freeze.txt"), "utf8").split(/\r?\n/u).filter(l => l && !l.startsWith("-e ")).map(s => s.toLowerCase()).sort();
    const missing = pinned.filter(p => !frozen.includes(p));
    need(!missing.length, `pip 패키지 고정 버전 (${missing.length}개 불일치: ${missing.slice(0, 5).join(", ")})`, "pip install -r docs/implementation/omr-runtime/homr-windows-freeze.txt");
  } catch { need(false, "pip freeze 실행", "가상환경의 pip를 복구하세요."); }
}
for (const model of manifest.models) {
  const file = path.resolve(root, model.path);
  if (!need(file.startsWith(path.resolve(root) + path.sep) && existsSync(file), `모델/언어 데이터 ${model.path}`, model.path.startsWith("audiveris")
    ? `Audiveris ${manifest.audiveris} Windows 콘솔 MSI를 audiveris-portable/files 로 풀고 tessdata(eng/kor)를 audiveris-portable/tessdata 에 두세요.`
    : "homr 첫 실행(또는 homr 설치 스크립트)이 받는 모델을 이 경로에 두세요. 저장소에 모델을 넣지 않습니다.")) continue;
  const size = statSync(file).size;
  need(size === model.bytes && await hash(file) === model.sha256, `${model.path} sha256 ${model.sha256.slice(0, 12)}…`, "파일이 다릅니다. 같은 버전으로 다시 받으세요(수정·재배포하지 않음).");
}
const jars = path.join(root, "audiveris-portable/files/Audiveris/app");
const jarList = existsSync(jars) ? readdirSync(jars) : [];
need(jarList.some(j => /^leptonica-.*-windows-x86_64\.jar$/u.test(j)) && jarList.some(j => /^tesseract-.*-windows-x86_64\.jar$/u.test(j)), "Audiveris app 폴더의 leptonica/tesseract windows-x86_64 jar", `Audiveris ${manifest.audiveris} Windows 콘솔 MSI를 audiveris-portable/files 로 추출하세요.`);
console.log(JSON.stringify({ ready: problems.length === 0, runtime: root, homrRevision: head, python: version, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
