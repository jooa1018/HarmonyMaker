"""Self-authored miniature scores only; no private recognition material."""
from __future__ import annotations

import os
import zipfile
from pathlib import Path

import pytest

os.environ.setdefault("HM_AUDIVERIS_API_KEY", "test-provider-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("HM_AUDIVERIS_FAKE_ENGINE", "1")
import app as provider


def score(pitch: str = "C", divisions: int = 1, number: int = 1) -> str:
    return f'<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="{number}"><attributes><divisions>{divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>{pitch}</step><octave>4</octave></pitch><duration>{4*divisions}</duration><type>whole</type></note></measure></part></score-partwise>'


def mxl(path: Path, text: str) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
        archive.writestr("score.xml", text)


def book(path: Path, movements: int) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("book.xml", "<book>" + "".join(f'<score><page sheet-number="1" sheet-page-id="{i+1}"/></score>' for i in range(movements)) + "</book>")


@pytest.mark.parametrize("pitch,divisions,number", [("C", 1, 1), ("F", 12, 7), ("A", 480, 32)])
def test_one_complete_export_preserves_bytes(tmp_path: Path, pitch: str, divisions: int, number: int) -> None:
    text = score(pitch, divisions, number)
    book(tmp_path / "score.omr", 1)
    mxl(tmp_path / "score.mxl", text)
    selected = provider.find_result(tmp_path)
    assert provider.read_engine_musicxml(selected) == text


def test_duplicate_xml_mxl_of_same_artifact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    text = score()
    book(tmp_path / "score.omr", 1)
    mxl(tmp_path / "score.mxl", text)
    (tmp_path / "score.xml").write_text(text.replace("><", ">\n<"))
    monkeypatch.setattr(provider, "decode_musicxml", lambda _: pytest.fail("selection must not run postprocessing"))
    assert provider.find_result(tmp_path) == tmp_path / "score.mxl"


@pytest.mark.parametrize("names", [("a", "z"), ("z", "a"), ("movement10", "movement2")])
@pytest.mark.parametrize("identical", [False, True])
def test_distinct_movements_never_selected_by_name_or_size(tmp_path: Path, names: tuple[str, str], identical: bool) -> None:
    mxl(tmp_path / (names[0] + ".mxl"), score())
    mxl(tmp_path / (names[1] + ".mxl"), score() if identical else score("G", 12, 9))
    with pytest.raises(provider.OutputSelectionError) as error:
        provider.find_result(tmp_path)
    assert error.value.code == "AUDIVERIS_OUTPUT_AMBIGUOUS"


def test_book_inventory_detects_missing_export_even_with_only_one_file(tmp_path: Path) -> None:
    book(tmp_path / "score.omr", 3)
    mxl(tmp_path / "score.mxl", score())
    with pytest.raises(provider.OutputSelectionError) as error:
        provider.find_result(tmp_path)
    assert error.value.code == "AUDIVERIS_OUTPUT_INCOMPLETE"
    assert (tmp_path / "score.omr").exists() and (tmp_path / "score.mxl").exists()


def test_conflicting_serializations_are_not_duplicates(tmp_path: Path) -> None:
    mxl(tmp_path / "score.mxl", score())
    (tmp_path / "score.xml").write_text(score("D"))
    with pytest.raises(provider.OutputSelectionError, match="서로 다른"):
        provider.find_result(tmp_path)


@pytest.mark.parametrize("metadata", ["<book/>", "not XML", '<!DOCTYPE book [<!ENTITY a "x">]><book><score/></book>'])
def test_invalid_book_inventory_is_not_ignored(tmp_path: Path, metadata: str) -> None:
    with zipfile.ZipFile(tmp_path / "score.omr", "w") as archive:
        archive.writestr("book.xml", metadata)
    mxl(tmp_path / "score.mxl", score())
    with pytest.raises(provider.OutputSelectionError) as error:
        provider.find_result(tmp_path)
    assert error.value.code == "AUDIVERIS_OUTPUT_INVALID"


def test_unreadable_extra_output_cannot_hide_a_missing_segment(tmp_path: Path) -> None:
    mxl(tmp_path / "score.mxl", score())
    (tmp_path / "second.musicxml").write_text("broken")
    with pytest.raises(provider.OutputSelectionError) as error:
        provider.find_result(tmp_path)
    assert error.value.code == "AUDIVERIS_OUTPUT_INVALID"


def test_run_job_returns_failure_and_retains_all_artifacts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    from fastapi.testclient import TestClient
    from PIL import Image
    import io, hashlib

    for attr, value in [("DATA_DIR", tmp_path), ("DB_PATH", tmp_path / "jobs.sqlite3"), ("JOBS_DIR", tmp_path / "jobs"), ("FAKE_ENGINE", False)]:
        monkeypatch.setattr(provider, attr, value)
    provider.JOBS_DIR.mkdir()

    class Process:
        returncode = 0
        async def communicate(self): return b"", b""

    async def engine(*command, **kwargs):
        output = Path(command[command.index("-output") + 1])
        book(output / "score.omr", 2)
        mxl(output / "a.mxl", score())
        mxl(output / "z.mxl", score("G"))
        return Process()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", engine)
    auth = {"Authorization": "Bearer " + provider.API_KEY}
    with TestClient(provider.app) as client:
        job = client.post("/v1/jobs", headers=auth, json={"pageCount":1,"idempotencyKey":"selection-create-key"}).json()["jobId"]
        image = Image.new("RGB", (200, 300), "white"); buf = io.BytesIO(); image.save(buf, format="PNG"); data = buf.getvalue()
        assert client.put(f"/v1/jobs/{job}/pages/0", headers={**auth,"Content-Type":"image/png","Idempotency-Key":"selection-upload-key","X-Page-Digest":hashlib.sha256(data).hexdigest()}, content=data).status_code == 204
        assert client.post(f"/v1/jobs/{job}/start", headers=auth, json={"idempotencyKey":"selection-start-key"}).status_code == 202
        status = client.get(f"/v1/jobs/{job}/status", headers=auth).json()
        assert status["kind"] == "failed" and status["code"] == "AUDIVERIS_OUTPUT_INCOMPLETE"
        assert str(tmp_path) not in status["message"]
        assert client.get(f"/v1/jobs/{job}/result", headers=auth).status_code == 409
        workspace = provider.JOBS_DIR / job
        assert not (workspace / "result.musicxml").exists()
        assert {p.name for p in (workspace / "output").iterdir()} == {"score.omr", "a.mxl", "z.mxl"}
