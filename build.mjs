import { build } from 'esbuild';
import { mkdirSync, copyFileSync, cpSync, rmSync } from 'node:fs';

// wasm 은 기본적으로 CDN 에서 받습니다(배포 용량 19MB → 0.5MB).
// --vendor-wasm 을 주면 dist/wasm 으로 함께 묶습니다. 이때 src/detect.js 의
// WASM 상수를 './wasm' 으로 바꿔야 합니다.
const vendorWasm = process.argv.includes('--vendor-wasm');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true, format: 'esm', minify: true, target: 'es2020',
  outfile: 'dist/app.js', logLevel: 'info',
});

copyFileSync('index.html', 'dist/index.html');
copyFileSync('src/styles.css', 'dist/styles.css');
copyFileSync('manifest.webmanifest', 'dist/manifest.webmanifest');

// TWA(안드로이드 앱) 가 이 도메인을 자기 것이라고 증명하는 파일.
// 이게 없으면 앱을 열었을 때 주소창이 그대로 남습니다.
mkdirSync('dist/.well-known', { recursive: true });
copyFileSync('well-known/assetlinks.json', 'dist/.well-known/assetlinks.json');

// 아이콘 하나가 없다고 배포 전체를 죽이지는 않습니다. 경고만 남기고 넘어갑니다.
// (다운로드를 거치면 파일명의 하이픈이 떨어지는 일이 있어 실제로 한 번 물렸습니다)
for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo.svg']) {
  try { copyFileSync(`assets/${f}`, `dist/${f}`); }
  catch { console.warn(`[build] assets/${f} 없음 — 건너뜁니다`); }
}

if (vendorWasm) {
  mkdirSync('dist/wasm', { recursive: true });
  cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'dist/wasm', { recursive: true });
}

console.log(`build done${vendorWasm ? ' (wasm vendored)' : ' (wasm from CDN)'}`);
