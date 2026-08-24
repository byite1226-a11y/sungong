/**
 * Phase A — 채점기
 *
 *   read.mjs 의 판독 결과를 사람이 만든 정답 라벨과 비교해
 *   v3 §8-2 의 네 지표와 게이트 판정을 출력합니다.
 *
 *   사용:  node measure.mjs --run runs/<파일>.json --labels labels.json
 *
 *   임계치는 측정 전에 못 박은 값입니다. 결과를 보고 바꾸지 마세요.
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

const MARKS = ['circle', 'slash', 'triangle', 'star', 'unmarked'];
const GATE = {
  markAcc:   { op: '>=', th: 0.90, name: '문항–마크 결합 정확도' },
  confusion: { op: '<=', th: 0.05, name: '사선 ↔ △ 혼동률' },
  missRate:  { op: '<=', th: 0.05, name: '문항 번호 누락률' },
  workAcc:   { op: '>=', th: 0.95, name: '풀이 흔적(work) 정확도' },
};

let total = 0, markOk = 0, missing = 0;
let stPool = 0, stConfused = 0;              // 라벨이 slash/triangle 인 문항
let workSeen = 0, workOk = 0;                // 판독이 존재하는 문항의 work 일치
const confMatrix = {};                        // 라벨 → 판독 mark 분포
const perPhoto = [];

for (const [photo, items] of Object.entries(labels)) {
  const read = run.photos[photo];
  const pred = {};
  (read?.items || []).forEach(it => { pred[it.item_no] = it; });

  let pTotal = 0, pOk = 0, pMiss = 0;
  for (const [noStr, lab] of Object.entries(items)) {
    const no = Number(noStr);
    total++; pTotal++;
    const p = pred[no];
    const predMark = p ? p.mark : '(누락)';
    confMatrix[lab.mark] ??= {};
    confMatrix[lab.mark][predMark] = (confMatrix[lab.mark][predMark] || 0) + 1;

    // 혼동률 분모 = 라벨이 slash/triangle 인 전 문항 (누락 포함. 누락은 혼동으로 세지 않는다)
    if (lab.mark === 'slash' || lab.mark === 'triangle') stPool++;

    if (!p) { missing++; pMiss++; continue; }               // 누락 = mark 오답으로도 센다
    if (p.mark === lab.mark) { markOk++; pOk++; }
    if ((lab.mark === 'slash' && p.mark === 'triangle') ||
        (lab.mark === 'triangle' && p.mark === 'slash')) stConfused++;
    workSeen++;
    if (p.work === lab.work) workOk++;
  }
  perPhoto.push({ photo, total: pTotal, markOk: pOk, missing: pMiss, readError: read?.error || null });
}

const markAcc   = total ? markOk / total : 0;
const missRate  = total ? missing / total : 0;
const confusion = stPool ? stConfused / stPool : 0;
const workAcc   = workSeen ? workOk / workSeen : 0;

const pct = x => (x * 100).toFixed(1) + '%';
const pass = (v, g) => (g.op === '>=' ? v >= g.th : v <= g.th);

console.log(`\n모델 ${run.model} · 프롬프트 ${run.prompt_ver} · 사진 ${Object.keys(labels).length}장 · 문항 ${total}개\n`);
const rows = [
  ['markAcc', markAcc], ['confusion', confusion], ['missRate', missRate], ['workAcc', workAcc],
];
let allPass = true;
for (const [k, v] of rows) {
  const g = GATE[k];
  const ok = pass(v, g);
  allPass &&= ok;
  console.log(`${ok ? '✅' : '❌'} ${g.name.padEnd(18)} ${pct(v).padStart(7)}  (기준 ${g.op} ${pct(g.th)})`);
}
console.log(`\n게이트: ${allPass ? '통과 — 네 지표 모두 임계치 안' : '미달 — 보완 후 재측정 (프롬프트 → 모델 → 촬영 가이드, 3차까지)'}`);

console.log('\n혼동 행렬 (행=라벨, 열=판독):');
const cols = [...MARKS, '(누락)'];
console.log('          ' + cols.map(c => c.padStart(9)).join(''));
for (const m of MARKS) {
  const row = confMatrix[m] || {};
  console.log(m.padEnd(10) + cols.map(c => String(row[c] || 0).padStart(9)).join(''));
}

const bad = perPhoto.filter(p => p.readError || p.markOk < p.total);
if (bad.length) {
  console.log('\n확인이 필요한 사진:');
  for (const p of bad) {
    console.log(`  ${p.photo} — 일치 ${p.markOk}/${p.total}${p.missing ? `, 누락 ${p.missing}` : ''}${p.readError ? `, 오류: ${p.readError}` : ''}`);
  }
}

// ai_read_run 에 들어갈 실측 원가 추적용 — 토큰 합계
let inTok = 0, outTok = 0;
for (const r of Object.values(run.photos)) {
  inTok += r.usage?.input_tokens || 0;
  outTok += r.usage?.output_tokens || 0;
}
if (inTok) console.log(`\n토큰 합계: 입력 ${inTok.toLocaleString()} · 출력 ${outTok.toLocaleString()} (단가 비교는 임계치를 넘은 모델끼리만)`);
