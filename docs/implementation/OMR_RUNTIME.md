# 로컬 OMR 런타임 재현 안내

로컬 이미지 인식(`/local-image`)은 저장소 코드와 **저장소 밖 외부 런타임 폴더** 하나를 함께 씁니다. 이 문서는 두 부분의 경계와 준비·확인 방법을 정리합니다.

## 1. 구성 요소 구분

| 구분 | 위치 | 버전 관리 |
|---|---|---|
| 프로젝트 소유 실행 코드 | `experiments/homr-integration/*.py`(보완 규칙, pipeline, `from_image.py`, `run_local.py`, `homr_observe.py`, `run_windows.py`), `scripts/local-image-worker.mjs`, `src/server/local-image/*` | 저장소. 서버 시작 시 파일 해시가 `runnerSha256`로 job manifest와 요청 캐시 키에 들어갑니다. |
| 외부 라이브러리 | `<runtime>/homr-source`(github.com/liebharc/homr, 고정 revision), `<runtime>/homr-windows-env`(Python 3.12.14 가상환경) | `omr-runtime/runtime-manifest.json`의 `homrRevision`, `omr-runtime/homr-windows-freeze.txt` |
| 모델·언어 데이터 | homr ONNX 3개, rapidocr ONNX 3개, Audiveris 5.10.2의 tesseract `eng`/`kor` traineddata, Audiveris app jar(leptonica/tesseract 네이티브) | `runtime-manifest.json`에 경로·크기·sha256만 기록합니다. 파일은 저장소에 넣지 않습니다(재배포 권한 확인 대상). |
| 사용자 원본·평가 정답·실험 증거 | 사용자 이미지, r551/정오표, 감사·검증 산출물 | 저장소에 넣지 않습니다. 런타임은 읽지 않습니다(`pipeline.py`가 평가 파일 open을 차단). |
| 일시 산출물 | `HM_LOCAL_IMAGE_ROOT/jobs/<id>` | job 폴더. `artifacts.json`에 해시가 기록됩니다. |

2026-09-25에 `run_windows.py`(Windows Job Object 자원 제한)와 `homr_observe.py`(homr CLI 관찰 래퍼)를 private 비교 폴더에서 저장소로 옮겼습니다. 두 파일 첫 줄에 원본 sha256을 남겼고, 경로 해석만 바꿨습니다. 이제 외부 폴더에는 프로젝트 코드가 없습니다.

## 2. 준비

1. 외부 런타임 폴더를 하나 정합니다(예: `D:\hm-omr-runtime`).
2. `git clone https://github.com/liebharc/homr.git homr-source` 후 `runtime-manifest.json`의 `homrRevision`으로 checkout합니다.
3. Python 3.12.14로 `homr-windows-env` 가상환경을 만들고 `pip install -r docs/implementation/omr-runtime/homr-windows-freeze.txt`를 실행합니다. 이어 homr-source를 editable로 설치합니다.
4. homr 모델과 rapidocr 모델은 homr 첫 실행 때 내려받는 위치에 둡니다. Audiveris 5.10.2 Windows 콘솔 MSI는 `audiveris-portable/files`로 풀고, tessdata `eng`/`kor`를 `audiveris-portable/tessdata`에 둡니다.
5. 확인:

```powershell
node scripts/check-omr-runtime.mjs D:\hm-omr-runtime
```

`ready:true`여야 합니다. 불일치 항목이 있으면 항목별 준비 방법이 출력되고 종료 코드는 1입니다. 서버 설정(`src/server/local-image/config.ts`)도 같은 해시를 시작할 때 다시 검증합니다. 대응 코드는 `LOCAL_IMAGE_MODEL_REVISION`, `LOCAL_IMAGE_MODELS_MISSING`, `LOCAL_IMAGE_MODEL_INTEGRITY`, `LOCAL_IMAGE_PATH_CONFIG`입니다.

## 3. 실행

```powershell
$env:HM_LOCAL_IMAGE_OMR='1'
$env:HM_LOCAL_IMAGE_ORIGIN='http://127.0.0.1:3203'
$env:HM_LOCAL_IMAGE_ROOT='<job 저장 폴더 절대 경로>'
$env:HM_LOCAL_IMAGE_COMPARE='<외부 런타임 폴더 절대 경로>'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3203
```

로컬 검증 build는 `HM_LOCAL_DIST_DIR=.next-local-current`처럼 `.next-local-` 접두어를 가진 하나의 고정 폴더를 재사용합니다. 검증 회차마다 설정 파일에 새 분기를 추가하지 않습니다.

## 4. 이 PC의 확인 결과

2026-09-25: 기존 비교 폴더(`engine-compare-2026-09-11.private`)는 homr `457e7c65…`, Python 3.12.14, 고정 pip 목록, 모델 8개 해시에 대해 `ready:true`였습니다.
