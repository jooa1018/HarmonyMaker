from __future__ import annotations

import hashlib
import json
import os
import secrets
import uuid
from typing import Annotated

from fastapi import BackgroundTasks, Header, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse

import app as provider

app = provider.app
DEMO_TOKEN = os.environ.get("HM_AUDIVERIS_DEMO_TOKEN", "")


def require_demo_token(token: str) -> None:
    if len(DEMO_TOKEN) < 24 or not secrets.compare_digest(token, DEMO_TOKEN):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")


@app.get("/demo/{token}", response_class=HTMLResponse)
def demo_page(token: str) -> HTMLResponse:
    require_demo_token(token)
    token_json = json.dumps(token)
    return HTMLResponse(
        f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>HarmonyMaker · Audiveris 임시 테스트</title>
<style>
:root{{color-scheme:light dark;font-family:system-ui,-apple-system,sans-serif}}body{{max-width:720px;margin:0 auto;padding:24px 18px 60px;line-height:1.55}}h1{{font-size:1.45rem}}.card{{border:1px solid #8886;border-radius:14px;padding:16px;margin:18px 0}}button,input{{font:inherit}}button{{padding:11px 16px;border-radius:10px;border:1px solid #8888}}button:disabled{{opacity:.5}}#status{{white-space:pre-wrap}}.small{{font-size:.88rem;opacity:.75}}a{{word-break:break-all}}</style>
</head>
<body>
<h1>Audiveris 5.10.2 임시 OMR 테스트</h1>
<p>악보 사진 한 장을 선택하면 임시 Render 서버에서 실제 Audiveris 엔진으로 MusicXML 변환을 시도합니다.</p>
<div class="card">
<input id="file" type="file" accept="image/*" />
<p><button id="run" type="button">인식 시작</button></p>
<div id="status">대기 중</div>
<div id="result"></div>
</div>
<p class="small">테스트용 임시 서비스입니다. 인식 결과는 반드시 확인해야 하며, 서버 재시작 시 작업이 사라질 수 있습니다. 업로드는 최대 한 페이지이며 처리 후 결과 다운로드가 끝나면 삭제를 시도합니다.</p>
<script>
const token={token_json};
const base=`/demo-api/${{encodeURIComponent(token)}}`;
const fileInput=document.getElementById('file');
const run=document.getElementById('run');
const statusEl=document.getElementById('status');
const resultEl=document.getElementById('result');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function pngBlob(file){{
  const bitmap=await createImageBitmap(file);
  const max=2600;
  const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  const w=Math.max(1,Math.round(bitmap.width*scale));
  const h=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{{alpha:false}});ctx.fillStyle='white';ctx.fillRect(0,0,w,h);ctx.drawImage(bitmap,0,0,w,h);bitmap.close();
  return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG 변환 실패')),'image/png'));
}}
async function checked(url,options){{const r=await fetch(url,options);if(!r.ok)throw new Error(`${{r.status}} ${{await r.text()}}`);return r;}}
run.addEventListener('click',async()=>{{
  const file=fileInput.files?.[0];if(!file){{statusEl.textContent='악보 사진을 먼저 선택하세요.';return;}}
  run.disabled=true;resultEl.textContent='';let jobId;
  try{{
    statusEl.textContent='사진을 PNG로 준비하는 중…';const png=await pngBlob(file);
    const created=await (await checked(`${{base}}/jobs`,{{method:'POST'}})).json();jobId=created.jobId;
    statusEl.textContent='업로드 중…';await checked(`${{base}}/jobs/${{encodeURIComponent(jobId)}}/page`,{{method:'PUT',headers:{{'Content-Type':'image/png'}},body:png}});
    statusEl.textContent='Audiveris 인식 시작…';await checked(`${{base}}/jobs/${{encodeURIComponent(jobId)}}/start`,{{method:'POST'}});
    for(let i=0;i<120;i++){{
      const state=await (await checked(`${{base}}/jobs/${{encodeURIComponent(jobId)}}/status`)).json();
      statusEl.textContent=`상태: ${{state.kind}}${{state.progressBp!==undefined?` · ${{(state.progressBp/100).toFixed(0)}}%`:''}}`;
      if(state.kind==='completed'){{
        const url=`${{base}}/jobs/${{encodeURIComponent(jobId)}}/result`;
        resultEl.innerHTML=`<p><a href="${{url}}" target="_blank" rel="noopener">MusicXML 결과 열기</a></p><p><button id="delete" type="button">서버 작업 삭제</button></p>`;
        document.getElementById('delete').onclick=async()=>{{await checked(`${{base}}/jobs/${{encodeURIComponent(jobId)}}`,{{method:'DELETE'}});statusEl.textContent+='\n서버 작업 삭제 완료';resultEl.innerHTML='';}};
        return;
      }}
      if(['failed','cancelled'].includes(state.kind))throw new Error(JSON.stringify(state));
      await sleep(3000);
    }}
    throw new Error('처리 시간이 너무 깁니다.');
  }}catch(error){{statusEl.textContent=`실패: ${{error instanceof Error?error.message:String(error)}}`;}}
  finally{{run.disabled=false;}}
}});
</script>
</body>
</html>"""
    )


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
