"""Execute explicit UI actions; log interaction effort, not estimated human editing time.

Actions are supplied separately after original-image inspection. This driver never
reads an oracle, applies a correction bundle, writes IndexedDB, or calls OMR.
"""
from pathlib import Path
from urllib.parse import urlsplit
import argparse
import json
import time
from playwright.sync_api import sync_playwright


def locate(page, spec):
    target = page
    for item in spec if isinstance(spec, list) else [spec]:
        if 'role' in item:
            target = target.get_by_role(item['role'], name=item.get('name'), exact=True)
        elif 'label' in item:
            target = target.get_by_label(item['label'], exact=item.get('exact', True))
        elif 'text' in item:
            target = target.get_by_text(item['text'], exact=True)
        else:
            target = target.locator(item['css'])
        if 'nth' in item:
            target = target.nth(item['nth'])
    return target


SNAPSHOT = """async () => {
  const names = (await indexedDB.databases()).map(d => d.name);
  const report = {};
  for (const [database, store] of [
    ['harmonymaker-import-recovery-v1','drafts'],
    ['harmonymaker-structural-recovery-v1','drafts']
  ]) {
    if (!names.includes(database)) continue;
    const db = await new Promise((resolve,reject) => {const r=indexedDB.open(database);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const rows = await new Promise((resolve,reject) => {const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    db.close();
    for (const row of rows) {
      for (const p of row.pages) {
        p.observedSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await p.blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
        p.bytes=p.blob.size;delete p.blob;
      }
      const summarize = b => ({manifestSha256:b.manifestSha256,imageSha256:b.image.sha256,
        artifactHashes:Object.fromEntries(Object.entries(b.artifacts).map(([k,v])=>[k,v.sha256])),
        evidence:JSON.parse(b.artifacts.evidence.text)});
      if (row.localCandidate) row.localCandidate=summarize(row.localCandidate);
      for (const d of row.workspace?.documents ?? []) if (d.localCandidate) d.localCandidate=summarize(d.localCandidate);
    }
    report[database]=rows;
  }
  report.databaseNames=names;
  return report;
}"""


def run(v):
    out = v.output / v.case
    out.mkdir(parents=True, exist_ok=True)
    actions = json.loads(v.actions.read_text(encoding='utf-8'))
    records, blocked, errors = [], [], []
    started = time.perf_counter()
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            str(out / 'browser-profile'), headless=True, viewport={'width': 1440, 'height': 1000},
            args=['--disable-background-networking', '--disable-component-update'])
        def route(r):
            if urlsplit(r.request.url).hostname in ['127.0.0.1', 'localhost']:
                r.continue_()
            else:
                blocked.append(r.request.url)
                r.abort()
        context.route('**/*', route)
        page = context.pages[0] if context.pages else context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(v.url + '/import', wait_until='networkidle', timeout=90000)
        for number, action in enumerate(actions):
            begin = time.perf_counter()
            record = {'action': action, 'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            try:
                op = action['op']
                if op == 'upload':
                    locate(page, action['target']).set_input_files(action['value'])
                elif op in ['fill', 'select']:
                    target = locate(page, action['target'])
                    if op == 'fill':
                        target.fill(action['value'])
                    else:
                        target.select_option(**action['value'])
                elif op in ['click', 'check', 'uncheck']:
                    getattr(locate(page, action['target']), op)()
                elif op == 'download':
                    with page.expect_download() as d:
                        locate(page, action['target']).click()
                    d.value.save_as(str(out / action['name']))
                elif op == 'reload':
                    page.reload(wait_until='networkidle')
                elif op == 'inspect':
                    target = locate(page, action['target']) if 'target' in action else page.locator('body')
                    record['observed'] = target.inner_text()
                    record['controls'] = target.locator('input,select,textarea,button').evaluate_all("""els => els.map(e=>({label:e.getAttribute('aria-label')||Array.from(e.labels??[]).map(l=>l.textContent).join(' ')||e.textContent,value:e.value,checked:e.checked,disabled:e.disabled}))""")
                    if action.get('screenshot') and 'target' in action:
                        target.scroll_into_view_if_needed()
                else:
                    raise ValueError('Unsupported driver action: ' + op)
                if 'waitText' in action:
                    page.get_by_text(action['waitText'], exact=False).first.wait_for(timeout=30000)
                page.wait_for_timeout(250)
                record['status'] = 'complete'
            except Exception as e:
                record['status'] = 'blocked'
                record['error'] = str(e)
            record['uiWallSeconds'] = round(time.perf_counter() - begin, 3)
            stem = v.actions.stem + '-' + str(number)
            (out / (stem + '.ui.txt')).write_text(page.locator('body').inner_text(), encoding='utf-8')
            if action.get('screenshot') or record['status'] == 'blocked':
                page.screenshot(path=str(out / (stem + '.png')))
            records.append(record)
            if record['status'] == 'blocked':
                break
        snapshot = page.evaluate(SNAPSHOT)
        assert 'harmonymaker-v0' not in snapshot['databaseNames'], 'Unexpected project creation in a stopped candidate trial'
        assert urlsplit(page.url).path == '/import', 'Unexpected Source/workspace navigation'
        workspace = page.get_by_role('button', name='프로젝트 워크스페이스 열기 →', exact=True)
        assert workspace.count() == 0 or workspace.is_disabled(), 'Incomplete candidate can advance'
        (out / (v.actions.stem + '.storage.json')).write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding='utf-8')
        report = {'case': v.case, 'actions': records, 'wallSecondsIncludingBrowserAndNavigation': round(time.perf_counter()-started, 3),
                  'interactionCounts': {op: sum(r['action']['op'] == op for r in records) for op in ['upload','fill','select','click','check','uncheck','download','reload','inspect']},
                  'browserErrors': errors, 'blockedExternalRequests': blocked,
                  'timingInterpretation': 'Measured agent-operated UI time; not a human usability study. Observation/decision time is recorded separately.',
                  'url': page.url, 'sourceApproved': False}
        (out / (v.actions.stem + '.report.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        context.close()
    print(json.dumps({'case':v.case,'completed':sum(r['status']=='complete' for r in records),'lastStatus':records[-1]['status'] if records else None,'error':records[-1].get('error') if records else None,'output':str(out)},ensure_ascii=False))


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--output',type=Path,required=True);p.add_argument('--actions',type=Path,required=True)
    p.add_argument('--case',required=True);p.add_argument('--url',default='http://127.0.0.1:3194')
    run(p.parse_args())
