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
 *
 *   ★ 강제 선택 가설 (2026-08-28): v2 에는 unclear 값이 없어 애매한 사선 계열도
 *     6종 중 하나를 강제로 고르게 한다. 애매한 것을 강제로 고르면 절반은 틀린다.
 *     그래서 "A(v0) 가 unclear_st 로 표명한 문항을 B(v2) 는 무엇으로 읽었는가"와
 *     "불일치가 unclear 문항에 몰려 있는가"를 명시적으로 센다 (§4).
 *     겹침이 크면 처방은 프롬프트 다듬기가 아니라 unclear 값 복원이다.
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
  const dist = {}; let items = 0, dropped = 0, failed = 0, failed429 = 0;
  const failedFiles = [];
  const perFile = {};
  for (const [f, r] of Object.entries(run.photos)) {
    if (r.error) {
      failed++; failedFiles.push(`${f} — ${r.error}`);
      if (String(r.error).includes('429')) failed429++;
      perFile[f] = null; continue;
    }
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
  return { dist, items, dropped, failed, failed429, failedFiles, perFile };
}
const sa = summarize(A), sb = summarize(B);

/* ── 문항 단위 대조 (보고서를 쓰기 전에 전부 계산한다 — 핵심 숫자가 맨 위에 필요) ── */
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

/* ── 강제 선택 가설 — A(v0) 의 unclear_st 문항을 B(v2) 는 무엇으로 읽었는가 ── */
const unclearA = [];        // {f, no, a, b}  b=null 이면 B 가 그 문항을 못 읽음
for (const f of files) {
  const ma = sa.perFile[f];
  if (!ma) continue;
  for (const [no, set] of ma) {
    if (!set.has('unclear_st')) continue;
    const vb = sb.perFile[f]?.get(no);
    unclearA.push({ f, no, a: [...set].sort().join('+'), b: vb ? [...vb].sort().join('+') : null });
  }
}
const unclearBDist = {};    // B 가 그 문항들을 고른 값의 분포
for (const u of unclearA) {
  const k = u.b === null ? '(B 못 읽음)' : u.b;
  unclearBDist[k] = (unclearBDist[k] || 0) + 1;
}
const disagreeUnclear = disagree.filter(d => d.a.includes('unclear_st') || d.b.includes('unclear_st'));
const disagreeStOnly = disagree.filter(d =>
  !d.a.includes('unclear_st') && !d.b.includes('unclear_st') &&
  ['slash', 'triangle'].some(m => d.a.includes(m) || d.b.includes(m)));

