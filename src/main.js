import * as db from './db.js';
import { Detector, ManualDetector } from './detect.js';
import { ic, clock, mmss, hm, hmBig, hmc, ring, el, esc, toast,
         kstToday, mondayOf, DOW, dowOf, hhmm, SPAN, pad } from './ui.js';

const app = document.getElementById('app');

const S = {
  route: 'boot',
  user: null, profile: null, subjects: [],
  home: null, cal: null, week: null, plan: null, stats: null,
  calMode: 'month', selDay: kstToday(),
  focus: null, detector: null, result: null,
  sheet: null, busy: false,
  fast: localStorage.getItem('fast') === '1',   // 시연용 짧은 임계값
};
window.__S = S;

const go = (r) => { S.route = r; render(); };
const sub = (id) => S.subjects.find(s => s.id === id);
const subColor = (id) => sub(id)?.color || 'var(--tx-3)';
const subName  = (id) => sub(id)?.name || '기타';

/* ── 부팅 ── */
async function boot() {
  render();
  const { data } = await db.sb.auth.getSession();
  if (!data.session) return go('auth');
  await afterLogin();
}
async function afterLogin() {
  S.user = await db.auth.user();
  try {
    [S.profile, S.subjects] = await Promise.all([db.getProfile(), db.getSubjects()]);
  } catch (e) { toast('프로필을 불러오지 못했습니다'); }
  const r = await db.resumeSession().catch(() => null);
  if (r?.session) { await attachSession(r.session, r.net_sec ?? 0, r.gross_sec ?? 0); return; }
  await loadHome();
  go('home');
}
async function loadHome() { S.home = await db.today().catch(() => null); }

db.sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { S.user = null; go('auth'); } });

/* ── 렌더 라우터 ── */
function render() {
  app.className = 'app' + (S.route === 'focus' && S.focus?.state === 'away' ? ' tone-acc'
    : S.route === 'focus' && S.focus?.state === 'drowsy' ? ' tone-acc'
    : S.route === 'focus' && S.focus?.state === 'break' ? ' tone-sunk' : '');
  app.dataset.theme = (S.route === 'focus') ? 'b' : 'a';

  const V = {
    boot: vBoot, auth: vAuth, home: vHome, ready: vReady, focus: vFocus,
    result: vResult, calendar: vCalendar, planner: vPlanner, stats: vStats, settings: vSettings,
  }[S.route] || vBoot;

  app.innerHTML = `<div class="statusbar"></div>` + V();
  if (S.sheet) app.insertAdjacentHTML('beforeend', S.sheet());
  if (S.route === 'focus') mountCam();
}

const vBoot = () => `<div class="center"><div class="stack" style="align-items:center;gap:14px">
  ${ic('seat', 44, 1.6)}<div class="cap">불러오는 중</div></div></div>`;

/* ── 로그인 · 가입 ── */
let authMode = 'in';
function vAuth() {
  return `<div class="scroll pad" style="display:flex;flex-direction:column;justify-content:center">
    <div style="padding:0 0 30px">
      <div style="color:var(--pri)">${ic('seat', 40, 1.6)}</div>
      <div class="h1" style="margin-top:16px">순공</div>
      <div class="sub" style="margin-top:8px">앉아 있던 시간만 셉니다.<br>그 시간이 오늘 계획에 그대로 채워집니다.</div>
    </div>
    <div class="stack" style="gap:10px">
      <input class="field" id="em" type="email" inputmode="email" autocomplete="email" placeholder="이메일">
      <input class="field" id="pw" type="password" autocomplete="${authMode === 'in' ? 'current-password' : 'new-password'}" placeholder="비밀번호 (6자 이상)">
      ${authMode === 'up' ? '<input class="field" id="nk" placeholder="닉네임 (선택)">' : ''}
    </div>
    <button class="btn pri" style="margin-top:16px" data-a="auth">${authMode === 'in' ? '로그인' : '가입하고 시작하기'}</button>
    <button class="btn ghost" style="margin-top:6px" data-a="authmode">
      ${authMode === 'in' ? '계정이 없어요 — 가입하기' : '이미 계정이 있어요 — 로그인'}
    </button>
    <div class="card p flat" style="margin-top:26px;background:var(--sunk);border-style:dashed">
      <div class="h3">둘러보기</div>
      <div class="cap" style="margin-top:5px">3주치 기록이 들어 있는 데모 계정으로 바로 볼 수 있습니다.</div>
      <button class="btn sm soft" style="margin-top:11px;background:var(--surface)" data-a="demo">데모 계정으로 열기</button>
    </div>
    <div class="cap" style="margin-top:22px;line-height:1.7">
      카메라는 기기 안에서만 착석과 졸음을 판단하고 즉시 버립니다.<br>얼굴 이미지는 저장되지도, 전송되지도 않습니다.
    </div>
  </div>`;
}

/* ── 홈 ── */
function vHome() {
  const h = S.home;
  if (!h) return vBoot();
  const goalSec = (h.goal_min || 300) * 60;
  const pct = goalSec ? h.net_sec / goalSec : 0;
  const diff = h.net_sec - (h.yesterday_net_sec || 0);
  const todos = h.todos || [];
  const done = todos.filter(t => t.done_at).length;
  const empty = h.net_sec === 0 && h.session_count === 0;

  return `<div class="scroll pb">
    <div class="appbar">
      <div class="h1">오늘</div>
      <button class="icon-btn" data-a="go" data-v="settings">${ic('gear', 19)}</button>
    </div>
    <div class="pad">
      <div class="cap" style="margin-top:-10px;margin-bottom:14px">${todayLabel()}</div>

      <div class="card p" style="padding:24px 18px 20px">
        <div class="ring-wrap" style="margin:0 auto;width:186px">
          ${ring(pct, { size: 186, sw: 14, boot: true })}
          <div class="in">
            <div class="lbl" style="margin-bottom:5px">오늘 순공시간</div>
            ${empty
              ? `<div class="h2">아직 기록이 없어요</div><div class="cap" style="margin-top:6px">첫 세션을 시작해 보세요</div>`
              : `<div class="hero num">${hmBig(h.net_sec)}</div>
                 <div class="cap num" style="margin-top:6px">목표 ${hm(goalSec)} · ${Math.round(pct * 100)}%</div>`}
          </div>
        </div>
        <div class="between" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line-2)">
          <div class="row" style="gap:7px">
            ${h.streak?.current ? `<span class="pill acc">${ic('bolt', 13, 2)} ${h.streak.current}일 연속</span>` : ''}
            ${!empty ? `<span class="pill mut num">어제 ${diff >= 0 ? '+' : ''}${hm(Math.abs(diff))}</span>` : ''}
          </div>
          <div class="cap num">세션 ${h.session_count}회</div>
        </div>
      </div>

      <button class="btn start" style="margin-top:14px" data-a="go" data-v="ready">${ic('play', 19)} 지금 집중 시작</button>

      <div class="sec">
        <div class="sec-head"><div class="h2">오늘 할 일 <span class="num" style="color:var(--tx-3)">${done}/${todos.length}</span></div>
          <button class="cap" style="color:var(--pri);font-weight:650" data-a="go" data-v="planner">플래너</button></div>
        ${todos.length ? `<div class="card">${todos.map((t, i) => todoRow(t, i === todos.length - 1)).join('')}</div>`
          : `<div class="card"><div class="empty">${ic('check_sq', 40, 1.5)}
              <div class="h3">오늘 계획한 일이 없어요</div>
              <div class="cap" style="margin-top:6px">할 일에 목표 시간을 적어두면<br>집중 세션이 끝날 때 자동으로 채워집니다</div>
              <button class="btn sm soft" style="margin-top:14px;width:auto;padding:0 18px" data-a="go" data-v="planner">할 일 추가</button>
             </div></div>`}
      </div>

      <div class="sec">
        <div class="card p row" style="gap:13px;align-items:flex-start" data-a="go" data-v="settings">
          <div class="ico ok">${ic('shield', 18)}</div>
          <div class="grow">
            <div class="h3">얼굴 이미지는 저장되지 않습니다</div>
            <div class="cap" style="margin-top:4px">카메라는 기기 안에서만 착석과 졸음을 판단하고 즉시 버립니다. 남는 것은 앉아 있던 시간뿐입니다.</div>
          </div>
          <div style="color:var(--tx-3);margin-top:2px">${ic('right', 16, 2)}</div>
        </div>
      </div>
    </div>
  </div>${tabbar('home')}`;
}

