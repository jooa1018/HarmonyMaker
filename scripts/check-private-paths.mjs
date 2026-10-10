import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function findPrivateMarkers(source) {
  // Scan raw and JSON-escaped Windows separators without printing captured identities.
  const profile = /(?:[a-z]:[\\/]+Users[\\/]+[^\\/\s"'<>`]+|\/(?:home|Users)\/[^/\s"'<>`]+)/iu;
  // Literal report/config identity fields. URL.hostname and --hostname are not fields.
  const hostField = /(?:^|[\s{,|])["'`]*(?:host[-_ ]?name|computer[-_ ]?name|machine[-_ ]?name)["'`]*\s*(?::|=|\|)\s*\S/iu;
  return source.split(/\r?\n/u).flatMap((line, index) => {
    const kinds = [];
    if (profile.test(line)) kinds.push("user-profile-path");
    if (hostField.test(line)) kinds.push("host-identity-field");
    return kinds.map(kind => ({ line: index + 1, kind }));
  });
}

export function checkTrackedFiles() {
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  let violations = 0;
  for (const path of paths) {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue; // binary artifact
    let source;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { continue; }
    for (const issue of findPrivateMarkers(source)) {
      // Even a suspicious filename is redacted; never echo the source line or value.
      const safePath = findPrivateMarkers(path).length ? "[redacted-file]" : path;
      console.error(`${safePath}:${issue.line}: ${issue.kind}`);
      violations++;
    }
  }
  if (violations) process.exitCode = 1;
  else console.log(`Privacy check passed (${paths.length} tracked files).`);
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkTrackedFiles();
