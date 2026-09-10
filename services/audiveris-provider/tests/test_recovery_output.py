import hashlib
import io
import json
import os
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

os.environ.setdefault("HM_AUDIVERIS_API_KEY", "test-provider-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("HM_AUDIVERIS_FAKE_ENGINE", "1")
import app as provider
from recovery_output import rejected_output_bundle

XML = '<score-partwise><part-list/><part id="P"><measure number="1"><note><rest/><duration>4</duration></note></measure></part></score-partwise>'
AUTH = {"Authorization": f"Bearer {provider.API_KEY}"}

def test_all_rejected_fragments_are_preserved_without_claiming_order(tmp_path: Path):
    (tmp_path / "first.musicxml").write_text(XML, encoding="utf-8")
    (tmp_path / "second.musicxml").write_text(XML, encoding="utf-8")
    bundle = json.loads(rejected_output_bundle(tmp_path, code="AUDIVERIS_OUTPUT_INCOMPLETE", engine_version="5.10.2",
        pages=[], read_xml=provider.read_engine_musicxml))
    assert bundle["status"] == "incomplete"
    assert len(bundle["documents"]) == 2
    assert all(d["rawMusicXml"] == XML and d["sha256"] == hashlib.sha256(XML.encode()).hexdigest() for d in bundle["documents"])
    assert [d["id"] for d in bundle["documents"]] == ["fragment-1", "fragment-2"]

def test_rejected_archive_limit_applies_before_decompression(tmp_path: Path):
    with zipfile.ZipFile(tmp_path / "bomb.mxl", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("score.xml", "x" * 4_000_001)
    with pytest.raises(ValueError, match="bounds"):
        rejected_output_bundle(tmp_path, code="AUDIVERIS_OUTPUT_INVALID", engine_version="5.10.2", pages=[], read_xml=lambda _: pytest.fail("must not decompress"))

def failed_job(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(provider, "DATA_DIR", tmp_path)
    monkeypatch.setattr(provider, "DB_PATH", tmp_path / "provider.sqlite3")
    monkeypatch.setattr(provider, "JOBS_DIR", tmp_path / "jobs")
    provider.JOBS_DIR.mkdir()
    provider.initialize_database()
    client = TestClient(provider.app)
    created = client.post("/v1/jobs", headers=AUTH, json={"pageCount": 1, "idempotencyKey": "recovery-create-0001"})
    assert created.status_code == 200
    job_id = created.json()["jobId"]
    image = io.BytesIO()
    Image.new("RGB", (200, 300), "white").save(image, format="PNG")
    page = image.getvalue()
    assert client.put(f"/v1/jobs/{job_id}/pages/0", headers={**AUTH, "Content-Type": "image/png",
        "Idempotency-Key": "recovery-upload-0001", "X-Page-Digest": hashlib.sha256(page).hexdigest()}, content=page).status_code == 204
    output = provider.job_path(job_id) / "output"
    output.mkdir(exist_ok=True)
    (output / "part.musicxml").write_text(XML, encoding="utf-8")
    with provider.database() as connection:
        connection.execute("UPDATE jobs SET state='failed',error_code='AUDIVERIS_OUTPUT_INCOMPLETE' WHERE id=?", (job_id,))
    return client, job_id, output

def test_failed_output_is_authenticated_separate_and_expiring(tmp_path: Path, monkeypatch):
    client, job_id, output = failed_job(tmp_path, monkeypatch)
    path = f"/v1/jobs/{job_id}/rejected-output"
    assert client.get(path).status_code == 401
    assert client.get(f"/v1/jobs/{job_id}/result", headers=AUTH).status_code == 409
    response = client.get(path, headers=AUTH)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json()["pages"][0]["pageIndex"] == 0
    assert response.json()["documents"][0]["rawMusicXml"] == XML
    assert (output / "part.musicxml").read_text() == XML
    with provider.database() as connection:
        connection.execute("UPDATE jobs SET expires_at='2020-01-01T00:00:00Z' WHERE id=?", (job_id,))
    assert client.get(path, headers=AUTH).status_code in (404, 410)

def test_owner_deletion_during_read_does_not_recreate_artifacts(tmp_path: Path, monkeypatch):
    client, job_id, output = failed_job(tmp_path, monkeypatch)
    original = provider.rejected_output_bundle
    def racing(*args, **kwargs):
        result = original(*args, **kwargs)
        response = client.delete(f"/v1/jobs/{job_id}", headers={**AUTH, "Idempotency-Key": "recovery-delete-0001"})
        assert response.status_code == 200
        return result
    monkeypatch.setattr(provider, "rejected_output_bundle", racing)
    assert client.get(f"/v1/jobs/{job_id}/rejected-output", headers=AUTH).status_code in (404, 409, 410)
    assert not output.exists()
