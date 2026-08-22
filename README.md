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

GitHub `byite1226-a11y/sungong` 의 `main` 에 올리면 자동 배포됩니다 → https://sungong-app.vercel.app

빌드 설정(`buildCommand` · `outputDirectory`)은 `vercel.json` 안에 들어 있어 대시보드에서 따로 맞출 필요가 없습니다.
같은 파일의 `Permissions-Policy: camera=(self)` 가 카메라를 허용합니다.

## 구조

```
index.html          진입점 (dist 기준 경로)
build.mjs           esbuild 번들 (wasm 은 CDN, --vendor-wasm 으로 자체 호스팅 가능)
src/main.js         상태 · 라우터 · 화면 13장 · 세션 제어
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

## 디자인

클로드 디자인 아트보드 13장(폰) 기준으로 전 화면을 조판했습니다.
토큰 이름·값은 `공모전-디자인시스템-마스터브리프` v2 를 그대로 따릅니다.

지키고 있는 두 가지 —
- **과목 색 5종**은 색각 이상(deutan·protan) ΔE 검증을 통과한 값입니다. 임의로 바꾸면 히트맵·통계가 무너집니다
- **구간 4종**은 색만이 아니라 텍스처로도 구분됩니다 (졸음 45° 사선 · 휴식 세로 점선). 흑백으로 뽑아도 읽힙니다

## 아직 안 된 것

- 포모도로 긴 휴식 분기 (짧은 휴식만)
- 오프라인 큐 (RPC 실패 시 화면은 계속 돌지만 재업로드는 미구현)
- 세션 요약의 구간 경계 수동 편집
- 반복 할 일 (스키마·RPC 는 있고 화면이 없음)
- 회원 탈퇴 (앱스토어 심사 항목 — Edge Function 필요)
- 푸시 알림 스케줄러
