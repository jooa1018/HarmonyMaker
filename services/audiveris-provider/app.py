from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import subprocess
import time
import uuid
import zipfile
from contextlib import contextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Iterator, Literal
from xml.etree import ElementTree

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, PlainTextResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field

AUDIVERIS_VERSION = os.environ.get("AUDIVERIS_VERSION", "5.10.2")
PROVIDER_VERSION = "hm-audiveris-provider-v1"
PROVIDER_VENDOR_ID = "audiveris"
API_KEY = os.environ.get("HM_AUDIVERIS_API_KEY", "")
DATA_DIR = Path(os.environ.get("HM_AUDIVERIS_DATA_DIR", "/tmp/hm-audiveris")).resolve()
DB_PATH = DATA_DIR / "provider.sqlite3"
JOBS_DIR = DATA_DIR / "jobs"
AUDIVERIS_BIN = os.environ.get("AUDIVERIS_BIN", "audiveris")
MAX_PAGES = int(os.environ.get("HM_AUDIVERIS_MAX_PAGES", "12"))
MAX_PAGE_BYTES = int(os.environ.get("HM_AUDIVERIS_MAX_PAGE_BYTES", str(16 * 1024 * 1024)))
MAX_PAGE_PIXELS = int(os.environ.get("HM_AUDIVERIS_MAX_PAGE_PIXELS", str(50_000_000)))
RETENTION_SECONDS = int(os.environ.get("HM_AUDIVERIS_RETENTION_SECONDS", "3600"))
PROCESS_TIMEOUT_SECONDS = int(os.environ.get("HM_AUDIVERIS_PROCESS_TIMEOUT_SECONDS", "900"))
DURABLE_STORAGE = os.environ.get("HM_AUDIVERIS_DURABLE_STORAGE", "0") == "1"
FAKE_ENGINE = os.environ.get("HM_AUDIVERIS_FAKE_ENGINE", "0") == "1"
SOURCE_CODE_URL = os.environ.get(
    "HM_AUDIVERIS_SOURCE_CODE_URL",
    "https://github.com/jooa1018/HarmonyMaker/tree/chatgpt/harmonymaker-audiveris-provider/services/audiveris-provider",
)

if len(API_KEY) < 32:
    raise RuntimeError("HM_AUDIVERIS_API_KEY must contain at least 32 characters")
if not 1 <= MAX_PAGES <= 100:
    raise RuntimeError("HM_AUDIVERIS_MAX_PAGES is outside the supported range")
if not 1 <= RETENTION_SECONDS <= 7 * 24 * 60 * 60:
    raise RuntimeError("HM_AUDIVERIS_RETENTION_SECONDS is outside the supported range")

Image.MAX_IMAGE_PIXELS = MAX_PAGE_PIXELS
DATA_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="HarmonyMaker Audiveris OMR provider", version=PROVIDER_VERSION)
processing_gate = asyncio.Semaphore(1)
running_processes: dict[str, asyncio.subprocess.Process] = {}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CreateJobRequest(StrictModel):
    pageCount: int = Field(ge=1, le=MAX_PAGES)
    idempotencyKey: str = Field(min_length=16, max_length=256)


class IdempotentOperationRequest(StrictModel):
    idempotencyKey: str = Field(min_length=16, max_length=256)


class JobResponse(StrictModel):
    jobId: str


class ProviderPage(StrictModel):
    pageIndex: int
    pageDigest: str
    widthPixels: int
    heightPixels: int


