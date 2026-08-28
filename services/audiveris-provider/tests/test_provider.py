from __future__ import annotations

import hashlib
import importlib
import io
import os
import time
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

os.environ.setdefault("HM_AUDIVERIS_API_KEY", "test-provider-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("HM_AUDIVERIS_FAKE_ENGINE", "1")
os.environ.setdefault("HM_AUDIVERIS_DATA_DIR", "/tmp/hm-audiveris-pytest")
os.environ.setdefault("HM_AUDIVERIS_RETENTION_SECONDS", "3600")

import app as provider  # noqa: E402

AUTH = {"Authorization": f"Bearer {os.environ['HM_AUDIVERIS_API_KEY']}"}


def png(width: int = 200, height: int = 300) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def wait_completed(client: TestClient, job_id: str) -> None:
    for _ in range(100):
        body = client.get(f"/v1/jobs/{job_id}/status", headers=AUTH).json()
        if body["kind"] == "completed":
            return
        if body["kind"] == "failed":
            raise AssertionError(body)
        time.sleep(0.01)
    raise AssertionError("job did not complete")


def test_full_two_page_protocol(tmp_path: Path) -> None:
    os.environ["HM_AUDIVERIS_DATA_DIR"] = str(tmp_path)
    provider.DATA_DIR = tmp_path
    provider.DB_PATH = tmp_path / "provider.sqlite3"
    provider.JOBS_DIR = tmp_path / "jobs"
    provider.JOBS_DIR.mkdir(parents=True)
    provider.initialize_database()

    with TestClient(provider.app) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.get("/v1/capabilities", headers=AUTH).json()["vendorId"] == "audiveris"
        created = client.post(
            "/v1/jobs",
            headers=AUTH,
            json={"pageCount": 2, "idempotencyKey": "create-key-xxxxxxxx"},
        )
        assert created.status_code == 200
        job_id = created.json()["jobId"]
        replay = client.post(
            "/v1/jobs",
            headers=AUTH,
            json={"pageCount": 2, "idempotencyKey": "create-key-xxxxxxxx"},
        )
        assert replay.json()["jobId"] == job_id

        for index, page in enumerate((png(200, 300), png(210, 310))):
            response = client.put(
                f"/v1/jobs/{job_id}/pages/{index}",
                headers={
                    **AUTH,
                    "Content-Type": "image/png",
                    "Idempotency-Key": f"upload-key-{index}-xxxxxxxx",
                    "X-Page-Digest": hashlib.sha256(page).hexdigest(),
                },
                content=page,
            )
            assert response.status_code == 204

        started = client.post(
            f"/v1/jobs/{job_id}/start",
            headers=AUTH,
            json={"idempotencyKey": "start-key-xxxxxxxx"},
        )
        assert started.status_code == 202
        wait_completed(client, job_id)
        musicxml = client.get(f"/v1/jobs/{job_id}/result", headers=AUTH)
        assert musicxml.status_code == 200
        assert "<score-partwise" in musicxml.text
        metadata = client.get(f"/v1/jobs/{job_id}/metadata", headers=AUTH).json()
        assert [item["pageIndex"] for item in metadata["pages"]] == [0, 1]
        assert metadata["pages"][1]["widthPixels"] == 210

        deleted = client.delete(
            f"/v1/jobs/{job_id}",
            headers={**AUTH, "Idempotency-Key": "delete-key-xxxxxxxx"},
        )
        assert deleted.json() == {"status": "deleted"}
        assert client.delete(
            f"/v1/jobs/{job_id}",
            headers={**AUTH, "Idempotency-Key": "delete-key-xxxxxxxx"},
        ).json() == {"status": "deleted"}


def test_rejects_digest_and_idempotency_conflicts(tmp_path: Path) -> None:
    os.environ["HM_AUDIVERIS_DATA_DIR"] = str(tmp_path)
    provider.DATA_DIR = tmp_path
    provider.DB_PATH = tmp_path / "provider.sqlite3"
    provider.JOBS_DIR = tmp_path / "jobs"
    provider.JOBS_DIR.mkdir(parents=True)
    provider.initialize_database()
    page = png()
    digest = hashlib.sha256(page).hexdigest()
    with TestClient(provider.app) as client:
        job_id = client.post(
            "/v1/jobs", headers=AUTH, json={"pageCount": 1, "idempotencyKey": "create-conflict-xxxx"}
        ).json()["jobId"]
        response = client.put(
            f"/v1/jobs/{job_id}/pages/0",
            headers={**AUTH, "Content-Type": "image/png", "Idempotency-Key": "upload-conflict-xxxx", "X-Page-Digest": digest},
            content=page,
        )
        assert response.status_code == 204
        conflict = client.put(
            f"/v1/jobs/{job_id}/pages/0",
            headers={**AUTH, "Content-Type": "image/png", "Idempotency-Key": "other-upload-key-xxxx", "X-Page-Digest": digest},
            content=page,
        )
        assert conflict.status_code == 409
