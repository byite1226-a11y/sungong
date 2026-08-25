/**
 * Phase A — 채점기 (v3.1)
 *
 *   read.mjs 의 판독 결과를 사람이 만든 정답 라벨과 비교해
 *   v3.1 §8-2 의 다섯 게이트 지표를 출력합니다.
 *
 *   사용:  node measure.mjs --run runs/<파일>.json --labels labels.json
 *
 *   임계치는 측정 전에 못 박은 값입니다. 결과를 보고 바꾸지 마세요.
 *   ⚠️ 지표는 반드시 함께 읽을 것 — workAcc·구분 정확도의 분모는 "읽힌 문항"이라
 *   많이 누락하는 모델이 그 둘에서는 유리하게 보입니다. missRate 가 그걸 잡습니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};

const run    = JSON.parse(fs.readFileSync(path.resolve(here, arg('run', ''))));
const labels = JSON.parse(fs.readFileSync(path.resolve(here, arg('labels', 'labels.json'))));

const MARKS = ['circle', 'slash', 'triangle', 'question', 'check', 'unmarked'];

/* ── 이름 불일치는 측정을 시작하기 전에 크게 알리고 멈춘다 (§8-3 #3) ──
   파일명 오타 하나로 그 사진의 전 문항이 조용히 '누락'으로 집계되어
   missRate 가 폭발하는데 원인이 안 보이는 사고를 막는다. */
const absent = Object.keys(labels).filter(p => !(p in run.photos));
if (absent.length) {
  console.error('\n⛔ 라벨에는 있는데 판독 결과에 없는 사진이 있습니다 — 파일명을 확인하세요:');
  absent.forEach(p => console.error(`   ${p}`));
  console.error(`   판독 결과에 있는 파일: ${Object.keys(run.photos).join(', ')}`);
  console.error('   측정을 중단합니다. 이름을 맞춘 뒤 다시 실행하세요.\n');
  process.exit(1);
}
const errored = Object.keys(labels).filter(p => run.photos[p]?.error);
if (errored.length) {
  console.error('\n⚠️ 판독이 실패한 사진이 있습니다 — 해당 사진의 전 문항이 누락으로 집계됩니다:');
  errored.forEach(p => console.error(`   ${p} — ${run.photos[p].error}`));
  console.error('   read.mjs 를 다시 돌려 성공시킨 뒤 재측정하는 것을 권합니다.\n');
}
const unlabeled = Object.keys(run.photos).filter(p => !(p in labels));
if (unlabeled.length) console.error(`ℹ️ 라벨이 없어 측정에서 제외한 사진: ${unlabeled.join(', ')}\n`);

/* ── 집계 ── */
let total = 0, markOk = 0, missing = 0;
let stSeen = 0, stOk = 0;                     // 라벨 slash·triangle 중 읽힌 것 / 정확히 구분한 것
let sAsT = 0, tAsS = 0;                       // 방향별 — 한 숫자로 뭉치면 어느 쪽인지 모른다
let workSeen = 0, workOk = 0;                 // 읽힌 문항의 work 3분류 일치 (partial 포함)
let spurious = 0;                             // 라벨에 없는 번호를 지어낸 것 (환각)
const confMatrix = {};
const perPhoto = [];

for (const [photo, items] of Object.entries(labels)) {
  const read = run.photos[photo];
  const pred = {};
  (read?.items || []).forEach(it => { pred[it.item_no] = it; });

  const ghost = (read?.items || []).filter(it => !(String(it.item_no) in items));
  spurious += ghost.length;

  let pTotal = 0, pOk = 0, pMiss = 0;
  for (const [noStr, lab] of Object.entries(items)) {
    const no = Number(noStr);
    total++; pTotal++;
    const p = pred[no];
    const predMark = p ? p.mark : '(누락)';
    confMatrix[lab.mark] ??= {};
    confMatrix[lab.mark][predMark] = (confMatrix[lab.mark][predMark] || 0) + 1;

    if (!p) { missing++; pMiss++; continue; }          // 누락 = mark 오답으로도 센다
    if (p.mark === lab.mark) { markOk++; pOk++; }
    if (lab.mark === 'slash' || lab.mark === 'triangle') {
      stSeen++;
      if (p.mark === lab.mark) stOk++;
      if (lab.mark === 'slash' && p.mark === 'triangle') sAsT++;
      if (lab.mark === 'triangle' && p.mark === 'slash') tAsS++;
    }
    workSeen++;
    if (p.work === lab.work) workOk++;
  }
  perPhoto.push({
    photo, total: pTotal, markOk: pOk, missing: pMiss,
    ghost: ghost.map(g => g.item_no), readError: read?.error || null,
  });
}

