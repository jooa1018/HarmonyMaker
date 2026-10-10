// Disposable browser-test server. Never uses an existing DB, object store, or keys.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
const env = { ...process.env, NODE_ENV: "development", HM_DEV_MEMORY_PERSISTENCE: "1", DATABASE_URL: "" };
for (const key of ["SESSION_TOKEN_HMAC_KEY", "CSRF_HMAC_KEY", "SHARE_ENCRYPTION_KEY", "SHARE_TOKEN_HMAC_KEY", "OWNER_DELETE_HMAC_KEY", "QUOTA_IP_HMAC_KEY", "INTERNAL_OPERATIONS_KEY"]) env[key] = randomBytes(32).toString("base64url");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", process.env.HM_UI_PORT ?? "3133"], { env, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code ?? 1; });
