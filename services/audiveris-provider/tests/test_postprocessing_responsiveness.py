"""Slow OCR supplementation must not prevent observing or deleting the same job."""
import asyncio
import threading
from pathlib import Path

import pytest
import app as provider
from test_output_selection import score


@pytest.mark.parametrize("delete_during_decode", [False, True])
def test_status_remains_responsive_during_decode(tmp_path, monkeypatch, delete_during_decode):
    for name, value in [("DATA_DIR", tmp_path), ("DB_PATH", tmp_path / "jobs.sqlite3"),
                        ("JOBS_DIR", tmp_path / "jobs"), ("FAKE_ENGINE", False)]:
        monkeypatch.setattr(provider, name, value)
    provider.JOBS_DIR.mkdir()
    provider.initialize_database()
    job = provider.create_job(provider.CreateJobRequest(pageCount=1, idempotencyKey="responsive-create-key")).jobId
    with provider.database() as db:
        db.execute("INSERT INTO pages(job_id,page_index,page_digest,upload_key,width_pixels,height_pixels,path) VALUES(?,?,?,?,?,?,?)", (job, 0, "digest", "responsive-upload-key", 200, 300, "unused"))
    entered, release = threading.Event(), threading.Event()

    class Process:
        returncode = 0
        async def communicate(self):
            return b"", b""

    async def engine(*args, **kwargs):
        return Process()

    def decode(_):
        entered.set()
        # Finite guard ensures the regression fails instead of hanging on the
        # old implementation, which ran this operation on the event loop.
        assert release.wait(3), "status observation was blocked by OCR decoding"
        (provider.JOBS_DIR / job / "chord-ocr").mkdir(exist_ok=True)
        return score()

    monkeypatch.setattr(provider, "combine_pages", lambda *args: tmp_path / "input.png")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", engine)
    monkeypatch.setattr(provider, "find_result", lambda path: path / "score.mxl")
    monkeypatch.setattr(provider, "decode_musicxml", decode)

    async def scenario():
        monkeypatch.setattr(provider, "processing_gate", asyncio.Semaphore(1))
        task = asyncio.create_task(provider.run_job(job))
        await asyncio.to_thread(entered.wait, 2)
        try:
            assert provider.job_row(job)["state"] == "processing"
            if delete_during_decode:
                deletion = asyncio.create_task(provider.delete_job(job, "responsive-delete-key"))
                await asyncio.sleep(0)
                assert not deletion.done(), "cleanup must wait for its file-writing worker"
            release.set()
            await task
            if delete_during_decode:
                await deletion
                assert not (provider.JOBS_DIR / job).exists()
                with provider.database() as db:
                    assert db.execute("SELECT id FROM jobs WHERE id=?", (job,)).fetchone() is None
            else:
                assert provider.job_row(job)["state"] == "completed"
                assert (provider.JOBS_DIR / job / "result.musicxml").exists()
        finally:
            release.set()
            await task

    asyncio.run(scenario())