const markAcc  = total ? markOk / total : 0;
const distAcc  = stSeen ? stOk / stSeen : 1;
const missRate = total ? missing / total : 0;
const workAcc  = workSeen ? workOk / workSeen : 0;

/* 게이트 (v3.1 §8-2 확정 — 측정 전에 못 박은 값) */
const rows = [
  { name: '문항–마크 결합 정확도 (라벨 전체, 누락=오답)', v: markAcc,  ok: markAcc  >= 0.90, ref: '≥ 90%' },
  { name: '사선만 ↔ 사선+△ 구분 (읽힌 s·t 문항)',        v: distAcc,  ok: distAcc  >= 0.95, ref: '≥ 95%' },
  { name: '문항 번호 누락률 (라벨 전체)',                 v: missRate, ok: missRate <= 0.05, ref: '≤ 5%' },
  { name: 'work 3분류 정확도 (읽힌 문항, partial 포함)',  v: workAcc,  ok: workAcc  >= 0.90, ref: '≥ 90%' },
  { name: '환각 문항 수 (라벨에 없는 번호)',              v: spurious, ok: spurious === 0,   ref: '= 0', count: true },
];

const pct = x => (x * 100).toFixed(1) + '%';
console.log(`\n${run.provider || ''} ${run.model} · 프롬프트 ${run.prompt_ver}${run.media_res ? ` · media_res ${run.media_res}` : ''} · 사진 ${Object.keys(labels).length}장 · 문항 ${total}개\n`);
let allPass = true;
for (const r of rows) {
  allPass &&= r.ok;
  console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(30)} ${(r.count ? `${r.v}개` : pct(r.v)).padStart(7)}  (기준 ${r.ref})`);
}
console.log(`   └ 구분 실패 방향: 사선을 △로 ${sAsT}건 · △를 사선으로 ${tAsS}건${tAsS > sAsT ? '  ← 예보대로 "△를 못 본" 방향' : ''}`);
console.log(`\n게이트: ${allPass ? '통과 — 다섯 지표 모두 임계치 안' : '미달 — 보완 후 재측정 (프롬프트 → 모델 → 촬영 가이드, 3차까지)'}`);

console.log('\n혼동 행렬 (행=라벨, 열=판독):');
const cols = [...MARKS, '(누락)'];
console.log('          ' + cols.map(c => c.padStart(9)).join(''));
for (const m of MARKS) {
  const row = confMatrix[m] || {};
  console.log(m.padEnd(10) + cols.map(c => String(row[c] || 0).padStart(9)).join(''));
}

const bad = perPhoto.filter(p => p.readError || p.markOk < p.total || p.ghost.length);
if (bad.length) {
  console.log('\n확인이 필요한 사진:');
  for (const p of bad) {
    const parts = [`일치 ${p.markOk}/${p.total}`];
    if (p.missing) parts.push(`누락 ${p.missing}`);
    if (p.ghost.length) parts.push(`환각 문항 ${p.ghost.join(',')}`);
    if (p.readError) parts.push(`오류: ${p.readError}`);
    console.log(`  ${p.photo} — ${parts.join(', ')}`);
  }
}

/* ai_read_run 에 들어갈 실측 원가 추적용 — 토큰 합계 */
let inTok = 0, outTok = 0;
for (const r of Object.values(run.photos)) {
  inTok += r.usage?.input_tokens || 0;
  outTok += r.usage?.output_tokens || 0;
}
if (inTok) console.log(`\n토큰 합계: 입력 ${inTok.toLocaleString()} · 출력 ${outTok.toLocaleString()} (단가 비교는 임계치를 넘은 모델끼리만)`);