/* ── 마크다운 ── */
const L = [];
L.push('# v0 / v2 비교표');
L.push(`A = \`${nameA}\` (${path.basename(arg('a'))}) · B = \`${nameB}\` (${path.basename(arg('b'))})`);
L.push(`생성 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
L.push('');
L.push('> 라벨 없는 비교입니다 — 어느 쪽이 맞는지는 정정 후에만 알 수 있습니다.');
L.push('> v0 는 표시 있는 문항만 출력합니다: B(v2)만 읽은 unmarked 는 불일치로 세지 않습니다.');
L.push('> 숫자 하나가 아니라 방향과 패턴을 보십시오 — 이 표본 크기로 개별 차이는 유의성이 없습니다.');
L.push('');

L.push('## 0. 핵심 숫자');
L.push('');
L.push(`- 판독 문항: A(${A.prompt_ver}) **${sa.items}** · B(${B.prompt_ver}) **${sb.items}**`);
L.push(`- 파싱 실패 줄: A **${sa.dropped}** · B **${sb.dropped}**`);
L.push(`- A(${A.prompt_ver}) 의 unclear_st: **${unclearA.length}개**`);
L.push(`- 둘 다 읽었는데 다르게 읽은 문항: **${disagree.length}개** (그중 unclear_st 관련 ${disagreeUnclear.length}개)`);
L.push(`- 측정 실패(API): A ${sa.failed}장${sa.failed429 ? ` (429 ${sa.failed429}장)` : ''} · B ${sb.failed}장${sb.failed429 ? ` (429 ${sb.failed429}장)` : ''}`);
L.push('');

L.push('## 1. 요약');
L.push('');
L.push('| | A | B |');
L.push('|---|---|---|');
L.push(`| 판독 문항 | ${sa.items} | ${sb.items} |`);
L.push(`| 파싱 실패 줄 | ${sa.dropped} | ${sb.dropped} |`);
L.push(`| 측정 실패 사진 | ${sa.failed} | ${sb.failed} |`);
L.push('');
for (const [name, s] of [['A', sa], ['B', sb]]) {
  if (s.failedFiles.length) {
    L.push(`${name} 측정 실패 (모델 오판과 섞지 말 것 — 재실행 대상):`);
    s.failedFiles.forEach(x => L.push(`- ${x}`));
    L.push('');
  }
}

L.push('## 2. 마크 분포');
L.push('');
L.push('| mark | A | B |');
L.push('|---|---|---|');
for (const m of MARK_ORDER) {
  if (!(sa.dist[m] || sb.dist[m])) continue;
  L.push(`| ${m} | ${sa.dist[m] || 0} | ${sb.dist[m] || 0} |`);
}
L.push('');

L.push('## 3. 둘 다 읽은 문항의 마크 대조');
L.push('');
L.push(`일치 ${agreeCount} / ${bothCount} (${bothCount ? (agreeCount / bothCount * 100).toFixed(1) : '—'}%)`);
L.push('');
if (disagree.length) {
  L.push('| 사진 | 문항 | A | B |');
  L.push('|---|---|---|---|');
  for (const d of disagree) L.push(`| ${d.f} | ${d.no} | ${d.a} | ${d.b} |`);
  L.push('');
  L.push(`사선/△ 계열이 걸린 불일치 (unclear 제외): ${disagreeStOnly.length}개 ← 게이트2 후보. 정정에서 우선 확정하세요.`);
} else {
  L.push('(불일치 없음)');
}
L.push('');

L.push('## 4. 강제 선택 가설 — A 가 "모르겠다"고 한 문항을 B 는 무엇으로 골랐는가');
L.push('');
L.push(`① A(${A.prompt_ver}) 가 unclear_st 로 표명한 문항: **${unclearA.length}개**`);
L.push('');
if (unclearA.length) {
  L.push('② 같은 문항을 B 가 읽은 값:');
  L.push('');
  L.push('| 사진 | 문항 | A | B |');
  L.push('|---|---|---|---|');
  for (const u of unclearA) L.push(`| ${u.f} | ${u.no} | ${u.a} | ${u.b ?? '(못 읽음)'} |`);
  L.push('');
  L.push(`B 의 선택 분포: ${Object.entries(unclearBDist).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  L.push('');
  L.push(`③ 겹침: 불일치 ${disagree.length}개 중 unclear_st 가 걸린 것 **${disagreeUnclear.length}개**` +
    (disagree.length ? ` (${(disagreeUnclear.length / disagree.length * 100).toFixed(0)}%)` : ''));
  L.push('');
  L.push('> 읽는 법: ③의 비율이 크면 두 프롬프트의 차이가 "애매한 사선 계열" 문항에 몰려 있다는 뜻 —');
  L.push('> B(v2) 가 애매한 것을 강제로 골라 틀린다는 가설이 지지됩니다. 처방은 프롬프트 다듬기가 아니라');
  L.push('> unclear 값 복원(v3 분기) 쪽입니다. 단, 어느 쪽이 실제로 틀렸는지는 정정(라벨) 후에 확정됩니다.');
} else {
  L.push(`(A 가 unclear_st 를 한 건도 내지 않음 — 이 데이터로는 강제 선택 가설을 검증할 수 없습니다.`);
  L.push(`불일치 ${disagree.length}개가 어디에 몰려 있는지 §3 을 보십시오)`);
}
L.push('');

L.push('## 5. 한쪽만 읽은 문항');
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
    if (o.nonnumeric_refs?.length) extras.push(`${f}: 비수치 번호 ${o.nonnumeric_refs.map(u => `"${u.problem_ref}"(${u.mark_type})`).join(', ')} ← [1~3] 지문 범위 함정 의심`);
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
console.log(`핵심 숫자 — 문항 A ${sa.items} / B ${sb.items} · dropped A ${sa.dropped} / B ${sb.dropped} · unclear_st ${unclearA.length} · 불일치 ${disagree.length} (unclear 관련 ${disagreeUnclear.length})`);
console.log(`측정 실패 — A ${sa.failed}장 (429 ${sa.failed429}) · B ${sb.failed}장 (429 ${sb.failed429})`);
