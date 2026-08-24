# 순공 — 안드로이드 앱(APK) 만들기

지금 배포된 웹앱을 **Trusted Web Activity** 로 감쌉니다. 다시 짜는 게 아니라 포장입니다.
내부적으로 Chrome 을 그대로 쓰기 때문에 **카메라·MediaPipe 가 웹과 100% 동일하게** 동작합니다.
Play Store 가 정식으로 인정하는 방식이라 그대로 출시할 수 있습니다.

## 먼저 알아둘 것

- **패키지 이름은 한 번 스토어에 올리면 영원히 못 바꿉니다.** 지금 `co.byite.sungong` 로 넣어뒀습니다.
  도메인이 `byite.co` 가 아니라면 바꾸세요 (`twa-manifest.json` 의 `packageId`,
  `well-known/assetlinks.json` 의 `package_name` 두 곳).
- **키스토어를 잃어버리면 앱을 업데이트할 수 없습니다.** Play App Signing 을 켜두면
  구글이 원본 키를 보관해줘서 복구가 가능합니다 — 켜는 걸 권합니다.
- 웹 서버가 죽으면 앱도 빈 화면이 됩니다. TWA 는 껍데기이고 내용은 웹에서 옵니다.

## 준비

```bash
npm install -g @bubblewrap/cli
bubblewrap doctor          # JDK·Android SDK 를 자동으로 받아옵니다 (첫 실행은 몇 분)
```

## 1. 프로젝트 생성

이 저장소를 받은 폴더에서:

```bash
bubblewrap init --manifest https://sungong-app.vercel.app/manifest.webmanifest
```

물어보는 값은 대부분 그냥 엔터를 쳐도 됩니다. 다만 이미 채워둔
`twa-manifest.json` 을 쓰고 싶으면, init 이 만든 파일을 이걸로 덮어쓰고 다음으로 넘어가세요.

**Signing key** 를 묻는 단계에서 새로 만들면 `android.keystore` 가 생깁니다.
**이 파일과 비밀번호를 반드시 따로 백업하세요.**

## 2. 도메인 소유 증명 (이게 빠지면 주소창이 남습니다)

키의 지문을 뽑습니다:

```bash
bubblewrap fingerprint list
```

`SHA-256` 값(`AA:BB:CC:...` 형태)을 복사해서
**`well-known/assetlinks.json`** 의 `PUT_YOUR_SHA256_FINGERPRINT_HERE` 자리에 붙여넣고,
GitHub 에 올립니다. 배포되면 아래 주소가 응답해야 합니다:

```
https://sungong-app.vercel.app/.well-known/assetlinks.json
```

> `build.mjs` 가 이 파일을 `dist/.well-known/` 로 복사하도록 이미 해뒀습니다.
> 확인: `npx serve dist` 후 위 경로 열어보기.

## 3. 빌드

```bash
bubblewrap build
```

나오는 것:
- `app-release-signed.apk` — 폰에 바로 설치해서 테스트
- `app-release-bundle.aab` — Play Store 업로드용

## 4. 폰에 설치

```bash
adb install -r app-release-signed.apk
```

USB 연결이 번거로우면 APK 파일을 폰으로 보내 직접 실행해도 됩니다
(설정에서 '출처를 알 수 없는 앱' 허용 필요).

## 5. Play Store 내부 테스트

Play Console → 앱 만들기 → 테스트 → 내부 테스트 → `app-release-bundle.aab` 업로드.
내부 테스터는 심사 없이 몇 분 안에 링크를 받습니다.

---

## 순서 주의

**브라우저 테스트를 먼저 하세요.** TWA 는 Chrome 을 그대로 쓰므로
브라우저에서 안 되는 건 APK 에서도 똑같이 안 됩니다. APK 가 감지 버그를 고쳐주지 않습니다.

`sungong-app.vercel.app` 을 폰 브라우저로 열고 설정에서 **빠른 시연 모드**를 켜면
5분 안에 착석·이탈·졸음·엎드림이 실제로 잡히는지 확인됩니다.
그 답이 나온 뒤에 포장하는 게 맞습니다 — 그래야 문제가 생겼을 때
웹 문제인지 포장 문제인지 구분됩니다.