function todayLabel() {
  const d = kstToday();
  return `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일 ${dowOf(d)}요일`;
}

function todoRow(t, last) {
  const pct = t.plan_min ? Math.min(1, t.actual_min / t.plan_min) : 0;
  const over = t.actual_min > t.plan_min;
  const c = subColor(t.subject_id);
  return `<div class="lrow" style="align-items:flex-start;padding:14px 16px" data-a="todo" data-v="${t.id}" data-done="${t.done_at ? 1 : 0}">
    <div style="width:22px;height:22px;flex:none;border-radius:7px;margin-top:1px;display:grid;place-items:center;
      border:1.8px solid ${t.done_at ? 'var(--pri)' : 'var(--line)'};background:${t.done_at ? 'var(--pri)' : 'var(--surface)'};
      color:${t.done_at ? '#fff' : 'transparent'}">${ic('check', 13, 2.6)}</div>
    <div class="grow">
      <div class="row" style="gap:6px;margin-bottom:3px">
        <i style="width:7px;height:7px;border-radius:99px;background:${c};display:block"></i>
        <span class="cap" style="font-weight:700;color:${c}">${esc(subName(t.subject_id))}</span>
      </div>
      <div class="h3" style="${t.done_at ? 'color:var(--tx-3);text-decoration:line-through;text-decoration-thickness:1.5px' : ''}">${esc(t.title)}</div>
      <div class="row" style="gap:8px;margin-top:7px">
        <div class="meter grow"><i style="width:${pct * 100}%;background:${c}"></i></div>
        ${over ? `<i style="width:3px;height:5px;border-radius:2px;background:var(--acc);display:block"></i>` : ''}
        <div class="cap num" style="font-weight:700;white-space:nowrap">${t.actual_min}<span style="color:var(--tx-3)">/${t.plan_min}분</span></div>
      </div>
    </div>
  </div>${last ? '' : '<div class="divider" style="margin-left:50px"></div>'}`;
}

function tabbar(active) {
  const t = [['home', '홈', 'home'], ['calendar', '캘린더', 'cal'], ['planner', '플래너', 'check_sq'], ['stats', '기록', 'chart']];
  return `<div class="tabbar">${t.map(([id, label, icon]) => `
    <button class="tab ${active === id ? 'on' : ''}" data-a="go" data-v="${id}">
      ${ic(icon, 23, 1.8)}<span>${label}</span></button>`).join('')}</div>`;
}

/* ── 집중 준비 ── */
const R = { subjectId: null, goalMin: 30, todoId: null, pomodoro: false };
function vReady() {
  const p = S.profile || {};
  const cam = p.cam_enabled !== false;
  const drowsy = cam && p.drowsy_enabled !== false;
  if (!R.subjectId && S.subjects[0]) R.subjectId = S.subjects[0].id;
  const todos = (S.home?.todos || []).filter(t => !t.done_at);

  return `<div class="scroll pba">
    <div class="appbar">
      <button class="icon-btn" data-a="go" data-v="home">${ic('left', 19, 2)}</button>
      <div class="h1">집중 시작</div>
    </div>
    <div class="pad">
      <div class="lbl" style="margin-bottom:9px">과목</div>
      <div class="chips">${S.subjects.map(s =>
        `<button class="chip ${R.subjectId === s.id ? 'on' : ''}" data-a="pick" data-v="${s.id}">${esc(s.name)}</button>`).join('')}</div>

      ${todos.length ? `<div class="sec">
        <div class="between" style="margin-bottom:9px"><div class="lbl">연결할 할 일</div><div class="cap">선택</div></div>
        <div class="card">${todos.slice(0, 3).map((t, i) => `
          <div class="lrow" data-a="pickTodo" data-v="${t.id}">
            <div class="ico" style="background:${subColor(t.subject_id)}1f;color:${subColor(t.subject_id)}">${ic('check_sq', 18)}</div>
            <div class="grow"><div class="h3">${esc(t.title)}</div>
              <div class="cap num" style="margin-top:2px">오늘 · 목표 ${t.plan_min}분</div></div>
            <div style="width:20px;height:20px;border-radius:6px;display:grid;place-items:center;
              border:1.8px solid ${R.todoId === t.id ? 'var(--pri)' : 'var(--line)'};
              background:${R.todoId === t.id ? 'var(--pri)' : 'transparent'};color:${R.todoId === t.id ? '#fff' : 'transparent'}">
              ${ic('check', 12, 2.8)}</div>
          </div>${i < Math.min(3, todos.length) - 1 ? '<div class="divider" style="margin-left:59px"></div>' : ''}`).join('')}
        </div></div>` : ''}

      ${R.pomodoro ? '' : `<div class="sec">
        <div class="lbl" style="margin-bottom:9px">목표 시간</div>
        <div class="card p between">
          <button class="icon-btn" data-a="goal" data-v="-5">${ic('minus', 16, 2.2)}</button>
          <div style="text-align:center">
            <div class="num" style="font-size:30px;font-weight:800;letter-spacing:-.04em">${R.goalMin}<span style="font-size:16px;font-weight:700">분</span></div>
            <div class="cap">권장 25~50분</div>
          </div>
          <button class="icon-btn" data-a="goal" data-v="5">${ic('plus', 16, 2.2)}</button>
        </div></div>`}

      <div class="sec">
        <div class="lbl" style="margin-bottom:9px">측정 방식</div>
        <div class="card">
          <div class="lrow" data-a="toggleCam">
            <div class="ico">${ic('cam', 18)}</div>
            <div class="grow"><div class="h3">카메라 착석 감지</div>
              <div class="cap" style="margin-top:2px">자리를 비우면 타이머가 자동으로 멈춥니다</div></div>
            <div class="sw ${cam ? 'on' : ''}"><i></i></div>
          </div>
          <div class="divider" style="margin-left:59px"></div>
          <div class="lrow ${cam ? '' : 'lock'}" data-a="toggleDrowsy" style="${cam ? '' : 'opacity:.4'}">
            <div class="ico">${ic('eye', 18)}</div>
            <div class="grow"><div class="h3">졸음 감지</div>
              <div class="cap" style="margin-top:2px">${cam ? '눈을 감거나 고개를 떨구면 그 시간이 빠집니다' : '착석 감지를 켜야 졸음도 볼 수 있어요'}</div></div>
            <div class="sw ${drowsy ? 'on' : ''} ${cam ? '' : 'lock'}"><i></i></div>
          </div>
          ${cam ? `<div style="padding:0 16px 16px">
            <div class="cam" id="camslot">
              <div class="scan"></div>
              <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>
              <span class="pill ok badge" id="camstate">준비 중</span>
              <div style="text-align:center;color:var(--tx-2);z-index:2" id="camph">
                ${ic('seat', 26, 1.6)}<div class="cap" style="margin-top:6px;font-weight:650">기기 안에서만 분석 · 저장 없음</div>
              </div>
            </div></div>`
            : `<div style="padding:0 16px 16px"><div class="cap">수동 모드에서는 시작·정지를 직접 눌러 순공시간을 기록합니다.</div></div>`}
        </div>
      </div>

      <div class="sec">
        <div class="card p between" data-a="togglePomo">
          <div class="grow"><div class="h3">포모도로</div>
            <div class="cap" style="margin-top:3px">25분 집중하고 5분 쉬는 것을 반복합니다</div></div>
          <div class="sw ${R.pomodoro ? 'on' : ''}"><i></i></div>
        </div>
      </div>

      <div class="sec">
        <div class="card p tint-ok">
          <div class="row" style="align-items:flex-start;gap:11px">
            <div style="color:var(--ok);margin-top:1px">${ic('shield', 19)}</div>
            <div>
              <div class="h3" style="color:var(--tx)">카메라를 켜기 전에</div>
              <div class="cap" style="margin-top:6px;color:var(--tx-2);line-height:1.7">
                · 얼굴 이미지는 기기를 떠나지 않고, 판단 직후 즉시 폐기됩니다<br>
                · 저장되는 것은 구간의 종류와 시각뿐입니다<br>
                · 누구인지 식별하지 않습니다 — 눈과 자세만 봅니다<br>
                · 언제든 수동 모드로 바꾸거나 감지를 끌 수 있습니다
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="sec">
        <div class="card p between" data-a="fast">
          <div class="grow"><div class="h3">빠른 시연 모드</div>
            <div class="cap" style="margin-top:3px">판정 임계값을 3초/2초로 줄여 바로 확인할 수 있게 합니다</div></div>
          <div class="sw ${S.fast ? 'on' : ''}"><i></i></div>
        </div>
      </div>
    </div>
  </div>
  <div class="actionbar"><button class="btn start" data-a="begin">${ic('play', 19)} 시작하기</button></div>`;
}

