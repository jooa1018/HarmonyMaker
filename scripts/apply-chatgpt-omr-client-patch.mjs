import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// All bounded P2 patch chunks must be present before this transport executes.
const encoded = Array.from({ length: 8 }, (_, index) =>
  readFileSync(`scripts/chatgpt-patches/wave1.${String(index).padStart(2, "0")}.b64`, "utf8").trim(),
).join("");
const patch = Buffer.from(encoded, "base64");

execFileSync("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
  input: patch,
  stdio: ["pipe", "inherit", "inherit"],
});
execFileSync("git", ["apply", "--whitespace=nowarn", "-"], {
  input: patch,
  stdio: ["pipe", "inherit", "inherit"],
});
