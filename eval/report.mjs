/**
 * 판독 보고서 생성기 — 라벨 없이 돌아갑니다.
 *
 *   node report.mjs --run runs/<파일>.json [--photos photos]
 *
 * 정답(labels.json)이 없어도 "이 모델이 망가졌는가"는 분포로 드러납니다.
 * 콘솔에 요약을 찍고, 사진과 판독을 나란히 놓은 report.html 을 만듭니다.
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i+1] : d; };
const RUN    = arg('run');
const PHOTOS = arg('photos', 'photos');
const OUT    = arg('out', 'report.html');
if (!RUN) { console.error('사용법: node report.mjs --run runs/<파일>.json'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(RUN, 'utf8'));
const src = raw.photos || raw;

/* 판독 결과를 { 파일명: [ {no,mark,work,mc,wc} ] } 로 정규화 */
const ok = {}, failed = {};
for (const [f, v] of Object.entries(src)) {
  if (v && v.error) { failed[f] = v.error; continue; }
  let items = Array.isArray(v) ? v : (v && (v.items || v.result));
  if (!Array.isArray(items)) { failed[f] = '판독 항목 없음'; continue; }
  ok[f] = items.map(it => ({
    no: Number(it.item_no ?? it.no ?? it.number),
    mark: String(it.mark ?? '?'),
    work: String(it.work ?? '?'),
    mc: Number(it.mark_confidence ?? it.confidence ?? 1),
    wc: Number(it.work_confidence ?? it.confidence ?? 1),
    lat: v.latency_ms, usage: v.usage,
  })).filter(x => Number.isFinite(x.no)).sort((a,b)=>a.no-b.no);
}

const MARKS = ['circle','slash','triangle','question','check','unmarked'];
const WORKS = ['solved','blank','partial'];
const all = Object.values(ok).flat();
const N = all.length;
const pages = Object.keys(ok).length;

const count = (arr, key, vals) => {
  const c = Object.fromEntries(vals.map(v=>[v,0])); let other = 0;
  for (const x of arr) (c[x[key]] !== undefined) ? c[x[key]]++ : other++;
  if (other) c['(알 수 없음)'] = other;
  return c;
};
const mDist = count(all,'mark',MARKS), wDist = count(all,'work',WORKS);

/* 조합 — 설계가 실제로 성립하는지 */
const combo = {};
for (const x of all) { const k = `${x.mark} × ${x.work}`; combo[k] = (combo[k]||0)+1; }

/* 이상 신호 */
const flags = [];
const pageStats = [];
for (const [f, items] of Object.entries(ok)) {
  const nos = items.map(i=>i.no);
  const dup = nos.length !== new Set(nos).size;
  let gap = 0; for (let i=1;i<nos.length;i++) if (nos[i]-nos[i-1] > 1) gap++;
  const lowN = items.filter(i=>Math.min(i.mc,i.wc) < 0.7).length;
  pageStats.push({f, n:items.length, start:nos[0]??0, gap, dup, lowN,
                  lat: items[0]?.lat ?? 0});
}
const nCounts = pageStats.map(p=>p.n).sort((a,b)=>a-b);
const med = a => a.length ? a[Math.floor(a.length/2)] : 0;
const medN = med(nCounts);
const outliers = pageStats.filter(p => medN>0 && (p.n < medN*0.3 || p.n > medN*3));

const low = all.filter(x=>Math.min(x.mc,x.wc) < 0.7).length;
const notFrom1 = pageStats.filter(p=>p.start !== 1);
const withGap  = pageStats.filter(p=>p.gap > 0);
const withDup  = pageStats.filter(p=>p.dup);