/* ── 집중 중 · 자리 비움 · 졸음 · 휴식 ── */
function vFocus() {
  const f = S.focus; if (!f) return vBoot();
  const st = f.state;
  const goalSec = (f.goalMin || 30) * 60;
  const acc = st === 'away' || st === 'drowsy';
  const brk = st === 'break';

  const label = brk ? '휴식' : st === 'away' ? '멈춤' : st === 'drowsy' ? '졸음' : '순공시간';
  const ringColor = brk ? 'var(--tx-3)' : acc ? 'var(--acc)' : 'var(--pri)';

  return `<div class="scroll" style="padding-bottom:24px">
    <div class="pad">
      <div class="between" style="padding:4px 0 22px">
        <span class="pill ${acc ? 'acc' : brk ? 'mut' : 'pri'}">
          ${brk ? ic('coffee', 13, 2) : st === 'drowsy' ? ic('eye', 13, 2) : `<i style="width:7px;height:7px;border-radius:99px;background:${subColor(f.subjectId)};display:block"></i>`}
          ${brk ? '휴식' : esc(subName(f.subjectId))}${st === 'away' ? ' · 일시정지' : st === 'drowsy' ? ' · 졸음' : ''}</span>
        <button class="icon-btn" data-a="stop">${ic('x', 18, 2.1)}</button>
      </div>

      <div class="ring-wrap" style="margin:0 auto;width:250px">
        ${ring(brk ? f.breakLeft / (f.breakSec || 300) : f.net / goalSec, { size: 250, sw: 10, color: ringColor })}
        <div class="in">
          <div class="lbl" style="margin-bottom:7px;${acc ? 'color:var(--acc-tx)' : ''}">${label}</div>
          <div class="display" id="tmr" style="${acc ? 'opacity:.45' : ''}">${brk ? mmss(f.breakLeft) : clock(f.net)}</div>
          ${brk ? `<div class="cap" style="margin-top:9px">${f.cycle + 1}번째 집중까지</div>`
            : acc ? `<div class="cap num" id="sub" style="margin-top:9px;color:var(--acc-tx);font-weight:700">${st === 'away' ? '비운 시간' : '감지된 시간'} ${clock(f.offSec)}</div>`
            : `<div class="cap num" id="sub" style="margin-top:9px">총 ${clock(f.gross)} · 목표 ${f.goalMin}분</div>`}
        </div>
      </div>

      ${f.pomodoro ? `<div style="margin-top:16px">
        <div class="cycle">${[0,1,2,3].map(i => `<i class="${i < f.cycle ? 'on' : ''} ${i === 3 && f.cycle < 4 ? 'next' : ''}"></i>`).join('')}</div>
        <div class="cap" style="text-align:center;margin-top:7px">${f.cycle}/4 사이클 · ${brk ? '쉬는 중' : `${f.cycle + 1}번째 집중 중`}</div>
      </div>` : ''}

      ${brk ? `
        <div class="card p" style="margin-top:22px">
          <div class="row" style="gap:9px"><div style="color:var(--tx-3)">${ic('cam', 18)}</div>
            <div class="cap grow">휴식 중에는 카메라가 꺼집니다</div></div>
        </div>
        <div class="btn-row" style="margin-top:20px">
          <button class="btn soft" data-a="skipBreak">${ic('play', 17)} 휴식 건너뛰기</button>
          <button class="btn soft" data-a="stop">${ic('stop', 16)} 세션 종료</button>
        </div>
        <div class="cap" style="text-align:center;margin-top:14px">휴식 시간은 순공시간에 포함되지 않습니다</div>
      ` : acc ? `
        <div class="card p" style="margin-top:22px;border-color:var(--acc);background:var(--surface)">
          <div class="row" style="gap:9px;align-items:flex-start">
            <span class="dot warn" style="margin-top:6px"></span>
            <div><div class="h3">${st === 'away' ? '자리를 비운 것 같아요' : '졸고 있는 것 같아요'}</div>
              <div class="cap" style="margin-top:5px">${st === 'away'
                ? '돌아와 앉으면 자동으로 다시 이어서 잽니다. 이 시간은 순공시간에서 빠집니다.'
                : '눈을 감은 채로 시간이 지났어요. 이 시간은 순공시간에서 빠집니다.'}</div></div>
          </div>
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button class="btn soft" data-a="falsePositive">${ic('pencil', 17)} 잘못 감지예요</button>
          <button class="btn start" data-a="resumeNow">${ic('play', 17)} ${st === 'away' ? '이어서' : '깼어요'}</button>
        </div>
        <div class="cap" style="text-align:center;margin-top:14px;line-height:1.6">
          '잘못 감지예요'를 누르면 그 구간이 즉시 순공시간으로 되돌아가고,<br>같은 상황을 덜 잡도록 감도가 조정됩니다.
        </div>
      ` : `
        <div class="card p" style="margin-top:22px">
          <div class="row" style="gap:9px">
            <span class="dot"></span>
            <div class="grow"><div class="h3" id="camlabel">${S.detector?.manual ? '수동 기록 중' : '착석 확인 중'}</div></div>
            <div class="cap num" id="cnt">이탈 ${f.awayCount} · 졸음 ${f.drowsyCount}</div>
          </div>
          ${S.detector?.manual ? '' : `<div style="margin-top:12px"><div class="cam blur" id="camslot" style="height:96px">
            <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>
            <span class="pill ok badge">기기 처리 · 저장 없음</span>
          </div></div>`}
          <div class="cap" style="margin-top:11px;padding-top:11px;border-top:1px solid var(--line-2)">
            카메라 영상은 기기 밖으로 나가지 않으며 저장되지 않습니다.
          </div>
        </div>
        ${f.todoTitle ? `<div class="card p" style="margin-top:12px">
          <div class="lbl" style="margin-bottom:8px">연결된 할 일</div>
          <div class="row" style="gap:8px">
            <i style="width:8px;height:8px;border-radius:99px;background:${subColor(f.subjectId)};display:block"></i>
            <div class="h3 grow">${esc(f.todoTitle)}</div>
            <div class="cap num" id="todoMin">${Math.floor(f.net / 60)}/${f.todoPlan}분</div></div>
          <div class="meter" style="margin-top:9px"><i id="todoBar" style="width:${Math.min(100, f.net / 60 / f.todoPlan * 100)}%;background:${subColor(f.subjectId)}"></i></div>
        </div>` : ''}
        <div class="btn-row" style="margin-top:20px">
          ${S.detector?.manual
            ? `<button class="btn soft" data-a="manualAway">${ic('pause', 18)} 자리 비움</button>`
            : `<button class="btn soft" data-a="manualAway">${ic('pause', 18)} 일시정지</button>`}
          <button class="btn pri" style="flex:0 0 118px" data-a="stop">${ic('stop', 17)} 종료</button>
        </div>
        <div class="cap" style="text-align:center;margin-top:14px">화면을 꺼도 측정은 계속됩니다</div>
      `}
    </div>
  </div>`;
}

