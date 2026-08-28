// eval/tools/diff_runs.mjs — 두 run JSON의 mark 차이만 집계하는 진단 도구.
// 정답 라벨을 만들지 않고, 정확도를 계산하지 않는다. 데이터는 담기지 않으므로 커밋 가능.
// usage: node tools/diff_runs.mjs --a <v0.json> --b <v2.json>
import fs from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const pathA = arg('--a'), pathB = arg('--b');
if (!pathA || !pathB) {
  console.error('usage: node tools/diff_runs.mjs --a <v0.json> --b <v2.json>');
  process.exit(1);
}

const ALIAS = {
  c: 'circle', s: 'slash', t: 'triangle', q: 'question', k: 'check', u: 'unmarked',
  circle: 'circle', slash: 'slash', triangle: 'triangle',
  question: 'question', check: 'check', unmarked: 'unmarked',
  slash_family_unclear: 'slash_family_unclear', unclear_st: 'slash_family_unclear', unclear: 'slash_family_unclear',
  other: 'other', other_handwritten: 'other',
};
const UNKNOWN = new Set();
const normMark = (v) => {
  if (v === null || v === undefined) return 'MISSING';
  const s = String(v).trim().toLowerCase();
  if (ALIAS[s]) return ALIAS[s];
  UNKNOWN.add(s);
  return s; // 모르는 값은 원문 유지 — 그 자체가 신호
};
const isUnclear = (m) => m.includes('unclear');

const FILE_KEYS = ['file', 'filename', 'fileName', 'image', 'imagePath', 'imageFile', 'photo', 'path', 'src', 'name'];
const NUM_KEYS  = ['item_no', 'itemNo', 'item_number', 'number', 'no', 'num', 'qno', 'q_no', 'questionNumber', 'question_no', 'item', '번호', '문항', 'q', 'id'];
const MARK_KEYS = ['mark', 'markLabel', 'mark_label', 'symbol', 'm'];
const IMG_RE = /\.(jpe?g|png|webp|heic|heif|bmp)$/i;

const pick = (o, keys) => { for (const k of keys) if (k in o && o[k] !== null && o[k] !== undefined) return k; return null; };

function walk(node, file, out, parentKey) {
  if (Array.isArray(node)) { for (const n of node) walk(n, file, out, parentKey); return; }
  if (!node || typeof node !== 'object') return;

  // 파일명 출처 ①: 값이 이미지 파일명인 필드
  let f = file;
  for (const k of FILE_KEYS) {
    const v = node[k];
    if (typeof v === 'string' && IMG_RE.test(v)) { f = v.split(/[\\/]/).pop(); break; }
  }

  const mk = pick(node, MARK_KEYS);
  let nk = pick(node, NUM_KEYS);
  if (mk && (typeof node[mk] === 'string' || typeof node[mk] === 'number')) {
    // 번호 출처 ②: 번호 필드가 없고 부모 키가 숫자면 그 키를 번호로
    const num = nk ? String(node[nk]).trim()
              : (parentKey != null && /^\d+$/.test(String(parentKey)) ? String(parentKey) : null);
    if (num !== null) out.push({ file: f ?? 'UNKNOWN_FILE', num, mark: normMark(node[mk]) });
  }
  // 파일명 출처 ③: 객체의 '키'가 이미지 파일명인 경우 (photos: { "IMG_x.jpg": {...} })
  for (const [k, v] of Object.entries(node)) {
    const childFile = (typeof k === 'string' && IMG_RE.test(k)) ? k.split(/[\\/]/).pop() : f;
    walk(v, childFile, out, k);
  }
}

function load(p) {
  const out = [];
  walk(JSON.parse(fs.readFileSync(p, 'utf8')), null, out, null);
  const map = new Map(); const dups = [];
  for (const it of out) {
    const key = `${it.file}:${it.num}`;
    if (map.has(key)) dups.push(key); else map.set(key, it);
  }
  return { list: out, map, dups };
}

const A = load(pathA); // v0
const B = load(pathB); // v2

const keysA = [...A.map.keys()], keysB = [...B.map.keys()];
const inter = keysA.filter((k) => B.map.has(k));
const onlyB = keysB.filter((k) => !A.map.has(k));
const onlyA = keysA.filter((k) => !B.map.has(k));

