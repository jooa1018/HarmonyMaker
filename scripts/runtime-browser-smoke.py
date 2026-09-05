"""Production-build, ordinary-entry smoke on disposable localhost only.

No mock OMR result, database, object store or cloud credentials are installed.
This proves direct-import Product Core, not real-provider/Preview acceptance.
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.request import urlopen
from xml.etree import ElementTree as ET
import zipfile

from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "runtime-browser-evidence"
BASE = "http://127.0.0.1:3100"
TITLE = "Runtime closure original fixture"
RESULTS: list[dict[str, object]] = []


def record(step: str, **details: object) -> None:
    result = {"step": step, "status": "PASS", **details}
    RESULTS.append(result)
    print(json.dumps(result, ensure_ascii=False), flush=True)


def original_score() -> bytes:
    # Session-authored eight-bar diatonic score; no user/external score is used.
    bars = []
    for index, (root, kind, notes) in enumerate([
        ("C", "major", "CEGE"), ("G", "major", "DGBG"),
        ("A", "minor", "CEAE"), ("F", "major", "CFAC"),
        ("C", "major", "EGEC"), ("G", "major", "DGBG"),
        ("F", "major", "AFAC"), ("C", "major", "GECC"),
    ], 1):
        attributes = '<attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' if index == 1 else ""
        direction = '<direction><direction-type><rehearsal>Verse</rehearsal></direction-type><sound tempo="120"/></direction>' if index == 1 else ""
        melody = ''.join(f'<note><pitch><step>{step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>' for step in notes)
        bars.append(f'<measure number="{index}">{attributes}{direction}<harmony><root><root-step>{root}</root-step></root><kind>{kind}</kind></harmony>{melody}</measure>')
    return (f'<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>{TITLE}</work-title></work><part-list><score-part id="P1"><part-name>Source Lead</part-name></score-part></part-list><part id="P1">' + ''.join(bars) + '</part></score-partwise>').encode()


def compressed_score(xml: bytes) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>')
        archive.writestr("score.musicxml", xml)
    return output.getvalue()


def ready_review(page: Page) -> None:
    page.locator('input[name="lead-candidate"]').first.check()
    expect(page.locator('input[id^="chord-"]')).not_to_have_count(0)
    for button in page.get_by_role("button", name="저장하고 확인", exact=True).all():
        button.click()
    for button in page.get_by_role("button", name="Section 확인", exact=True).all():
        button.click()
    if page.get_by_role("button", name="tempo 확인", exact=True).count():
        page.get_by_label("초기 quarter BPM").fill("120")
        page.get_by_role("button", name="tempo 확인", exact=True).click()
    page.locator("#singer-count").select_option("3")
    for ordinal, (low, high, comfortable_low, comfortable_high) in enumerate([
        ("G2", "C6", "G3", "C5"), ("C3", "C6", "C4", "C6"), ("C2", "G4", "G2", "G4"),
    ]):
        for prefix, value in [("hard-low", low), ("hard-high", high), ("comfortable-low", comfortable_low), ("comfortable-high", comfortable_high)]:
            page.locator(f"#{prefix}-{ordinal}").select_option(value)
        page.get_by_role("button", name="음역 확인", exact=True).nth(ordinal).click()
    page.get_by_label("이 Source를 편곡 생성 입력으로 사용할 권리가 있습니다.").check()
    page.get_by_role("button", name="권리 확인 저장", exact=True).click()
    button = page.get_by_role("button", name="프로젝트 워크스페이스 열기 →", exact=True)
    expect(button).to_be_enabled(timeout=30000)
    button.click()
    page.wait_for_url(re.compile(r"/workspace\?project="), timeout=30000)
    expect(page.get_by_test_id("generation-status")).to_be_visible()


def generate(page: Page, preset: str) -> None:
    page.get_by_label("Preset", exact=True).select_option(preset)
    page.get_by_role("button", name="정본 화음 생성", exact=True).click()
    expect(page.get_by_test_id("generation-status")).to_have_text("complete", timeout=60000)
    expect(page.locator('.score-wrap svg')).not_to_have_count(0)
    expect(page.locator('section.practice-player [role="alert"]')).to_have_count(0)


AUDIO_TAP = """() => {
  window.__hmAnalyzers = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    if (args[0] instanceof AudioDestinationNode) {
      const analyzer = this.context.createAnalyser();
      connect.call(this, analyzer);
      connect.call(analyzer, args[0]);
      window.__hmAnalyzers.push(analyzer);
      return args[0];
    }
    return connect.apply(this, args);
  };
}"""


def playback(page: Page) -> None:
    player = page.locator('section.practice-player')
    player.get_by_role("button", name="Play", exact=True).click()
    expect(player.locator('p.status').first).to_contain_text("재생 중")
    # Observe real Web Audio PCM, not just a button/transport state. The analyzer
    # is transparent in the existing signal path; no synthesizer is replaced.
    page.wait_for_function("""() => window.__hmAnalyzers.some(a => {
      const samples = new Float32Array(a.fftSize); a.getFloatTimeDomainData(samples);
      return samples.some(x => Math.abs(x) > 0.00001);
    })""", timeout=15000)
    player.get_by_role("button", name="Pause", exact=True).click()
    expect(player.locator('p.status').first).to_contain_text("일시 정지")
    player.get_by_role("button", name="Resume", exact=True).click()
    expect(player.locator('p.status').first).to_contain_text("재생 중")
    player.get_by_role("button", name="Reset", exact=True).click()
    expect(player.locator('p.status').first).to_contain_text("준비")


def download(page: Page, label: str, name: str) -> Path:
    with page.expect_download() as pending:
        page.get_by_role("button", name=label, exact=True).click()
    path = OUT / name
    pending.value.save_as(path)
    assert path.stat().st_size > 0
    return path


def run(page: Page) -> None:
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("link", name="MusicXML 가져오기와 Quick Review →", exact=True).click()
    page.locator('input[type="file"]').set_input_files({"name": "invalid.musicxml", "mimeType": "application/xml", "buffer": b'<not-a-score />'})
    expect(page.get_by_text("가져오기가 안전하게 차단되었습니다.", exact=True)).to_be_visible()
    record("invalid-direct-input-rejected")
    xml = original_score()
    page.locator('input[type="file"]').set_input_files({"name": "original.musicxml", "mimeType": "application/xml", "buffer": xml})
    ready_review(page)
    workspace = page.url
    record("musicxml-user-entry-review-project", measures=8, singers=3)
    for preset in ("simple", "standard", "full"):
        generate(page, preset)
        record("generation", preset=preset, result="complete")
    for projection in ("lead", "upper", "lower", "full"):
        page.get_by_role("button", name=projection, exact=True).click()
        expect(page.locator('.score-wrap svg')).not_to_have_count(0)
        playback(page)
        record("projection-render-audio", projection=projection, pcm="nonzero", physical_device=False)
    page.screenshot(path=str(OUT / "workspace-desktop.png"), full_page=True)
    exported_xml = download(page, "MusicXML 다운로드", "roundtrip.musicxml")
    root = ET.fromstring(exported_xml.read_bytes())
    assert len(root.findall("part")) == 3
    assert len(root.findall(".//note")) > 0
    assert len(root.findall(".//harmony")) > 0
    exported_project = download(page, "프로젝트 내보내기", "roundtrip.harmonymaker.json")
    project = json.loads(exported_project.read_text())
    assert project["source"]["title"] == TITLE
    assert project["schemaVersion"] == 9
    page.get_by_role("button", name="로컬 저장", exact=True).click()
    page.reload(wait_until="networkidle")
    expect(page.get_by_test_id("generation-status")).to_have_text("complete", timeout=30000)
    assert page.url == workspace
    record("save-reload-reenter", result="complete")
    page.locator('input[type="file"][accept="application/json,.json"]').set_input_files(exported_project)
    expect(page.get_by_text("정본 프로젝트 파일을 검증하고 로드했습니다.", exact=True)).to_be_visible()
    record("project-export-reimport-validated")
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="lead", exact=True).click()
    playback(page)
    page.screenshot(path=str(OUT / "workspace-mobile.png"), full_page=True)
    record("mobile-controls", viewport="390x844", physical_device=False)
    page.get_by_role("button", name="full", exact=True).click()
    page.get_by_role("button", name="권리 확인 후 공유 만들기 / 복구", exact=True).click()
    link = page.locator('a[href*="/share#p="]')
    expect(link).to_be_visible(timeout=30000)
    share_url = link.get_attribute("href")
    assert share_url and share_url.startswith(BASE + "/share#p=")
    # Never log the encoded share URL or any storage credentials.
    shared = page.context.new_page()
    shared.goto(share_url, wait_until="networkidle")
    expect(shared.get_by_role("heading", name=TITLE, exact=True)).to_be_visible()
    expect(shared.get_by_role("button", name="정본 화음 생성", exact=True)).to_have_count(0)
    playback(shared)
    shared.close()
    record("url-share-readonly-render-audio", server_store=False)
    page.get_by_role("button", name="로컬 삭제", exact=True).click()
    page.wait_for_url(BASE + "/")
    page.goto(workspace, wait_until="networkidle")
    expect(page.get_by_role("link", name="Quick Review에서 시작하기 →", exact=True)).to_be_visible()
    expect(page.get_by_test_id("generation-status")).to_have_count(0)
    record("owned-local-project-delete")
    page.goto(BASE + "/import", wait_until="networkidle")
    page.locator('input[type="file"]').set_input_files(exported_xml)
    ready_review(page)
    generate(page, "standard")
    record("exported-musicxml-reimport-generation", result="complete")
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("link", name="사진·PDF OMR과 증거 검토 →", exact=True).click()
    # With no production substrate credentials, the actual API must fail visibly.
    # No provider request is sent and no reference result can be substituted.
    alert = page.get_by_role("alert")
    expect(alert).to_be_visible(timeout=30000)
    assert alert.inner_text().strip()
    expect(page.get_by_role("button", name="인식 시작", exact=True)).to_be_disabled()
    record("omr-missing-configuration-visible-error", real_omr="BLOCKED_EXTERNAL")
    page.locator('input[type="file"]').first.set_input_files({"name": "original.mxl", "mimeType": "application/vnd.recordare.musicxml", "buffer": compressed_score(xml)})
    page.wait_for_url("**/import", timeout=30000)
    ready_review(page)
    generate(page, "standard")
    record("mxl-omr-entry-handoff-review-generation", result="complete")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    # No cloud secrets/URLs are accepted for this test; production DB migrations
    # and external effects cannot be authorized accidentally by runner environment.
    for key in ("DATABASE_URL", "S3_ENDPOINT", "OMR_AUDIVERIS_BASE_URL", "OMR_PROVIDER_MODE"):
        if os.environ.get(key):
            raise RuntimeError(f"Disposable browser smoke requires {key} to be absent")
    log = (OUT / "next-start.log").open("w")
    server = subprocess.Popen(["node", "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3100"], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    page = None
    completed = False
    try:
        for _ in range(120):
            if server.poll() is not None:
                raise RuntimeError("Production server exited before readiness")
            try:
                with urlopen(BASE, timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(0.5)
        else:
            raise RuntimeError("Production server did not become ready")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
            context.add_init_script("(" + AUDIO_TAP + ")();")
            page = context.new_page()
            try:
                run(page)
                completed = True
            except Exception as error:
                text = re.sub(r'https?://\S+', '[redacted-url]', page.locator("body").inner_text())
                (OUT / "failure-body.txt").write_text(text)
                # URL-share payloads are not included in evidence screenshots.
                page.locator('a[href*="/share"]').evaluate_all("links => links.forEach(a => a.textContent = '공유 링크 (숨김)')")
                page.screenshot(path=str(OUT / "failure.png"), full_page=True)
                RESULTS.append({"step": "browser-flow", "status": "FAIL", "error": re.sub(r'https?://\S+', '[redacted-url]', str(error))})
                raise
            finally:
                browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill(); server.wait(timeout=10)
        log.close()
        (OUT / "results.json").write_text(json.dumps({"code_sha": os.environ.get("HM_CODE_SHA", "local-unpublished"), "environment": "disposable-localhost-production-build", "status": "PASS" if completed else "FAIL", "real_omr": "BLOCKED_EXTERNAL", "preview": "NOT_RUN", "physical_device": "NOT_RUN", "checks": RESULTS}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