class MetadataResponse(StrictModel):
    pages: list[ProviderPage]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_utc(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


@contextmanager
def database() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    try:
        yield connection
    finally:
        connection.close()


def initialize_database() -> None:
    with database() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY,
              create_key TEXT NOT NULL UNIQUE,
              page_count INTEGER NOT NULL CHECK(page_count > 0),
              state TEXT NOT NULL CHECK(state IN ('created','queued','processing','completed','failed','cancelled')),
              progress_bp INTEGER,
              error_code TEXT,
              error_message TEXT,
              result_path TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pages (
              job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
              page_index INTEGER NOT NULL,
              page_digest TEXT NOT NULL,
              upload_key TEXT NOT NULL,
              width_pixels INTEGER NOT NULL,
              height_pixels INTEGER NOT NULL,
              path TEXT NOT NULL,
              PRIMARY KEY(job_id, page_index)
            );
            CREATE TABLE IF NOT EXISTS operations (
              job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
              kind TEXT NOT NULL,
              idempotency_key TEXT NOT NULL,
              PRIMARY KEY(job_id, kind)
            );
            """
        )


def require_auth(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = f"Bearer {API_KEY}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="provider authorization required")


def job_row(job_id: str) -> sqlite3.Row:
    with database() as connection:
        row = connection.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return row


def job_path(job_id: str) -> Path:
    try:
        uuid.UUID(job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="job not found") from error
    resolved = (JOBS_DIR / job_id).resolve()
    if JOBS_DIR not in resolved.parents:
        raise HTTPException(status_code=404, detail="job not found")
    return resolved


def operation_claim(job_id: str, kind: str, key: str) -> Literal["new", "replay"]:
    with database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        prior = connection.execute(
            "SELECT idempotency_key FROM operations WHERE job_id=? AND kind=?",
            (job_id, kind),
        ).fetchone()
        if prior is not None:
            connection.execute("COMMIT")
            if prior["idempotency_key"] != key:
                raise HTTPException(status_code=409, detail="idempotency conflict")
            return "replay"
        connection.execute(
            "INSERT INTO operations(job_id,kind,idempotency_key) VALUES(?,?,?)",
            (job_id, kind, key),
        )
        connection.execute("COMMIT")
    return "new"


def cleanup_expired() -> None:
    now = time.time()
    with database() as connection:
        rows = connection.execute("SELECT id,expires_at FROM jobs").fetchall()
        expired = [row["id"] for row in rows if parse_utc(row["expires_at"]) <= now]
        for job_id in expired:
            connection.execute("DELETE FROM jobs WHERE id=?", (job_id,))
            shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)


def decode_musicxml(result_file: Path) -> str:
    data = result_file.read_bytes()
    if result_file.suffix.lower() == ".mxl" or data.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(result_file) as archive:
            root_path: str | None = None
            if "META-INF/container.xml" in archive.namelist():
                root = ElementTree.fromstring(archive.read("META-INF/container.xml"))
                for element in root.iter():
                    if element.tag.endswith("rootfile"):
                        root_path = element.attrib.get("full-path")
                        break
            if root_path is None:
                root_path = next(
                    (name for name in archive.namelist() if name.lower().endswith((".musicxml", ".xml")) and not name.startswith("META-INF/")),
                    None,
                )
            if root_path is None:
                raise RuntimeError("Audiveris MXL has no MusicXML root file")
            data = archive.read(root_path)
    text = data.decode("utf-8-sig")
    if "<score-partwise" not in text and "<score-timewise" not in text:
        raise RuntimeError("Audiveris result is not MusicXML")
    if len(text.encode("utf-8")) > 4 * 1024 * 1024:
        raise RuntimeError("Audiveris MusicXML exceeds the provider limit")
    return text


def fake_musicxml(page_count: int) -> str:
    measures = "".join(
        f'<measure number="{index + 1}"><attributes><divisions>1</divisions>'
        f'{"<key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>" if index == 0 else ""}'
        '<note><rest/><duration>4</duration><voice>1</voice><type>whole</type></note></measure>'
        for index in range(page_count)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Lead</part-name>'
        f'</score-part></part-list><part id="P1">{measures}</part></score-partwise>'
    )


def combine_pages(job_id: str, pages: list[sqlite3.Row], workspace: Path) -> Path:
    images: list[Image.Image] = []
    try:
        for page in pages:
            image = Image.open(page["path"])
            image.load()
            images.append(image.convert("L"))
        if not images:
            raise RuntimeError("job has no pages")
        input_path = workspace / "score.tiff"
        images[0].save(input_path, format="TIFF", save_all=True, append_images=images[1:], compression="tiff_lzw")
        return input_path
    finally:
        for image in images:
            image.close()


def find_result(output_dir: Path) -> Path:
    candidates = sorted(
        [*output_dir.rglob("*.mxl"), *output_dir.rglob("*.musicxml"), *output_dir.rglob("*.xml")],
        key=lambda path: (path.suffix.lower() != ".mxl", len(path.parts), str(path)),
    )
    if not candidates:
        raise RuntimeError("Audiveris produced no MusicXML result")
    return candidates[0]


async def run_job(job_id: str) -> None:
    async with processing_gate:
        row = job_row(job_id)
        if row["state"] in ("cancelled", "completed"):
            return
        with database() as connection:
            pages = connection.execute("SELECT * FROM pages WHERE job_id=? ORDER BY page_index", (job_id,)).fetchall()
            if len(pages) != row["page_count"]:
                connection.execute(
                    "UPDATE jobs SET state='failed',error_code='PAGES_INCOMPLETE',error_message='not all pages were uploaded',updated_at=? WHERE id=?",
                    (utc_now(), job_id),
                )
                return
            connection.execute(
                "UPDATE jobs SET state='processing',progress_bp=500,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?",
                (utc_now(), job_id),
            )

        workspace = job_path(job_id)
        output_dir = workspace / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        result_path = workspace / "result.musicxml"
        try:
            if FAKE_ENGINE:
                await asyncio.sleep(0)
                result_path.write_text(fake_musicxml(len(pages)), encoding="utf-8")
            else:
                input_path = await asyncio.to_thread(combine_pages, job_id, pages, workspace)
                command = [
                    AUDIVERIS_BIN,
                    "-batch",
                    "-transcribe",
                    "-export",
                    "-save",
                    "-output",
                    str(output_dir),
                    "--",
                    str(input_path),
                ]
                process = await asyncio.create_subprocess_exec(
                    *command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env={**os.environ, "HOME": str(workspace / "home")},
                )
                running_processes[job_id] = process
                try:
                    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=PROCESS_TIMEOUT_SECONDS)
                except TimeoutError:
                    process.kill()
                    await process.wait()
                    raise RuntimeError("Audiveris timed out")
                finally:
                    running_processes.pop(job_id, None)
                if process.returncode != 0:
                    combined = (stdout + b"\n" + stderr).decode("utf-8", errors="replace")[-8_000:]
                    raise RuntimeError(f"Audiveris failed with exit code {process.returncode}: {combined}")
                exported = find_result(output_dir)
                result_path.write_text(decode_musicxml(exported), encoding="utf-8")
            with database() as connection:
                connection.execute(
                    "UPDATE jobs SET state='completed',progress_bp=10000,result_path=?,updated_at=? WHERE id=? AND state<>'cancelled'",
                    (str(result_path), utc_now(), job_id),
                )
        except Exception as error:  # provider boundary converts all engine failures to a durable terminal state
            with database() as connection:
                current = connection.execute("SELECT state FROM jobs WHERE id=?", (job_id,)).fetchone()
                if current is not None and current["state"] != "cancelled":
                    connection.execute(
                        "UPDATE jobs SET state='failed',error_code='AUDIVERIS_FAILED',error_message=?,updated_at=? WHERE id=?",
                        (str(error)[-4_000:], utc_now(), job_id),
                    )


@app.on_event("startup")
async def startup() -> None:
    initialize_database()
    cleanup_expired()
    with database() as connection:
        recoverable = connection.execute(
            "SELECT id FROM jobs WHERE state IN ('queued','processing') ORDER BY created_at"
        ).fetchall()
    for row in recoverable:
        asyncio.create_task(run_job(row["id"]))


@app.get("/health")
def health() -> dict[str, Any]:
    cleanup_expired()
    return {
        "status": "ok",
        "providerVersion": PROVIDER_VERSION,
        "engine": "fake" if FAKE_ENGINE else "audiveris",
        "audiverisVersion": AUDIVERIS_VERSION,
        "sourceCodeUrl": SOURCE_CODE_URL,
        "durableStorage": DURABLE_STORAGE,
    }


@app.get("/source")
def source() -> dict[str, str]:
    return {"sourceCodeUrl": SOURCE_CODE_URL, "license": "AGPL-3.0-only"}


@app.get("/v1/capabilities", dependencies=[Depends(require_auth)])
def capabilities() -> dict[str, Any]:
    return {
        "vendorId": PROVIDER_VENDOR_ID,
        "vendorDisplayName": f"Audiveris {AUDIVERIS_VERSION} self-hosted",
        "supportedMimeTypes": ["image/png"],
        "transferMimeType": "image/png",
        "maxPages": MAX_PAGES,
        "evidenceGranularity": "page",
        "supportsDeletion": True,
        "retentionDisclosure": True,
        "supportsIdempotency": DURABLE_STORAGE,
        "supportsInteractiveInput": False,
        "canDeleteImmediately": True,
        "retentionPolicyReference": f"self-hosted:{RETENTION_SECONDS}s:{'durable' if DURABLE_STORAGE else 'ephemeral'}",
        "externalTransfer": True,
        "estimatedCreditPerPage": 1,
    }


@app.post("/v1/jobs", response_model=JobResponse, dependencies=[Depends(require_auth)])
def create_job(payload: CreateJobRequest) -> JobResponse:
    cleanup_expired()
    with database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        prior = connection.execute("SELECT id,page_count FROM jobs WHERE create_key=?", (payload.idempotencyKey,)).fetchone()
        if prior is not None:
            connection.execute("COMMIT")
            if prior["page_count"] != payload.pageCount:
                raise HTTPException(status_code=409, detail="create idempotency conflict")
            return JobResponse(jobId=prior["id"])
        job_id = str(uuid.uuid4())
        now = utc_now()
        expires_at = datetime.fromtimestamp(time.time() + RETENTION_SECONDS, timezone.utc).isoformat().replace("+00:00", "Z")
        connection.execute(
            "INSERT INTO jobs(id,create_key,page_count,state,created_at,updated_at,expires_at) VALUES(?,?,?,'created',?,?,?)",
            (job_id, payload.idempotencyKey, payload.pageCount, now, now, expires_at),
        )
        connection.execute("COMMIT")
    workspace = job_path(job_id)
    (workspace / "pages").mkdir(parents=True, exist_ok=False)
    (workspace / "home").mkdir(parents=True, exist_ok=True)
    return JobResponse(jobId=job_id)


@app.put("/v1/jobs/{job_id}/pages/{page_index}", status_code=204, dependencies=[Depends(require_auth)])
async def upload_page(
    job_id: str,
    page_index: int,
    request: Request,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    page_digest: Annotated[str | None, Header(alias="X-Page-Digest")] = None,
) -> Response:
    row = job_row(job_id)
    if row["state"] != "created":
        raise HTTPException(status_code=409, detail="job no longer accepts pages")
    if page_index < 0 or page_index >= row["page_count"]:
        raise HTTPException(status_code=422, detail="page index is outside the job")
    if idempotency_key is None or len(idempotency_key) < 16 or len(idempotency_key) > 256:
        raise HTTPException(status_code=422, detail="invalid upload idempotency key")
    if page_digest is None or not all(character in "0123456789abcdef" for character in page_digest) or len(page_digest) != 64:
        raise HTTPException(status_code=422, detail="invalid page digest")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "image/png":
        raise HTTPException(status_code=415, detail="only canonical PNG is supported")
    body = await request.body()
    if len(body) == 0 or len(body) > MAX_PAGE_BYTES:
        raise HTTPException(status_code=413, detail="page exceeds the provider byte limit")
    actual_digest = hashlib.sha256(body).hexdigest()
    if actual_digest != page_digest:
        raise HTTPException(status_code=422, detail="page digest mismatch")
    try:
        from io import BytesIO

        with Image.open(BytesIO(body)) as image:
            image.verify()
        with Image.open(BytesIO(body)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_PAGE_PIXELS:
                raise HTTPException(status_code=422, detail="page dimensions exceed the provider limit")
    except (UnidentifiedImageError, OSError) as error:
        raise HTTPException(status_code=422, detail="invalid PNG") from error

    path = job_path(job_id) / "pages" / f"{page_index:04d}.png"
    with database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        prior = connection.execute("SELECT * FROM pages WHERE job_id=? AND page_index=?", (job_id, page_index)).fetchone()
        if prior is not None:
            connection.execute("COMMIT")
            if prior["page_digest"] != page_digest or prior["upload_key"] != idempotency_key:
                raise HTTPException(status_code=409, detail="page upload conflict")
            return Response(status_code=204)
        path.write_bytes(body)
        connection.execute(
            "INSERT INTO pages(job_id,page_index,page_digest,upload_key,width_pixels,height_pixels,path) VALUES(?,?,?,?,?,?,?)",
            (job_id, page_index, page_digest, idempotency_key, width, height, str(path)),
        )
        connection.execute("COMMIT")
    return Response(status_code=204)


@app.post("/v1/jobs/{job_id}/start", status_code=202, dependencies=[Depends(require_auth)])
def start_job(job_id: str, payload: IdempotentOperationRequest, background_tasks: BackgroundTasks) -> Response:
    row = job_row(job_id)
    claim = operation_claim(job_id, "start", payload.idempotencyKey)
    if claim == "replay":
        return Response(status_code=202)
    with database() as connection:
        page_count = connection.execute("SELECT count(*) AS count FROM pages WHERE job_id=?", (job_id,)).fetchone()["count"]
        if page_count != row["page_count"]:
            connection.execute("DELETE FROM operations WHERE job_id=? AND kind='start'", (job_id,))
            raise HTTPException(status_code=409, detail="pages are incomplete")
        connection.execute("UPDATE jobs SET state='queued',progress_bp=0,updated_at=? WHERE id=?", (utc_now(), job_id))
    background_tasks.add_task(run_job, job_id)
    return Response(status_code=202)


@app.get("/v1/jobs/{job_id}/status", dependencies=[Depends(require_auth)])
def get_status(job_id: str) -> dict[str, Any]:
    row = job_row(job_id)
    state = row["state"]
    if state == "processing":
        return {"kind": "processing", "progressBp": row["progress_bp"] or 0}
    if state == "failed":
        return {"kind": "failed", "code": row["error_code"] or "AUDIVERIS_FAILED", "message": row["error_message"] or "Audiveris failed"}
    return {"kind": state}


@app.get("/v1/jobs/{job_id}/result", dependencies=[Depends(require_auth)])
def get_result(job_id: str) -> PlainTextResponse:
    row = job_row(job_id)
    if row["state"] != "completed" or not row["result_path"]:
        raise HTTPException(status_code=409, detail="result is not available")
    return PlainTextResponse(Path(row["result_path"]).read_text(encoding="utf-8"), media_type="application/vnd.recordare.musicxml+xml")


@app.get("/v1/jobs/{job_id}/metadata", response_model=MetadataResponse, dependencies=[Depends(require_auth)])
def get_metadata(job_id: str) -> MetadataResponse:
    job_row(job_id)
    with database() as connection:
        pages = connection.execute("SELECT * FROM pages WHERE job_id=? ORDER BY page_index", (job_id,)).fetchall()
    return MetadataResponse(
        pages=[
            ProviderPage(
                pageIndex=page["page_index"],
                pageDigest=page["page_digest"],
                widthPixels=page["width_pixels"],
                heightPixels=page["height_pixels"],
            )
            for page in pages
        ]
    )


@app.post("/v1/jobs/{job_id}/cancel", status_code=204, dependencies=[Depends(require_auth)])
async def cancel_job(job_id: str, payload: IdempotentOperationRequest) -> Response:
    job_row(job_id)
    operation_claim(job_id, "cancel", payload.idempotencyKey)
    process = running_processes.get(job_id)
    if process is not None and process.returncode is None:
        process.terminate()
        with suppress(TimeoutError):
            await asyncio.wait_for(process.wait(), timeout=5)
        if process.returncode is None:
            process.kill()
    with database() as connection:
        connection.execute("UPDATE jobs SET state='cancelled',updated_at=? WHERE id=?", (utc_now(), job_id))
    return Response(status_code=204)


@app.delete("/v1/jobs/{job_id}", status_code=200, dependencies=[Depends(require_auth)])
async def delete_job(
    job_id: str,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> JSONResponse:
    if idempotency_key is None or len(idempotency_key) < 16 or len(idempotency_key) > 256:
        raise HTTPException(status_code=422, detail="invalid delete idempotency key")
    with database() as connection:
        row = connection.execute("SELECT id FROM jobs WHERE id=?", (job_id,)).fetchone()
    if row is None:
        return JSONResponse({"status": "deleted"})
    operation_claim(job_id, "delete", idempotency_key)
    process = running_processes.get(job_id)
    if process is not None and process.returncode is None:
        process.kill()
        await process.wait()
    with database() as connection:
        connection.execute("DELETE FROM jobs WHERE id=?", (job_id,))
    shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)
    return JSONResponse({"status": "deleted"})


@app.get("/v1/jobs/{job_id}/retention", dependencies=[Depends(require_auth)])
def retention(job_id: str) -> dict[str, Any]:
    row = job_row(job_id)
    return {
        "vendorDeletesAt": row["expires_at"],
        "canDeleteImmediately": True,
        "policyReference": f"self-hosted:{RETENTION_SECONDS}s:{'durable' if DURABLE_STORAGE else 'ephemeral'}",
    }
