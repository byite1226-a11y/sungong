/**
 * Phase A — 두 run 나란히 비교 (v0 vs v2 용)
 *
 *   같은 사진 묶음을 두 프롬프트로 돌린 run JSON 두 개를 비교해
 *   "어디서 다르게 읽었는가"를 뽑는다. 라벨 없이 도는 비교다 —
 *   어느 쪽이 맞는지는 정정(라벨) 후에만 알 수 있다.
 *
 *   사용:  node compare_runs.mjs --a runs/<v0>.json --b runs/<v2>.json
 *   출력:  results/compare_<ts>.md + 콘솔 요약
 *
 *   v0 의 형식 차이 (읽을 때 유의):
 *   - 표시가 있는 문항만 출력한다 → v2 의 unmarked 항목이 v0 에 없는 것은 불일치가 아니다
 *   - unclear_st = "사선 계열인데 s/t 구분 불가"를 모델이 스스로 표명한 것
 *   - 한 문항에 표시 두 개(예: △+?)가 두 행으로 나올 수 있다 → 마크 집합으로 비교한다
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};

if (!arg('a') || !arg('b')) { console.error('사용: node compare_runs.mjs --a runs/<파일>.json --b runs/<파일>.json'); process.exit(1); }
const A = JSON.parse(fs.readFileSync(path.resolve(here, arg('a')), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.resolve(here, arg('b')), 'utf8'));
const nameA = `${A.model}·${A.prompt_ver}`;
const nameB = `${B.model}·${B.prompt_ver}`;

const MARK_ORDER = ['circle', 'slash', 'triangle', 'unclear_st', 'question', 'check', 'unmarked', 'other'];

function summarize(run) {
  const dist = {}; let items = 0, dropped = 0, failed = 0;
  const perFile = {};
  for (const [f, r] of Object.entries(run.photos)) {
    if (r.error) { failed++; perFile[f] = null; continue; }
    dropped += r.dropped_lines || 0;
    const map = new Map();                 // no → Set(marks) — v0 는 한 문항 두 행 가능
    for (const it of r.items) {
      items++;
      dist[it.mark] = (dist[it.mark] || 0) + 1;
      if (!map.has(it.item_no)) map.set(it.item_no, new Set());
      map.get(it.item_no).add(it.mark);
    }
    perFile[f] = map;
  }
  return { dist, items, dropped, failed, perFile };
}
const sa = summarize(A), sb = summarize(B);

const L = [];
L.push('# v0 / v2 비교표');
L.push(`A = \`${nameA}\` (${path.basename(arg('a'))}) · B = \`${nameB}\` (${path.basename(arg('b'))})`);
L.push(`생성 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
L.push('');
L.push('> 라벨 없는 비교입니다 — 어느 쪽이 맞는지는 정정 후에만 알 수 있습니다.');
L.push('> v0 는 표시 있는 문항만 출력합니다: B(v2)만 읽은 unmarked 는 불일치로 세지 않습니다.');
L.push('');

L.push('## 1. 요약');
L.push('');
L.push('| | A | B |');
L.push('|---|---|---|');
L.push(`| 판독 문항 | ${sa.items} | ${sb.items} |`);
L.push(`| 파싱 실패 줄 | ${sa.dropped} | ${sb.dropped} |`);
L.push(`| 측정 실패 사진 | ${sa.failed} | ${sb.failed} |`);
L.push('');

L.push('## 2. 마크 분포');
L.push('');
L.push('| mark | A | B |');
L.push('|---|---|---|');
for (const m of MARK_ORDER) {
  if (!(sa.dist[m] || sb.dist[m])) continue;
  L.push(`| ${m} | ${sa.dist[m] || 0} | ${sb.dist[m] || 0} |`);
}
L.push('');

/* ── 문항 단위 대조 ── */
const files = [...new Set([...Object.keys(A.photos), ...Object.keys(B.photos)])].sort();
const disagree = [];        // 둘 다 읽었는데 마크가 다름
const onlyA = [];           // A 만 읽음
const onlyB = [];           // B 만 읽음 (B=unmarked 는 별도)
const onlyBUnmarked = [];
let agreeCount = 0, bothCount = 0;