const L = [];
const say = (s = '') => L.push(s);
const pct = (n, d) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);
const dist = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };

say('## 0) 파싱 검산');
say(`v0(--a) 파일: ${pathA}`);
say(`v2(--b) 파일: ${pathB}`);
say(`v0 추출 문항 ${A.list.length}개 (고유 키 ${A.map.size}, 중복 ${A.dups.length})`);
say(`v2 추출 문항 ${B.list.length}개 (고유 키 ${B.map.size}, 중복 ${B.dups.length})`);
if (A.dups.length) say(`  v0 중복 키: ${A.dups.join(', ')}`);
if (B.dups.length) say(`  v2 중복 키: ${B.dups.join(', ')}`);
if (UNKNOWN.size) say(`⚠ 별칭표에 없던 mark 값: ${[...UNKNOWN].join(', ')}`);
if (A.map.size === 0 || B.map.size === 0) {
  say('⚠ 추출 실패 — 스키마 자동인식 불가. 아래 구조 덤프를 그대로 보고하고 중단하세요.');
  for (const [tag, p] of [['v0', pathA], ['v2', pathB]]) {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    say(`--- ${tag} top-level: ${Array.isArray(j) ? `Array(${j.length})` : Object.keys(j).join(', ')}`);
    say(JSON.stringify(j, null, 1).split('\n').slice(0, 60).join('\n'));
  }
  console.log(L.join('\n'));
  process.exit(2);
}
say(`v0 mark 분포: ${dist(A.list.map((x) => x.mark)).map(([m, n]) => `${m}=${n}`).join(', ')}`);
say(`v2 mark 분포: ${dist(B.list.map((x) => x.mark)).map(([m, n]) => `${m}=${n}`).join(', ')}`);
say();

const unclearKeys = keysA.filter((k) => isUnclear(A.map.get(k).mark));
say('## (1) v0의 slash_family_unclear 문항');
say(`${unclearKeys.length} / ${A.map.size}  (${pct(unclearKeys.length, A.map.size)})`);
for (const k of unclearKeys) say(`  ${k}`);
if (!unclearKeys.length) say('  (없음)');
say();

say('## (2) 그 문항을 v2는 어떻게 읽었나');
for (const k of unclearKeys) {
  const b = B.map.get(k);
  say(`  ${k}  v0=slash_family_unclear  v2=${b ? b.mark : '(v2에 없음)'}`);
}
if (!unclearKeys.length) say('  (해당 없음)');
say();

const mism = inter.filter((k) => A.map.get(k).mark !== B.map.get(k).mark);
say('## (3) 교집합과 불일치');
say(`교집합 ${inter.length}문항, mark 불일치 ${mism.length}문항 (${pct(mism.length, inter.length)})`);
say();

const overlap = mism.filter((k) => isUnclear(A.map.get(k).mark));
say('## (4) ★ 불일치 ∩ v0-unclear  — 강제선택 가설의 핵심');
say(`${overlap.length} / 불일치 ${mism.length}  (${pct(overlap.length, mism.length)})`);
say(`※ v0-unclear ${unclearKeys.length}개 중 불일치로 이어진 비율: ${pct(overlap.length, unclearKeys.length)}`);
say();

say('## (5) 불일치 mark 쌍 분포');
for (const [pair, n] of dist(mism.map((k) => `${A.map.get(k).mark} → ${B.map.get(k).mark}`))) say(`  ${pair} : ${n}`);
if (!mism.length) say('  (불일치 없음)');
say();

say('## (6) v2에만 있는 문항');
say(`${onlyB.length}문항`);
for (const [m, n] of dist(onlyB.map((k) => B.map.get(k).mark))) say(`  ${m} : ${n}`);
say(`(참고) v0에만 있는 문항: ${onlyA.length}`);
for (const [m, n] of dist(onlyA.map((k) => A.map.get(k).mark))) say(`  ${m} : ${n}`);
say();

say('## 부록) 불일치 전체 목록');
for (const k of mism) say(`  ${k}  v0=${A.map.get(k).mark}  v2=${B.map.get(k).mark}`);

const text = L.join('\n');
console.log(text);
fs.writeFileSync('results/diff_runs_out.md', text);
console.error('\n(저장: results/diff_runs_out.md)');
