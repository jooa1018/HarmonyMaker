from pathlib import Path
import re

service = Path("src/server/share/share-store-core.ts").read_text(encoding="utf-8")
candidates = re.findall(r"async\s+(\w*[Rr]econcile\w*)\s*\(", service)
owner_methods = [name for name in candidates if "owner" in name.lower()]
if not owner_methods:
    raise SystemExit(f"owner reconciliation method not found: {candidates}")
method = owner_methods[0]

path = Path("src/server/share/idempotent-create.ts")
text = path.read_text(encoding="utf-8")
if "ensureCurrentShareCreateReplay" not in text:
    helper = f'''\nfunction shareReplayAggregateIsActive(value: unknown): boolean {{\n  if (value === true) return true;\n  if (!value || typeof value !== "object") return false;\n  const record = value as Readonly<Record<string, unknown>>;\n  return record.lifecycle === "active" || record.status === "active" || record.kind === "active";\n}}\n\nexport async function ensureCurrentShareCreateReplay<T extends {{ readonly status: number; readonly body: unknown }}>(input: {{\n  readonly result: T;\n  readonly shares: ShareStoreService;\n  readonly now: Date;\n}}): Promise<T | {{ readonly status: 409; readonly body: {{ readonly ok: false; readonly error: {{ readonly code: "SHARE_CREATE_REPLAY_RETIRED"; readonly messageKo: string }} }} }}> {{\n  if (input.result.status !== 200 || !input.result.body || typeof input.result.body !== "object") return input.result;\n  const body = input.result.body as Readonly<Record<string, unknown>>;\n  if (body.ok !== true || typeof body.token !== "string" || typeof body.ownerDeleteSecret !== "string") return input.result;\n  try {{\n    const aggregate = await (input.shares as unknown as {{\n      readonly {method}: (request: {{ readonly token: string; readonly ownerDeleteSecret: string; readonly now: Date }}) => Promise<unknown>;\n    }}).{method}({{ token: body.token, ownerDeleteSecret: body.ownerDeleteSecret, now: input.now }});\n    if (shareReplayAggregateIsActive(aggregate)) return input.result;\n  }} catch {{\n    // A cached successful response is lower authority than the current durable lifecycle.\n  }}\n  return {{\n    status: 409,\n    body: {{ ok: false, error: {{ code: "SHARE_CREATE_REPLAY_RETIRED", messageKo: "이전 공유는 더 이상 active 상태가 아닙니다. 명시적으로 새 공유를 시작해 주세요." }} }},\n  }};\n}}\n'''
    text = text.rstrip() + helper + "\n"
path.write_text(text, encoding="utf-8")

for relative_path, function_name in [
    ("src/app/api/shares/route.ts", "createShareIdempotently"),
    ("src/app/api/shares/recover/route.ts", "recoverShareCreateIdempotently"),
]:
    route = Path(relative_path)
    source = route.read_text(encoding="utf-8")
    if "ensureCurrentShareCreateReplay" not in source:
        source = re.sub(
            r'import \{([^}]*)\} from "([^"]*idempotent-create)";',
            lambda match: 'import {' + match.group(1).rstrip() + ', ensureCurrentShareCreateReplay } from "' + match.group(2) + '";',
            source,
            count=1,
        )
    call = re.search(rf"const\s+(\w+)\s*=\s*await\s+{function_name}\(", source)
    if not call:
        raise SystemExit(f"{function_name} call not found in {relative_path}")
    result_name = call.group(1)
    if f"ensureCurrentShareCreateReplay({{ result: {result_name}" not in source:
        patterns = [
            rf"return\s+NextResponse\.json\({result_name}\.body,\s*\{{\s*status:\s*{result_name}\.status\s*\}}\);",
            rf"return\s+Response\.json\({result_name}\.body,\s*\{{\s*status:\s*{result_name}\.status\s*\}}\);",
        ]
        for pattern in patterns:
            match = re.search(pattern, source)
            if match:
                replacement = f'const currentResult = await ensureCurrentShareCreateReplay({{ result: {result_name}, shares: services.shares, now }});\n    return NextResponse.json(currentResult.body, {{ status: currentResult.status }});'
                source = source[:match.start()] + replacement + source[match.end():]
                break
        else:
            raise SystemExit(f"response return not found in {relative_path}")
    route.write_text(source, encoding="utf-8")

Path("src/server/share/share-replay-lifecycle.test.ts").write_text(f'''import {{ describe, expect, it }} from "vitest";\n\nimport {{ ensureCurrentShareCreateReplay }} from "./idempotent-create";\n\nconst replay = {{ status: 200, body: {{ ok: true, token: "share-token", ownerDeleteSecret: "owner-secret" }} }} as const;\n\ndescribe("current Share lifecycle replay authority", () => {{\n  it("returns the exact replay only while the durable share remains active", async () => {{\n    const shares = {{ {method}: async () => ({{ lifecycle: "active" }}) }} as never;\n    await expect(ensureCurrentShareCreateReplay({{ result: replay, shares, now: new Date("2026-01-01T00:00:00.000Z") }})).resolves.toEqual(replay);\n  }});\n\n  it.each(["disabled", "deleted", "expired"])("retires a cached replay after the durable lifecycle becomes %s", async (lifecycle) => {{\n    const shares = {{ {method}: async () => ({{ lifecycle }}) }} as never;\n    await expect(ensureCurrentShareCreateReplay({{ result: replay, shares, now: new Date("2026-01-01T00:00:00.000Z") }})).resolves.toEqual({{\n      status: 409,\n      body: {{ ok: false, error: {{ code: "SHARE_CREATE_REPLAY_RETIRED", messageKo: expect.any(String) }} }},\n    }});\n  }});\n}});\n''', encoding="utf-8")
