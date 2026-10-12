import { test } from "node:test";
import assert from "node:assert/strict";
import { findPrivateMarkers } from "./check-private-paths.mjs";

const win = ["C:", "Users", "fixture-person", "work"].join("\\");
const unix = ["", "home", "fixture-person", "work"].join("/");
const mac = ["", "Users", "fixture-person", "work"].join("/");
test("detects Windows, escaped JSON, POSIX and macOS profile paths", () => {
  for (const path of [win, JSON.stringify(win), unix, mac, win.replaceAll("\\", "/")]) {
    assert.deepEqual(findPrivateMarkers(path), [{ line: 1, kind: "user-profile-path" }]);
  }
});
test("detects report identity fields in JSON, YAML and Markdown tables", () => {
  for (const key of ["host" + "name", "computer" + "Name", "machine" + "_name"]) {
    for (const text of [JSON.stringify({ [key]: "fixture-device" }), key + ": fixture-device", "| " + key + " | fixture-device |"])
      assert.equal(findPrivateMarkers(text)[0]?.kind, "host-identity-field");
  }
});
test("allows placeholders, network code and loopback bind options", () => {
  for (const text of ["%USERPROFILE%/work", "const host = request.headers.get('host');", "url.hostname", "next start --hostname 127.0.0.1", "DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE"])
    assert.deepEqual(findPrivateMarkers(text), []);
});
test("findings contain only line and rule, never the sensitive input", () => {
  assert.deepEqual(findPrivateMarkers("safe\n" + win), [{ line: 2, kind: "user-profile-path" }]);
  assert.equal(JSON.stringify(findPrivateMarkers(win)).includes("fixture-person"), false);
});
