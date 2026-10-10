"""Production-build, ordinary-entry smoke on disposable localhost only.

No database, object store or cloud credentials are installed.
This proves direct-import Product Core on disposable localhost.
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import traceback
from urllib.parse import urlsplit
from urllib.request import urlopen
from xml.etree import ElementTree as ET
import zipfile

from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "runtime-browser-evidence"
BASE = "http://127.0.0.1:3100"
TITLE = "Runtime closure original fixture"
RESULTS: list[dict[str, object]] = []
STEP = "server-readiness"
OBSERVATIONS: list[dict[str, object]] = []


def begin(step: str) -> None:
    global STEP
    STEP = step


def safe_path(url: str) -> str:
    path = urlsplit(url).path
    return path if path in ("/", "/import", "/workspace", "/share", "/api/session") else "/[redacted]"


def redact(text: str) -> str:
    text = re.sub(r'v1\.[A-Za-z0-9_-]{43}\.\d{10,12}\.[a-f0-9]{64}', '[redacted-handle]', text)
    text = re.sub(r'(?:https?|postgres(?:ql)?|s3)://\S+', '[redacted-url]', text)
    return re.sub(r'(?i)((?:token|cookie|secret|authorization|password|payload)\s*[:=]\s*)\S+', r'\1[redacted]', text)


def record(step: str, **details: object) -> None:
    result = {"step": step, "status": "PASS", **details}
    RESULTS.append(result)
    print(json.dumps(result, ensure_ascii=False), flush=True)


def original_score(repeats: int = 1) -> bytes:
    # Session-authored eight-bar diatonic score; no user/external score is used.
    bars = []
    for index, (root, kind, notes) in enumerate([
        ("C", "major", "CEGE"), ("G", "major", "DGBG"),
        ("A", "minor", "CEAE"), ("F", "major", "CFAC"),
        ("C", "major", "EGEC"), ("G", "major", "DGBG"),
        ("F", "major", "AFAC"), ("C", "major", "GECC"),
    ] * repeats, 1):
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
    # The product schedules canonical draft updates with a React transition.
    # A click plus retrying checked-state assertion observes that public state;
    # Locator.check() requires the transition to commit synchronously.
    lead = page.locator('input[name="lead-candidate"]').first
    lead.click()
    expect(lead).to_be_checked()
    expect(page.get_by_text("정본 digest·timeline·atomization 재계산 중…", exact=True)).not_to_be_visible(timeout=30000)
    expect(page.locator('input[id^="chord-"]')).not_to_have_count(0)
    for button in page.get_by_role("button", name="저장하고 확인", exact=True).all():
        button.click()
    expect(page.get_by_text("정본 digest·timeline·atomization 재계산 중…", exact=True)).not_to_be_visible(timeout=30000)
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
    selector = page.get_by_label(re.compile(r"^Preset(?:\s|$)"))
    selector.select_option(preset)
    expect(selector).to_have_value(preset)
    page.get_by_role("button", name="정본 화음 생성", exact=True).click()
    expect(page.get_by_test_id("generation-status")).to_have_text("complete", timeout=60000)
    expect(page.locator('.score-wrap svg')).not_to_have_count(0)
    expect(page.locator('section.practice-player [role="alert"]')).to_have_count(0)


def readable_layout(page: Page, minimum_systems: int = 2) -> dict:
    # A visible SVG can still contain a whole song scaled into one tiny line.
    # Measure actual browser geometry, including flex controls with long IDs.
    page.wait_for_function("""minimum => {
      const notes = [...document.querySelectorAll('.score-wrap .abcjs-note')];
      const systems = new Set(notes.flatMap(n => [...n.classList].filter(c => /^abcjs-l\\d+$/.test(c))));
      const heads = [...document.querySelectorAll('.score-wrap .abcjs-notehead')];
      return document.documentElement.scrollWidth <= innerWidth + 1 && systems.size >= minimum &&
        heads.length > 0 && heads.every(n => n.getBoundingClientRect().height >= 4);
    }""", arg=minimum_systems, timeout=15000)
    return page.evaluate("""() => ({
      viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      systems: new Set([...document.querySelectorAll('.score-wrap .abcjs-note')]
        .flatMap(n => [...n.classList].filter(c => /^abcjs-l\\d+$/.test(c)))).size,
      minimumNoteheadHeight: Math.min(...[...document.querySelectorAll('.score-wrap .abcjs-notehead')]
        .map(n => n.getBoundingClientRect().height))
    })""")


AUDIO_TAP = """() => {
  window.__hmAnalyzers = [];
  window.__hmIntervals = new Set();
  const schedule = window.setInterval.bind(window);
  const clear = window.clearInterval.bind(window);
  window.setInterval = (...args) => {
    const timer = schedule(...args); window.__hmIntervals.add(timer); return timer;
  };
  window.clearInterval = (timer) => { window.__hmIntervals.delete(timer); clear(timer); };
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


def audio_released(page: Page, timers: int) -> None:
    page.wait_for_function("""timers =>
      window.__hmAnalyzers.every(a => a.context.state === 'closed') &&
      window.__hmIntervals.size === timers""", arg=timers, timeout=15000)


def play_with_pcm(page: Page, action: str = "Play") -> None:
    player = page.locator('section.practice-player')
    player.get_by_role("button", name=action, exact=True).click()
    expect(player.locator('p.status').first).to_contain_text("재생 중")
    # Observe real Web Audio PCM, not just a button/transport state. The analyzer
    # is transparent in the existing signal path; no synthesizer is replaced.
    page.wait_for_function("""() => window.__hmAnalyzers.some(a => {
      if (a.context.state !== 'running') return false;
      const samples = new Float32Array(a.fftSize); a.getFloatTimeDomainData(samples);
      return samples.some(x => Math.abs(x) > 0.00001);
    })""", timeout=15000)
    assert page.evaluate("new Set(window.__hmAnalyzers.filter(a => a.context.state !== 'closed').map(a => a.context)).size") == 1, "More than one live audio context"


def playback(page: Page) -> None:
    player = page.locator('section.practice-player')
    timers = page.evaluate("window.__hmIntervals.size")
    play_with_pcm(page)
    player.get_by_role("button", name="Pause", exact=True).click()
    expect(player.locator('p.status').first).to_contain_text("일시 정지")
    audio_released(page, timers)
    play_with_pcm(page, "Resume")
    player.get_by_role("button", name="Reset", exact=True).click()
    expect(player.locator('p.status').first).to_contain_text("준비")
    audio_released(page, timers)


def download(page: Page, label: str, name: str) -> Path:
    with page.expect_download() as pending:
        page.get_by_role("button", name=label, exact=True).click()
    path = OUT / name
    pending.value.save_as(path)
    assert path.stat().st_size > 0
    return path


def run_product_core(page: Page) -> bytes:
    begin("musicxml-user-entry-review-project")
    page.goto(BASE, wait_until="networkidle")
    page.get_by_text("기존 입력 경로", exact=True).click()
    page.get_by_role("link", name="MusicXML과 Quick Review", exact=True).click()
    page.get_by_label("MusicXML / XML / MXL 선택 또는 드롭", exact=True).set_input_files({"name": "invalid.musicxml", "mimeType": "application/xml", "buffer": b'<not-a-score />'})
    expect(page.get_by_text("가져오기가 안전하게 차단되었습니다.", exact=True)).to_be_visible()
    record("invalid-direct-input-rejected")
    xml = original_score()
    page.get_by_label("MusicXML / XML / MXL 선택 또는 드롭", exact=True).set_input_files({"name": "original.musicxml", "mimeType": "application/xml", "buffer": xml})
    ready_review(page)
    workspace = page.url
    record("musicxml-user-entry-review-project", measures=8, singers=3)
    for preset in ("simple", "standard", "full"):
        begin(f"generation-{preset}")
        generate(page, preset)
        record("generation", preset=preset, result="complete")
    for projection in ("lead", "upper", "lower", "full"):
        begin(f"projection-render-audio-{projection}")
        page.get_by_role("button", name=projection, exact=True).click()
        expect(page.locator('.score-wrap svg')).not_to_have_count(0)
        playback(page)
        record("projection-render-audio", projection=projection, pcm="nonzero", physical_device=False)
    begin("playing-projection-replacement")
    timers = page.evaluate("window.__hmIntervals.size")
    play_with_pcm(page)
    page.get_by_role("button", name="lead", exact=True).click()
    audio_released(page, timers)
    playback(page)
    page.get_by_role("button", name="full", exact=True).click()
    record("playing-projection-replacement", released_contexts=True, released_timers=True)
    begin("export-save-reload-reenter")
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
    begin("mobile-controls")
    page.get_by_role("button", name="lead", exact=True).click()
    playback(page)
    layout = readable_layout(page)
    page.screenshot(path=str(OUT / "workspace-mobile.png"), full_page=True)
    record("mobile-controls", viewport="390x844", physical_device=False, layout=layout)
    page.get_by_role("button", name="full", exact=True).click()
    begin("url-share-readonly-render-audio")
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
    readable_layout(shared)
    shared.close()
    record("url-share-readonly-render-audio", server_store=False)
    begin("playing-unmount-owned-local-project-delete")
    timers = page.evaluate("window.__hmIntervals.size")
    play_with_pcm(page)
    page.get_by_role("button", name="로컬 삭제", exact=True).click()
    page.wait_for_url(BASE + "/")
    audio_released(page, timers)
    record("playing-unmount-release", released_contexts=True, released_timers=True)
    page.goto(workspace, wait_until="networkidle")
    expect(page.get_by_role("link", name="Quick Review에서 시작하기 →", exact=True)).to_be_visible()
    expect(page.get_by_test_id("generation-status")).to_have_count(0)
    record("owned-local-project-delete")
    begin("exported-musicxml-reimport-generation")
    page.goto(BASE + "/import", wait_until="networkidle")
    page.get_by_label("MusicXML / XML / MXL 선택 또는 드롭", exact=True).set_input_files(exported_xml)
    ready_review(page)
    generate(page, "standard")
    record("exported-musicxml-reimport-generation", result="complete")
    return xml


def run(page: Page) -> None:
    removed_api_requests = []
    page.on("request", lambda request: removed_api_requests.append(request.method) if urlsplit(request.url).path.startswith(("/api/omr/", "/api/local-image")) else None)
    xml = run_product_core(page)
    begin("mxl-direct-import-review-generation")
    page.goto(BASE + "/import", wait_until="networkidle")
    page.locator('input[type="file"]').first.set_input_files({"name": "original.mxl", "mimeType": "application/vnd.recordare.musicxml", "buffer": compressed_score(xml)})
    ready_review(page)
    generate(page, "standard")
    record("mxl-direct-import-review-generation", result="complete")
    playback(page)
    page.get_by_role("button", name="로컬 저장", exact=True).click()
    page.reload(wait_until="networkidle")
    expect(page.get_by_test_id("generation-status")).to_have_text("complete", timeout=30000)
    mxl_export = download(page, "MusicXML 다운로드", "mxl-roundtrip.musicxml")
    assert len(ET.fromstring(mxl_export.read_bytes()).findall("part")) == 3
    record("mxl-playback-save-reload-export", result="complete")
    assert removed_api_requests == [], "Direct import dispatched an obsolete recognition request"
    begin("long-score-readable-reflow")
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(BASE + "/import", wait_until="networkidle")
    page.get_by_label("MusicXML / XML / MXL 선택 또는 드롭", exact=True).set_input_files({"name": "long-original.musicxml", "mimeType": "application/xml", "buffer": original_score(12)})
    ready_review(page)
    generate(page, "standard")
    desktop = readable_layout(page, 12)
    page.locator('.score-wrap').screenshot(path=str(OUT / "long-score-desktop.png"))
    timers = page.evaluate("window.__hmIntervals.size")
    play_with_pcm(page)
    page.set_viewport_size({"width": 390, "height": 844})
    mobile = readable_layout(page, 12)
    expect(page.locator('section.practice-player p.status').first).to_contain_text("재생 중")
    assert page.evaluate("new Set(window.__hmAnalyzers.filter(a => a.context.state !== 'closed').map(a => a.context)).size") == 1
    page.get_by_role("button", name="Reset", exact=True).click()
    audio_released(page, timers)
    page.locator('.score-wrap').screenshot(path=str(OUT / "long-score-mobile.png"))
    assert mobile["systems"] > desktop["systems"], "Viewport resize did not reflow score systems"
    page.get_by_role("button", name="로컬 삭제", exact=True).click()
    page.wait_for_url(BASE + "/")
    record("long-score-readable-reflow", measures=96, desktop=desktop, mobile=mobile, playback_survived_resize=True)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    # No cloud secrets/URLs are accepted for this test; production DB migrations
    # and external effects cannot be authorized accidentally by runner environment.
    for key in ("DATABASE_URL", "S3_ENDPOINT"):
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
            context.on("page", lambda child: child.on("pageerror", lambda error: OBSERVATIONS.append({"kind": "pageerror", "path": safe_path(child.url), "error": redact(str(error))})))
            page.on("pageerror", lambda error: OBSERVATIONS.append({"kind": "pageerror", "path": safe_path(page.url), "error": redact(str(error))}))
            context.on("response", lambda response: OBSERVATIONS.append({"kind": "api-response", "path": safe_path(response.url), "status": response.status}) if "/api/" in response.url else None)
            context.on("requestfailed", lambda request: OBSERVATIONS.append({"kind": "requestfailed", "path": safe_path(request.url), "method": request.method, "error": redact(request.failure or "unknown")}))
            try:
                run(page)
                begin("browser-error-gate")
                assert not [event for event in OBSERVATIONS if event["kind"] == "pageerror"], "Unhandled browser pageerror (see observations)"
                completed = True
            except Exception as error:
                failure = {"step": STEP, "status": "FAIL", "path": safe_path(page.url), "exception_type": type(error).__name__, "error": redact(str(error)) or type(error).__name__, "traceback": redact("".join(traceback.format_exception(error)))}
                RESULTS.append(failure)
                print(json.dumps(failure, ensure_ascii=False), flush=True)
                text = redact(page.locator("body").inner_text())
                (OUT / "failure-body.txt").write_text(text, encoding="utf-8")
                # URL-share payloads are not included in evidence screenshots.
                page.locator('a[href*="/share"]').evaluate_all("links => links.forEach(a => a.textContent = '공유 링크 (숨김)')")
                page.screenshot(path=str(OUT / "failure.png"), full_page=True)
                raise SystemExit(1) from None
            finally:
                browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill(); server.wait(timeout=10)
        log.close()
        (OUT / "results.json").write_text(json.dumps({"code_sha": os.environ.get("HM_CODE_SHA", "local-unpublished"), "environment": "disposable-localhost-production-build", "status": "PASS" if completed else "FAIL", "preview": "NOT_RUN", "physical_device": "NOT_RUN", "checks": RESULTS, "observations": OBSERVATIONS}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