const add = (lvl,t) => flags.push({lvl,t});
if (mDist.triangle === 0)  add('bad', `triangle(사선 위 △)을 90장 전체에서 한 번도 못 읽었습니다 — 이 판정이 아예 작동하지 않습니다`);
else if (mDist.triangle/N < 0.005) add('warn', `triangle 이 ${mDist.triangle}건(${(mDist.triangle/N*100).toFixed(1)}%) 뿐입니다 — 못 읽는 쪽일 가능성`);
if (mDist.circle/N > 0.9) add('bad', `circle 이 ${(mDist.circle/N*100).toFixed(1)}% 입니다 — 실제 숙제에 오답이 이렇게 없을 수 없습니다. 모델이 전부 정답으로 찍는 중일 수 있습니다`);
if (wDist.blank === 0)   add('bad', `blank 를 한 번도 못 읽었습니다 — work 축이 작동하지 않습니다`);
if (wDist.partial/N < 0.01) add('warn', `partial 이 ${wDist.partial}건 뿐입니다 — 3분류가 사실상 2분류로 동작 중입니다`);
if ((combo['circle × blank']||0) === 0) add('warn', `circle × blank 가 0건입니다 — "답만 적고 ○" 판정이 성립하지 않을 수 있습니다 (설계 핵심 칸)`);
if (low/N > 0.15) add('warn', `신뢰도 0.7 미만 문항이 ${low}개(${(low/N*100).toFixed(1)}%) 입니다`);
if (notFrom1.length) add('warn', `문항 번호가 1부터 시작하지 않는 사진 ${notFrom1.length}장`);
if (withGap.length)  add('warn', `번호가 중간에 비는 사진 ${withGap.length}장 — 문항을 빠뜨렸을 수 있습니다`);
if (withDup.length)  add('bad',  `같은 번호가 중복된 사진 ${withDup.length}장 — 환각 가능성`);
if (outliers.length) add('warn', `페이지당 문항 수 이상치 ${outliers.length}장 (중앙값 ${medN}개)`);
if (Object.keys(failed).length) add('bad', `판독 실패 ${Object.keys(failed).length}장`);
if (!flags.length) add('ok', '눈에 띄는 이상 신호가 없습니다');

/* 원가 실측 */
let inTok=0, outTok=0;
for (const v of Object.values(src)) {
  const u = v && v.usage; if (!u) continue;
  inTok  += u.promptTokenCount ?? u.input_tokens ?? u.prompt_tokens ?? 0;
  outTok += u.candidatesTokenCount ?? u.output_tokens ?? u.completion_tokens ?? 0;
}
const lats = pageStats.map(p=>p.lat).filter(Boolean).sort((a,b)=>a-b);

/* ── 콘솔 요약 (이걸 그대로 복사해서 보내면 됩니다) ── */
const bar = (n,t) => '█'.repeat(Math.round(n/Math.max(t,1)*24)).padEnd(24,'·');
const L = [];
L.push('═'.repeat(58));
L.push(`판독 보고서 — ${raw.model || '모델 미상'} / 프롬프트 ${raw.prompt_ver || '?'}`);
L.push('═'.repeat(58));
L.push(`처리   성공 ${pages}장 · 실패 ${Object.keys(failed).length}장`);
L.push(`문항   총 ${N}개 · 페이지당 중앙값 ${medN}개`);
if (lats.length) L.push(`지연   중앙값 ${(med(lats)/1000).toFixed(1)}초`);
if (inTok||outTok) L.push(`토큰   입력 ${inTok.toLocaleString()} · 출력 ${outTok.toLocaleString()}`);
L.push('');
L.push('■ 마크 분포');
for (const k of Object.keys(mDist)) L.push(`   ${k.padEnd(12)} ${String(mDist[k]).padStart(5)}  ${(mDist[k]/N*100).toFixed(1).padStart(5)}%  ${bar(mDist[k],N)}`);
L.push('');
L.push('■ 풀이(work) 분포');
for (const k of Object.keys(wDist)) L.push(`   ${k.padEnd(12)} ${String(wDist[k]).padStart(5)}  ${(wDist[k]/N*100).toFixed(1).padStart(5)}%  ${bar(wDist[k],N)}`);
L.push('');
L.push('■ 조합 (상위 8)');
Object.entries(combo).sort((a,b)=>b[1]-a[1]).slice(0,8)
  .forEach(([k,v])=>L.push(`   ${k.padEnd(24)} ${String(v).padStart(5)}`));
L.push(`   ${'circle × blank'.padEnd(24)} ${String(combo['circle × blank']||0).padStart(5)}   ← 설계 핵심 칸`);
L.push('');
L.push('■ 이상 신호');
for (const f of flags) L.push(`   ${f.lvl==='bad'?'🔴':f.lvl==='warn'?'🟡':'🟢'} ${f.t}`);
if (Object.keys(failed).length) {
  L.push(''); L.push('■ 실패한 사진');
  Object.entries(failed).slice(0,5).forEach(([f,e])=>L.push(`   ${f} — ${String(e).slice(0,90)}`));
}
L.push('═'.repeat(58));
const summary = L.join('\n');
console.log(summary);

