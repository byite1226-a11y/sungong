/**
 * Phase A — 정정용 판독 보고서 (마크다운)
 *
 *   run JSON 을 사람이 종이를 옆에 놓고 훑으며 "틀린 것만" 찾아낼 수 있는
 *   형태로 뽑는다. 문항 순서 나열은 앵커링이 심하므로 **마크별로 묶고**,
 *   가장 중요한 판별(slash·triangle)을 맨 위에 둔다.
 *
 *   사용:  node report_md.mjs --tier free                      # 최신 run 자동 선택
 *          node report_md.mjs --run runs/<파일>.json --tier paid [--pages photos/pages.txt]
 *   출력:  results/report_pilot_<ts>.md  (+ 콘솔에 경로)
 *
 *   --tier 는 필수다. 무료 티어 결과가 나중에 정본으로 오인되는 것을 막기 위해
 *   헤더에 반드시 찍는다. 파일럿(무료) 숫자는 게이트 판정에 쓰지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};

const TIER = arg('tier');
if (!['free', 'paid'].includes(TIER)) {
  console.error('--tier free 또는 --tier paid 를 반드시 지정하세요 (보고서 헤더에 찍힙니다)');
  process.exit(1);
}
const MODE = arg('mode', 'pilot');
if (MODE !== 'pilot') {
  console.error('현재는 --mode pilot 만 구현돼 있습니다. 전량(120장) 모드는 유료 전환 단계에서 만듭니다.');
  process.exit(1);
}

const latestRun = (dir) => {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
};
const runPath = arg('run') ? path.resolve(here, arg('run')) : latestRun(path.join(here, 'runs'));
if (!runPath) { console.error('runs/ 에 결과가 없습니다. 먼저 read.mjs 를 돌리세요'); process.exit(1); }
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));

/* pages.txt (선택) — "파일명 12-18" 또는 "파일명 12-18,21". 사용자가 직접 만든 것만 읽는다 */
const pagesPath = arg('pages') ? path.resolve(here, arg('pages')) : null;
const pages = {};
if (pagesPath) {
  for (const line of fs.readFileSync(pagesPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const sp = t.lastIndexOf(' ');
    if (sp < 0) continue;
    const file = t.slice(0, sp).trim();
    const nos = new Set();
    for (const tok of t.slice(sp + 1).split(',')) {
      const m = tok.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      for (let n = a; n <= b; n++) nos.add(n);
    }
    if (nos.size) pages[file] = nos;
  }
}

/* ── 집계 ── */
const MARK_SIGN = {
  slash: '/', triangle: '△', unclear_st: '/△?', question: '☆', check: '✓',
  circle: '○', unmarked: '(없음)', other: '(기타)',
};
/* 집중력이 가장 높은 자리에 가장 중요한 판별을 둔다 */
const GROUP_ORDER = ['slash', 'triangle', 'unclear_st', 'question', 'check', 'other', 'circle', 'unmarked'];
const GROUP_NOTE = {
  slash: '★ 세모가 얹힌 것이 섞여 있는지 확인',
  triangle: '★ 사선만 있는 것이 섞여 있는지 확인',
  unclear_st: '★ v0 전용 — 사선인지 △인지 모델이 구분하지 못한 것. 종이에서 확정 필요',
};

const files = Object.keys(run.photos).sort();
const groups = {};            // mark → [{file, no}]
const lowConf = [];           // 신뢰도 60 미만
const perFile = {};           // file → [{no, mark}]
let totalItems = 0, droppedTotal = 0, failedPhotos = 0, latencyTotal = 0;

for (const f of files) {
  const r = run.photos[f];
  latencyTotal += r.latency_ms || 0;
  if (r.error) { failedPhotos++; perFile[f] = null; continue; }
  droppedTotal += r.dropped_lines || 0;
  perFile[f] = [];
  for (const it of r.items) {
    totalItems++;
    perFile[f].push(it);
    (groups[it.mark] ??= []).push({ file: f, no: it.item_no });
    if (it.mark_confidence != null && it.mark_confidence < 0.6) {
      lowConf.push({ file: f, no: it.item_no, mark: it.mark, conf: Math.round(it.mark_confidence * 100) });
    }
  }
}

/* ── 마크다운 ── */
const L = [];
const stamp = new Date();
const title = MODE === 'pilot'
  ? `판독 보고서 · 파일럿${TIER === 'free' ? ' [스모크 테스트 · 무료 티어]' : ''}`
  : '판독 보고서';
L.push(`# ${title}`);
L.push(`model \`${run.model}\` · prompt \`${run.prompt_ver}\` · temperature \`0\`${run.media_res ? ` · media_res \`${run.media_res}\`` : ''} · tier \`${TIER}\` · ${stamp.toISOString().slice(0, 16).replace('T', ' ')}`);
L.push(`run \`${path.relative(here, runPath)}\``);
L.push('');
if (TIER === 'free') {
  L.push('> ⚠️ 무료 티어 스모크 테스트입니다. 이 숫자를 게이트 판정에 쓰지 마십시오.');
}
L.push('> 네 지표를 함께 읽으십시오. 혼동률·정확도의 분모가 "읽힌 문항"이라');
L.push('> 많이 누락하는 모델이 오히려 유리해 보입니다. 누락률과 함께 보아야 합니다.');
L.push('');