for (const f of files) {
  const ma = sa.perFile[f], mb = sb.perFile[f];
  if (!ma || !mb) continue;                            // 한쪽이 실패한 사진은 대조 불가
  const nos = new Set([...ma.keys(), ...mb.keys()]);
  for (const no of [...nos].sort((x, y) => x - y)) {
    const va = ma.get(no), vb = mb.get(no);
    if (va && vb) {
      bothCount++;
      const aStr = [...va].sort().join('+'), bStr = [...vb].sort().join('+');
      if (aStr === bStr) agreeCount++;
      else disagree.push({ f, no, a: aStr, b: bStr });
    } else if (va) {
      onlyA.push({ f, no, a: [...va].sort().join('+') });
    } else {
      const bStr = [...vb].sort().join('+');
      (bStr === 'unmarked' ? onlyBUnmarked : onlyB).push({ f, no, b: bStr });
    }
  }
}

L.push('## 3. 둘 다 읽은 문항의 마크 대조');
L.push('');
L.push(`일치 ${agreeCount} / ${bothCount} (${bothCount ? (agreeCount / bothCount * 100).toFixed(1) : '—'}%)`);
L.push('');
if (disagree.length) {
  L.push('| 사진 | 문항 | A | B |');
  L.push('|---|---|---|---|');
  for (const d of disagree) L.push(`| ${d.f} | ${d.no} | ${d.a} | ${d.b} |`);
  L.push('');
  const st = disagree.filter(d =>
    ['slash', 'triangle', 'unclear_st'].some(m => d.a.includes(m) || d.b.includes(m)));
  L.push(`이 중 사선/△ 계열이 걸린 불일치: ${st.length}개 ← 게이트2 후보. 정정에서 이 문항들을 우선 확정하세요.`);
} else {
  L.push('(불일치 없음)');
}
L.push('');

L.push('## 4. 한쪽만 읽은 문항');
L.push('');
L.push(`A 만 읽음 — ${onlyA.length}개`);
for (const d of onlyA) L.push(`  ${d.f} ${d.no} (${d.a})`);
L.push('');
L.push(`B 만 읽음 (unmarked 제외) — ${onlyB.length}개`);
for (const d of onlyB) L.push(`  ${d.f} ${d.no} (${d.b})`);
L.push('');
L.push(`B 만 unmarked 로 출력 — ${onlyBUnmarked.length}개 (v0 형식상 정상 — 표시 없는 문항은 v0 출력에 안 나옴)`);
L.push('');

/* v0 부속 정보 — 번호에 못 붙인 표시·비수치 번호는 비교 대상 밖이지만 놓치면 안 된다 */
for (const [name, run] of [['A', A], ['B', B]]) {
  const extras = [];
  for (const [f, r] of Object.entries(run.photos)) {
    const o = r.observation;
    if (!o) continue;
    if (o.unlinked_marks?.length) extras.push(`${f}: 번호에 못 붙인 표시 ${o.unlinked_marks.map(u => u.mark_type).join(', ')}`);
    if (o.nonnumeric_refs?.length) extras.push(`${f}: 비수치 번호 ${o.nonnumeric_refs.map(u => `"${u.problem_ref}"(${u.mark_type})`).join(', ')}`);
  }
  if (extras.length) {
    L.push(`## ${name} (${name === 'A' ? nameA : nameB}) 의 관찰 부속 정보`);
    L.push('');
    extras.forEach(e => L.push(`- ${e}`));
    L.push('');
  }
}

const outDir = path.join(here, 'results');
fs.mkdirSync(outDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = arg('out') ? path.resolve(here, arg('out')) : path.join(outDir, `compare_${ts}.md`);
fs.writeFileSync(outFile, L.join('\n'));
console.log(`저장: ${path.relative(process.cwd(), outFile)}`);
console.log(`둘 다 읽음 ${bothCount} (일치 ${agreeCount}) · 불일치 ${disagree.length} · A만 ${onlyA.length} · B만 ${onlyB.length} (+unmarked ${onlyBUnmarked.length})`);