/* ── 세션 요약 · 정정 ── */
function vResult() {
  const r = S.result; if (!r) return vBoot();
  const s = r.session, spans = (r.spans || []).filter(x => x.seconds > 0);
  const total = Math.max(1, s.gross_sec);
  const segs = [];
  let cur = new Date(s.started_at).getTime();
  const end = new Date(s.ended_at || s.eff_end).getTime();
  spans.slice().sort((a, b) => new Date(a.started_at) - new Date(b.started_at)).forEach(sp => {
    const a = new Date(sp.started_at).getTime(), b = new Date(sp.ended_at).getTime();
    if (a > cur) segs.push({ k: 'on', s: (a - cur) / 1000 });
    segs.push({ k: sp.reverted ? 'on' : sp.kind, s: (b - a) / 1000, id: sp.id, reverted: sp.reverted });
    cur = b;
  });
  if (end > cur) segs.push({ k: 'on', s: (end - cur) / 1000 });

  const kinds = [...new Set(spans.filter(x => !x.reverted).map(x => x.kind))];
  const cand = spans.find(x => !x.reverted && (x.kind === 'away' || x.kind === 'drowsy'));

  return `<div class="scroll pba">
    <div class="appbar"><button class="icon-btn" data-a="go" data-v="home">${ic('left', 19, 2)}</button><div class="h1">세션 요약</div></div>
    <div class="pad">
      <div class="card p" style="text-align:center;padding:26px 18px">
        <div class="lbl">순공시간</div>
        <div class="hero num" style="margin-top:6px">${hmBig(s.net_sec)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:14px;justify-items:center">
          <span class="pill mut num">${hhmm(s.started_at)} – ${hhmm(s.ended_at || s.eff_end)}</span>
          <span class="pill mut num">총 ${hm(s.gross_sec)}</span>
          ${s.away_count ? `<span class="pill acc num">이탈 ${s.away_count}회 · ${hm(s.away_sec)}</span>` : ''}
          ${s.drowsy_count ? `<span class="pill acc num">졸음 ${s.drowsy_count}회 · ${hm(s.drowsy_sec)}</span>` : ''}
          ${!s.away_count && !s.drowsy_count ? '<span class="pill mut">이탈·졸음 없음</span>' : ''}
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">세션 타임라인</div><div class="cap">가로 = 실제 시간</div></div>
        <div class="card p">
          <div class="span-tl">${segs.map(g => {
            const cfg = SPAN[g.k];
            return `<div style="flex:${Math.max(g.s, total * 0.01)};background:${cfg ? cfg.fill : 'var(--pri)'};
              opacity:${cfg ? cfg.op : 1}" class="${cfg?.tex || ''}"></div>`;
          }).join('')}</div>
          <div class="between" style="margin-top:8px">
            <div class="cap num">${hhmm(s.started_at)}</div><div class="cap num">${hhmm(s.ended_at || s.eff_end)}</div>
          </div>
          <div class="row" style="gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2)">
            <div class="legend"><i style="background:var(--pri)"></i> 착석</div>
            ${kinds.map(k => `<div class="legend"><i class="${SPAN[k].tex}" style="background:${SPAN[k].fill};opacity:${SPAN[k].op}"></i> ${SPAN[k].name}</div>`).join('')}
            ${spans.some(x => x.reverted) ? '<div class="legend"><i style="background:var(--pri);opacity:.5"></i> 정정됨</div>' : ''}
          </div>
        </div>
      </div>

      ${cand ? `<div class="sec">
        <div class="card p tint-acc">
          <div class="row" style="gap:11px;align-items:flex-start">
            <div style="color:var(--acc-tx);margin-top:1px">${ic('alert', 19)}</div>
            <div class="grow">
              <div class="h3" style="color:var(--tx)">${hhmm(cand.started_at)}–${hhmm(cand.ended_at)} 구간이 ${cand.kind === 'away' ? '이탈' : '졸음'}로 잡혔어요</div>
              <div class="cap" style="margin-top:5px;color:var(--tx-2)">${cand.kind === 'away'
                ? '책상에 엎드려 필기 중이었다면 되돌릴 수 있습니다.' : '눈을 감고 암기 중이었다면 되돌릴 수 있습니다.'}</div>
              <button class="btn sm soft" style="margin-top:11px;background:var(--surface)" data-a="revert" data-v="${cand.id}">
                ${ic('check', 15, 2.4)} 순공으로 되돌리기</button>
            </div>
          </div>
        </div></div>` : ''}
    </div>
  </div>
  <div class="actionbar"><div class="btn-row">
    <button class="btn soft" style="flex:0 0 110px" data-a="discard">버리기</button>
    <button class="btn pri" data-a="save">기록 저장</button>
  </div></div>`;
}

/* ── 캘린더 · 플래너 · 기록 · 설정 ── */
function vCalendar() {
  const c = S.cal;
  if (!c) return skelScreen('캘린더', 'calendar');
  const first = new Date(c.from + 'T00:00:00Z');
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(c.to + 'T00:00:00Z').getUTCDate();
  const map = Object.fromEntries((c.days || []).map(d => [d.day, d]));
  const today = kstToday();
  const lvl = m => m == null ? 'none' : m === 0 ? '' : m < 5400 ? 'v1' : m < 10800 ? 'v2' : m < 14400 ? 'v3' : 'v4';
  const sel = S.sel;

  return `<div class="scroll pb pbf">
    <div class="appbar"><div class="h1">캘린더</div>
      <button class="icon-btn" data-a="month" data-v="-1">${ic('left', 17, 2)}</button>
      <button class="icon-btn" data-a="month" data-v="1">${ic('right', 17, 2)}</button></div>
    <div class="pad">
      <div class="h2 num" style="margin-top:-10px;margin-bottom:16px">${c.from.slice(0, 4)}년 ${+c.from.slice(5, 7)}월</div>
      <div class="card p" style="padding:14px 16px;margin-bottom:14px">
        <div class="row" style="gap:0">
          ${[['순공 합계', hm(c.total_sec)], ['공부한 날', `${c.studied_days}일`], ['최장 연속', `${c.streak?.longest ?? 0}일`]]
            .map(([a, b], i) => `<div class="grow" ${i ? 'style="border-left:1px solid var(--line-2);padding-left:14px"' : ''}>
              <div class="lbl">${a}</div>
              <div class="num" style="font-size:13.5px;font-weight:750;margin-top:4px;letter-spacing:-.04em;white-space:nowrap">${b}</div></div>`).join('')}
        </div>
      </div>
      <div class="card p">
        <div class="cal" style="margin-bottom:8px">${DOW.map((d, i) => `<div class="hd ${i === 6 ? 'sun' : ''}">${d}</div>`).join('')}</div>
        <div class="cal">
          ${Array(lead).fill('<div class="cell none"></div>').join('')}
          ${Array.from({ length: days }, (_, i) => {
            const iso = `${c.from.slice(0, 8)}${pad(i + 1)}`;
            const rec = map[iso]; const future = iso > today;
            return `<button class="cell ${future ? 'none' : lvl(rec?.net_sec ?? 0)} ${iso === today ? 'today' : ''} ${iso === sel ? 'sel' : ''}"
              data-a="day" data-v="${iso}"><div class="d">${i + 1}</div>${rec?.net_sec ? `<div class="m num">${hmc(Math.round(rec.net_sec / 60))}</div>` : ''}</button>`;
          }).join('')}
        </div>
        <div class="row" style="justify-content:flex-end;gap:5px;margin-top:14px">
          <div class="legend">적음</div>
          ${['var(--sunk)', 'color-mix(in srgb,var(--pri) 13%,var(--sunk))', 'color-mix(in srgb,var(--pri) 30%,var(--sunk))', 'color-mix(in srgb,var(--pri) 55%,var(--sunk))', 'var(--pri)']
            .map(x => `<div class="legend"><i style="background:${x}"></i></div>`).join('')}
          <div class="legend">많음</div>
        </div>
      </div>
      ${S.dayd ? dayDetailCard(S.dayd) : ''}
    </div>
  </div>
  <button class="fab" data-a="go" data-v="ready">${ic('play', 24)}</button>${tabbar('calendar')}`;
}

function dayDetailCard(d) {
  const t = kstToday();
  return `<div class="sec">
    <div class="sec-head"><div class="h2">${+d.day.slice(5, 7)}월 ${+d.day.slice(8, 10)}일 ${dowOf(d.day)}요일</div>
      ${d.day === t ? '<span class="pill acc">오늘</span>' : ''}</div>
    ${d.day > t ? `<div class="card p"><div class="cap">아직 오지 않은 날입니다.</div></div>`
      : !d.sessions?.length ? `<div class="card p"><div class="cap">이 날은 기록이 없습니다.</div></div>`
      : `<div class="card">
          <div class="lrow" style="padding-bottom:8px"><div class="ico">${ic('clock', 18)}</div>
            <div class="grow"><div class="h3 num">${hm(d.net_sec)}</div><div class="cap">순공시간</div></div></div>
          <div class="divider" style="margin:4px 16px"></div>
          ${d.sessions.map(s => `<div class="lrow" style="padding:11px 16px">
            <div style="width:34px;flex:none;display:grid;place-items:center">
              <i style="width:10px;height:10px;border-radius:99px;background:${subColor(s.subject_id)};display:block"></i></div>
            <div class="grow"><div class="h3">${esc(subName(s.subject_id))}</div>
              <div class="cap num" style="margin-top:2px">${hhmm(s.started_at)} – ${hhmm(s.ended_at)}${s.away_count ? ` · 이탈 ${s.away_count}` : ''}${s.drowsy_count ? ` · 졸음 ${s.drowsy_count}` : ''}</div></div>
            <div class="num" style="font-weight:750;font-size:14px">${hm(s.net_sec)}</div>
          </div>`).join('')}
        </div>`}
  </div>`;
}

function vPlanner() {
  const list = S.plan;
  if (!list) return skelScreen('플래너', 'planner');
  const done = list.filter(t => t.done_at).length;
  const plan = list.reduce((a, b) => a + b.plan_min, 0);
  const real = list.reduce((a, b) => a + b.actual_min, 0);
  return `<div class="scroll pb pbf">
    <div class="appbar"><div class="h1">플래너</div></div>
    <div class="pad">
      <div class="cap" style="margin-top:-10px;margin-bottom:16px">${todayLabel()}</div>
      ${list.length ? `<div class="card p">
        <div class="between">
          <div><div class="lbl">오늘 완료</div>
            <div class="num" style="font-size:24px;font-weight:800;letter-spacing:-.04em;margin-top:3px">${done}<span style="font-size:15px;color:var(--tx-3)">/${list.length}</span></div></div>
          <div style="text-align:right"><div class="lbl">계획 대비 실제</div>
            <div class="num" style="font-size:24px;font-weight:800;letter-spacing:-.04em;margin-top:3px">${plan ? Math.round(real / plan * 100) : 0}<span style="font-size:15px;color:var(--tx-3)">%</span></div></div>
        </div>
        <div class="meter" style="height:7px;margin-top:14px"><i style="width:${list.length ? done / list.length * 100 : 0}%"></i></div>
        <div class="between" style="margin-top:9px">
          <div class="cap num">계획 ${hm(plan * 60)}</div>
          <div class="cap num" style="color:var(--ok);font-weight:700">실제 ${hm(real * 60)}</div>
        </div>
      </div>
      <div class="sec"><div class="card">${list.map((t, i) => todoRow(t, i === list.length - 1)).join('')}</div></div>`
      : `<div class="card"><div class="empty">${ic('check_sq', 44, 1.5)}
          <div class="h3">오늘 계획한 일이 없어요</div>
          <div class="cap" style="margin-top:6px">첫 할 일을 추가해 보세요</div></div></div>`}
      <div class="sec"><div class="card p dash"><div class="cap" style="line-height:1.7">
        할 일에 목표 시간을 적어두면, 집중 세션을 끝냈을 때 그 시간이 자동으로 채워집니다.
        계획과 실제의 차이가 다음 주 계획을 세우는 유일한 근거입니다.
      </div></div></div>
    </div>
  </div>
  <button class="fab pri" data-a="sheetAdd">${ic('plus', 26, 2.1)}</button>${tabbar('planner')}`;
}

function vStats() {
  const r = S.stats;
  if (!r) return skelScreen('기록', 'stats');
  const max = Math.max(1, ...(r.by_day || []).map(d => d.net_sec));
  const week = mondayOf();
  const byDow = Object.fromEntries((r.by_weekday || []).map(d => [d.isodow, d.net_sec]));
  const diff = r.total_sec - r.prev_total_sec;
  const subjMax = Math.max(1, ...(r.by_subject || []).map(s => s.net_sec));
  const BK = { '05-09': '새벽·아침 05–09', '09-12': '오전 09–12', '12-18': '오후 12–18', '18-22': '저녁 18–22', '22-05': '밤 22–05' };
  const hb = r.by_hour_bucket || [];
  const hbMax = Math.max(1, ...hb.map(b => b.net_sec));
  const today = kstToday();

  return `<div class="scroll pb">
    <div class="appbar"><div class="h1">기록</div></div>
    <div class="pad">
      <div class="card p">
        <div class="between">
          <div><div class="lbl">이번 주 순공시간</div>
            <div class="num" style="font-size:30px;font-weight:800;letter-spacing:-.045em;margin-top:4px">${hm(r.total_sec)}</div></div>
          ${r.prev_total_sec ? `<span class="pill ${diff >= 0 ? 'ok' : 'mut'} num">${diff >= 0 ? '+' : '−'}${hm(Math.abs(diff))}</span>`
            : '<span class="pill mut">비교할 지난주 기록 없음</span>'}
        </div>
        <div class="bars" style="height:118px;margin-top:20px">
          ${DOW.map((d, i) => {
            const iso = new Date(new Date(week + 'T00:00:00Z').getTime() + i * 864e5).toISOString().slice(0, 10);
            const v = byDow[i + 1]; const future = iso > today;
            return `<div class="bar ${future ? 'dim' : iso === today ? 'now' : ''}">
              <span class="num" style="font-size:9.5px;color:var(--tx-3)">${future || !v ? '' : hmc(Math.round(v / 60))}</span>
              <i style="height:${future || !v ? 4 : Math.max(4, v / max * 100)}%"></i><span>${d}</span></div>`;
          }).join('')}
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">과목별</div><div class="cap num">합계 ${hm(r.total_sec)}</div></div>
        <div class="card p" style="display:flex;flex-direction:column;gap:15px">
          ${(r.by_subject || []).length ? r.by_subject.map(s => `<div>
            <div class="between" style="margin-bottom:6px">
              <div class="row" style="gap:7px"><i style="width:8px;height:8px;border-radius:99px;background:${s.color || 'var(--tx-3)'};display:block"></i>
                <span class="h3">${esc(s.name || '기타')}</span></div>
              <div class="num" style="font-size:13px;font-weight:700">${hm(s.net_sec)}
                <span style="color:var(--tx-3);font-weight:600">${Math.round(s.net_sec / Math.max(1, r.total_sec) * 100)}%</span></div>
            </div>
            <div class="hbar"><i style="width:${s.net_sec / subjMax * 100}%;background:${s.color || 'var(--tx-3)'}"></i></div>
          </div>`).join('') : '<div class="cap">아직 기록이 없어요.</div>'}
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">집중 패턴</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${[['평균 세션', hm(r.pattern?.avg_session_sec)], ['최장 세션', hm(r.pattern?.max_session_sec)],
             ['세션당 이탈·졸음', `${r.pattern?.avg_away_per_session ?? 0}회`], ['공부한 날', `${r.studied_days}일`]]
            .map(([a, b]) => `<div class="card p" style="padding:15px 13px;text-align:center">
              <div class="num" style="font-size:19px;font-weight:800;letter-spacing:-.035em">${b}</div>
              <div class="cap" style="margin-top:4px">${a}</div></div>`).join('')}
        </div>
      </div>

      ${hb.length ? `<div class="sec">
        <div class="sec-head"><div class="h2">시간대</div><div class="cap">가장 잘 되는 시간</div></div>
        <div class="card p">
          ${hb.map(b => `<div style="margin-bottom:13px">
            <div class="between" style="margin-bottom:5px">
              <div class="cap" style="font-weight:650;color:var(--tx-2)">${BK[b.bucket] || b.bucket}</div>
              <div class="cap num" style="font-weight:700">${hm(b.net_sec)}</div></div>
            <div class="hbar" style="height:7px"><i style="width:${b.net_sec / hbMax * 100}%;background:${b.net_sec === hbMax ? 'var(--acc)' : 'var(--pri)'}"></i></div>
          </div>`).join('')}
          <div class="cap" style="margin-top:2px;padding-top:12px;border-top:1px solid var(--line-2);line-height:1.6">
            ${(() => { const top = hb.find(b => b.net_sec === hbMax);
              return top ? `${BK[top.bucket]}에 전체 순공시간의 ${Math.round(hbMax / Math.max(1, r.total_sec) * 100)}%가 몰려 있습니다.` : ''; })()}
          </div>
        </div>
      </div>` : ''}
    </div>
  </div>${tabbar('stats')}`;
}

function skelScreen(title, tab) {
  return `<div class="scroll pb"><div class="appbar"><div class="h1">${title}</div></div>
    <div class="pad stack" style="gap:12px">
      <div class="skel" style="height:88px;border-radius:20px"></div>
      <div class="skel" style="height:240px;border-radius:20px"></div>
      <div class="skel" style="height:160px;border-radius:20px"></div>
    </div></div>${tabbar(tab)}`;
}

function vSettings() {
  const p = S.profile || {};
  const cam = p.cam_enabled !== false, drowsy = p.drowsy_enabled !== false;
  return `<div class="scroll" style="padding-bottom:40px">
    <div class="appbar"><button class="icon-btn" data-a="go" data-v="home">${ic('left', 19, 2)}</button><div class="h1">카메라와 개인정보</div></div>
    <div class="pad">
      <div class="card p ${cam ? 'tint-ok' : ''}" style="padding:22px 18px;text-align:center;${cam ? '' : 'background:var(--sunk);border-color:var(--line)'}">
        <div style="color:${cam ? 'var(--ok)' : 'var(--tx-3)'};display:flex;justify-content:center">${ic('shield', 34, 1.6)}</div>
        <div class="h2" style="margin-top:12px">${cam ? '얼굴 이미지는 저장되지 않습니다' : '카메라를 사용하지 않고 있습니다'}</div>
        <div class="cap" style="margin-top:7px;color:var(--tx-2);line-height:1.7;max-width:280px;margin-inline:auto;text-wrap:balance">
          ${cam ? `카메라는 '지금 자리에 앉아 있는가'${drowsy ? ", '졸고 있는가'" : ''}만 판단합니다. 판단이 끝난 프레임은 그 즉시 기기에서 삭제됩니다.`
                : '수동 타이머로만 기록 중입니다.'}
        </div>
      </div>

      ${cam ? `<div class="sec">
        <div class="sec-head"><div class="h2">어떻게 동작하나요</div></div>
        <div class="card">
          ${[['eye', '눈과 자세만 봅니다', '누구인지 식별하지 않습니다'],
             ['cam', '기기 안에서만 분석', '영상이 서버로 전송되지 않습니다'],
             ['trash', '판단 직후 즉시 폐기', '프레임을 파일로 남기지 않습니다'],
             ['clock', '남는 것은 시간뿐', '구간의 종류와 시각만 저장됩니다']]
            .map(([i, a, b], k) => `<div class="lrow"><div class="ico ok">${ic(i, 18)}</div>
              <div class="grow"><div class="h3">${a}</div><div class="cap" style="margin-top:2px">${b}</div></div></div>
              ${k < 3 ? '<div class="divider" style="margin-left:59px"></div>' : ''}`).join('')}
        </div></div>` : ''}

      <div class="sec">
        <div class="sec-head"><div class="h2">저장되는 데이터</div></div>
        <div class="card p" style="background:var(--sunk);box-shadow:none">
          ${[['세션', '시작 시각 · 종료 시각 · 과목'],
             ['구간', '종류(자리 비움 · 졸음 · 일시정지 · 휴식) · 시작 시각 · 종료 시각'],
             ['정정', '되돌린 구간 · 되돌린 시각']]
            .map(([a, b]) => `<div class="row" style="gap:12px;align-items:flex-start;margin-bottom:8px">
              <div class="cap" style="font-weight:700;color:var(--tx-2);flex:0 0 34px">${a}</div>
              <div class="cap" style="color:var(--tx-3)">${b}</div></div>`).join('')}
          <div class="cap" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
            이 목록이 전부입니다. 이미지·영상·위치·연락처는 저장하지 않습니다.</div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">설정</div></div>
        <div class="card">
          <div class="lrow" data-a="toggleCam"><div class="ico">${ic('cam', 18)}</div>
            <div class="grow"><div class="h3">카메라 착석 감지</div><div class="cap" style="margin-top:2px">끄면 수동 타이머로만 기록합니다</div></div>
            <div class="sw ${cam ? 'on' : ''}"><i></i></div></div>
          <div class="divider" style="margin-left:59px"></div>
          <div class="lrow ${cam ? '' : 'lock'}" data-a="toggleDrowsy" style="${cam ? '' : 'opacity:.4'}">
            <div class="ico">${ic('eye', 18)}</div>
            <div class="grow"><div class="h3">졸음 감지</div><div class="cap" style="margin-top:2px">끄면 눈 감김·고개 떨굼을 보지 않습니다</div></div>
            <div class="sw ${drowsy ? 'on' : ''} ${cam ? '' : 'lock'}"><i></i></div></div>
          <div class="divider" style="margin-left:59px"></div>
          <div class="lrow" data-a="corrections"><div class="ico acc">${ic('pencil', 18)}</div>
            <div class="grow"><div class="h3">잘못 감지 정정 이력</div>
              <div class="cap num" style="margin-top:2px">${S.corr == null ? '불러오는 중' : S.corr.length ? `되돌린 구간 ${S.corr.filter(c => c.action === 'revert').length}건 · 감도 자동 조정됨` : '아직 되돌린 구간이 없습니다'}</div></div>
            <div style="color:var(--tx-3)">${ic('right', 16, 2)}</div></div>
          <div class="divider" style="margin-left:59px"></div>
          <div class="lrow" data-a="signout"><div class="ico">${ic('out', 18)}</div>
            <div class="grow"><div class="h3">로그아웃</div></div></div>
        </div>
      </div>

      <div class="sec"><div class="cap" style="line-height:1.7">
        이 앱은 누구에게도 내 기록을 자동으로 보내지 않습니다. 기록은 기기와 내 계정에만 남습니다.
      </div></div>
    </div>
  </div>`;
}

/* ── 카메라 마운트 (재렌더에도 스트림이 끊기지 않게 같은 video 노드를 옮긴다) ── */
let videoEl = null;
function mountCam() {
  const slot = app.querySelector('#camslot');
  if (!slot || !videoEl) return;
  slot.insertBefore(videoEl, slot.firstChild);
}
async function ensurePreview() {
  const p = S.profile || {};
  if (p.cam_enabled === false) { S.detector = new ManualDetector({ onState: onDetState }); return; }
  if (S.detector && !S.detector.manual && S.detector.ready) return;
  if (!videoEl) { videoEl = el('<video playsinline muted autoplay></video>'); }
  const d = new Detector({
    awaySec:   S.fast ? 3 : (p.away_threshold_sec ?? 20),
    drowsySec: S.fast ? 2 : (p.drowsy_threshold_sec ?? 8),
    drowsyOn:  p.drowsy_enabled !== false,
    onState:   onDetState,
    onTick:    onDetTick,
  });
  S.detector = d;
  try {
    await d.start(videoEl);
    render();
    setCamState('착석 확인 중', true);
  } catch (e) {
    const why = d.failed === 'denied' ? '카메라 권한이 꺼져 있어요 — 수동 모드로 시작할 수 있습니다'
              : d.failed === 'model'  ? '감지 모델을 불러오지 못했습니다 — 수동 모드로 전환합니다'
              : '카메라를 열 수 없습니다 — 수동 모드로 전환합니다';
    toast(why);
    S.detector = new ManualDetector({ onState: onDetState });
    render();
  }
}
function setCamState(txt, ok) {
  const b = app.querySelector('#camstate');
  if (b) { b.textContent = txt; b.className = `pill ${ok ? 'ok' : 'acc'} badge`; }
  const ph = app.querySelector('#camph');
  if (ph) ph.style.display = 'none';
}
function onDetTick(v) {
  if (S.route !== 'ready') return;
  setCamState(v.present ? (v.blink > 0.5 ? '눈 감김 감지' : '착석 확인 중') : '얼굴이 보이지 않아요', v.present && v.blink <= 0.5);
}

/* ── 세션 제어 ── */
async function beginSession() {
  if (S.busy) return; S.busy = true;
  const clientId = db.uuid();
  const todo = (S.home?.todos || []).find(t => t.id === R.todoId);
  const p = S.profile || {};
  try {
    const s = await db.startSession(clientId, {
      subjectId: R.subjectId, todoId: R.todoId,
      source: S.detector?.manual ? 'manual' : 'camera',
      goalMin: R.pomodoro ? (p.pomodoro_focus_min || 25) : R.goalMin,
      pomodoro: R.pomodoro,
    });
    S.focus = {
      id: s.id, clientId, subjectId: s.subject_id, goalMin: s.goal_min || 30,
      net: 0, gross: 0, offSec: 0, state: 'ok', awayCount: 0, drowsyCount: 0,
      openSpanKind: null, pomodoro: R.pomodoro, cycle: 0,
      breakSec: (p.pomodoro_break_min || 5) * 60, breakLeft: 0,
      todoTitle: todo?.title || null, todoPlan: todo?.plan_min || 0,
      startedAt: Date.now(),
    };
    startTick();
    go('focus');
  } catch (e) { toast(msg(e)); }
  S.busy = false;
}

async function attachSession(s, net, gross) {
  S.focus = {
    id: s.id, clientId: s.client_id, subjectId: s.subject_id, goalMin: s.goal_min || 30,
    net, gross, offSec: 0, state: 'ok', awayCount: 0, drowsyCount: 0,
    openSpanKind: null, pomodoro: s.pomodoro, cycle: 0, breakSec: 300, breakLeft: 0,
    todoTitle: null, todoPlan: 0, startedAt: Date.now() - gross * 1000,
  };
  await ensurePreview();
  startTick();
  go('focus');
  toast('진행 중이던 세션을 이어서 잽니다');
}

let tickTimer, beatTimer;
function startTick() {
  clearInterval(tickTimer); clearInterval(beatTimer);
  tickTimer = setInterval(tick, 1000);
  beatTimer = setInterval(() => S.focus && db.heartbeat(S.focus.id).catch(() => {}), 30000);
}
function stopTick() { clearInterval(tickTimer); clearInterval(beatTimer); }

function tick() {
  const f = S.focus; if (!f) return;
  if (f.state === 'break') {
    f.breakLeft--;
    if (f.breakLeft <= 0) return endBreak();
    patch('#tmr', mmss(f.breakLeft));
    return;
  }
  f.gross++;
  if (f.state === 'ok') {
    f.net++;
    patch('#tmr', clock(f.net));
    patch('#sub', `총 ${clock(f.gross)} · 목표 ${f.goalMin}분`);
    const tm = app.querySelector('#todoMin');
    if (tm) { tm.textContent = `${Math.floor(f.net / 60)}/${f.todoPlan}분`;
      const b = app.querySelector('#todoBar'); if (b) b.style.width = Math.min(100, f.net / 60 / f.todoPlan * 100) + '%'; }
    if (f.pomodoro && f.net >= f.goalMin * 60 * (f.cycle + 1)) startBreak();
  } else {
    f.offSec++;
    patch('#sub', `${f.state === 'away' ? '비운 시간' : '감지된 시간'} ${clock(f.offSec)}`);
  }
}
function patch(sel, txt) { const n = app.querySelector(sel); if (n) n.textContent = txt; }

async function onDetState(next, prev) {
  const f = S.focus;
  if (!f || S.route !== 'focus' || f.state === 'break') return;
  if (next === prev) return;
  try {
    if (prev !== 'ok' && f.openSpanKind) { await db.closeSpan(f.id); f.openSpanKind = null; }
    if (next !== 'ok') {
      await db.openSpan(f.id, next);
      f.openSpanKind = next;
      f.offSec = 0;
      if (next === 'away') f.awayCount++; else f.drowsyCount++;
    }
  } catch (e) { /* 오프라인이어도 화면은 계속 돈다 */ }
  f.state = next;
  render();
}

async function startBreak() {
  const f = S.focus;
  f.cycle++;
  try { await db.openSpan(f.id, 'break'); f.openSpanKind = 'break'; } catch {}
  S.detector?.pause?.();
  f.state = 'break'; f.breakLeft = f.breakSec;
  render();
}
async function endBreak() {
  const f = S.focus;
  try { await db.closeSpan(f.id); } catch {}
  f.openSpanKind = null; f.state = 'ok';
  S.detector?.resume?.();
  render();
}

async function stopSession() {
  const f = S.focus; if (!f) return;
  stopTick();
  S.detector?.stop?.();
  try {
    await db.endSession(f.id);
    S.result = await db.sessionDetail(f.id);
    S.focus = null;
    go('result');
  } catch (e) { toast(msg(e)); S.focus = null; go('home'); }
}

async function falsePositive() {
  const f = S.focus; if (!f || f.state === 'ok') return;
  try {
    const span = await db.closeSpan(f.id);
    const r = await db.revertSpan(span.id);
    f.openSpanKind = null;
    f.net += Math.max(0, Math.round((new Date(span.ended_at) - new Date(span.started_at)) / 1000));
    if (f.state === 'away') f.awayCount = Math.max(0, f.awayCount - 1); else f.drowsyCount = Math.max(0, f.drowsyCount - 1);
    f.state = 'ok';
    S.detector && (S.detector.state = 'ok');
    render();
    toast(r?.threshold_changed ? '되돌렸어요 · 감도가 조정됐습니다' : '순공시간으로 되돌렸어요');
  } catch (e) { toast(msg(e)); }
}

const msg = (e) => {
  const m = String(e?.message || e);
  if (/Invalid login/i.test(m)) return '이메일 또는 비밀번호가 맞지 않습니다';
  if (/already registered|User already/i.test(m)) return '이미 가입된 이메일입니다';
  if (/Password should be/i.test(m)) return '비밀번호는 6자 이상이어야 합니다';
  if (/Failed to fetch|NetworkError/i.test(m)) return '네트워크에 연결할 수 없습니다';
  return m.slice(0, 80);
};

/* ── 데이터 로더 ── */
async function loadCalendar(delta = 0) {
  const base = S.calBase || kstToday();
  const d = new Date(base + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + delta); d.setUTCDate(1);
  S.calBase = d.toISOString().slice(0, 10);
  S.cal = await db.calendarMonth(d.getUTCFullYear(), d.getUTCMonth() + 1).catch(() => null);
  render();
}
async function loadDay(iso) { S.sel = iso; S.dayd = await db.dayDetail(iso).catch(() => null); render(); }
async function loadPlanner() { S.plan = await db.todosOn(kstToday()).catch(() => []); render(); }
async function loadStats() {
  const mon = mondayOf();
  const sun = new Date(new Date(mon + 'T00:00:00Z').getTime() + 6 * 864e5).toISOString().slice(0, 10);
  S.stats = await db.rangeSummary(mon, sun).catch(() => null);
  render();
}

/* ── 이벤트 ── */
app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, v = t.dataset.v;
  switch (a) {
    case 'go': {
      if (v === 'ready') { R.todoId = null; go('ready'); ensurePreview(); return; }
      if (v === 'calendar') { S.route = 'calendar'; render(); if (!S.cal) loadCalendar(0); return; }
      if (v === 'planner')  { S.route = 'planner';  render(); loadPlanner(); return; }
      if (v === 'stats')    { S.route = 'stats';    render(); loadStats(); return; }
      if (v === 'home')     { S.detector?.stop?.(); S.detector = null; await loadHome(); go('home'); return; }
      if (v === 'settings') { S.route = 'settings'; render(); db.corrections().then(c => { S.corr = c; render(); }).catch(() => {}); return; }
      go(v); return;
    }
    case 'authmode': authMode = authMode === 'in' ? 'up' : 'in'; render(); return;
    case 'auth': {
      const em = app.querySelector('#em').value.trim(), pw = app.querySelector('#pw').value;
      const nk = app.querySelector('#nk')?.value?.trim();
      if (!em || !pw) return toast('이메일과 비밀번호를 입력해 주세요');
      t.disabled = true;
      try {
        if (authMode === 'in') await db.auth.signIn(em, pw);
        else { await db.auth.signUp(em, pw, nk); toast('가입됐어요'); }
        S.route = 'boot'; render(); await afterLogin();
      } catch (err) { toast(msg(err)); t.disabled = false; }
      return;
    }
    case 'demo': {
      t.disabled = true;
      try { await db.auth.signIn('demo@sungong.app', 'sungong-demo-2026'); S.route = 'boot'; render(); await afterLogin(); }
      catch (err) { toast(msg(err)); t.disabled = false; }
      return;
    }
    case 'signout': await db.auth.signOut(); return;
    case 'pick': R.subjectId = v; render(); return;
    case 'pickTodo': R.todoId = R.todoId === v ? null : v; render(); return;
    case 'goal': R.goalMin = Math.max(5, Math.min(180, R.goalMin + Number(v))); render(); return;
    case 'togglePomo': R.pomodoro = !R.pomodoro; render(); return;
    case 'fast': S.fast = !S.fast; localStorage.setItem('fast', S.fast ? '1' : '0');
      S.detector?.stop?.(); S.detector = null; render(); ensurePreview(); return;
    case 'toggleCam': {
      const on = !(S.profile.cam_enabled !== false);
      S.profile = await db.updateProfile({ cam_enabled: on }).catch(() => S.profile);
      S.detector?.stop?.(); S.detector = null; render();
      if (on && S.route === 'ready') ensurePreview();
      return;
    }
    case 'toggleDrowsy': {
      if (S.profile.cam_enabled === false) return;
      S.profile = await db.updateProfile({ drowsy_enabled: !(S.profile.drowsy_enabled !== false) }).catch(() => S.profile);
      S.detector?.stop?.(); S.detector = null; render();
      if (S.route === 'ready') ensurePreview();
      return;
    }
    case 'begin': beginSession(); return;
    case 'stop': stopSession(); return;
    case 'manualAway': {
      const f = S.focus; if (!f) return;
      if (f.state === 'ok') onDetState('away', 'ok'); else onDetState('ok', f.state);
      return;
    }
    case 'resumeNow': { const f = S.focus; if (f) { S.detector && (S.detector.state = 'ok'); onDetState('ok', f.state); } return; }
    case 'falsePositive': falsePositive(); return;
    case 'skipBreak': endBreak(); return;
    case 'revert': {
      try { await db.revertSpan(v); S.result = await db.sessionDetail(S.result.session.id); render(); toast('순공시간으로 되돌렸어요'); }
      catch (err) { toast(msg(err)); } return;
    }
    case 'save': await loadHome(); go('home'); toast('기록을 저장했어요'); return;
    case 'discard': {
      try { await db.discardSession(S.result.session.id); } catch {}
      await loadHome(); go('home'); toast('세션을 버렸어요'); return;
    }
    case 'day': loadDay(v); return;
    case 'month': loadCalendar(Number(v)); return;
    case 'todo': {
      const done = t.dataset.done === '1';
      try {
        await db.toggleTodo(v, !done);
        if (S.route === 'planner') loadPlanner(); else { await loadHome(); render(); }
      } catch (err) { toast(msg(err)); } return;
    }
    case 'sheetAdd': toast('할 일 추가는 다음 버전에서 열립니다'); return;
    case 'corrections': toast(S.corr?.length ? `정정 ${S.corr.length}건 — 되돌린 구간은 순공시간에 이미 반영돼 있습니다` : '아직 되돌린 구간이 없습니다'); return;
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && S.route === 'auth') app.querySelector('[data-a="auth"]')?.click();
});
window.addEventListener('beforeunload', () => { S.detector?.stop?.(); });

boot();
