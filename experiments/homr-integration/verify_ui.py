"""Upload generated candidates into the real local /import UI, without approving them."""
from pathlib import Path
from urllib.parse import urlsplit
import argparse,json
from playwright.sync_api import sync_playwright

def main(v):
    report=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        for case in ['user-jpeg','independent-a','independent-b']:
            context=browser.new_context(viewport={'width':1400,'height':1000});blocked=[];errors=[]
            def route(r):
                if urlsplit(r.request.url).hostname in ['127.0.0.1','localhost']:r.continue_()
                else:blocked.append(r.request.url);r.abort()
            context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(v.url+'/import',wait_until='networkidle')
            path=v.evidence/'runs'/case/'v6/C-integrated.candidate.musicxml'
            page.locator('input[type=file]').first.set_input_files(str(path))
            page.wait_for_function("!Array.from(document.querySelectorAll('p')).some(p=>p.textContent.includes('보안 검사 중')) && document.body.textContent.includes('교정')",timeout=30000)
            page.wait_for_timeout(1000)
            text=page.locator('body').inner_text()
            assert '구조 파싱 완료' in text or '차단' in text,text[:1000]
            workspace=page.get_by_role('button',name='프로젝트 워크스페이스 열기 →',exact=True)
            assert workspace.count()==0 or workspace.is_disabled()
            page.screenshot(path=str(v.evidence/(case+'-import-ui.png')),full_page=False)
            (v.evidence/(case+'-import-ui.txt')).write_text(text,encoding='utf-8')
            before=text
            page.reload(wait_until='networkidle');page.wait_for_timeout(500)
            after=page.locator('body').inner_text();(v.evidence/(case+'-after-reload-ui.txt')).write_text(after,encoding='utf-8')
            report.append({'case':case,'url':v.url+'/import','realProductComponent':True,'file':str(path),'workspaceOpened':False,'sourceApproved':False,'uiParseStatus':'review-required' if '구조 파싱 완료' in before else 'blocked','diagnosticCodes':sorted(set(__import__('re').findall(r'\b(?:IMPORT|SOURCE|OMR)_[A-Z_]+',before))),'reviewHeadings':page.locator('h2').all_text_contents(),'candidateRecoveryVisibleAfterReload':'보존' in after,'browserErrors':errors,'blockedExternalRequests':blocked,'downstream':'not executed; candidate is incomplete; no defaults or confirmations supplied'})
            context.close()
        browser.close()
    (v.evidence/'ui-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--evidence',type=Path,required=True);a.add_argument('--url',default='http://127.0.0.1:3194');main(a.parse_args())
