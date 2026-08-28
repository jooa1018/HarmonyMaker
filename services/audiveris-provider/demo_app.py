from __future__ import annotations

import hashlib
import html
import os
import secrets
import uuid
from io import BytesIO

from fastapi import BackgroundTasks, File, Header, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import HTMLResponse, RedirectResponse
from PIL import ImageOps, UnidentifiedImageError

import app as provider

app = provider.app
DEMO_TOKEN = os.environ.get("HM_AUDIVERIS_DEMO_TOKEN", "")


def require_demo_token(token: str) -> None:
    if len(DEMO_TOKEN) < 24 or not secrets.compare_digest(token, DEMO_TOKEN):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")


def page_html(title: str, body: str, *, refresh_seconds: int | None = None) -> HTMLResponse:
    refresh = (
        f'<meta http-equiv="refresh" content="{refresh_seconds}" />'
        if refresh_seconds is not None
        else ""
    )
    return HTMLResponse(
        f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
{refresh}
<title>{html.escape(title)}</title>
<style>
:root{{color-scheme:light dark;font-family:system-ui,-apple-system,sans-serif}}
body{{max-width:720px;margin:0 auto;padding:24px 18px 60px;line-height:1.55}}
h1{{font-size:1.45rem}}
.card{{border:1px solid #8886;border-radius:14px;padding:16px;margin:18px 0}}
button,input{{font:inherit}}
button{{padding:11px 16px;border-radius:10px;border:1px solid #8888}}
.small{{font-size:.88rem;opacity:.75}}
pre{{white-space:pre-wrap;word-break:break-word}}
a{{word-break:break-all}}
</style>
</head>
<body>
<h1>{html.escape(title)}</h1>
{body}
</body>
</html>"""
    )


def canonical_png(raw: bytes) -> bytes:
    if not raw or len(raw) > provider.MAX_PAGE_BYTES:
        raise HTTPException(status_code=413, detail="사진 파일이 너무 큽니다.")
    try:
        with provider.Image.open(BytesIO(raw)) as opened:
            image = ImageOps.exif_transpose(opened).convert("L")
            max_side = 2600
            if max(image.size) > max_side:
                image.thumbnail((max_side, max_side), provider.Image.Resampling.LANCZOS)
            output = BytesIO()
            image.save(output, format="PNG", optimize=True)
            png = output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="이 사진 형식을 서버에서 읽지 못했습니다. JPG/PNG 또는 사진의 스크린샷으로 다시 시도하세요.",
        ) from error
    if not png or len(png) > provider.MAX_PAGE_BYTES:
        raise HTTPException(status_code=413, detail="PNG 변환 결과가 너무 큽니다.")
    return png


async def png_request(png: bytes) -> Request:
    sent = False

    async def receive() -> dict[str, object]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": png, "more_body": False}
        return {"type": "http.disconnect"}

    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "PUT",
        "scheme": "https",
        "path": "/demo-upload",
        "raw_path": b"/demo-upload",
        "query_string": b"",
        "headers": [(b"content-type", b"image/png")],
        "client": ("demo", 0),
        "server": ("demo", 443),
    }
    return Request(scope, receive)


@app.get("/demo/{token}", response_class=HTMLResponse)
def demo_page(token: str) -> HTMLResponse:
    require_demo_token(token)
    safe_token = html.escape(token, quote=True)
    return page_html(
        "Audiveris 5.10.2 임시 OMR 테스트",
        f"""
<p>악보 사진 한 장을 선택하면 임시 Render 서버에서 실제 Audiveris 엔진으로 MusicXML 변환을 시도합니다.</p>
<div class="card">
<form action="/demo/{safe_token}/submit" method="post" enctype="multipart/form-data">
  <p><input name="file" type="file" accept="image/*" required /></p>
  <p><button type="submit">인식 시작</button></p>
</form>
<p class="small">버튼은 JavaScript 없이 일반 HTML 제출로 동작합니다. JPG/PNG가 가장 확실하며, HEIC가 거부되면 사진의 스크린샷을 올리면 됩니다.</p>
</div>
<p class="small">테스트용 임시 서비스입니다. 서버 재시작 시 작업이 사라질 수 있습니다. 업로드는 한 페이지이며, 결과를 확인한 뒤 서버 작업을 삭제할 수 있습니다.</p>
""",
    )


@app.post("/demo/{token}/submit")
async def demo_submit(
    token: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> Response:
    require_demo_token(token)
    try:
        raw = await file.read(provider.MAX_PAGE_BYTES + 1)
        png = canonical_png(raw)
        created = provider.create_job(
            provider.CreateJobRequest(pageCount=1, idempotencyKey=f"demo-create-{uuid.uuid4()}")
        )
        job_id = created.jobId
        request = await png_request(png)
        await provider.upload_page(
            job_id,
            0,
            request,
            idempotency_key=f"demo-upload-{job_id}",
            page_digest=hashlib.sha256(png).hexdigest(),
        )
        provider.start_job(
            job_id,
            provider.IdempotentOperationRequest(idempotencyKey=f"demo-start-{job_id}"),
            background_tasks,
        )
    except HTTPException as error:
        detail = error.detail if isinstance(error.detail, str) else str(error.detail)
        return page_html(
            "업로드 실패",
            f'<div class="card"><pre>{html.escape(detail)}</pre><p><a href="/demo/{html.escape(token, quote=True)}">다시 시도</a></p></div>',
        )
    return RedirectResponse(
        url=f"/demo/{token}/job/{job_id}",
        status_code=status.HTTP_303_SEE_OTHER,
    )


@app.get("/demo/{token}/job/{job_id}", response_class=HTMLResponse)
def demo_job(token: str, job_id: str) -> HTMLResponse:
    require_demo_token(token)
    state = provider.get_status(job_id)
    kind = str(state.get("kind", "unknown"))
    safe_token = html.escape(token, quote=True)
    safe_job_id = html.escape(job_id, quote=True)

    if kind in {"created", "queued", "processing"}:
        progress = state.get("progressBp")
        progress_text = ""
        if isinstance(progress, int):
            progress_text = f" · {progress / 100:.0f}%"
        return page_html(
            "Audiveris 인식 중",
            f"""
<div class="card">
<p><strong>상태:</strong> {html.escape(kind)}{html.escape(progress_text)}</p>
<p>이 페이지는 약 3초마다 자동 새로고침됩니다.</p>
</div>
""",
            refresh_seconds=3,
        )

    if kind == "completed":
        result_url = f"/demo-api/{safe_token}/jobs/{safe_job_id}/result"
        delete_url = f"/demo/{safe_token}/job/{safe_job_id}/delete"
        return page_html(
            "Audiveris 인식 완료",
            f"""
<div class="card">
<p><strong>상태:</strong> completed</p>
<p><a href="{result_url}">MusicXML 결과 열기</a></p>
<form action="{delete_url}" method="post"><button type="submit">서버 작업 삭제</button></form>
</div>
""",
        )

    code = html.escape(str(state.get("code", "AUDIVERIS_FAILED")))
    message = html.escape(str(state.get("message", "인식에 실패했습니다.")))
    return page_html(
        "Audiveris 인식 실패",
        f"""
<div class="card">
<p><strong>{code}</strong></p>
<pre>{message}</pre>
<p><a href="/demo/{safe_token}">다른 사진으로 다시 시도</a></p>
</div>
""",
    )


@app.post("/demo/{token}/job/{job_id}/delete")
async def demo_delete_form(token: str, job_id: str) -> Response:
    require_demo_token(token)
    await provider.delete_job(job_id, idempotency_key=f"demo-delete-{job_id}")
    return RedirectResponse(url=f"/demo/{token}", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/demo-api/{token}/jobs")
def demo_create_job(token: str) -> provider.JobResponse:
    require_demo_token(token)
    return provider.create_job(
        provider.CreateJobRequest(pageCount=1, idempotencyKey=f"demo-create-{uuid.uuid4()}")
    )


@app.put("/demo-api/{token}/jobs/{job_id}/page", status_code=204)
async def demo_upload_page(token: str, job_id: str, request: Request) -> Response:
    require_demo_token(token)
    body = await request.body()
    digest = hashlib.sha256(body).hexdigest()
    return await provider.upload_page(
        job_id,
        0,
        request,
        idempotency_key=f"demo-upload-{job_id}",
        page_digest=digest,
    )


@app.post("/demo-api/{token}/jobs/{job_id}/start", status_code=202)
def demo_start_job(token: str, job_id: str, background_tasks: BackgroundTasks) -> Response:
    require_demo_token(token)
    return provider.start_job(
        job_id,
        provider.IdempotentOperationRequest(idempotencyKey=f"demo-start-{job_id}"),
        background_tasks,
    )


@app.get("/demo-api/{token}/jobs/{job_id}/status")
def demo_status(token: str, job_id: str) -> dict[str, object]:
    require_demo_token(token)
    return provider.get_status(job_id)


@app.get("/demo-api/{token}/jobs/{job_id}/result")
def demo_result(token: str, job_id: str) -> Response:
    require_demo_token(token)
    response = provider.get_result(job_id)
    response.headers["Content-Disposition"] = 'attachment; filename="audiveris-result.musicxml"'
    return response


@app.delete("/demo-api/{token}/jobs/{job_id}")
async def demo_delete(token: str, job_id: str) -> Response:
    require_demo_token(token)
    return await provider.delete_job(job_id, idempotency_key=f"demo-delete-{job_id}")