/* ── HTML — 사진과 판독을 나란히 ── */
const ICON = {
  circle:'<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" stroke="#12A05C" stroke-width="2.6" fill="none"/></svg>',
  slash:'<svg viewBox="0 0 32 32"><path d="M8 25 L24 7" stroke="#FF6B3D" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>',
  triangle:'<svg viewBox="0 0 32 32"><path d="M8 25 L24 7" stroke="#FF6B3D" stroke-width="1.8" fill="none" opacity=".5"/><path d="M16 7 L26 25 H6 Z" stroke="#12A05C" stroke-width="2.3" stroke-linejoin="round" fill="none"/></svg>',
  question:'<svg viewBox="0 0 32 32"><path d="M16 5 L19.6 12.9 28 14 21.9 20.1 23.4 28.6 16 24.6 8.6 28.6 10.1 20.1 4 14 12.4 12.9 Z" stroke="#3D5AFE" stroke-width="2.1" stroke-linejoin="round" fill="none"/></svg>',
  check:'<svg viewBox="0 0 32 32"><path d="M7 17 L13 23 L25 9" stroke="#868DAB" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  unmarked:'<svg viewBox="0 0 32 32"><rect x="7" y="7" width="18" height="18" rx="3" stroke="#868DAB" stroke-width="2.1" stroke-dasharray="3.5 3" fill="none" opacity=".8"/></svg>',
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const distRows = (d) => Object.keys(d).map(k=>{
  const p = (d[k]/N*100);
  return `<tr><td class="k">${esc(k)}</td><td class="n">${d[k]}</td><td class="p">${p.toFixed(1)}%</td>
    <td class="b"><i style="width:${p}%"></i></td></tr>`;
}).join('');

const cards = Object.entries(ok).map(([f, items]) => {
  const st = pageStats.find(p=>p.f===f);
  const rows = items.map(it=>{
    const lo = Math.min(it.mc,it.wc) < 0.7;
    return `<tr class="${lo?'lo':''}"><td class="no">${it.no}</td>
      <td class="ic">${ICON[it.mark]||'<span class="q">?</span>'}</td>
      <td class="mk">${esc(it.mark)}</td><td class="wk">${esc(it.work)}</td>
      <td class="cf">${Math.round(Math.min(it.mc,it.wc)*100)}%</td></tr>`;
  }).join('');
  const warn = [st.gap?`번호 빈 곳 ${st.gap}`:'', st.dup?'번호 중복':'', st.start!==1?`${st.start}번부터`:'',
                st.lowN?`저신뢰 ${st.lowN}`:''].filter(Boolean).join(' · ');
  return `<section class="card">
    <div class="ph"><img loading="lazy" src="${esc(PHOTOS)}/${esc(f)}" alt=""></div>
    <div class="rd">
      <h3>${esc(f)} <span>${items.length}문항${warn?` · <b>${esc(warn)}</b>`:''}</span></h3>
      <table class="items">${rows}</table>
    </div></section>`;
}).join('');

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>판독 보고서</title><style>
:root{--bg:#F4F5FA;--sf:#fff;--sk:#F0F2F8;--tx:#14172B;--t2:#4C5372;--t3:#868DAB;--ln:#E5E8F1;
--pri:#3D5AFE;--acc:#FF6B3D;--accw:#FFF0EA;--acct:#C7461A;--ok:#12A05C;--okw:#E7F6EE}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Pretendard',-apple-system,'Malgun Gothic',system-ui,sans-serif;background:var(--bg);
color:var(--tx);font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:34px 20px 90px}
h1{font-size:26px;font-weight:700;letter-spacing:-.03em}
.sub{color:var(--t3);font-family:ui-monospace,monospace;font-size:12.5px;margin-top:6px}
h2{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--t3);
margin:30px 0 12px;padding-bottom:7px;border-bottom:1px solid var(--ln)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:20px}
.kpi{background:var(--sf);border:1px solid var(--ln);border-radius:11px;padding:13px 15px}
.kpi .v{font-family:ui-monospace,monospace;font-size:21px;font-weight:700;font-variant-numeric:tabular-nums}
.kpi .l{font-size:11px;color:var(--t3);margin-top:2px}
.two{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:800px){.two{grid-template-columns:1fr 1fr}}
.box{background:var(--sf);border:1px solid var(--ln);border-radius:12px;padding:14px 16px}
.box h4{font-size:13px;font-weight:700;margin-bottom:10px}
table{width:100%;border-collapse:collapse}
.dist td{padding:5px 4px;font-size:12.5px;vertical-align:middle}
.dist .k{font-family:ui-monospace,monospace;font-size:11.5px}
.dist .n{text-align:right;font-family:ui-monospace,monospace;font-weight:600;width:52px}
.dist .p{text-align:right;font-family:ui-monospace,monospace;color:var(--t3);width:54px}
.dist .b{width:40%;padding-left:10px}
.dist .b i{display:block;height:7px;background:var(--pri);border-radius:4px;min-width:2px}
.flag{display:flex;gap:9px;padding:9px 12px;border-radius:9px;margin-bottom:6px;font-size:13px;line-height:1.5}
.flag.bad{background:var(--accw);color:var(--acct)}
.flag.warn{background:#FFF7E8;color:#9A5505}
.flag.ok{background:var(--okw);color:var(--ok)}
.card{background:var(--sf);border:1px solid var(--ln);border-radius:13px;overflow:hidden;
display:grid;grid-template-columns:1fr;margin-bottom:14px}
@media(min-width:820px){.card{grid-template-columns:1fr 340px}}
.ph{background:#0D1122;display:flex;align-items:center;justify-content:center;min-height:200px;max-height:520px}
.ph img{max-width:100%;max-height:520px;object-fit:contain}
.rd{padding:13px 15px;overflow-y:auto;max-height:520px}
.rd h3{font-family:ui-monospace,monospace;font-size:12px;font-weight:600;margin-bottom:9px;
padding-bottom:8px;border-bottom:1px solid var(--ln);word-break:break-all}
.rd h3 span{display:block;font-size:11px;color:var(--t3);font-weight:400;margin-top:3px}
.rd h3 b{color:var(--acct)}
.items td{padding:4px 3px;font-size:12px;border-bottom:1px solid #F5F6FA}
.items .no{font-family:ui-monospace,monospace;font-weight:700;color:var(--pri);width:26px;text-align:right}
.items .ic{width:26px}.items .ic svg{width:19px;height:19px;display:block}
.items .mk{font-family:ui-monospace,monospace;font-size:11px}
.items .wk{font-family:ui-monospace,monospace;font-size:10.5px;color:var(--t2)}
.items .cf{font-family:ui-monospace,monospace;font-size:10px;color:var(--t3);text-align:right}
.items tr.lo{background:var(--accw)}
.items tr.lo .cf{color:var(--acct);font-weight:700}
.q{color:var(--acct);font-weight:700}
pre.sum{background:#111528;color:#C9D1F0;padding:16px;border-radius:11px;overflow-x:auto;
font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.65}
</style></head><body><div class="wrap">
<h1>판독 보고서</h1>
<div class="sub">${esc(raw.model||'모델 미상')} · 프롬프트 ${esc(raw.prompt_ver||'?')} · ${esc(raw.created_at||'')}</div>
<div class="kpis">
  <div class="kpi"><div class="v">${pages}</div><div class="l">성공한 사진</div></div>
  <div class="kpi"><div class="v" style="color:${Object.keys(failed).length?'var(--acct)':'inherit'}">${Object.keys(failed).length}</div><div class="l">실패</div></div>
  <div class="kpi"><div class="v">${N.toLocaleString()}</div><div class="l">총 문항</div></div>
  <div class="kpi"><div class="v">${medN}</div><div class="l">페이지당 중앙값</div></div>
  <div class="kpi"><div class="v">${lats.length?(med(lats)/1000).toFixed(1)+'초':'—'}</div><div class="l">지연 중앙값</div></div>
  <div class="kpi"><div class="v" style="color:${low/N>0.15?'var(--acct)':'inherit'}">${(low/N*100).toFixed(1)}%</div><div class="l">저신뢰 문항</div></div>
</div>
<h2>이상 신호</h2>
${flags.map(f=>`<div class="flag ${f.lvl}"><span>${f.lvl==='bad'?'🔴':f.lvl==='warn'?'🟡':'🟢'}</span><span>${esc(f.t)}</span></div>`).join('')}
<h2>분포</h2>
<div class="two">
  <div class="box"><h4>마크</h4><table class="dist">${distRows(mDist)}</table></div>
  <div class="box"><h4>풀이(work)</h4><table class="dist">${distRows(wDist)}</table></div>
</div>
<h2>조합 — 설계가 성립하는가</h2>
<div class="box"><table class="dist">${Object.entries(combo).sort((a,b)=>b[1]-a[1]).slice(0,10)
  .map(([k,v])=>`<tr><td class="k">${esc(k)}</td><td class="n">${v}</td><td class="p">${(v/N*100).toFixed(1)}%</td><td class="b"><i style="width:${v/N*100}%"></i></td></tr>`).join('')}
  <tr style="border-top:2px solid var(--ln)"><td class="k"><b>circle × blank</b></td><td class="n">${combo['circle × blank']||0}</td>
  <td class="p">${((combo['circle × blank']||0)/N*100).toFixed(1)}%</td><td class="b" style="font-size:11px;color:var(--t3);padding-left:10px">설계 핵심 칸</td></tr>
</table></div>
<h2>복사해서 보낼 요약</h2>
<pre class="sum">${esc(summary)}</pre>
<h2>사진별 판독 결과</h2>
${cards}
</div></body></html>`;

fs.writeFileSync(path.resolve(path.dirname(RUN), '..', OUT), html);
console.log(`\n📄 보고서: ${OUT}  — 더블클릭해서 여세요`);
