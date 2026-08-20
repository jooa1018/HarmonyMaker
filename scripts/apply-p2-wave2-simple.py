from pathlib import Path
import re


def replace_function_body(path: Path, start_marker: str, end_marker: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


# P2-REAUDIT-04: reject a schema-valid canonical plaintext overflow before
# idempotency/quota durable effects are claimed.
path = Path("src/server/share/idempotent-create.ts")
text = path.read_text(encoding="utf-8")
if "validateShareCreatePayloadBeforeEffects" not in text:
    text = re.sub(
        r'import \{([^}]*)\} from "\.\./\.\./domain/digest/canonical";',
        lambda match: 'import {' + ((' canonicalJson,' if 'canonicalJson' not in match.group(1) else '') + match.group(1)) + '} from "../../domain/digest/canonical";',
        text,
        count=1,
    )
    text = re.sub(
        r'import \{([^}]*)\} from "\.\./\.\./domain/share";',
        lambda match: 'import {' + ((' isPracticeSharePayload, PRACTICE_SHARE_LIMITS,' if 'isPracticeSharePayload' not in match.group(1) else (' PRACTICE_SHARE_LIMITS,' if 'PRACTICE_SHARE_LIMITS' not in match.group(1) else '')) + match.group(1)) + '} from "../../domain/share";',
        text,
        count=1,
    )
    marker = "export async function createShareIdempotently"
    index = text.index(marker)
    helper = '''function validateShareCreatePayloadBeforeEffects(payload: PracticeSharePayload): void {\n  if (!isPracticeSharePayload(payload)) throw new RangeError("SHARE_PAYLOAD_INVALID");\n  const plaintextBytes = new TextEncoder().encode(canonicalJson(payload)).byteLength;\n  if (plaintextBytes > PRACTICE_SHARE_LIMITS.maxPlaintextBytes) throw new RangeError("SHARE_PAYLOAD_TOO_LARGE");\n}\n\n'''
    text = text[:index] + helper + text[index:]
    signature = re.search(r'export async function createShareIdempotently\([\s\S]*?\n\): Promise<[^\n]+> \{\n', text)
    if not signature:
        raise SystemExit("createShareIdempotently signature not found")
    text = text[:signature.end()] + "  validateShareCreatePayloadBeforeEffects(input.payload);\n" + text[signature.end():]
path.write_text(text, encoding="utf-8")


# P2-REAUDIT-05: a late owner-delete response may only mutate the exact
# route/revision and exact locally persisted share authority that dispatched it.
path = Path("src/app/workspace/WorkspaceClient.tsx")
text = path.read_text(encoding="utf-8")
start = text.index("  const deleteStoredShare = async () => {")
end = text.index("\n\n  if (!project)", start)
replacement = '''  const deleteStoredShare = async () => {\n    if (!storedShare) return;\n    let operationAuthority: ReturnType<WorkspaceRouteController["beginMutation"]>;\n    try { operationAuthority = routeController.beginMutation(projectId); }\n    catch { return; }\n    const expectedShare = { ...storedShare };\n    const bootstrap = await fetch("/api/session", { method: "POST" });\n    const session = await bootstrap.json() as { csrfToken?: string };\n    if (!routeController.mutationStillCurrent(projectId, operationAuthority.projectId)) return;\n    if (!bootstrap.ok || !session.csrfToken) { setMessage("ShareStore 삭제 권한을 확인하지 못했습니다."); return; }\n    const response = await fetch(`/api/shares/${encodeURIComponent(expectedShare.token)}`, { method: "DELETE", headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken }, body: JSON.stringify({ ownerDeleteSecret: expectedShare.ownerDeleteSecret }) });\n    if (!routeController.mutationStillCurrent(projectId, operationAuthority.projectId)) return;\n    const currentEnvelope = await shareRecoveryStore.load(projectId).catch(() => undefined);\n    const exactLocalAuthority = currentEnvelope?.createdResponse?.token === expectedShare.token\n      && currentEnvelope.createdResponse.ownerDeleteSecret === expectedShare.ownerDeleteSecret;\n    if (!exactLocalAuthority) return;\n    if (response.ok) {\n      await shareRecoveryStore.delete(projectId);\n      if (!routeController.mutationStillCurrent(projectId, operationAuthority.projectId)) return;\n      setStoredShare(undefined); setShareFreshAllowed(false); setShareUrl(undefined); setMessage("ShareStore 공유를 소유자 삭제했고 로컬 복구 권위를 제거했습니다.");\n    } else setMessage("ShareStore 공유를 삭제하지 못했습니다.");\n  };'''
path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
