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
for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo.svg']) {
  copyFileSync(`assets/${f}`, `dist/${f}`);
}

if (vendorWasm) {
  mkdirSync('dist/wasm', { recursive: true });
  cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'dist/wasm', { recursive: true });
}

console.log(`build done${vendorWasm ? ' (wasm vendored)' : ' (wasm from CDN)'}`);
