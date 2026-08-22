# 순공 (sungong) — 웹앱

카메라가 **실제로 앉아 있던 시간(순공시간)** 만 세고, 그 시간이 플래너 할 일에 자동으로 채워집니다.
브라우저에서 온디바이스로 착석·졸음을 판정합니다. 얼굴 이미지는 저장되지도, 전송되지도 않습니다.

## 실행

```bash
npm install
npm run build
npx serve dist          # 또는 아무 정적 서버
```

**카메라는 HTTPS 또는 localhost 에서만 동작합니다.** 폰에서 테스트하려면 배포가 필요합니다.

## 배포 (Vercel)

```bash
npx vercel --prod
```

빌드 설정은 자동 감지되지 않으니 처음 한 번만:

- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

`vercel.json` 에 `Permissions-Policy: camera=(self)` 가 들어 있어 카메라가 허용됩니다.

## 구조

```
index.html          진입점 (dist 기준 경로)
build.mjs           esbuild 번들 + wasm 복사
src/main.js         상태 · 라우터 · 9화면 · 세션 제어
src/db.js           Supabase 클라이언트 + RPC 래퍼
src/detect.js       MediaPipe FaceLandmarker 판정기 (+ 수동 폴백)
src/ui.js           아이콘 · 포맷터 · 링 · 토스트
src/styles.css      디자인 토큰 (라이트 A / 다크 B)
```

## 판정 규칙

```
얼굴 없음   N초 지속 → away    (기본 20초)
눈 감김     N초 지속 → drowsy  (기본 8초, eyeBlink 블렌드셰이프 > 0.5)
고개 떨굼   N초 지속 → drowsy  (pitch < −22°)
복귀        1.5초    → ok

순공 = 총시간 − Σ(away + drowsy + pause + break)
```

- **프레임 샘플링 2fps** (`SAMPLE_MS = 500`) — 장시간 세션의 발열·배터리 때문입니다
- 프레임은 판정 직후 버려집니다. 서버로 가는 것은 구간의 종류와 시각뿐입니다
- 카메라 거부·모델 로드 실패 시 **수동 모드로 자동 폴백** — 앱은 그대로 동작합니다
- 설정의 **빠른 시연 모드**를 켜면 임계값이 3초/2초로 줄어 바로 확인할 수 있습니다

## 백엔드

Supabase `wiezfwgevjvcoambrngh` (ap-northeast-2). 스키마·RLS·RPC는 이미 적용돼 있습니다.
데모 계정: `demo@sungong.app` / `sungong-demo-2026` (3주치 시드 포함)

## 아직 안 된 것

- 할 일 추가 시트 (버튼은 있고 안내 토스트만 뜸)
- 포모도로 긴 휴식 분기 (짧은 휴식만)
- 오프라인 큐 (RPC 실패 시 화면은 계속 돌지만 재업로드는 미구현)
- 세션 요약의 구간 탭 툴팁·구간 수동 편집