L.push('## 1. 요약');
L.push('');
L.push(`사진 ${files.length}장 / 판독 문항 ${totalItems}개 / 파싱 실패 줄 ${droppedTotal} / 측정 실패 ${failedPhotos}장 / 소요 ${Math.round(latencyTotal / 1000)}초`);
if (failedPhotos) {
  L.push('');
  L.push('측정 실패한 사진 (모델 오판과 섞지 말 것 — 재실행 대상):');
  for (const f of files) if (run.photos[f].error) L.push(`- \`${f}\` — ${run.photos[f].error}`);
}
if (droppedTotal) {
  L.push('');
  L.push('파싱에서 버려진 줄 (해당 사진의 문항이 누락됐을 수 있음):');
  for (const f of files) {
    const d = run.photos[f].dropped;
    if (d?.length) L.push(`- \`${f}\`: ${d.map(x => `\`${x}\``).join(' · ')}`);
  }
}
L.push('');

L.push('## 2. 마크별 묶음 — 여기를 보고 정정하세요');
L.push('');
for (const mark of GROUP_ORDER) {
  const rows = groups[mark];
  if (!rows && !['slash', 'triangle', 'question', 'check', 'circle', 'unmarked'].includes(mark)) continue;
  const note = GROUP_NOTE[mark] ? `        ${GROUP_NOTE[mark]}` : '';
  L.push(`### ${MARK_SIGN[mark] ?? mark} ${mark} 로 읽음 — ${rows?.length ?? 0}개${note}`);
  L.push('');
  if (rows?.length) {
    const byFile = {};
    for (const r of rows) (byFile[r.file] ??= []).push(r.no);
    for (const [f, nos] of Object.entries(byFile)) L.push(`${f}  ${nos.sort((a, b) => a - b).join(' ')}`);
    L.push('');
  }
}
if (run.prompt_ver === 'v0') {
  L.push('> ℹ️ v0 는 표시가 있는 문항만 출력합니다 — unmarked 0개는 판독 누락이 아니라 형식상 정상입니다.');
  L.push('');
}

L.push(`## 3. 신뢰도 낮은 문항 (60 미만) — ${lowConf.length}개`);
L.push('');
if (lowConf.length) {
  for (const c of lowConf.sort((a, b) => a.conf - b.conf)) {
    L.push(`${c.file} ${c.no}  ${c.mark}    ${c.conf}`);
  }
} else if (run.prompt_ver === 'v0') {
  L.push('(v0 는 확신도를 출력하지 않습니다)');
} else {
  L.push('(없음)');
}
L.push('');

L.push('## 4. 페이지별 문항 번호 — 종이와 대조해 빠진 번호·없는 번호를 확인하세요');
L.push('');
for (const f of files) {
  const its = perFile[f];
  if (!its) { L.push(`${f}  (측정 실패)`); continue; }
  const nos = [...new Set(its.map(i => i.item_no))].sort((a, b) => a - b);
  const dup = its.length !== nos.length ? '  ⚠️ 같은 번호가 두 번' : '';
  let paper = '';
  if (pages[f]) {
    const exp = pages[f];
    const missing = [...exp].filter(n => !nos.includes(n)).sort((a, b) => a - b);
    const extra = nos.filter(n => !exp.has(n));
    paper = `  | 종이 ${exp.size}문항` +
      (missing.length ? ` · 누락 ${missing.join(',')}` : '') +
      (extra.length ? ` · 범위 밖 ${extra.join(',')} ← 환각 의심` : '');
  }
  L.push(`${f}  ${nos.join(',') || '(문항 없음)'}        (${nos.length}개)${dup}${paper}`);
}
L.push('');
if (!pagesPath) {
  L.push('> pages.txt 없이 생성했습니다. 각 줄을 종이와 대조해 **빠진 번호**(누락)와 **종이에 없는 번호**(환각)를 §5 형식으로 적어 주세요.');
  L.push('> 지문 범위 표기 `[1~3]` `[16~18]` 이 문항 번호로 둔갑했는지 특히 확인하십시오.');
  L.push('');
}

L.push('## 5. 정정 입력란');
L.push('');
L.push('아래 형식으로 **틀린 것만** 적어 주세요.');
L.push('');
L.push('    파일명 문항 → 실제마크');
L.push('    IMG_1234.jpg 14 → triangle');
L.push('    IMG_1236.jpg 23 → slash          (판독에 없던 문항 추가)');
L.push('    IMG_1240.jpg 31 → 삭제            (종이에 없는 문항을 지어냄)');
L.push('');
L.push('마크는 circle / slash / triangle / question / check / unmarked 중 하나입니다.');
L.push('정정할 것이 없으면 "없음" 한 줄만 적으세요.');
L.push('');

/* ── 저장 ── */
const outDir = path.join(here, 'results');
fs.mkdirSync(outDir, { recursive: true });
const ts = stamp.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = arg('out') ? path.resolve(here, arg('out')) : path.join(outDir, `report_${MODE}_${ts}.md`);
fs.writeFileSync(outFile, L.join('\n'));
console.log(`저장: ${path.relative(process.cwd(), outFile)}`);
console.log(`사진 ${files.length}장 · 문항 ${totalItems}개 · 파싱 실패 줄 ${droppedTotal} · 측정 실패 ${failedPhotos}장`);
console.log('다음: 보고서를 종이와 대조해 정정을 적은 뒤 → node apply_corrections.mjs --run <run> --corrections <파일>');
