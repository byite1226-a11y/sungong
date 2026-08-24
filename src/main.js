import * as db from './db.js';
import { Detector, ManualDetector } from './detect.js';
import { ic, clock, mmss, hm, hmSplit, hmc, ring, el, esc, toast,
         kstToday, mondayOf, DOW, dowOf, hhmm, SPAN, pad } from './ui.js';

const app = document.getElementById('app');

const S = {
  route: 'boot',
  user: null, profile: null, subjects: [],
  home: null, wkSum: null, cal: null, week: null, plan: null, stats: null,
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
async function loadHome() {
  const mon = mondayOf();
  const sun = new Date(new Date(mon + 'T00:00:00Z').getTime() + 6 * 864e5).toISOString().slice(0, 10);
  const [home, wk] = await Promise.all([
    db.today().catch(() => null),
    db.rangeSummary(mon, sun).catch(() => null),
  ]);
  S.home = home; S.wkSum = wk;
}

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
  if (S.route === 'focus' || S.route === 'ready') mountCam();
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
  const raw   = goalSec ? h.net_sec / goalSec : 0;
  const over  = raw > 1;
  const diff  = h.net_sec - (h.yesterday_net_sec || 0);
  const todos = h.todos || [];
  const done  = todos.filter(t => t.done_at).length;
  const empty = h.net_sec === 0 && h.session_count === 0;

  return `<div class="scroll pb">
    <div class="appbar" style="align-items:flex-start;padding-top:10px">
      <div class="grow">
        <div class="h1">오늘</div>
        <div class="cap" style="margin-top:6px">${todayLabel()}</div>
      </div>
      <button class="icon-btn" data-a="go" data-v="settings" aria-label="설정">${ic('gear', 19)}</button>
    </div>

    <div class="pad">
     <div class="two home">
      <div class="g11">
      <div class="card p" style="padding:24px 18px 20px;animation:riseIn .4s cubic-bezier(0,.9,.3,1) both">
        <div class="ring-wrap" style="margin:0 auto;width:202px">
          ${ring(Math.min(1, raw), { size: 202, sw: 14, boot: true, outer: over ? raw - 1 : 0 })}
          <div class="in" style="padding:0 32px">
            ${empty
              ? `<div class="h3">아직 오늘 기록이 없어요</div>
                 <div class="cap" style="margin-top:6px">첫 세션을 시작하면 여기에 쌓입니다</div>`
              : `<div class="lbl">오늘 순공시간</div>
                 <div style="margin-top:4px">${hmSplit(h.net_sec)}</div>
                 <div class="cap" style="margin-top:6px;color:var(--tx-2)">목표 ${hm(goalSec)} · ${Math.round(raw * 100)}%</div>`}
          </div>
        </div>
        <div style="height:1px;background:var(--line);margin:20px 0 16px"></div>
        ${empty
          ? `<div class="cap" style="text-align:center">기록이 시작되면 연속 일수가 여기에 표시됩니다</div>`
          : `<div class="row" style="gap:8px">
              ${h.streak?.current ? `<span class="pill acc">${ic('bolt', 12, 2.2)}${h.streak.current}일 연속</span>` : ''}
              <span class="pill mut num">어제 ${diff >= 0 ? '+' : '−'}${hm(Math.abs(diff))}</span>
              <div class="cap" style="margin-left:auto;white-space:nowrap">세션 ${h.session_count}회</div>
            </div>`}
      </div>

      <button class="btn start" style="margin-top:14px" data-a="go" data-v="ready">${ic('play', 18)} 지금 집중 시작</button>
      </div>

      ${weekCard()}

      <div class="g22 sec">
        <div class="sec-head">
          <div class="row" style="gap:8px;align-items:baseline">
            <div class="h2">오늘 할 일</div>
            ${todos.length ? `<span class="num" style="font-size:13px;font-weight:650;color:var(--tx-3)">${done}/${todos.length}</span>` : ''}
          </div>
          <button class="cap" style="color:var(--pri);font-size:13px;font-weight:650" data-a="go" data-v="planner">플래너</button>
        </div>
        ${todos.length
          ? `<div class="card" style="padding:2px 16px;animation:riseIn .4s cubic-bezier(0,.9,.3,1) 60ms both">
               ${todos.map((t, i) => todoRow(t, i > 0)).join('')}</div>`
          : `<div class="card"><div class="empty">
               <svg width="96" height="56" viewBox="0 0 96 56" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                 <rect x="14" y="10" width="36" height="36" rx="9" stroke="var(--pri)"/>
                 <path d="M25 28l6 6 10-11" stroke="var(--pri)"/>
                 <rect x="58" y="16" width="24" height="24" rx="8" stroke="var(--tx-3)" stroke-dasharray="4 5"/>
               </svg>
               <div style="font-size:13px;line-height:1.55;color:var(--tx-2)">오늘 계획한 일이 없어요</div>
               <button class="btn sm" style="margin-top:14px;width:auto;padding:0 18px;background:var(--pri-weak);color:var(--pri);font-size:13.5px;font-weight:700"
                 data-a="go" data-v="planner">${ic('plus', 15, 2.2)} 할 일 추가</button>
             </div></div>`}
      </div>

      <div class="g13 sec">
        <div class="card p tint-ok row" style="gap:12px" data-a="go" data-v="settings">
          <div class="ico ok tile">${ic('shield', 19)}</div>
          <div class="grow">
            <div class="h3">얼굴 이미지는 저장되지 않습니다</div>
            <div style="margin-top:4px;font-size:13px;line-height:1.55;color:var(--tx-2)">카메라는 기기 안에서만 착석과 졸음을 판단하고 즉시 버립니다. 남는 것은 앉아 있던 시간뿐입니다.</div>
          </div>
          <div style="color:var(--tx-3);flex:none">${ic('right', 18)}</div>
        </div>
      </div>
     </div>
    </div>
  </div>${tabbar('home')}`;
}

/* 이번 주 — 순공 합계 · 지난주 대비 · 요일별 막대 7칸 */
function weekCard() {
  const r = S.wkSum;
  const head = `<div class="sec-head">
      <div class="h2">이번 주</div>
      <button class="cap" style="color:var(--pri);font-size:13px;font-weight:650" data-a="go" data-v="stats">기록 전체</button>
    </div>`;

  if (!r) return `<div class="g21 sec">${head}
    <div class="card p">
      <div class="shim" style="height:14px;width:60%"></div>
      <div class="shim" style="height:72px;margin-top:12px;border-radius:12px"></div>
    </div></div>`;

  if (!r.total_sec) return `<div class="g21 sec">${head}
    <div class="card"><div class="empty">
      <svg width="104" height="56" viewBox="0 0 104 56" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 50h92" stroke="var(--tx-3)"/>
        <rect x="18" y="30" width="12" height="20" rx="4" stroke="var(--tx-3)"/>
        <rect x="46" y="14" width="12" height="36" rx="4" stroke="var(--pri)"/>
        <rect x="74" y="38" width="12" height="12" rx="4" stroke="var(--tx-3)"/>
      </svg>
      <div style="font-size:13px;line-height:1.55;color:var(--tx-2)">아직 이번 주 기록이 없어요.<br>세션이 끝나면 요일별로 쌓입니다.</div>
    </div></div></div>`;

  const byDow = Object.fromEntries((r.by_weekday || []).map(d => [d.isodow, d.net_sec]));
  const max   = Math.max(1, ...Object.values(byDow));
  const diff  = r.total_sec - (r.prev_total_sec || 0);
  const mon   = mondayOf(), today = kstToday();

  return `<div class="g21 sec">${head}
    <div class="card p" style="animation:riseIn .4s cubic-bezier(0,.9,.3,1) 30ms both">
      <div class="between" style="align-items:flex-start">
        <div>
          <div class="lbl">순공 합계</div>
          <div style="margin-top:4px">${hmSplit(r.total_sec, 17.5, 12, 3)}</div>
        </div>
        ${r.prev_total_sec
          ? `<span class="pill ${diff >= 0 ? 'ok' : 'mut'} num">지난주 ${diff >= 0 ? '+' : '−'}${hm(Math.abs(diff))}</span>`
          : `<span class="pill mut">비교할 지난주 기록 없음</span>`}
      </div>
      <div class="row" style="gap:7px;margin-top:16px;align-items:stretch">
        ${DOW.map((d, i) => {
          const iso    = new Date(new Date(mon + 'T00:00:00Z').getTime() + i * 864e5).toISOString().slice(0, 10);
          const v      = byDow[i + 1] || 0;
          const future = iso > today;
          const cls    = future ? 'dim' : iso === today ? 'now' : '';
          const pctH   = v && !future ? Math.max(5, v / max * 100) : 5;
          return `<div class="bar ${cls}" style="flex:1;min-width:0;height:auto;gap:0">
            <div style="height:72px;width:100%;display:flex;align-items:flex-end"><i style="height:${pctH}%"></i></div>
            <span style="margin-top:6px">${d}</span></div>`;
        }).join('')}
      </div>
    </div></div>`;
}


function todayLabel() {
  const d = kstToday();
  return `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일 ${dowOf(d)}요일`;
}

/* 취소선은 제목 span 안의 absolute 바로 — 글자 폭이 변하지 않아 옆 요소를 밀지 않는다 (디자인 10 §1) */
function strikeTitle(text, on) {
  return `<span style="position:relative;display:inline-block;max-width:100%">
    <span style="display:block;${on ? 'color:var(--tx-3)' : ''};transition:color .18s">${esc(text)}</span>
    <span style="position:absolute;left:0;top:52%;height:1.5px;border-radius:1px;background:var(--tx-3);
      width:${on ? '100%' : '0'};transition:width 220ms cubic-bezier(.2,.8,.25,1)"></span>
  </span>`;
}

function todoRow(t, divider) {
  const pct  = t.plan_min ? Math.min(1, t.actual_min / t.plan_min) : 0;
  const over = t.plan_min && t.actual_min > t.plan_min;
  const c    = subColor(t.subject_id);
  const on   = !!t.done_at;
  return `${divider ? '<div style="height:1px;background:var(--line);margin-left:34px"></div>' : ''}
    <div class="row" style="gap:12px;padding:14px 0" data-a="todo" data-v="${t.id}" data-done="${on ? 1 : 0}">
      <div style="width:22px;height:22px;flex:none;border-radius:7px;display:grid;place-items:center;
        border:1.8px solid ${on ? 'var(--pri)' : 'var(--line)'};background:${on ? 'var(--pri)' : 'var(--surface)'};
        transition:background .18s,border-color .18s">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.6"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke-dasharray="22" stroke-dashoffset="${on ? 0 : 22}"
            style="transition:stroke-dashoffset 180ms cubic-bezier(.2,.8,.25,1)"/>
        </svg>
      </div>
      <div class="grow">
        <div class="h3">${strikeTitle(t.title, on)}</div>
        <div class="row" style="gap:6px;margin-top:5px">
          <i style="width:7px;height:7px;flex:none;border-radius:99px;background:${c};display:block"></i>
          <span class="cap">${esc(subName(t.subject_id))}</span>
          <span class="meter fix" style="margin-left:4px"><i style="width:${pct * 100}%;background:${c}"></i></span>
          ${over ? '<i style="width:3px;height:5px;border-radius:2px;background:var(--acc);display:block"></i>' : ''}
        </div>
      </div>
      <div class="num" style="font-size:13px;font-weight:650;color:var(--tx-2);white-space:nowrap;text-align:right;min-width:64px">
        ${t.actual_min}<span style="color:var(--tx-3)">/${t.plan_min}분</span>
      </div>
    </div>`;
}


function tabbar(active) {
  const t = [['home', '홈', 'home'], ['calendar', '캘린더', 'cal'], ['planner', '플래너', 'check_sq'], ['stats', '기록', 'chart']];
  return `<div class="tabbar">${t.map(([id, label, icon]) => `
    <button class="tab ${active === id ? 'on' : ''}" data-a="go" data-v="${id}">
      ${ic(icon, 23, 1.8)}<span>${label}</span></button>`).join('')}</div>`;
}

/* ── 집중 준비 ── */
const R = { subjectId: null, goalMin: 30, todoId: null, pomodoro: false };
/* ── 집중 준비 ─────────────────────────────────────────────
   아트보드 「02 집중 시작 준비」 조판 이식.
   R(과목·목표 시간·할 일·포모도로)은 main.js 의 기존 선언을 그대로 쓴다:
     const R = { subjectId: null, goalMin: 30, todoId: null, pomodoro: false };
   액션은 기존 것만 쓴다 — go/home · pick · pickTodo · goal · toggleCam ·
   toggleDrowsy · togglePomo · fast · begin. 새로 만든 것 없음.            */

function vReady() {
  const p = S.profile || {};
  const cam = p.cam_enabled !== false;
  /* 카메라를 켜 뒀는데 detector 가 수동으로 떨어졌다 = 카메라를 못 열었다는 뜻.
     ensurePreview() 가 실패할 때만 만들어지는 상태라 여기서 읽기만 한다. */
  const denied  = cam && !!S.detector?.manual;
  const camLive = cam && !denied;
  const drowsy  = camLive && p.drowsy_enabled !== false;   // 착석이 죽으면 졸음도 죽는다
  const focusMin = p.pomodoro_focus_min || 25;
  const restMin  = p.pomodoro_break_min || 5;

  if (!R.subjectId && S.subjects[0]) R.subjectId = S.subjects[0].id;
  const undone = (S.home?.todos || []).filter(t => !t.done_at);
  const todos  = undone.slice(0, 3);
  const only   = undone.length === 1;   // 아트보드 '남은 유일한 할 일'

  /* 포모도로 리듬 미리보기 — 집중/휴식 길이를 flex 비율로 그린다 */
  const rhythm = [0, 1, 2, 3].map(() =>
    `<i style="flex:${focusMin};min-width:10px;height:8px;border-radius:4px;background:var(--pri);display:block"></i>
     <i style="flex:${restMin};min-width:4px;height:8px;border-radius:4px;background:var(--tx-3);opacity:.4;display:block"></i>`
  ).join('');

  return `<div class="scroll pba">
    <div class="appbar">
      <button class="icon-btn" data-a="go" data-v="home" aria-label="뒤로"
        style="background:transparent;border:none;color:var(--tx-2);margin-left:-8px">${ic('left', 19)}</button>
      <div class="h1">집중 시작</div>
    </div>
    <div class="pad">

      <div style="margin-top:24px">
        <div class="lbl" style="margin-bottom:11px">과목</div>
        <div class="chips" style="gap:8px">${S.subjects.map(subjChip).join('')}</div>
      </div>

      ${todos.length ? `<div class="sec">
        <div class="between" style="align-items:baseline;margin-bottom:11px">
          <div class="lbl">연결할 할 일</div>
          <span style="font-size:11.5px;color:var(--tx-3)">선택</span>
        </div>
        <div class="card" style="padding:0 16px">
          ${todos.map((t, i) => todoPick(t, i > 0, only)).join('')}
        </div>
        ${noTodoRow()}
      </div>` : ''}

      <div class="sec">
        <div class="lbl" style="margin-bottom:11px">측정 방식</div>
        <div class="card" style="padding:14px 16px">

          <div class="row" style="gap:12px" data-a="toggleCam">
            <div class="ico" style="width:36px;height:36px;border-radius:12px">${ic('cam', 18)}</div>
            <div class="grow">
              <div class="h3">카메라 착석 감지</div>
              <div style="margin-top:2px;font-size:13px;line-height:1.55;color:var(--tx-3)">자리를 비우면 타이머가 자동으로 멈춥니다</div>
            </div>
            <div class="sw ${cam ? 'on' : ''}"><i></i></div>
          </div>

          <div class="divider" style="margin:12px 0 12px 48px"></div>

          <!-- 착석 감지가 꺼져 있으면(또는 카메라를 못 열었으면) 자동으로 비활성 40% + 스위치 잠금 -->
          <div class="row" style="gap:12px;${camLive ? '' : 'opacity:.4;pointer-events:none'}" data-a="toggleDrowsy">
            <div class="ico" style="width:36px;height:36px;border-radius:12px">${ic('eye', 18)}</div>
            <div class="grow">
              <div class="h3">졸음 감지</div>
              <div style="margin-top:2px;font-size:13px;line-height:1.55;color:var(--tx-3)">
                ${camLive ? '눈을 감거나 책상에 엎드리면 그 시간이 빠집니다' : '착석 감지를 켜야 졸음도 볼 수 있어요'}</div>
            </div>
            <div class="sw ${drowsy ? 'on' : ''} ${camLive ? '' : 'lock'}"><i></i></div>
          </div>

          ${camLive ? `<div style="padding-top:12px">
            <div class="cam" id="camslot" style="height:112px;border:0;
              background:linear-gradient(180deg,var(--pri-weak),transparent 70%),var(--sunk)">
              <div class="scan" style="opacity:.5"></div>
              <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>
              <span class="pill ok badge" id="camstate" style="top:8px;right:28px;left:auto;transform:none">준비 중</span>
              <div id="camph" style="z-index:2;display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--tx-2)">
                ${ic('seat', 26)}
                <div style="font-size:11.5px;color:var(--tx-2)">기기 안에서만 분석 · 저장 없음</div>
              </div>
            </div></div>`
          : denied ? `<div style="padding-top:12px">
            <div style="min-height:112px;border-radius:18px;background:var(--sunk);display:flex;flex-direction:column;
              align-items:center;justify-content:center;gap:8px;text-align:center;padding:14px 16px">
              <div class="row" style="gap:8px">
                <span style="color:var(--acc)">${ic('alert', 18)}</span>
                <span class="h3">${S.camFail === 'denied' ? '카메라 권한이 막혀 있어요'
                  : S.camFail === 'model' ? '감지 모델을 불러오지 못했어요'
                  : '카메라를 켤 수 없어요'}</span>
              </div>
              <div style="font-size:13px;line-height:1.55;color:var(--tx-2)">${
                S.camFail === 'denied'
                  ? '주소창의 자물쇠(또는 ⋮ 메뉴) → 사이트 설정 → 카메라를 허용으로 바꾼 뒤 다시 시도하세요'
                  : S.camFail === 'model'
                    ? '네트워크가 느리거나 끊겼을 수 있어요. 연결을 확인하고 다시 시도하세요'
                    : '다른 앱이 카메라를 쓰고 있지 않은지 확인해 주세요'}</div>
              <div class="row" style="gap:8px">
                <button class="btn sm" data-a="retryCam"
                  style="width:auto;height:36px;padding:0 14px;border-radius:12px;background:var(--pri-weak);
                  color:var(--pri-weak-tx);font-size:12.5px;font-weight:700">다시 시도</button>
                <span class="cap">지금도 수동 모드로는 시작할 수 있어요</span>
              </div>
            </div></div>`
          : `<div style="padding:12px 2px 2px;font-size:13px;line-height:1.55;color:var(--tx-2)">수동 모드에서는 시작·정지를 직접 눌러 순공시간을 기록합니다</div>`}
        </div>
      </div>

      ${R.pomodoro ? '' : `<div class="sec">
        <div class="lbl" style="margin-bottom:11px">목표 시간</div>
        <div class="card row" style="padding:14px 16px;gap:12px">
          ${stepBtn('minus', { a: 'goal', v: '-5', dis: R.goalMin <= 5, label: '줄이기' })}
          <div class="grow" style="text-align:center">
            <div class="num" style="display:inline-flex;align-items:baseline;white-space:nowrap;letter-spacing:-.03em">
              <span style="font-size:22px;font-weight:800">${R.goalMin}</span><span style="font-size:13px;font-weight:700;margin-left:2px">분</span>
            </div>
            <div style="margin-top:2px;font-size:11.5px;color:var(--tx-3)">권장 25~50분</div>
          </div>
          ${stepBtn('plus', { a: 'goal', v: '5', dis: R.goalMin >= 180, label: '늘리기' })}
        </div>
      </div>`}

      <div class="sec">
        <div class="between" data-a="togglePomo">
          <div class="lbl">포모도로</div>
          <div class="sw ${R.pomodoro ? 'on' : ''}"><i></i></div>
        </div>
        <div class="card" style="margin-top:11px;padding:14px 16px">
          ${R.pomodoro
            ? `<div class="row" style="gap:12px;align-items:stretch">
                 ${pomoLen('집중', focusMin)}${pomoLen('휴식', restMin)}
               </div>
               <div style="margin-top:10px;font-size:11.5px;color:var(--tx-3)">4회 반복이 한 세트</div>
               <div class="row" style="gap:2px;margin-top:8px">${rhythm}</div>`
            : `<div style="font-size:13px;line-height:1.55;color:var(--tx-2)">${focusMin}분 집중하고 ${restMin}분 쉬는 것을 반복합니다</div>`}
        </div>
      </div>

      <div class="sec">
        <div class="card p tint-ok">
          <div class="row" style="gap:10px">
            <span style="color:var(--ok)">${ic('shield', 19)}</span>
            <div class="h3">카메라를 켜기 전에</div>
          </div>
          <ul style="margin-top:12px;list-style:none;display:flex;flex-direction:column;gap:10px">
            ${['얼굴 이미지는 기기를 떠나지 않고, 판단 직후 즉시 폐기됩니다',
               '저장되는 것은 구간의 종류와 시각뿐입니다',
               ...(drowsy ? ['졸음 판정에도 같은 원칙이 적용됩니다'] : []),
               '언제든 수동 모드로 바꾸거나 감지를 끌 수 있습니다']
              .map(s => `<li style="display:flex;gap:8px;font-size:13px;line-height:1.55;color:var(--tx-2)">
                <span style="color:var(--ok);flex:0 0 14px;margin-top:3px">${ic('check', 14, 2.2)}</span>${s}</li>`).join('')}
          </ul>
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
  <div class="actionbar"><button class="btn start" data-a="begin">${ic('play', 18)} 시작하기</button></div>`;
}

/* 과목 칩 — 색은 subject 레코드의 값 그대로(색각 검증본). 선택 시 pri-weak 바탕 + pri 테두리 */
function subjChip(s) {
  const on = R.subjectId === s.id;
  return `<button class="chip" data-a="pick" data-v="${s.id}"
    style="display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:11px;
      font-size:13.5px;font-weight:${on ? 700 : 600};
      background:${on ? 'var(--pri-weak)' : 'var(--surface)'};
      border:1.5px solid ${on ? 'var(--pri)' : 'var(--line)'};
      color:${on ? 'var(--pri-weak-tx)' : 'var(--tx-2)'}">
    <i style="width:8px;height:8px;flex:0 0 8px;border-radius:99px;background:${s.color};display:block"></i>${esc(s.name)}</button>`;
}

/* 연결할 할 일 한 줄 — 선택되면 pri 원형 체크 */
function todoPick(t, divider, only) {
  const c = subColor(t.subject_id);
  const on = R.todoId === t.id;
  return `${divider ? '<div class="divider" style="margin-left:48px"></div>' : ''}
    <div class="row" style="gap:12px;padding:14px 0" data-a="pickTodo" data-v="${t.id}">
      <div class="ico" style="width:36px;height:36px;border-radius:12px;background:${c}1f;color:${c}">${ic('check_sq', 18)}</div>
      <div class="grow">
        <div class="h3">${esc(t.title)}</div>
        <div style="margin-top:2px;font-size:13px;line-height:1.55;color:var(--tx-3)">오늘 · 목표 ${t.plan_min}분${only ? ' · 남은 유일한 할 일' : ''}</div>
      </div>
      ${pickMark(on)}
    </div>`;
}

/* '할 일 없이 시작' — 아트보드의 미선택 상태. 이미 그 상태면 표시만 하고,
   할 일이 걸려 있으면 같은 pickTodo 로 그 선택을 푼다(토글) */
function noTodoRow() {
  const off = !R.todoId;
  return `<div class="row" ${off ? '' : `data-a="pickTodo" data-v="${R.todoId}"`}
    style="gap:12px;margin-top:8px;padding:14px 16px;border:1.5px dashed var(--line);border-radius:20px;
      color:var(--tx-${off ? '2' : '3'})">
    <div style="flex:0 0 36px;height:36px;border-radius:12px;background:var(--sunk);display:grid;place-items:center">${ic('plus', 18)}</div>
    <div class="grow" style="font-size:14.5px;font-weight:600;letter-spacing:-.02em">할 일 없이 시작</div>
    ${off ? pickMark(true) : ic('right', 18)}
  </div>`;
}

const pickMark = (on) => `<div style="flex:0 0 22px;height:22px;border-radius:99px;display:grid;place-items:center;color:#fff;
  background:${on ? 'var(--pri)' : 'transparent'};border:${on ? 'none' : '1.8px solid var(--line)'}">${on ? ic('check', 13, 2.6) : ''}</div>`;

/* 스텝퍼 버튼 — 목표 시간은 44px, 포모도로 길이는 36px. 한계값·조작 불가면 40% */
function stepBtn(icon, o = {}) {
  const s = o.sm ? 36 : 44;
  return `<button class="icon-btn" ${o.a ? `data-a="${o.a}" data-v="${o.v}"` : 'disabled'} aria-label="${o.label}"
    style="width:${s}px;height:${s}px;flex:0 0 ${s}px;border-radius:${o.sm ? 11 : 13}px;
      border:${o.sm ? 'none' : '1px solid var(--line)'};background:var(--${o.sm ? 'surface' : 'sunk'});
      color:var(--tx-2);${o.dis ? 'opacity:.4;pointer-events:none' : ''}">${ic(icon, o.sm ? 16 : 18, 2)}</button>`;
}

/* 포모도로 집중·휴식 길이 — 프로필 값을 보여준다.
   이 화면에는 값을 바꾸는 액션이 없어 ± 는 비활성으로 둔다(설정에서 바꾼다) */
function pomoLen(label, min) {
  return `<div class="row grow" style="gap:6px;background:var(--sunk);border-radius:13px;padding:6px">
    ${stepBtn('minus', { sm: true, dis: true, label: `${label} 줄이기` })}
    <div class="grow" style="text-align:center">
      <div style="font-size:10.5px;font-weight:700;color:var(--tx-3)">${label}</div>
      <div class="num" style="display:inline-flex;align-items:baseline;white-space:nowrap">
        <span style="font-size:15px;font-weight:800">${min}</span><span style="font-size:11px;font-weight:700;margin-left:1px">분</span></div>
    </div>
    ${stepBtn('plus', { sm: true, dis: true, label: `${label} 늘리기` })}
  </div>`;
}

/* 새 클래스 필요: .sub-3 { font-size:13px;line-height:1.55;color:var(--tx-3) }
   — 카드 안 보조 설명(착석·졸음·할 일)에서 3회 반복된다. .sub 는 --tx-2 라 대체 불가. */

/* ── 집중 중 · 자리 비움 · 졸음 · 휴식 ── */
/* ── 집중 중 · 자리 비움 · 졸음 · 휴식 ─────────────────────────────
   아트보드 03·04·05·06 은 한 함수의 네 상태다. 헤더(칩+닫기) · 링 250 · 타이머 슬롯은
   상태와 무관하게 같은 자리에 그대로 두고, 배경 톤과 카드·문구만 갈아 끼운다.
   배경 전환 260ms 는 render() 가 .app 에 붙이는 tone-acc/tone-sunk 가 맡는다
   (.app 은 재렌더에도 살아 있는 엘리먼트라 transition:background .26s 가 실제로 돈다).
   → 화면이 바뀌는 게 아니라 같은 화면의 상태가 바뀌는 것으로 읽힌다. */

/* 타이머 조판 — 콜론만 0.85배·opacity .55 로 눌러 자릿수가 먼저 읽히게 한다.
   ※ tick() 이 patch('#tmr', …) 로 textContent 를 덮으므로 ok·break 에서는 1초 뒤 평문이 된다.
     away·drowsy 는 #tmr 을 건드리지 않아 이 조판이 그대로 남는다. */
function tdigits(s) {
  return String(s).split(':')
    .map(p => `<span>${p}</span>`)
    .join('<span style="font-size:.85em;opacity:.55;margin:0 .02em">:</span>');
}

/* 감지 경고 점 — 점멸(깜빡임)이 아니라 1.6s 완만한 halo 페이드.
   점 본체는 항상 solid 로 두고 후광만 숨쉬게 해서 시야를 때리지 않는다. */
function warnDot(size = 9) {
  return `<span style="position:relative;display:block;flex:none;width:${size}px;height:${size}px;
    border-radius:99px;background:var(--acc)">
    <i style="position:absolute;inset:-4px;display:block;border-radius:99px;background:var(--acc);
      opacity:.28;animation:breathe 1.6s ease-in-out infinite"></i></span>`;
}

/* 포모도로 사이클 점 — .cycle i 가 7px. 긴 휴식 직전(4번째) 점만 주황 테두리.
   휴식 화면에서는 muted 로 꺼서 화면에 주황이 한 곳도 남지 않게 한다. */
function cycleDots(f, muted) {
  return `<div class="cycle">${[0, 1, 2, 3].map(i =>
    `<i class="${i < f.cycle ? 'on' : ''} ${!muted && i === 3 && f.cycle < 4 ? 'next' : ''}"></i>`).join('')}</div>`;
}

/* 카메라 꺼짐 — 아이콘 목록에 슬래시 달린 cam 이 없어 아트보드 06 의 path 를 그대로 쓴다 */
const camOffIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="flex:none">
  <path d="M4 8.5a2 2 0 0 1 2-2h1.6l1.2-1.8a1.5 1.5 0 0 1 1.2-.7h4a1.5 1.5 0 0 1 1.2.7l1.2 1.8H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>
  <path d="M4.5 4.5l15 15"/></svg>`;

function vFocus() {
  const f = S.focus; if (!f) return vBoot();
  const st  = f.state;                       // ok | away | drowsy | break
  const acc = st === 'away' || st === 'drowsy';
  const brk = st === 'break';
  const det = S.detector;
  const manual = !!det?.manual;

  /* 졸음 '의심' — 감지기가 drowsy 를 재는 중(pending)일 뿐 아직 확정 전.
     카드만 주황으로 두고 링·타이머·배경은 손대지 않는다 → 화면이 번쩍이지 않는다. */
  const suspect = !acc && !brk && det?.pending === 'drowsy';
  /* 엎드림 = 얼굴은 안 보이는데 Pose 가 상체를 잡은 경우. 눈 감김과 화면 문구가 다르다 */
  const slumped = st === 'drowsy' && (det?.reason === 'slump' || det?.last?.reason === 'slump');

  const goalSec = Math.max(1, (f.goalMin || 30) * 60);
  const raw     = f.net / goalSec;
  const goalHit = raw >= 1;
  const ringPct = brk ? f.breakLeft / (f.breakSec || 300) : Math.min(1, raw);
  const ringColor = brk ? 'var(--tx-3)' : acc ? 'var(--acc)' : 'var(--pri)';
  const label   = brk ? '휴식' : st === 'away' ? '멈춤' : st === 'drowsy' ? '졸음' : '순공시간';

  /* 링 안 캡션 — tick() 이 #sub 에 쓰는 문자열과 글자까지 같아야 1초 뒤 흔들리지 않는다 */
  const subTxt = brk ? `${f.cycle + 1}번째 집중까지`
    : acc ? `${st === 'away' ? '비운 시간' : '감지된 시간'} ${clock(f.offSec)}`
    : `총 ${clock(f.gross)} · 목표 ${f.goalMin}분`;

  /* 감지 상태 3종 — 얼굴 없음 / 눈 감김 / 착석. 수동 모드는 네 번째 문구. */
  const camLabel = manual ? '수동 기록 중'
    : !det?.last?.present ? '얼굴이 보이지 않아요'
    : det.last.blink > 0.5 ? '눈 감김 감지'
    : '착석 확인 중';

  const toBreak = f.pomodoro ? Math.max(0, Math.ceil((goalSec * (f.cycle + 1) - f.net) / 60)) : 0;

  return `<div class="scroll" style="padding-bottom:24px">
    <div class="pad">

      <div class="between" style="padding:4px 0 22px">
        <div class="row" style="gap:8px">
          <span class="pill ${acc ? 'acc' : brk ? 'mut' : 'pri'}">
            ${brk ? ic('coffee', 13, 2)
              : st === 'drowsy' ? ic('eye', 13, 2)
              : `<i style="width:7px;height:7px;border-radius:99px;background:${subColor(f.subjectId)};display:block"></i>`}
            ${brk ? '휴식' : esc(subName(f.subjectId))}${st === 'away' ? ' · 일시정지' : st === 'drowsy' ? ' · 졸음' : ''}</span>
          ${goalHit && !brk ? `<span class="pill acc">목표 달성</span>` : ''}
        </div>
        <button class="icon-btn" data-a="stop" aria-label="종료">${ic('x', 18, 2.1)}</button>
      </div>

      <div class="ring-wrap" style="margin:0 auto;width:250px">
        ${ring(ringPct, { size: 250, sw: 10, color: ringColor, outer: !brk && raw > 1 ? raw - 1 : 0 })}
        <div class="in">
          <div class="lbl" style="margin-bottom:7px;transition:color 260ms${acc ? ';color:var(--acc-tx)' : ''}">${label}</div>
          <div class="display num" id="tmr" style="display:flex;align-items:baseline;justify-content:center;
            white-space:nowrap;transition:opacity 200ms${acc ? ';opacity:.45' : ''}">${tdigits(brk ? mmss(f.breakLeft) : clock(f.net))}</div>
          <div class="cap num" id="sub" style="margin-top:9px${acc ? ';color:var(--acc-tx);font-weight:700' : ''}">${subTxt}</div>
        </div>
      </div>

      ${f.pomodoro && !brk ? `<div style="margin-top:16px">
        ${cycleDots(f, false)}
        <div class="cap" style="text-align:center;margin-top:7px">${f.cycle}/4 사이클 · ${f.cycle + 1}번째 집중 중${acc ? '' : ` · 다음 휴식까지 ${toBreak}분`}</div>
      </div>` : ''}

      ${brk ? `
        <div class="card p" style="margin-top:22px">
          <div class="between">
            ${cycleDots(f, true)}
            <div class="cap" style="white-space:nowrap">${f.cycle}/4 사이클 · 쉬는 중</div>
          </div>
          ${S.home ? `
            <div class="divider" style="margin:12px 0"></div>
            <div class="between" style="align-items:baseline">
              <span class="lbl">오늘 순공시간</span>
              <span class="cap num" style="color:var(--tx-2);font-weight:700;white-space:nowrap">${hm((S.home.net_sec || 0) + f.net)} / ${hm((S.home.goal_min || 300) * 60)}</span>
            </div>
            <div class="meter" style="margin-top:8px"><i style="width:${Math.min(100, ((S.home.net_sec || 0) + f.net) / Math.max(1, (S.home.goal_min || 300) * 60) * 100).toFixed(1)}%"></i></div>` : ''}
        </div>
        <div class="card p row" style="margin-top:12px;gap:10px">
          <div style="color:var(--tx-3);display:flex">${camOffIcon}</div>
          <div class="grow" style="font-size:13px;line-height:1.55;color:var(--tx-2)">휴식 중에는 카메라가 꺼집니다</div>
        </div>
        <div class="btn-row" style="margin-top:20px">
          <button class="btn soft" style="flex:1;font-size:15.5px" data-a="skipBreak">${ic('play', 17, 1.75)} 휴식 건너뛰기</button>
          <button class="btn soft" style="flex:1;font-size:15.5px" data-a="stop">${ic('stop', 17, 1.75)} 세션 종료</button>
        </div>
        <div class="cap" style="text-align:center;margin-top:14px">휴식 시간은 순공시간에 포함되지 않습니다</div>

      ` : acc ? `
        <div class="card" style="margin-top:22px;padding:14px 16px;border:1.5px solid var(--acc);background:var(--surface);
          transition:background 260ms cubic-bezier(.2,.8,.25,1),border-color 260ms">
          <div class="row" style="gap:10px;align-items:flex-start">
            ${warnDot(9)}
            <div class="grow" style="margin-top:-2px">
              <div class="h3">${st === 'away' ? '자리를 비운 것 같아요'
                : slumped ? '책상에 엎드린 것 같아요' : '졸고 있는 것 같아요'}</div>
              <div style="margin-top:6px;font-size:13px;line-height:1.55;color:var(--tx-2)">${st === 'away'
                ? '돌아와 앉으면 자동으로 다시 이어서 잽니다. 이 시간은 순공시간에서 빠집니다.'
                : slumped
                  ? '얼굴은 안 보이는데 자리에는 계신 것 같아요. 이 시간은 순공시간에서 빠집니다.'
                  : '눈을 감은 채로 시간이 지났어요. 이 시간은 순공시간에서 빠집니다.'}</div>
            </div>
          </div>
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button class="btn" style="flex:1;font-size:15.5px;background:var(--pri-weak);color:var(--pri-weak-tx)"
            data-a="falsePositive">${ic('pencil', 17, 1.75)} 잘못 감지예요</button>
          <button class="btn" style="flex:1;font-size:15.5px;background:var(--acc);color:#FFFFFF;box-shadow:0 10px 24px -10px var(--acc)"
            data-a="resumeNow">${ic('play', 17, 1.75)} ${st === 'away' ? '이어서' : '깼어요'}</button>
        </div>
        ${f.offSec >= 300 ? `<button class="btn sm" style="margin-top:12px;background:transparent;border:1px solid var(--line);color:var(--tx-2);font-size:13.5px;font-weight:700;height:44px"
          data-a="stop">세션 종료하기</button>` : ''}
        <div class="cap" style="text-align:center;margin-top:14px;line-height:1.6">
          <span style="color:var(--tx-2);font-weight:650">'잘못 감지예요'</span>를 누르면 그 구간이 즉시 순공시간으로 되돌아가고,<br>${st === 'away'
            ? '같은 상황을 덜 잡도록 감도가 조정됩니다.'
            : '눈 감고 암기하는 습관을 덜 잡도록 감도가 조정됩니다.'}
        </div>

      ` : `
        <div class="card" style="margin-top:22px;padding:14px 16px;transition:background 260ms cubic-bezier(.2,.8,.25,1),border-color 260ms${
          suspect ? ';border:1.5px solid var(--acc)' : ''}">
          <div class="row" style="gap:10px">
            ${suspect ? warnDot(7) : `<span class="dot"${manual ? ' style="background:var(--pri)"' : ''}></span>`}
            <div class="h3 grow" id="camlabel">${camLabel}</div>
            ${manual ? '' : `<div class="cap num" id="cnt" style="white-space:nowrap">이탈 ${f.awayCount} · 졸음 ${f.drowsyCount}</div>`}
          </div>
          ${manual ? '' : `<div style="margin-top:12px"><div class="cam blur" id="camslot" style="height:96px">
            <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>
            <span class="pill ok badge">기기 처리 · 저장 없음</span>
          </div></div>`}
          <div class="divider" style="margin:12px 0 12px 24px"></div>
          <div class="cap" style="margin-left:24px">${manual
            ? '시작·정지를 직접 눌러 순공시간을 기록합니다'
            : '카메라 영상은 기기 밖으로 나가지 않으며 저장되지 않습니다'}</div>
        </div>

        ${f.todoTitle ? `<div class="card p" style="margin-top:12px">
          <div class="lbl" style="margin-bottom:8px">연결된 할 일</div>
          <div class="row" style="gap:8px">
            <i style="width:8px;height:8px;flex:none;border-radius:99px;background:${subColor(f.subjectId)};display:block"></i>
            <div class="h3 grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.todoTitle)}</div>
            <div class="cap num" id="todoMin" style="white-space:nowrap">${Math.floor(f.net / 60)}/${f.todoPlan}분</div></div>
          <div class="meter" style="margin-top:10px"><i id="todoBar" style="width:${
            Math.min(100, f.net / 60 / Math.max(1, f.todoPlan) * 100).toFixed(1)}%;background:${subColor(f.subjectId)}"></i></div>
        </div>` : ''}

        <div class="btn-row" style="margin-top:20px">
          <button class="btn" style="flex:1;background:var(--pri-weak);color:var(--pri-weak-tx)"
            data-a="manualAway">${ic('pause', 18, 2.4)} ${manual ? '자리 비움' : '일시정지'}</button>
          <button class="btn pri" style="flex:0 0 118px" data-a="stop">${ic('stop', 17, 1.75)} 종료</button>
        </div>
        <div class="cap" style="text-align:center;margin-top:14px">화면을 꺼도 측정은 계속됩니다</div>
      `}

    </div>
  </div>`;
}

/* 새 클래스 필요: @keyframes softFade { 0%,100%{opacity:1} 50%{opacity:.45} }
   — 아트보드 04·05 의 경고 점은 softFade 1600ms 를 쓴다. styles.css 에 없어
     지금은 기존 breathe 를 1.6s 로 돌려 halo 만 숨쉬게 했다(점멸은 아니라 요건은 충족). */
/* 새 클래스 필요: @keyframes toneIn { from{opacity:0} to{opacity:1} }
   — 아트보드 04·05 의 배경 오버레이(opacity 260ms)용. innerHTML 이 통째로 갈리는 구조라
     새 엘리먼트에는 transition 이 걸리지 않는다. 지금은 .app 의 background .26s 전환이 그 역할을 한다. */

/* ── 세션 요약 · 정정 ── */
/* ── 세션 요약 ──────────────────────────────────────────────────────────
   아트보드 07 세션 요약 (v2) 이식본. main.js 의 vResult() 를 이 파일로 갈아끼운다.
   로직·액션은 그대로다 — data-a 는 go / revert / discard / save 네 개뿐이고
   전부 기존 핸들러가 이미 받는 것들이다. */

/* 구간 4종의 색·투명도·텍스처는 ui.js 의 SPAN 한 곳에서만 온다.
   여기서는 타임라인을 메우는 '착석'만 얹는다 (SPAN 에는 없는 종류). */
const SEG = { sit: { name: '착석', fill: 'var(--pri)', op: 1, tex: '', revert: false }, ...SPAN };

function vResult() {
  const r = S.result; if (!r) return vBoot();
  const s = r.session;
  const at = (ms) => hhmm(new Date(ms).toISOString());
  /* 빠른 시연 모드는 임계값이 3초라 1분 미만 구간이 나온다 — hm() 이면 전부 "0분" 이 된다 */
  const dur = (sec) => sec < 60 ? `${Math.round(sec)}초` : hm(sec);
  const t0 = new Date(s.started_at).getTime();
  const t1 = new Date(s.ended_at || s.eff_end).getTime();
  const total = Math.max(1, (t1 - t0) / 1000);
  const spans = (r.spans || []).filter(x => x.seconds > 0)
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at));

  /* 구간 사이를 착석으로 메워 한 줄로 만든다 — 가로 폭이 곧 실제 시간 */
  const segs = []; let cur = t0;
  spans.forEach(sp => {
    const a = Math.max(cur, new Date(sp.started_at).getTime());
    const b = Math.min(t1, new Date(sp.ended_at).getTime());
    if (b <= a) return;
    if (a > cur) segs.push({ kind: 'sit', from: cur, to: a });
    segs.push({ kind: sp.reverted ? 'sit' : sp.kind, from: a, to: b, sp, reverted: sp.reverted });
    cur = b;
  });
  if (t1 > cur || !segs.length) segs.push({ kind: 'sit', from: cur, to: Math.max(t1, cur) });

  const revAway   = spans.some(x => x.reverted && x.kind === 'away');
  const revDrowsy = spans.some(x => x.reverted && x.kind === 'drowsy');
  const anyRev    = spans.some(x => x.reverted);
  const present   = new Set(segs.map(g => g.kind));          // 범례는 실제 등장한 종류만
  const legend    = ['sit', 'away', 'drowsy', 'pause', 'break'].filter(k => present.has(k));
  /* 수동 세션에 구간이 하나도 없으면 설명할 게 없어 범례를 접는다 (아트보드 수동 상태) */
  const showLegend = s.source !== 'manual' || legend.length > 1;
  /* 정정 제안은 졸음 → 이탈 순서. 아직 안 되돌린 첫 구간 하나만 */
  const cand = spans.find(x => !x.reverted && x.kind === 'drowsy')
            || spans.find(x => !x.reverted && x.kind === 'away');

  /* 구간 탭 → 툴팁: 라디오 :checked 로만 여닫는다.
     새 data-a 를 만들지 않으려고 JS 대신 CSS 로 붙였다 — 되돌리기는 기존 revert 액션 그대로. */
  const tlCss = segs.map((g, i) =>
    `#tlp-${i}:checked~[data-tip="${i}"]{display:flex}` +
    `#tlp-${i}:checked~.span-tl>div:nth-child(${i + 1}){outline:2px solid var(--tx);outline-offset:1px}`).join('');

  const pill = (cls, txt) => `<span class="pill ${cls} num" style="justify-content:center">${txt}</span>`;

  const todo = s.todo_id
    ? (S.home?.todos || []).find(t => t.id === s.todo_id) || (S.plan || []).find(t => t.id === s.todo_id)
    : null;

  return `<div class="scroll pba">
    <div class="appbar">
      <button class="icon-btn" data-a="go" data-v="home" aria-label="뒤로">${ic('left', 19, 2)}</button>
      <div class="h1">세션 요약</div>
    </div>
    <div class="pad">

      <div class="card p" style="padding:26px 18px;text-align:center;animation:riseIn .4s cubic-bezier(0,.9,.3,1) both">
        ${s.pomodoro && s.break_count ? `<div class="cap" style="margin-bottom:6px">${s.break_count}사이클 완료</div>` : ''}
        <div class="lbl">순공시간</div>
        <div style="margin-top:6px;display:flex;justify-content:center">${hmSplit(s.net_sec, 40, 24, 6)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;max-width:296px;margin:14px auto 0">
          ${pill('mut', `${at(t0)} – ${at(t1)}`)}
          ${pill('mut', `총 ${dur(s.gross_sec)}`)}
          ${pill(s.away_count ? 'acc' : 'mut',
            s.away_count ? `이탈 ${s.away_count}회 · ${dur(s.away_sec)}` : revAway ? '이탈 0회' : '이탈 없음')}
          ${pill(s.drowsy_count ? 'acc' : 'mut',
            s.drowsy_count ? `졸음 ${s.drowsy_count}회 · ${dur(s.drowsy_sec)}` : revDrowsy ? '졸음 0회' : '졸음 없음')}
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">세션 타임라인</div><div class="cap">가로 = 실제 시간</div></div>
        <div class="card p">
          <style>.tl-pick{position:absolute;width:0;height:0;opacity:0;pointer-events:none}
.tl-tip{display:none;margin-top:12px;background:var(--sunk);border-radius:13px;padding:10px 12px;align-items:center;gap:10px}
${tlCss}</style>
          ${segs.map((_, i) => `<input type="radio" name="tlpick" id="tlp-${i}" class="tl-pick">`).join('')}

          <div class="span-tl">${segs.map((g, i) => {
            const k = SEG[g.kind];
            /* .stripe · .dotted 는 background-image 라서 배경은 반드시 background-color 로 준다.
               background 단축을 쓰면 인라인이 텍스처를 지워 흑백에서 구분이 사라진다. */
            return `<div class="${k.tex}" style="flex:${Math.max((g.to - g.from) / 1000, total * .01)};
              background-color:${k.fill};opacity:${k.op};position:relative">
              <label for="tlp-${i}" style="position:absolute;inset:-11px 0;cursor:pointer"
                aria-label="${g.reverted ? '정정됨' : k.name} ${at(g.from)}부터 ${at(g.to)}"></label>
              ${g.reverted ? '<span style="position:absolute;left:2px;right:2px;bottom:-5px;border-bottom:2px dotted var(--pri)"></span>' : ''}
            </div>`;
          }).join('')}</div>

          <div class="between" style="margin-top:8px">
            <div class="cap num">${at(t0)}</div><div class="cap num">${at(t1)}</div>
          </div>

          ${segs.map((g, i) => {
            const revertable = g.sp && !g.reverted && SEG[g.sp.kind].revert;   // pause·break 는 revert:false
            return `<div class="tl-tip" data-tip="${i}">
              <div class="grow" style="font-size:12.5px;font-weight:650;color:var(--tx-2)">
                ${g.reverted ? '정정됨' : SEG[g.kind].name} · ${at(g.from)}–${at(g.to)} · ${dur((g.to - g.from) / 1000)}
              </div>
              ${revertable ? `<button data-a="revert" data-v="${g.sp.id}" style="height:32px;padding:0 12px;
                border-radius:10px;background:var(--acc);color:#fff;font-size:12px;font-weight:700;white-space:nowrap"
                >순공으로 되돌리기</button>` : ''}
            </div>`;
          }).join('')}

          ${s.source === 'manual' ? '<div class="cap" style="margin-top:12px">수동으로 기록한 세션입니다</div>' : ''}

          ${showLegend ? `<div class="divider" style="margin:14px 0 12px"></div>
            <div class="row" style="gap:12px;flex-wrap:wrap">
              ${legend.map(k => `<div class="legend"><i class="${SEG[k].tex}"
                style="background-color:${SEG[k].fill};opacity:${SEG[k].op === 1 ? 1 : SEG[k].op + .15}"></i>${SEG[k].name}</div>`).join('')}
              ${anyRev ? '<div class="legend"><i style="background-color:var(--pri);border-bottom:2px dotted var(--surface)"></i>정정됨</div>' : ''}
            </div>` : ''}
        </div>
      </div>

      ${cand ? `<div class="sec" style="margin-top:12px">
        <div class="card p tint-acc">
          <div class="row" style="gap:10px;align-items:flex-start">
            <div style="color:var(--acc-tx);margin-top:1px">${ic('alert', 18)}</div>
            <div class="grow">
              <div class="h3">${hhmm(cand.started_at)}–${hhmm(cand.ended_at)} 구간이 ${cand.kind === 'away' ? '이탈로' : '졸음으로'} 잡혔어요</div>
              <div class="sub" style="margin-top:4px">${cand.kind === 'away'
                ? '책상에 엎드려 필기 중이었다면 되돌릴 수 있습니다.'
                : '눈을 감고 암기 중이었다면 되돌릴 수 있습니다.'}</div>
            </div>
          </div>
          <button class="btn sm soft" style="margin-top:12px;background:var(--surface);border-color:transparent;color:var(--acc-tx)"
            data-a="revert" data-v="${cand.id}">${ic('check', 15, 2.2)} 순공으로 되돌리기</button>
        </div>
      </div>` : ''}

      ${spans.filter(x => x.reverted).map(x => `<div style="margin-top:12px;padding:12px 18px;border:1px solid var(--line);
        border-radius:16px;font-size:13px;font-weight:650;color:var(--tx-2)">정정됨 · ${hhmm(x.started_at)}–${hhmm(x.ended_at)} → 순공</div>`).join('')}

      ${todo ? `<div class="sec">
        <div class="h2">연결된 할 일</div>
        <div class="card row" style="margin-top:11px;padding:14px 16px;gap:12px">
          <div class="ico tile" style="background:color-mix(in srgb,${subColor(todo.subject_id)} 14%,transparent);
            color:${subColor(todo.subject_id)}">${ic('check_sq', 18)}</div>
          <div class="grow">
            <div class="h3">${esc(todo.title)}</div>
            <div class="cap" style="margin-top:2px">${todo.plan_min ? `목표 ${todo.plan_min}분 → ` : ''}이 세션 ${Math.round(s.net_sec / 60)}분</div>
          </div>
          ${todo.done_at ? `<div style="width:22px;height:22px;flex:none;border-radius:99px;background:var(--pri);
            display:grid;place-items:center;color:#fff">${ic('check', 13, 2.6)}</div>` : ''}
        </div>
      </div>` : ''}

    </div>
  </div>
  <div class="actionbar"><div class="btn-row">
    <button class="btn soft" style="flex:0 0 110px" data-a="discard">버리기</button>
    <button class="btn pri" data-a="save">기록 저장</button>
  </div></div>`;
}

/* 새 클래스 필요: styles.css 에 아래 두 줄이 들어가면 위 <style> 블록의 앞 두 줄은 지워도 된다.
   .tl-pick{position:absolute;width:0;height:0;opacity:0;pointer-events:none}
   .tl-tip{display:none;margin-top:12px;background:var(--sunk);border-radius:13px;padding:10px 12px;align-items:center;gap:10px}
   구간 개수만큼 :nth-child 규칙이 필요해 나머지는 렌더 시점에 만든다. */

/* ── 캘린더 · 플래너 · 기록 · 설정 ── */
/* 08 캘린더 월간 · 09 캘린더 주간 — S.calMode 로 토글
   ※ 두 아트보드에 <!-- 마감 포인트 --> 주석이 없다 (본문 조각만 전달됨).
     합격 기준은 마스터브리프 §11 차트 규칙 + §16 v1 결함 목록으로 대체했다. */

/* 순차 램프 5단 — 셀 클래스(v1~v4)와 범례가 같은 값을 쓴다 */
const HM_RAMP = ['var(--sunk)',
  'color-mix(in srgb,var(--pri) 13%,var(--sunk))',
  'color-mix(in srgb,var(--pri) 30%,var(--sunk))',
  'color-mix(in srgb,var(--pri) 55%,var(--sunk))',
  'var(--pri)'];
/* 초 단위 임계 — 90분 / 180분 / 240분 (마스터브리프 §3-4) */
const lvl = (sec) => !sec ? '' : sec < 5400 ? 'v1' : sec < 10800 ? 'v2' : sec < 14400 ? 'v3' : 'v4';

/* 주간 세로축 06–24 고정 · 3시간 눈금 (마스터브리프 §11) */
const AX_H = 306, AX_FROM = 6 * 60, AX_TO = 24 * 60, AX_SPAN = AX_TO - AX_FROM;
const AX_TICKS = [6, 9, 12, 15, 18, 21, 24];
const axY = (min) => (min - AX_FROM) / AX_SPAN * AX_H;      // 분 → px
/* started_at·ended_at 은 timestamptz — KST 로 옮겨 읽는다 (ui.js hhmm 과 같은 방식) */
const kMin = (iso) => { const d = new Date(new Date(iso).getTime() + 9 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const kDay = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

function vCalendar() {
  return S.calMode === 'week' ? calWeek() : calMonth();
}

/* ── 공통 뼈대 ── */
/* 월/주 세그먼트. 전환 액션이 없어 비활성 칸은 표시만 한다 — 새 data-a 를 만들지 않는다 */
const calSeg = (mode) => `<div class="row" style="gap:0;background:var(--sunk);border-radius:11px;padding:2px">
  ${[['month', '월'], ['week', '주']].map(([m, t]) => m === mode
    ? `<span style="padding:6px 14px;border-radius:9px;background:var(--surface);color:var(--tx);font-size:12.5px;font-weight:700;box-shadow:0 1px 2px rgba(20,26,70,.08)">${t}</span>`
    : `<button data-a="calmode" data-v="${m}" style="padding:6px 14px;border-radius:9px;color:var(--tx-3);font-size:12.5px;font-weight:600">${t}</button>`).join('')}
</div>`;

/* 요약 3값 — 값은 전부 nowrap 한 줄, 칸 사이는 1px 선 (아트보드 조판 그대로) */
const sumCard = (items) => `<div class="card" style="padding:14px 16px;display:flex;align-items:stretch">
  ${items.map(([k, v], i) => `${i ? '<div style="width:1px;background:var(--line);margin:0 14px"></div>' : ''}
    <div class="grow"><div class="lbl">${k}</div>
      <div class="num" style="margin-top:4px;font-size:13.5px;font-weight:750;letter-spacing:-.04em;white-space:nowrap">${v}</div></div>`).join('')}
</div>`;

const calArrows = (mode) => mode === 'month'
  ? `<button class="icon-btn" style="background:transparent;border-color:transparent" data-a="month" data-v="-1" aria-label="이전 달">${ic('left', 19)}</button>
     <button class="icon-btn" style="background:transparent;border-color:transparent" data-a="month" data-v="1" aria-label="다음 달">${ic('right', 19)}</button>`
  : `<button class="icon-btn" style="background:transparent;border-color:transparent" data-a="wk" data-v="-1" aria-label="이전 주">${ic('left', 19)}</button>
     <button class="icon-btn" style="background:transparent;border-color:transparent" data-a="wk" data-v="1" aria-label="다음 주">${ic('right', 19)}</button>`;

/* 제목줄 + 세그먼트까지가 두 모드의 공통 머리 */
const calHead = (mode, title) => `<div class="appbar"><div class="h1">캘린더</div>${calArrows(mode)}</div>
  <div class="pad">
    <div class="between" style="margin-bottom:12px">
      <div class="h2 num">${title}</div>${calSeg(mode)}
    </div>`;

const calFoot = () => `</div></div>
  <button class="fab" data-a="go" data-v="ready">${ic('play', 24)}</button>${tabbar('calendar')}`;

/* ── 08 월간 ── */
function calMonth() {
  const c = S.cal;
  const base = c?.from || S.calBase || kstToday();
  const title = `${base.slice(0, 4)}년 ${+base.slice(5, 7)}월`;
  if (!c) return `<div class="scroll pb pbf">${calHead('month', title)}
    <div class="shim" style="height:74px;border-radius:20px"></div>
    <div class="card p" style="margin-top:12px">
      <div class="cal" style="margin-bottom:8px">${DOW.map((d, i) => `<div class="hd ${i === 6 ? 'sun' : ''}">${d}</div>`).join('')}</div>
      <div class="cal">${Array(35).fill('<div class="shim" style="aspect-ratio:1/1.06;border-radius:10px"></div>').join('')}</div>
    </div>${calFoot()}`;

  const lead = (new Date(c.from + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const days = new Date(c.to + 'T00:00:00Z').getUTCDate();
  const map = Object.fromEntries((c.days || []).map(d => [d.day, d]));
  const today = kstToday();
  const sel = S.sel || S.selDay || today;

  return `<div class="scroll pb pbf">${calHead('month', title)}
    ${sumCard([['순공 합계', hm(c.total_sec)], ['공부한 날', `${c.studied_days ?? 0}일`], ['최장 연속', `${c.streak?.longest ?? 0}일`]])}
   <div class="two cal">
    <div class="card p" style="margin-top:12px">
      <div class="cal" style="margin-bottom:8px">${DOW.map((d, i) => `<div class="hd ${i === 6 ? 'sun' : ''}">${d}</div>`).join('')}</div>
      <div class="cal" style="animation:riseIn .24s cubic-bezier(0,.9,.3,1) both">
        ${Array(lead).fill('<div class="cell none"></div>').join('')}
        ${Array.from({ length: days }, (_, i) => {
          const iso = `${c.from.slice(0, 8)}${pad(i + 1)}`;
          const rec = map[iso], future = iso > today;
          const isT = iso === today, isS = iso === sel;
          /* 세 상태가 다 달라야 한다 — 미래는 채움 없음 / 기록 없는 날은 --sunk 만 / 0분은 --sunk + "0:00" */
          const fill = future ? 'none' : rec ? lvl(rec.net_sec) : '';
          /* 오늘+선택이면 sel 클래스를 빼서 주황 테두리를 지키고 인디고는 안쪽 1px 로 넣는다 */
          const ring = isT && isS ? 'box-shadow:inset 0 0 0 1px var(--pri),0 0 0 2px var(--acc-weak)'
                     : isT        ? 'box-shadow:0 0 0 2px var(--acc-weak)'
                     : isS        ? 'border-width:2px' : '';
          return `<button class="${['cell', fill, isT && 'today', isS && !isT && 'sel'].filter(Boolean).join(' ')}" style="${ring}"
            data-a="day" data-v="${iso}" aria-label="${+c.from.slice(5, 7)}월 ${i + 1}일">
            <div class="d"${future ? ' style="opacity:.45"' : ''}>${i + 1}</div>
            ${!future && rec ? `<div class="m num">${hmc(Math.round(rec.net_sec / 60))}</div>` : ''}
          </button>`;
        }).join('')}
      </div>
      <div class="row" style="justify-content:flex-end;gap:6px;margin-top:14px">
        <span style="font-size:11.5px;color:var(--tx-3)">적음</span>
        ${HM_RAMP.map(b => `<i style="width:12px;height:12px;border-radius:4px;background:${b};display:block"></i>`).join('')}
        <span style="font-size:11.5px;color:var(--tx-3)">많음</span>
      </div>
    </div>
    ${daySection(sel, !c.total_sec, map[sel]?.net_sec ?? 0)}
   </div>
  ${calFoot()}`;
}

/* 선택한 날 — 빈 달 · 미래 · 기록 없음 · 정상 네 갈래 */
function daySection(sel, monthEmpty, fallbackSec) {
  const t = kstToday();
  const d = S.dayd?.day === sel ? S.dayd : null;
  const head = `<div class="sec-head"><div class="row" style="gap:8px">
      <div class="h2">${+sel.slice(5, 7)}월 ${+sel.slice(8, 10)}일 ${dowOf(sel)}요일</div>
      ${sel === t ? '<span class="pill acc">오늘</span>' : ''}</div></div>`;

  const netLine = (sec, full) => `<div class="row" style="gap:10px">
      <span style="color:var(--pri)">${ic('clock', 19)}</span>
      <div class="row" style="gap:6px;align-items:baseline">
        <span class="num" style="font-size:14.5px;font-weight:700;letter-spacing:-.02em">${hm(sec)}</span>
        <span style="font-size:11.5px;color:var(--tx-3)">순공시간</span>
      </div></div>
    ${full ? '<div style="height:1px;background:var(--line);margin:14px 0 4px 29px"></div>' : ''}`;

  let body;
  if (monthEmpty) {
    body = `<div class="empty" style="padding:14px 0">
      <svg width="104" height="56" viewBox="0 0 104 56" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <rect x="30" y="8" width="44" height="40" rx="8" stroke="var(--pri)"/>
        <path d="M30 20h44M42 4v8M62 4v8" stroke="var(--pri)"/>
        <path d="M42 32h8M54 32h8M42 40h8" stroke="var(--tx-3)"/>
      </svg>
      <div style="font-size:13px;line-height:1.55;color:var(--tx-2)">이 달에는 기록이 없어요. 첫 세션을 시작하면 여기에 쌓입니다.</div>
    </div>`;
  } else if (sel > t) {
    body = `<div style="text-align:center;padding:8px 0;font-size:13px;line-height:1.55;color:var(--tx-2)">아직 오지 않은 날입니다</div>`;
  } else if (d?.sessions?.length) {
    body = `${netLine(d.net_sec, true)}
      ${d.sessions.map((s, i) => sesRow(s, i > 0, 29)).join('')}`;
  } else if (!d && fallbackSec > 0) {
    /* 월간 집계에는 있는 날인데 상세를 아직 안 불러왔다 — 합계만 보여주고 세션은 지어내지 않는다 */
    body = netLine(fallbackSec, false);
  } else {
    body = `<div class="stack" style="align-items:center;gap:14px;padding:8px 0">
      <div style="font-size:13px;line-height:1.55;color:var(--tx-2)">이 날은 기록이 없습니다</div>
      <button class="btn sm soft" style="width:auto;padding:0 18px;background:transparent;font-size:13.5px" data-a="sheetAdd">이 날에 할 일 추가</button>
    </div>`;
  }
  return `<div class="sec">${head}<div class="card p">${body}</div></div>`;
}

/* 세션 한 줄 — 월간 상세(inset 29)와 주간 하단(inset 0)이 같이 쓴다 */
function sesRow(s, divider, inset) {
  const meta = `${hhmm(s.started_at)} – ${hhmm(s.ended_at)}`
    + (s.away_count ? ` · 이탈 ${s.away_count}` : '') + (s.drowsy_count ? ` · 졸음 ${s.drowsy_count}` : '');
  return `${divider ? `<div style="height:1px;background:var(--line);margin-left:${inset || 16}px"></div>` : ''}
    <div class="row" style="gap:8px;padding:11px 0 11px ${inset}px">
      <i style="width:10px;height:10px;flex:none;border-radius:99px;background:${subColor(s.subject_id)};display:block"></i>
      <div class="grow">
        <div class="h3">${esc(subName(s.subject_id))}</div>
        <div class="cap num" style="margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${meta}</div>
      </div>
      <div class="num" style="font-size:13px;font-weight:650;color:var(--tx-2);white-space:nowrap">${hm(s.net_sec)}</div>
    </div>`;
}

/* ── 09 주간 ── */
function calWeek() {
  const w = S.week;
  const mon = w?.from || mondayOf();
  const sun = w?.to || addDays(mon, 6);
  const title = `${+mon.slice(5, 7)}월 ${+mon.slice(8, 10)}일 – `
    + (mon.slice(5, 7) === sun.slice(5, 7) ? '' : `${+sun.slice(5, 7)}월 `) + `${+sun.slice(8, 10)}일`;
  if (!w) return `<div class="scroll pb pbf">${calHead('week', title)}
    <div class="shim" style="height:74px;border-radius:20px"></div>
    <div class="shim" style="height:390px;border-radius:20px;margin-top:12px"></div>${calFoot()}`;

  const today = kstToday();
  const byDay = Object.fromEntries((w.days || []).map(d => [d.day, d.net_sec]));
  const studied = (w.days || []).filter(d => d.net_sec >= 60).length;
  /* 일평균 = 주간 합계 ÷ 경과일 (지난 주는 7일) */
  const last = today < sun ? today : sun;
  const elapsed = Math.min(7, Math.max(1, Math.round((Date.parse(last + 'T00:00:00Z') - Date.parse(mon + 'T00:00:00Z')) / 864e5) + 1));

  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(mon, i);
    return { iso, dow: DOW[i], sun: i === 6, today: iso === today, blocks: [], carry: [] };
  });
  const col = Object.fromEntries(days.map(d => [d.iso, d]));

  /* 블록 배치 — 24시에서 자르고 잔여는 다음 날 컬럼 상단에 스택 */
  (w.sessions || []).forEach(s => {
    if (!s.started_at || !s.ended_at) return;
    const d0 = kDay(s.started_at), d1 = kDay(s.ended_at);
    const m0 = kMin(s.started_at), m1 = d1 === d0 ? kMin(s.ended_at) : AX_TO;
    const lo = Math.max(AX_FROM, m0), hi = Math.min(AX_TO, m1);
    if (col[d0]) {
      if (hi > lo) col[d0].blocks.push({ s, iso: d0, top: axY(lo), h: Math.max(14, axY(hi) - axY(lo)), cutTop: m0 < AX_FROM, cutBot: d1 !== d0 });
      else col[d0].carry.push({ s, iso: d0, min: m1 - m0 });   // 06시 이전에 끝난 세션
    }
    if (d1 !== d0 && col[d1]) col[d1].carry.push({ s, iso: d1, min: kMin(s.ended_at) });
  });

  /* 격자는 가로선만 · 열 안에만 — overflow:hidden + 반경 8 이 선을 잘라 열 밖으로 새지 않는다 */
  const grid = AX_TICKS.slice(1, -1).map(h =>
    `<i style="position:absolute;left:0;right:0;top:${axY(h * 60).toFixed(1)}px;height:1px;background:var(--chart-grid);display:block"></i>`).join('');

  const used = S.subjects.filter(x => (w.sessions || []).some(s => s.subject_id === x.id));
  const selW = S.sel >= mon && S.sel <= sun ? S.sel : today;
  const ses = (w.sessions || []).filter(s => kDay(s.started_at) === selW);
  const sesSec = ses.reduce((a, b) => a + (b.net_sec || 0), 0);

  return `<div class="scroll pb pbf">${calHead('week', title)}
    ${sumCard([['주간 합계', hm(w.total_sec)], ['공부한 날', `${studied}일`], ['일평균', hm(Math.round(w.total_sec / elapsed))]])}
    <div class="card" style="margin-top:12px;padding:16px 14px;position:relative">
      <div style="display:grid;grid-template-columns:30px repeat(7,1fr);column-gap:4px;row-gap:10px">
        <div></div>
        ${/* 헤더와 아래 열이 같은 그리드의 같은 컬럼에 들어간다 — 오늘 열 테두리와 날짜가 어긋날 수 없다 */
          days.map(d => `<div style="text-align:center">
          <div style="font-size:11px;font-weight:600;color:${d.today ? 'var(--acc)' : d.sun ? '#E4573D' : 'var(--tx-3)'}">${d.dow}</div>
          <div class="num" style="margin-top:2px;font-size:13px;font-weight:750;color:${d.today ? 'var(--acc)' : 'var(--tx)'}">${+d.iso.slice(8, 10)}</div>
        </div>`).join('')}
        <div style="position:relative;height:${AX_H}px">
          ${/* 라벨을 격자선 세로 중앙에 건다 */
            AX_TICKS.map(h => `<div class="num" style="position:absolute;right:6px;top:${axY(h * 60).toFixed(1)}px;transform:translateY(-50%);
            font-size:10px;font-weight:600;color:var(--tx-3);line-height:1;white-space:nowrap">${pad(h)}</div>`).join('')}
        </div>
        ${days.map(d => `<div style="position:relative;height:${AX_H}px;border-radius:8px;overflow:hidden;background:var(--sunk);${d.today ? 'box-shadow:inset 0 0 0 1.5px var(--acc)' : ''}">
          ${grid}
          ${d.carry.reduce((o, b) => { const h = Math.min(72, Math.max(14, b.min / AX_SPAN * AX_H));
            o.html += wBlock(b, { top: o.y, h, carry: true }); o.y += h + 2; return o; }, { y: 0, html: '' }).html}
          ${d.blocks.map(b => wBlock(b, b)).join('')}
        </div>`).join('')}
      </div>
      ${used.length ? `<div style="height:1px;background:var(--line);margin:14px 0 12px"></div>
        <div class="row" style="gap:12px;flex-wrap:wrap">
          ${used.map(x => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--tx-2)">
            <i style="width:10px;height:10px;border-radius:4px;background:${x.color};display:block"></i>${esc(x.name)}</span>`).join('')}
        </div>` : ''}
      ${!w.total_sec ? `<div class="center" style="position:absolute;inset:0;border-radius:20px;padding:0 32px;
        background:color-mix(in srgb,var(--surface) 82%,transparent);backdrop-filter:blur(2px)">
        <div class="stack" style="align-items:center;text-align:center">
          <svg width="104" height="56" viewBox="0 0 104 56" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <rect x="22" y="8" width="14" height="40" rx="6" stroke="var(--tx-3)"/>
            <rect x="45" y="8" width="14" height="40" rx="6" stroke="var(--pri)"/>
            <rect x="68" y="8" width="14" height="40" rx="6" stroke="var(--tx-3)"/>
            <rect x="47.5" y="16" width="9" height="12" rx="3" fill="var(--pri)" stroke="none"/>
          </svg>
          <div style="margin-top:14px;font-size:13px;line-height:1.55;color:var(--tx-2)">이번 주 기록이 아직 없어요. 첫 세션을 시작하면 시간대별로 쌓입니다.</div>
        </div></div>` : ''}
    </div>
    <div class="sec">
      <div class="sec-head">
        <div class="h2">${selW === today ? '오늘' : `${+selW.slice(5, 7)}월 ${+selW.slice(8, 10)}일`} 세션</div>
        <div class="cap num">${ses.length ? `${ses.length}회 · ${hm(sesSec)}` : byDay[selW] ? hm(byDay[selW]) : '기록 없음'}</div>
      </div>
      <div class="card" style="padding:4px 16px">
        ${ses.length ? ses.map((s, i) => sesRow(s, i > 0, 0)).join('')
          : `<div style="text-align:center;padding:22px 0;font-size:13px;color:var(--tx-2)">${selW > today ? '아직 오지 않은 날입니다' : '이 날은 기록이 없습니다'}</div>`}
      </div>
    </div>
  ${calFoot()}`;
}

/* 블록 — 반경 4 · 좌우 인셋 2 · 22px 미만이면 라벨 생략.
   잘린 쪽 모서리를 각지게 두고 그 변에 1.5px 밝은 선을 넣어 "이어짐"을 표시한다 (흑백에서도 구분됨) */
function wBlock(b, g) {
  const r = `${g.carry || b.cutTop ? '0 0' : '4px 4px'} ${b.cutBot ? '0 0' : '4px 4px'}`;
  const cut = g.carry || b.cutTop ? 'box-shadow:inset 0 1.5px 0 rgba(255,255,255,.6);'
            : b.cutBot ? 'box-shadow:inset 0 -1.5px 0 rgba(255,255,255,.6);' : '';
  return `<button data-a="day" data-v="${b.iso}" aria-label="${esc(subName(b.s.subject_id))} ${hm(b.s.net_sec)}"
    style="position:absolute;left:2px;right:2px;top:${g.top.toFixed(1)}px;height:${g.h.toFixed(1)}px;padding:0;display:block;
    background:${subColor(b.s.subject_id)};border-radius:${r};${cut}">
    ${g.h >= 22 ? `<span style="position:absolute;top:3px;left:3px;font-size:8.5px;font-weight:700;color:#FFFFFF;line-height:1">${esc(subName(b.s.subject_id))}</span>` : ''}
  </button>`;
}

/* 새 클래스 필요:
   .cal-seg  { display:flex;background:var(--sunk);border-radius:11px;padding:2px }
   .cal-seg > * { padding:6px 14px;border-radius:9px;font-size:12.5px }
   .cal-seg .on { background:var(--surface);color:var(--tx);font-weight:700;box-shadow:0 1px 2px rgba(20,26,70,.08) }
   .wcol { position:relative;height:306px;border-radius:8px;overflow:hidden;background:var(--sunk) }
   .wcol.today { box-shadow:inset 0 0 0 1.5px var(--acc) } */

/* 10 플래너 · 11 할 일 추가 시트 — main.js 이식본
   strikeTitle() 은 main.js 에 이미 있으므로 여기서 다시 정의하지 않고 그대로 쓴다. */

/* ── 10 플래너 ───────────────────────────────────────── */

/* 날짜 스트립 7칸 — flex:1 + min-width:0 으로 균등, 요일/날짜 2줄 (디자인 10 §4).
   loadPlanner() 가 오늘치만 부르므로 지금은 표시 전용이다 (선택 액션 없음). */
function dateStrip(sel) {
  const mon = mondayOf(), today = kstToday();
  return `<div class="row" style="gap:6px;align-items:stretch">
    ${DOW.map((d, i) => {
      const iso  = new Date(new Date(mon + 'T00:00:00Z').getTime() + i * 864e5).toISOString().slice(0, 10);
      const now  = iso === today, on = iso === sel && !now;
      return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px;
        padding:9px 0;border-radius:13px;box-sizing:border-box;background:${now ? 'var(--pri)' : 'var(--surface)'};
        border:1.5px solid ${on ? 'var(--pri)' : 'transparent'}">
        <span style="font-size:10.5px;font-weight:700;color:${now ? 'rgba(255,255,255,.75)' : i === 6 ? '#E4573D' : 'var(--tx-3)'}">${d}</span>
        <span class="num" style="font-size:15px;font-weight:750;color:${now ? '#FFFFFF' : iso > today ? 'var(--tx-3)' : 'var(--tx)'}">${+iso.slice(8, 10)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/* 틱 22px 두 종류 — 체크 전 진행분은 링, 그 밖엔 네모.
   둘 다 22×22 라 체크해도 행 높이·행 위치가 움직이지 않는다 (디자인 10 §5). */
const ringTick = (pct) => `<svg width="22" height="22" viewBox="0 0 22 22">
  <circle cx="11" cy="11" r="9.5" fill="none" stroke="var(--line)" stroke-width="2"></circle>
  <circle cx="11" cy="11" r="9.5" fill="none" stroke="var(--pri)" stroke-width="2" stroke-linecap="round"
    stroke-dasharray="59.7" stroke-dashoffset="${(59.7 * (1 - pct)).toFixed(1)}" transform="rotate(-90 11 11)"></circle></svg>`;

const boxTick = (on) => `<div style="width:22px;height:22px;border-radius:7px;display:grid;place-items:center;box-sizing:border-box;
  background:${on ? 'var(--pri)' : 'transparent'};border:1.5px solid ${on ? 'var(--pri)' : 'var(--line)'};
  transition:background .14s,border-color .14s">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 12.5l4.5 4.5L19 7.5" stroke-dasharray="22" stroke-dashoffset="${on ? 0 : 22}"
      style="transition:stroke-dashoffset 180ms cubic-bezier(.2,.8,.25,1)"/></svg></div>`;

/* 플래너 행 — 과목 / 제목 / Meter 3단. 홈의 todoRow 와 조판이 달라 따로 둔다.
   취소선은 strikeTitle() 그대로 (제목 span 안 absolute 바라 Meter·과목명을 밀지 않는다). */
function planRow(t, divider) {
  const on   = !!t.done_at;
  const c    = subColor(t.subject_id);
  const goal = t.plan_min || 0, real = t.actual_min || 0;
  const pct  = goal ? Math.min(1, real / goal) : 0;
  const over = goal > 0 && real > goal;
  return `${divider ? '<div style="height:1px;background:var(--line);margin-left:34px"></div>' : ''}
    <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 0;cursor:pointer"
      data-a="todo" data-v="${t.id}" data-done="${on ? 1 : 0}">
      <div style="flex:none;margin-top:14px">${!on && real > 0 && goal ? ringTick(pct) : boxTick(on)}</div>
      <div class="grow">
        <div class="row" style="gap:6px">
          <i style="width:7px;height:7px;flex:none;border-radius:99px;background:${c};display:block"></i>
          <span style="font-size:11.5px;font-weight:700;color:${c}">${esc(subName(t.subject_id))}</span>
        </div>
        <div class="h3" style="margin-top:3px">${strikeTitle(t.title, on)}</div>
        <div class="row" style="gap:10px;margin-top:7px">
          ${goal
            ? `<span class="meter" style="flex:1;display:flex">
                 <i style="width:${(over ? 97 : pct * 100).toFixed(1)}%;background:${c};border-radius:${over ? '99px 0 0 99px' : '99px'}"></i>
                 ${/* 초과분은 늘리지 않고 100% 에서 멈춘 뒤 3px 주황 캡으로만 알린다 (디자인 10 §2) */
                   over ? '<i style="flex:0 0 3px;width:3px;border-radius:0;background:var(--acc)"></i>' : ''}
               </span>
               <span class="num" style="font-size:11.5px;font-weight:700;color:var(--tx-2);white-space:nowrap;min-width:56px;text-align:right">${real}/${goal}분</span>`
            : `<span class="cap num">실제 ${real}분</span>`}
        </div>
      </div>
    </div>`;
}

function vPlanner() {
  const list = S.plan;
  if (!list) return skelScreen('플래너', 'planner');

  const today = kstToday();
  /* 스트립에서 고른 날. loadPlanner() 가 오늘치만 부르므로 지금은 늘 오늘이고,
     날짜 상태가 생기면 이 한 줄만 갈아끼우면 아래 3상태가 그대로 돈다. */
  const date    = today;
  const isToday = date === today, future = date > today;

  const done  = list.filter(t => t.done_at).length;
  const plan  = list.reduce((a, t) => a + (t.plan_min || 0), 0);
  const real  = list.reduce((a, t) => a + (t.actual_min || 0), 0);
  const all   = list.length > 0 && done === list.length;
  const md    = `${+date.slice(5, 7)}월 ${+date.slice(8, 10)}일`;

  return `<div class="scroll pbf">
    <div class="appbar">
      <div class="h1">플래너</div>
      <button class="icon-btn" data-a="go" data-v="calendar" aria-label="날짜 이동">${ic('cal', 19)}</button>
    </div>
    <div class="pad">
      ${dateStrip(date)}

     <div class="two plan">
      ${!list.length ? '' : future
        ? `<div class="card p" style="margin-top:12px">
             <div class="lbl">계획</div>
             <div class="num" style="margin-top:4px;font-size:24px;font-weight:800;letter-spacing:-.03em;white-space:nowrap">${plan}<span style="font-size:15px;font-weight:700;color:var(--tx-3)">분</span></div>
           </div>`
        : `<div class="card p" style="margin-top:12px;animation:riseIn .4s cubic-bezier(0,.9,.3,1) both">
             <!-- 좌우 숫자를 같은 그리드 행에 세워 baseline 을 맞춘다 (디자인 10 §3) -->
             <div style="display:grid;grid-template-columns:1fr auto;column-gap:12px;row-gap:4px;align-items:baseline">
               <div class="row" style="gap:8px"><span class="lbl">오늘 완료</span>${all ? '<span class="pill ok">모두 완료</span>' : ''}</div>
               <div class="lbl" style="text-align:right">계획 대비 실제</div>
               <div class="num" style="font-size:24px;font-weight:800;letter-spacing:-.03em;white-space:nowrap">${done}<span style="font-size:15px;font-weight:700;color:var(--tx-3)">/${list.length}</span></div>
               <div class="num" style="font-size:24px;font-weight:800;letter-spacing:-.03em;white-space:nowrap;text-align:right">${plan ? Math.round(real / plan * 100) : 0}<span style="font-size:15px;font-weight:700;color:var(--tx-3)">%</span></div>
             </div>
             <div class="meter" style="height:7px;margin-top:14px"><i style="width:${done / list.length * 100}%"></i></div>
             <div class="between" style="align-items:baseline;margin-top:10px">
               <span class="cap num">계획 ${hm(plan * 60)}</span>
               <span class="cap num" style="color:var(--ok);font-weight:700">실제 ${hm(real * 60)}</span>
             </div>
           </div>`}

      <div class="pl-list sec">
        <div class="sec-head">
          <div class="h2">${isToday ? '오늘 · ' : ''}${md}</div>
          ${isToday ? '<span class="cap">체크하면 순공시간과 묶입니다</span>' : ''}
        </div>
        ${list.length
          ? `<div class="card" style="padding:2px 16px;animation:riseIn .4s cubic-bezier(0,.9,.3,1) 60ms both">
               ${list.map((t, i) => planRow(t, i > 0)).join('')}</div>`
          : `<div class="card"><div class="empty">
               <svg width="112" height="64" viewBox="0 0 112 64" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                 <rect x="26" y="6" width="60" height="52" rx="10" stroke="var(--tx-3)"/>
                 <rect x="36" y="17" width="12" height="12" rx="4" stroke="var(--pri)"/>
                 <path d="M39.5 23l2.6 2.6 4-4.6" stroke="var(--pri)"/>
                 <path d="M54 23h22" stroke="var(--pri)"/>
                 <rect x="36" y="36" width="12" height="12" rx="4" stroke="var(--tx-3)"/>
                 <path d="M54 42h16" stroke="var(--tx-3)"/>
               </svg>
               <div class="h3">${isToday ? '오늘' : md + '에'} 계획한 일이 없어요</div>
               <div style="margin-top:4px;font-size:13px;line-height:1.55;color:var(--tx-2)">첫 할 일을 추가해 보세요</div>
               <button class="btn sm" style="margin-top:14px;width:auto;padding:0 18px;background:var(--pri-weak);color:var(--pri);font-size:13.5px;font-weight:700"
                 data-a="sheetAdd">${ic('plus', 15, 2.2)} 할 일 추가</button>
             </div></div>`}
      </div>

      <div class="sec"><div class="card p dash">
        <div style="font-size:13px;line-height:1.55;color:var(--tx-2)">할 일에 목표 시간을 적어두면, 집중 세션을 끝냈을 때 그 시간이 자동으로 채워집니다.</div>
        <div style="margin-top:8px;font-size:13px;line-height:1.55;color:var(--tx-3)">계획과 실제의 차이가 다음 주 계획을 세우는 유일한 근거입니다.</div>
      </div></div>
     </div>
    </div>
  </div>
  <button class="fab pri" data-a="sheetAdd">${ic('plus', 26, 2.1)}</button>${tabbar('planner')}`;
}

/* ── 11 할 일 추가 시트 ──────────────────────────────────
   S.sheet 에 함수를 꽂으면 render() 가 앱 위에 얹는다. 핸들러 배선:
     sheetAdd    → T.id = null; T.title = ''; T.custom = false; S.sheet = sheetTodo; render()
     sheetClose  → S.sheet = null; render()
     sheetCustom → T.custom = v === '1'; render()
     sheetSave   → T.title.trim() 이 비면 T.shake = 1; render() / 아니면 db.addTodo 후 닫기
   과목·목표 시간은 기존 pick · goal 액션과 R 을 그대로 쓴다 (핸들러 수정 없음). */
const T = { id: null, title: '', custom: false, shake: 0 };

function sheetTodo() {
  const subs  = S.subjects || [];
  const goal  = R.goalMin;
  const can   = T.title.trim().length > 0;
  const shake = T.shake; T.shake = 0;   /* 한 번만 흔들고 끈다 */
  const today = kstToday();
  const edit  = !!T.id;

  return `<div class="scrim" data-a="sheetClose"></div>
  <div class="sheet" style="max-height:68vh;padding-bottom:0;overflow:hidden;display:flex;flex-direction:column">
    <style>@keyframes shakeX{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}</style>
    <div class="grab"></div>
    <div class="between" style="margin-bottom:18px">
      <div class="h2">${edit ? '할 일 수정' : '할 일 추가'}</div>
      <button class="icon-btn" style="border:none;background:transparent" data-a="sheetClose" aria-label="닫기">${ic('x', 17)}</button>
    </div>

    <div class="scroll" style="padding-bottom:calc(26px + env(safe-area-inset-bottom))">
      <!-- .field 가 포커스 때 pri 1.5px 테두리를 이미 갖고 있다 (디자인 11 §1) -->
      <input class="field" id="todoTitle" type="text" autocomplete="off" placeholder="무엇을 할까요?"
        value="${esc(T.title)}"${shake ? ' style="animation:shakeX 120ms linear 2"' : ''}>

      <div style="margin-top:18px">
        <div class="lbl">과목</div>
        <div class="chips" style="margin-top:11px">
          ${subs.map(s => {
            const on = R.subjectId === s.id;
            return `<button class="chip" data-a="pick" data-v="${s.id}"
              style="display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-width:1.5px;${
                on ? 'background:var(--pri-weak);border-color:var(--pri);color:var(--pri-weak-tx);font-weight:700' : ''}">
              <i style="width:8px;height:8px;flex:none;border-radius:99px;background:${s.color};display:block"></i>${esc(s.name)}</button>`;
          }).join('')}
        </div>
      </div>

      <div style="margin-top:18px">
        <div class="lbl">목표 시간</div>
        ${T.custom
          ? `<div class="row" style="gap:12px;margin-top:11px;background:var(--sunk);border-radius:13px;padding:6px">
               <button class="icon-btn" data-a="goal" data-v="-5" aria-label="줄이기"
                 style="width:44px;height:44px;border:none;border-radius:11px;${goal <= 5 ? 'opacity:.4' : ''}">${ic('minus', 18, 2)}</button>
               <div class="grow num" style="display:flex;align-items:baseline;justify-content:center;white-space:nowrap">
                 <span style="font-size:18px;font-weight:800;letter-spacing:-.03em">${goal}</span><span style="font-size:12px;font-weight:700">분</span></div>
               <button class="icon-btn" data-a="goal" data-v="5" aria-label="늘리기"
                 style="width:44px;height:44px;border:none;border-radius:11px;${goal >= 180 ? 'opacity:.4' : ''}">${ic('plus', 18, 2)}</button>
               <button data-a="sheetCustom" data-v="0" style="flex:none;height:44px;padding:0 12px;font-size:12px;font-weight:700;color:var(--tx-3)">칩으로</button>
             </div>`
          /* 칩 4개 + 직접 입력을 flex:1 로 한 줄에 — 줄바꿈 없음 (디자인 11 §2).
             기존 goal 액션은 증감값을 받으므로 칩은 목표값과의 차이를 넘겨 그 값에 맞춘다. */
          : `<div class="row" style="gap:8px;margin-top:11px">
               ${[20, 30, 45, 60].map(m => {
                 const on = goal === m;
                 return `<button class="chip" data-a="goal" data-v="${m - goal}"
                   style="flex:1;min-width:0;height:38px;padding:0;border-width:1.5px;white-space:nowrap;${
                     on ? 'background:var(--pri-weak);border-color:var(--pri);color:var(--pri-weak-tx);font-weight:700' : ''}">${m}분</button>`;
               }).join('')}
               <button class="chip" data-a="sheetCustom" data-v="1"
                 style="flex:1.4;min-width:0;height:38px;padding:0;border-width:1.5px;border-style:dashed;background:transparent;color:var(--tx-3);white-space:nowrap">직접 입력</button>
             </div>`}
      </div>

      <div class="card flat" style="margin-top:18px;background:var(--bg);border-radius:16px;padding:2px 14px">
        <div class="row" style="gap:10px;padding:12px 0">
          <span style="color:var(--tx-2)">${ic('cal', 18)}</span>
          <span class="h3 grow">날짜</span>
          <span style="font-size:13px;color:var(--tx-2)">오늘 · ${+today.slice(5, 7)}월 ${+today.slice(8, 10)}일</span>
        </div>
      </div>

      ${edit ? `<button class="btn sm soft" style="margin-top:12px;background:transparent;color:var(--acc)"
        data-a="sheetDel" data-v="${T.id}">${ic('trash', 15)} 삭제</button>` : ''}

      <!-- 제목이 비면 40% 로 두되 눌리게 남겨 둔다 — 눌러야 흔들려서 왜 안 되는지 보인다 -->
      <button class="btn pri" style="margin-top:20px;opacity:${can ? 1 : .4}" data-a="sheetSave">${edit ? '저장' : '추가하기'}</button>
    </div>
  </div>`;
}

/* 시트가 다시 그려져도(과목 칩 등) 입력 중이던 제목이 살아남게 초안에 붙잡아 둔다.
   재렌더는 포커스를 빼앗으므로 추가 버튼 투명도만 직접 만진다. */
app.addEventListener('input', (e) => {
  if (e.target.id !== 'todoTitle') return;
  T.title = e.target.value;
  const b = app.querySelector('[data-a="sheetSave"]');
  if (b) b.style.opacity = T.title.trim() ? 1 : .4;
});

/* 새 클래스 필요: @keyframes shakeX{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
   지금은 시트 안 <style> 로 넣어 뒀다. styles.css 로 옮기면 그 <style> 줄을 지우면 된다. */

/* ── 기록 · 통계 (디자인 12) ──────────────────────────────────
   합격 기준 5줄 (아트보드 <!-- 마감 포인트 -->):
   1 요일별 막대 — 오늘 주황 · 미래 pri 26% · 미래 값 라벨 제거 · baseline 일치
   2 과목별 행 — 시간 700 / 비율 600 tx-3, 우측 세로줄 정렬
   3 집중 패턴 카드 — stretch + 고정 패딩으로 높이 동일
   4 시간대 — 최대 구간만 주황, 마지막 항목 margin 0
   5 데이터 부족 · 지난주 없음 · 로딩 3상태
   ────────────────────────────────────────────────────────── */

function vStats() {
  const r = S.stats;

  /* 상태 1 — 로딩. 스피너 대신 실제 카드와 같은 높이의 스켈레톤 */
  if (!r) return `<div class="scroll pb">
    <div class="appbar"><div class="h1">기록</div></div>
    <div class="pad">
      <div class="card p">
        <div class="shim" style="height:16px;width:60%"></div>
        <div class="shim" style="height:118px;margin-top:16px;border-radius:12px"></div>
      </div>
    </div>
  </div>${tabbar('stats')}`;

  /* 상태 2 — 데이터 부족. 3일 미만이면 패턴을 말하지 않는다 */
  if ((r.studied_days || 0) < 3) return `<div class="scroll pb">
    <div class="appbar"><div class="h1">기록</div></div>
    <div class="pad">
      <div class="card"><div class="empty">
        <svg width="104" height="56" viewBox="0 0 104 56" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 50h84" stroke="var(--tx-3)"/>
          <rect x="24" y="34" width="12" height="16" rx="4" stroke="var(--pri)"/>
          <rect x="46" y="24" width="12" height="26" rx="4" stroke="var(--pri)"/>
          <rect x="68" y="40" width="12" height="10" rx="4" stroke="var(--tx-3)" stroke-dasharray="3 4"/>
        </svg>
        <div style="font-size:13.5px;font-weight:700;letter-spacing:-.02em">아직 판단하기 이른 데이터예요</div>
        <div style="margin-top:4px;font-size:13px;line-height:1.55;color:var(--tx-2)">3일 이상 기록이 쌓이면 패턴이 보입니다</div>
        ${r.total_sec ? `<div class="cap num" style="margin-top:14px">지금까지 합계 ${hm(r.total_sec)}</div>` : ''}
      </div></div>
    </div>
  </div>${tabbar('stats')}`;

  /* 상태 3 — 정상 */
  const H      = 118;                       // 막대 트랙 최대 높이(px). 라벨은 트랙 밖에 둔다
  const mon    = mondayOf(), today = kstToday();
  const byDow  = Object.fromEntries((r.by_weekday || []).map(d => [d.isodow, d.net_sec]));
  const max    = Math.max(1, ...Object.values(byDow));
  const diff   = r.total_sec - (r.prev_total_sec || 0);
  const subj   = r.by_subject || [];
  const subMax = Math.max(1, ...subj.map(s => s.net_sec));   // 합계가 아니라 최대값 기준 정규화
  const BK     = { '05-09': '새벽·아침 05–09', '09-12': '오전 09–12', '12-18': '오후 12–18', '18-22': '저녁 18–22', '22-05': '밤 22–05' };
  const hb     = r.by_hour_bucket || [];
  const hbMax  = Math.max(1, ...hb.map(b => b.net_sec));
  const top    = hb.find(b => b.net_sec === hbMax);
  const pat    = r.pattern || {};

  return `<div class="scroll pb">
    <div class="appbar"><div class="h1">기록</div></div>
    <div class="pad">

      <div class="card p" style="animation:riseIn .4s cubic-bezier(0,.9,.3,1) both">
        <div class="between" style="align-items:flex-start;gap:8px">
          <div>
            <div class="lbl">이번 주 순공시간</div>
            <div style="margin-top:4px">${hmSplit(r.total_sec, 30, 15, 4)}</div>
          </div>
          ${r.prev_total_sec
            ? `<span class="pill ${diff >= 0 ? 'ok' : 'mut'} num">${diff >= 0 ? '+' : '−'}${hm(Math.abs(diff))}</span>`
            : `<span class="pill mut">비교할 지난주 기록 없음</span>`}
        </div>

        <div class="row" style="gap:7px;margin-top:16px;align-items:stretch">
          ${DOW.map((d, i) => {
            const iso    = new Date(new Date(mon + 'T00:00:00Z').getTime() + i * 864e5).toISOString().slice(0, 10);
            const v      = byDow[i + 1] || 0;
            const future = iso > today;
            const now    = iso === today;
            const h      = future || !v ? 4 : Math.max(4, Math.round(v / max * H));
            /* 트랙(132px)은 값 라벨을 품고 bottom 정렬 — 라벨 유무와 무관하게 baseline 이 맞는다 */
            return `<div class="bar ${future ? 'dim' : now ? 'now' : ''}" style="flex:1;min-width:0;height:auto;gap:0">
              <div style="height:132px;width:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center">
                ${future || !v ? '' : `<div class="num" style="font-size:9.5px;line-height:1;color:var(--tx-3);margin-bottom:4px">${hmc(Math.round(v / 60))}</div>`}
                <i style="height:${h}px;animation:grow .42s cubic-bezier(.2,.8,.25,1) ${i * 30}ms both"></i>
              </div>
              <span style="margin-top:6px;font-size:11px;line-height:1.5;${now ? 'color:var(--acc);font-weight:700' : 'color:var(--tx-3);font-weight:500'}">${d}</span>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">과목별</div></div>
        <div class="card p" style="display:flex;flex-direction:column;gap:15px">
          ${subj.length ? subj.map(s => {
            const c = s.color || '#79809E';   // 6번째 이후·미분류는 새 색 대신 중립
            return `<div>
              <div class="row" style="gap:6px;align-items:baseline">
                <i style="width:7px;height:7px;flex:0 0 7px;border-radius:99px;background:${c};align-self:center;display:block"></i>
                <span class="h3" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name || '기타')}</span>
                <span class="num" style="font-size:13px;font-weight:700;white-space:nowrap;min-width:72px;text-align:right">${hm(s.net_sec)}</span>
                <span class="num" style="font-size:12px;font-weight:600;color:var(--tx-3);white-space:nowrap;min-width:32px;text-align:right">${Math.round(s.net_sec / Math.max(1, r.total_sec) * 100)}%</span>
              </div>
              <div class="hbar" style="margin-top:6px"><i style="width:${s.net_sec / subMax * 100}%;background:${c}"></i></div>
            </div>`;
          }).join('') : '<div class="cap">아직 과목별로 나눌 기록이 없어요.</div>'}
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">집중 패턴</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch">
          ${[[Math.round((pat.avg_session_sec || 0) / 60), '분', '평균 세션'],
             [Math.round((pat.max_session_sec || 0) / 60), '분', '최장 세션'],
             [Number(pat.avg_away_per_session || 0).toFixed(1), '회', '세션당 이탈'],
             [r.studied_days || 0, '일', '공부한 날']]
            .map(([v, u, label]) => `<div class="card p" style="min-width:0;padding:16px 14px;display:flex;flex-direction:column;gap:4px">
              <div class="num" style="display:flex;align-items:baseline;white-space:nowrap">
                <span style="font-size:19px;font-weight:800;letter-spacing:-.03em">${v}</span>
                <span style="font-size:12px;font-weight:700;color:var(--tx-2);margin-left:3px">${u}</span>
              </div>
              <div style="font-size:11.5px;line-height:1.5;color:var(--tx-3)">${label}</div>
            </div>`).join('')}
        </div>
      </div>

      ${hb.length ? `<div class="sec">
        <div class="sec-head"><div class="h2">시간대</div><div class="cap">가장 잘 되는 시간</div></div>
        <div class="card p">
          ${hb.map((b, i) => `<div style="margin-bottom:${i === hb.length - 1 ? 0 : 14}px">
            <div class="between" style="align-items:baseline">
              <span style="font-size:11.5px;color:var(--tx-2)">${BK[b.bucket] || b.bucket}</span>
              <span class="num" style="font-size:11.5px;font-weight:700;color:var(--tx-2);white-space:nowrap">${hm(b.net_sec)}</span>
            </div>
            <div class="hbar" style="height:7px;margin-top:5px">
              <i style="width:${b.net_sec / hbMax * 100}%;background:${b.net_sec === hbMax ? 'var(--acc)' : 'var(--pri)'}"></i></div>
          </div>`).join('')}
          <div style="height:1px;background:var(--line);margin:16px 0 12px"></div>
          <div style="font-size:13px;line-height:1.55;color:var(--tx-2)">
            ${top ? `${BK[top.bucket] || top.bucket}시에 전체 순공시간의 ${Math.round(hbMax / Math.max(1, r.total_sec) * 100)}%가 몰려 있습니다.` : ''}
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

/* ── 13 카메라와 개인정보 ──────────────────────────────────────────────
   아트보드 마감 포인트
   ① '저장되는 데이터' 신설 — 무엇을 저장하는지까지 명시
   ② 선언 카드 text-wrap:balance · 최대 280px · 카메라 OFF 시 중립 톤 260ms
   ③ OFF 면 '어떻게 동작하나요' 높이 접힘 320ms
   ④ 위험 항목은 주황 글자와 아이콘만, 행 배경은 칠하지 않음
   ⑤ 삭제 다이얼로그 · 내보내기 시트 실동작 → 파일 맨 아래 주석 참조 (액션 미존재)  */

/* 행 보조문구 — 아트보드 값(13px/1.55/tx-3). .cap 은 11.5px 라 그대로 못 쓴다 */
const RSUB = 'margin-top:2px;font-size:13px;line-height:1.55;color:var(--tx-3)';

function vSettings() {
  const p   = S.profile || {};
  const cam = p.cam_enabled !== false;
  /* 카메라가 꺼지면 졸음 스위치도 OFF 로 보인다 — vReady 와 같은 규칙 */
  const drowsy = cam && p.drowsy_enabled !== false;

  const hows = [
    ['eye',   '눈과 자세만 봅니다',  '누구인지 식별하지 않습니다'],
    ['cam',   '기기 안에서만 분석',  '영상이 서버로 전송되지 않습니다'],
    ['trash', '판단 직후 즉시 폐기', '프레임을 파일로 남기지 않습니다'],
    ['clock', '남는 것은 시간뿐',    '구간의 종류와 시각만 저장됩니다'],
  ];
  /* 실제로 남는 세 테이블 — session · session_span · correction_log */
  const kept = [
    ['세션', '시작 시각 · 종료 시각 · 과목'],
    ['구간', '종류(자리 비움 · 졸음 · 일시정지 · 휴식) · 시작 시각 · 종료 시각'],
    ['정정', '되돌린 구간 · 되돌린 시각'],
  ];

  const heroSub = cam
    ? `카메라는 '지금 자리에 앉아 있는가'${drowsy ? ", '졸고 있는가'" : ''}만 판단합니다. 판단이 끝난 프레임은 그 즉시 기기에서 삭제됩니다.`
    : '수동 타이머로만 기록 중입니다';

  const corrTxt = S.corr == null ? '불러오는 중'
    : S.corr.length ? `되돌린 구간 ${S.corr.filter(c => c.action === 'revert').length}건 · 감도 자동 조정됨`
    : '아직 되돌린 구간이 없습니다';

  return `<div class="scroll" style="padding-bottom:40px">
    <div class="appbar">
      <button class="icon-btn" data-a="go" data-v="home" aria-label="뒤로">${ic('left', 19, 2)}</button>
      <div class="h1">카메라와 개인정보</div>
    </div>
    <div class="pad">

      <!-- ② 선언 카드 — ON 은 ok 톤, OFF 는 sunk 중립. 배경·글자색을 260ms 로 넘긴다 -->
      <div style="margin-top:14px;border-radius:20px;padding:22px 18px;display:flex;flex-direction:column;
        align-items:center;text-align:center;background:${cam ? 'var(--ok-weak)' : 'var(--sunk)'};
        transition:background 260ms cubic-bezier(.2,.8,.25,1)">
        <div style="color:${cam ? 'var(--ok)' : 'var(--tx-3)'};transition:color 260ms">${ic('shield', 34, 1.6)}</div>
        <div class="h2" style="margin-top:12px;max-width:280px;text-wrap:balance">
          ${cam ? '얼굴 이미지는 저장되지 않습니다' : '카메라를 사용하지 않고 있습니다'}</div>
        <div style="margin-top:7px;font-size:13px;line-height:1.6;color:var(--tx-2);max-width:280px;text-wrap:balance">
          ${heroSub}</div>
      </div>

      <!-- ③ 카메라가 꺼지면 안내를 지우지 않고 높이만 접는다 (320ms) -->
      <div class="sec">
        <div class="h2">어떻게 동작하나요</div>
        <div style="overflow:hidden;max-height:${cam ? '400px' : '0px'};opacity:${cam ? '1' : '0'};
          transition:max-height 320ms cubic-bezier(.2,.8,.25,1),opacity 160ms">
          <div class="card" style="margin-top:11px">
            ${hows.map(([icon, a, b], i) => `
              ${i ? '<div class="divider" style="margin-left:59px"></div>' : ''}
              <div class="lrow">
                <div class="ico ok">${ic(icon, 18)}</div>
                <div class="grow"><div class="h3">${a}</div><div style="${RSUB}">${b}</div></div>
              </div>`).join('')}
          </div>
        </div>
        ${cam ? '' : `<div class="card dash" style="margin-top:11px;padding:12px 16px;border-radius:16px;border-width:1.5px">
          <div class="cap" style="font-size:12.5px">카메라를 켜면 동작 방식 안내가 다시 표시됩니다</div></div>`}
      </div>

      <!-- ① 저장되는 데이터 — 목록과 그 목록이 전부라는 근거를 같이 둔다 -->
      <div class="sec">
        <div class="sec-head"><div class="h2">저장되는 데이터</div></div>
        <div class="card p">
          <div style="background:var(--sunk);border-radius:13px;padding:14px 16px;display:flex;flex-direction:column;gap:8px">
            ${kept.map(([k, v]) => `<div style="display:flex;gap:14px;font-size:12px;line-height:1.5">
              <span style="flex:0 0 32px;font-weight:700;color:var(--tx-2)">${k}</span>
              <span style="color:var(--tx-3)">${v}</span></div>`).join('')}
          </div>
          <div style="margin-top:10px;font-size:11.5px;line-height:1.5;color:var(--tx-3)">
            이 목록이 전부입니다. 얼굴 이미지는 서버로 나가지 않습니다 — 서버에 이미지를 받는 경로 자체가 없습니다.</div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">설정</div></div>
        <div class="card">
          <div class="lrow" data-a="toggleCam">
            <div class="ico">${ic('cam', 18)}</div>
            <div class="grow"><div class="h3">카메라 착석 감지</div>
              <div style="${RSUB}">끄면 수동 타이머로만 기록합니다</div></div>
            <div class="sw ${cam ? 'on' : ''}"><i></i></div>
          </div>
          <div class="divider" style="margin-left:59px"></div>
          <div class="lrow" data-a="toggleDrowsy" style="${cam ? '' : 'opacity:.4'}">
            <div class="ico">${ic('eye', 18)}</div>
            <div class="grow"><div class="h3">졸음 감지</div>
              <div style="${RSUB}">${cam ? '끄면 눈 감김·엎드림을 보지 않습니다' : '착석 감지를 켜야 졸음도 볼 수 있어요'}</div></div>
            <div class="sw ${drowsy ? 'on' : ''} ${cam ? '' : 'lock'}"><i></i></div>
          </div>
          <div class="divider" style="margin-left:59px"></div>
          <div class="lrow" data-a="corrections">
            <div class="ico acc">${ic('pencil', 18)}</div>
            <div class="grow"><div class="h3">잘못 감지 정정 이력</div>
              <div class="num" style="${RSUB}">${corrTxt}</div></div>
            <div style="color:var(--tx-3)">${ic('right', 16, 2)}</div>
          </div>
          <div class="divider" style="margin-left:59px"></div>
          <div class="lrow" data-a="signout">
            <div class="ico">${ic('out', 18)}</div>
            <div class="grow"><div class="h3">로그아웃</div></div>
          </div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-head"><div class="h2">내 기록</div></div>
        <div class="card">
          <div class="lrow" data-a="exportData">
            <div class="ico">${ic('out', 18)}</div>
            <div class="grow"><div class="h3">내 기록 내보내기</div>
              <div style="${RSUB}">위 목록 그대로 JSON 파일로 내려받습니다</div></div>
            <div style="color:var(--tx-3)">${ic('right', 16, 2)}</div>
          </div>
          <div class="divider" style="margin-left:59px"></div>
          <div class="lrow" data-a="deleteAll">
            <div style="width:34px;height:34px;flex:none;display:grid;place-items:center;color:var(--acc)">${ic('trash', 18)}</div>
            <div class="grow"><div class="h3" style="color:var(--acc)">모든 기록 삭제</div>
              <div style="${RSUB}">계정은 남고 세션·구간·정정 이력만 지웁니다. 되돌릴 수 없습니다</div></div>
          </div>
        </div>
      </div>

      <div style="margin-top:26px;font-size:13px;line-height:1.7;color:var(--tx-2);text-align:center;padding:0 12px">
        이 앱은 누구에게도 내 기록을 자동으로 보내지 않습니다. 기록은 기기와 내 계정에만 남습니다.</div>
    </div>
  </div>`;
}

/* 새 클래스 필요: .rsub { margin-top:2px;font-size:13px;line-height:1.55;color:var(--tx-3) }
   — 이 화면에서만 8회. .cap(11.5px) 과 크기가 달라 대체 불가 */

/* 마감 포인트 ④⑤ 미이식 — '내 기록 내보내기' 행 · '모든 기록 삭제' 행 · 삭제 다이얼로그 · 내보내기 시트.
   두 행을 붙이려면 main.js 의 click 스위치에 case 가 있어야 하는데 지금은 없다.
   눌러도 아무 일이 없는 '모든 기록 삭제' 버튼은 이 화면이 하려는 말과 정면으로 충돌하므로 넣지 않았다.
   붙이는 데 필요한 것 (규약상 이 파일 밖의 변경이라 하지 않음):
     db.js   export const exportJson       = () => rpc('fn_export_json');
             export const deleteAllRecords = () => rpc('fn_delete_all_records');   // 두 RPC 는 백엔드에 이미 있음
     main.js S.sheet(이미 render 가 읽는 훅) 로 시트를, S.dlg 류로 다이얼로그를 열고
             case 'openExport' / 'openDelete' / 'doExport' / 'doDeleteAll' 추가
     ui.js   내보내기 아이콘(위쪽 화살표) 없음 — ic() 목록에 없어서 'out' 재사용 또는 추가 필요 */

/* ── 카메라 마운트 (재렌더에도 스트림이 끊기지 않게 같은 video 노드를 옮긴다) ── */
let videoEl = null;
/* render() 가 app.innerHTML 로 화면을 통째로 갈아엎기 때문에 <video> 는 매번
   DOM 에서 떨어졌다 다시 붙습니다. 모바일 브라우저는 이때 재생을 멈추고,
   autoplay 속성은 최초 로드에만 적용되므로 저절로 다시 돌지 않습니다.
   그대로 두면 화면이 마지막 프레임에 얼어붙고, 감지기는 그 프레임을 계속
   분석해 영원히 '자리 비움'이 됩니다. 붙일 때마다 재생을 되살립니다. */
function mountCam() {
  const slot = app.querySelector('#camslot');
  if (!slot || !videoEl) return;
  if (videoEl.parentElement !== slot) slot.insertBefore(videoEl, slot.firstChild);
  if (videoEl.paused) videoEl.play().catch(() => {});
}
async function ensurePreview() {
  const p = S.profile || {};
  if (p.cam_enabled === false) { S.detector = new ManualDetector({ onState: onDetState }); return; }
  if (S.detector && !S.detector.manual && S.detector.ready) return;
  if (!videoEl) { videoEl = el('<video playsinline muted autoplay></video>'); }
  mountCam();   // DOM 밖의 비디오는 play() 가 영영 끝나지 않는다 — 슬롯이 있으면 먼저 꽂는다
  const d = new Detector({
    awaySec:   S.fast ? 3 : (p.away_threshold_sec ?? 20),
    drowsySec: S.fast ? 2 : (p.drowsy_threshold_sec ?? 8),
    drowsyOn:  p.drowsy_enabled !== false,
    poseOn:    p.drowsy_enabled !== false,   // 엎드림은 얼굴이 안 보이므로 Pose 가 있어야 잡힌다
    onState:   onDetState,
    onTick:    onDetTick,
    onLost:    onCamLost,
    onPhase:   (ph) => { if (ph === 'model') setCamState('감지 모델 내려받는 중 — 첫 실행은 오래 걸릴 수 있어요', true); },
  });
  S.detector = d;
  try {
    setCamState('카메라 여는 중', true);
    await d.start(videoEl);
    S.camFail = null;
    render();
    setCamState('착석 확인 중', true);
  } catch (e) {
    const why = d.failed === 'denied' ? '카메라 권한이 꺼져 있어요 — 수동 모드로 시작할 수 있습니다'
              : d.failed === 'model'  ? '감지 모델을 불러오지 못했습니다 — 수동 모드로 전환합니다'
              : '카메라를 열 수 없습니다 — 수동 모드로 전환합니다';
    toast(why);
    S.camFail = d.failed || 'nocam';       // 준비 화면이 원인별 카드를 그린다
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
  if (v.error) { setCamState(`감지 오류 · 복구 중 (${v.errStreak})`, false); return; }
  const txt = v.present ? (v.blink > 0.5 ? '눈 감김 감지' : '착석 확인 중')
            : v.body    ? '엎드림 감지'
            : '얼굴이 보이지 않아요';
  setCamState(txt, v.present && v.blink <= 0.5);
}

/* ── 구간 기록 큐 ─────────────────────────────────────────
   구간의 시각은 로컬이 진실입니다. 서버 호출이 실패해도 시각을 버리지 않고
   쌓아뒀다가 다시 보냅니다.

   이게 없으면 네트워크가 끊긴 동안의 이탈·졸음이 서버에 남지 않고,
   그 시간이 조용히 순공시간으로 계산됩니다.
   "앉아 있던 시간만 센다"는 이 앱의 약속이 거기서 깨집니다. */
const QKEY = 'span_queue';
const loadQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const saveQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch {} };
function queueSpan(item) { const q = loadQ(); q.push(item); saveQ(q); }

/* 이미 끝난 세션에는 구간을 넣을 수 없습니다 (서버가 P0002 로 거부).
   그런 항목은 몇 번을 다시 보내도 통과하지 못하므로 재시도 대상에서 뺍니다. */
const isDead = (e) => e?.code === 'P0002' || /active session not found/i.test(e?.message || '');

let flushing = false;
async function flushSpans(quiet = true) {
  if (flushing) return false;
  const q = loadQ(); if (!q.length) return true;
  flushing = true;
  const left = []; let dropped = 0;
  for (const it of q) {
    try {
      if (it.t === 'close') await db.closeSpan(it.sid, new Date(it.to));
      else { await db.openSpan(it.sid, it.kind, new Date(it.from)); await db.closeSpan(it.sid, new Date(it.to)); }
    } catch (e) {
      if (isDead(e)) { dropped++; continue; }
      left.push(it);
    }
  }
  saveQ(left); flushing = false;
  const sent = q.length - left.length - dropped;
  if (sent && !quiet) toast(`저장하지 못했던 구간 ${sent}개를 반영했어요`);
  if (dropped) toast(`구간 ${dropped}개는 세션이 이미 끝나 반영하지 못했습니다`);
  return left.length === 0;
}

/* 세션 도중 카메라가 끊겼을 때 — 다른 앱이 가져갔거나 권한이 회수된 경우.
   더 이상 관찰할 수 없으므로 열린 구간을 그 시점에 닫고 수동 모드로 넘긴다.
   그냥 두면 얼굴이 영영 안 보이는 것으로 읽혀 세션 내내 '자리 비움'이 된다. */
async function onCamLost() {
  const why = S.detector?.failed === 'model'
    ? '감지를 계속할 수 없어 수동 모드로 이어갑니다'
    : '카메라 연결이 끊겼어요 — 수동 모드로 이어갑니다';
  if (S.focus && S.route === 'focus' && S.focus.state !== 'ok') await onDetState('ok', S.focus.state);
  S.camFail = S.detector?.failed || 'nocam';
  S.detector = new ManualDetector({ onState: onDetState });
  toast(why);
  render();
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
  /* 화면부터 보여준다. 카메라·모델 로딩은 focus 렌더의 mountCam 이 비동기로 처리한다.
     여기서 ensurePreview 를 기다리면 폰에서 권한 프롬프트·모델 다운로드(10MB) 동안
     route 가 boot 에 묶여 '불러오는 중'에서 멈춘다 — 실기기에서 실제로 그랬다. */
  startTick();
  go('focus');
  ensurePreview();   // 기다리지 않는다 — 화면이 먼저, 카메라는 뒤에서
  toast('진행 중이던 세션을 이어서 잽니다');
}

let tickTimer, beatTimer;
function startTick() {
  clearInterval(tickTimer); clearInterval(beatTimer);
  tickTimer = setInterval(tick, 1000);
  beatTimer = setInterval(() => {
    if (!S.focus) return;
    db.heartbeat(S.focus.id).catch(() => {});
    flushSpans(false);
  }, 30000);
  keepAwake(true);
}
function stopTick() { clearInterval(tickTimer); clearInterval(beatTimer); keepAwake(false); }

/* ── 화면 꺼짐 방지 ──────────────────────────────────────
   모바일 브라우저는 화면이 꺼지면 타이머를 얼리고 카메라 프레임도 멈춥니다.
   책상에 세워두고 쓰는 앱이라 이게 없으면 30초 만에 측정이 죽습니다.
   Wake Lock 을 지원하지 않는 브라우저에서는 아래 visibilitychange 보정이 받아냅니다. */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on) {
      if (!wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } else if (wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch { wakeLock = null; }      // 배터리 절약 모드 등에서 거부될 수 있다 — 조용히 넘어간다
}

/* ── 화면이 꺼졌거나 다른 앱에 갔다 온 구간 처리 ──────────
   그동안 카메라는 아무것도 보지 못했습니다.
   본 적 없는 시간을 순공으로 세면 이 앱이 하는 말 전체가 거짓이 됩니다.
   그래서 그 구간은 통째로 '자리 비움'으로 넣습니다. 사용자가 정정할 수 있습니다. */
let hiddenAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  const gap = hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : 0;
  hiddenAt = 0;
  if (S.route === 'focus') keepAwake(true);       // Wake Lock 은 복귀 시 재요청해야 한다
  const f = S.focus;
  if (!f || gap < 3) return;

  f.gross += gap;                                 // 벽시계는 흘렀다
  if (f.state !== 'ok') { f.offSec += gap; render(); return; }   // 이미 빠지는 중이면 서버가 이어서 센다

  try {
    await db.openSpan(f.id, 'away', new Date(Date.now() - gap * 1000));
    await db.closeSpan(f.id);
    f.awayCount++;
    toast(`화면이 꺼져 있던 ${clock(gap)} 은 순공에서 뺐습니다`);
  } catch { /* 오프라인이면 서버 쪽은 다음 동기화에서 맞춰진다 */ }
  render();
});

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
  const now = new Date();
  let missed = false;

  /* 이전 구간 닫기 */
  if (prev !== 'ok' && f.spanFrom) {
    if (f.openSpanKind) {
      try { await db.closeSpan(f.id, now); }
      catch { queueSpan({ t: 'close', sid: f.id, to: now.toISOString() }); missed = true; }
    } else {
      /* 서버는 이 구간의 시작조차 모른다 — 통째로 다시 넣는다 */
      queueSpan({ t: 'span', sid: f.id, kind: prev, from: f.spanFrom, to: now.toISOString() });
      missed = true;
    }
    f.openSpanKind = null; f.spanFrom = null;
  }

  /* 새 구간 열기 — 서버가 실패해도 시작 시각은 로컬에 남긴다 */
  if (next !== 'ok') {
    f.spanFrom = now.toISOString();
    f.offSec = 0;
    if (next === 'away') f.awayCount++; else f.drowsyCount++;
    try { await db.openSpan(f.id, next, now); f.openSpanKind = next; }
    catch { f.openSpanKind = null; }
  }

  f.state = next;
  render();
  if (missed) toast('구간을 지금 저장하지 못했어요 — 연결되면 자동으로 반영됩니다');
  flushSpans();
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

  /* 열린 채 끝나는 구간부터 닫는다 — 안 닫으면 서버가 세션 끝까지 이탈로 센다 */
  const now = new Date();
  if (f.openSpanKind) {
    try { await db.closeSpan(f.id, now); }
    catch { queueSpan({ t: 'close', sid: f.id, to: now.toISOString() }); }
  } else if (f.spanFrom) {
    queueSpan({ t: 'span', sid: f.id, kind: f.state, from: f.spanFrom, to: now.toISOString() });
  }
  f.openSpanKind = null; f.spanFrom = null;

  /* 세션이 끝나면 서버는 그 세션에 구간을 더 받지 않습니다 (P0002).
     밀린 구간을 남긴 채 끝내면 그 이탈·졸음이 영영 기록되지 않고
     그 시간이 순공시간으로 남습니다. 그래서 다 밀어넣기 전에는 끝내지 않습니다. */
  const clean = await flushSpans();
  if (!clean && loadQ().some(it => it.sid === f.id)) {
    startTick();
    toast('아직 저장하지 못한 구간이 있어요 — 연결을 확인하고 종료를 다시 눌러주세요');
    render();
    return;
  }

  try {
    await db.endSession(f.id, now);
    S.detector?.stop?.();
    S.result = await db.sessionDetail(f.id);
    S.focus = null;
    go('result');
  } catch (e) {
    /* 세션을 버리지 않는다. 서버에는 아직 열려 있고 다시 시도할 수 있다.
       여기서 S.focus 를 비우면 사용자가 방금 공부한 시간이 화면에서 사라진다. */
    startTick();
    toast('기록을 저장하지 못했어요 — 연결을 확인하고 종료를 다시 눌러주세요');
    render();
  }
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
async function loadPlanner() { S.plan = await db.todosOn(S.planDate || kstToday()).catch(() => []); render(); }
async function loadWeek(delta = 0) {
  const base = S.wkBase || mondayOf();
  S.wkBase = delta ? addDays(base, delta * 7) : base;
  S.calMode = 'week';
  S.week = await db.calendarWeek(S.wkBase).catch(() => null);
  render();
}
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
    case 'retryCam': {
      S.detector?.stop?.(); S.detector = null; S.camFail = null;
      render();                      // '준비 중' 상태로 되돌리고
      ensurePreview();               // 처음부터 다시 붙인다 (getUserMedia + 모델)
      return;
    }
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
    /* ── 캘린더 월/주 ── */
    case 'calmode':
      if (v === 'week') { S.calMode = 'week'; if (!S.week) return loadWeek(0); }
      else { S.calMode = 'month'; }
      render(); return;
    case 'wk': return loadWeek(Number(v));

    /* ── 할 일 바텀시트 ── */
    case 'sheetAdd':
      T.id = null; T.title = ''; T.custom = false; T.shake = 0;
      R.subjectId = R.subjectId || S.subjects[0]?.id || null;
      R.goalMin = 30;
      S.sheet = sheetTodo; render(); return;
    case 'sheetClose': S.sheet = null; render(); return;
    case 'sheetCustom': T.custom = v === '1'; render(); return;
    case 'sheetSave': {
      const title = (T.title || '').trim();
      if (!title) { T.shake++; render(); return; }
      try {
        const row = { title, subject_id: R.subjectId, due_date: S.planDate || kstToday(), plan_min: R.goalMin };
        if (T.id) await db.updateTodo(T.id, row); else await db.addTodo(row);
        S.sheet = null;
        if (S.route === 'planner') await loadPlanner(); else { await loadHome(); render(); }
        toast(T.id ? '할 일을 수정했어요' : '할 일을 추가했어요');
      } catch (err) { toast(msg(err)); }
      return;
    }
    case 'sheetDel': {
      if (!T.id) { S.sheet = null; render(); return; }
      try {
        await db.deleteTodo(T.id); S.sheet = null;
        if (S.route === 'planner') await loadPlanner(); else { await loadHome(); render(); }
        toast('할 일을 지웠어요');
      } catch (err) { toast(msg(err)); }
      return;
    }

    /* ── 정정 되돌리기 취소 ── */
    case 'unrevert': {
      try { await db.unrevertSpan(v); S.result = await db.sessionDetail(S.result.session.id); render(); }
      catch (err) { toast(msg(err)); }
      return;
    }

    /* ── 내보내기 · 전체 삭제 ── */
    case 'exportData': {
      try {
        const data = await db.exportJson();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'),
          { href: URL.createObjectURL(blob), download: `순공-기록-${kstToday()}.json` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('기록을 내려받았어요');
      } catch (err) { toast(msg(err)); }
      return;
    }
    case 'deleteAll': {
      if (!confirm('기록을 전부 지웁니다. 세션·구간·정정 이력이 모두 사라지고 되돌릴 수 없습니다.\n\n계속할까요?')) return;
      try { await db.deleteAllRecords(); S.home = null; S.wkSum = null; S.cal = null; S.week = null; S.stats = null;
            await loadHome(); go('home'); toast('모든 기록을 지웠어요'); }
      catch (err) { toast(msg(err)); }
      return;
    }
    case 'corrections': toast(S.corr?.length ? `정정 ${S.corr.length}건 — 되돌린 구간은 순공시간에 이미 반영돼 있습니다` : '아직 되돌린 구간이 없습니다'); return;
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && S.route === 'auth') app.querySelector('[data-a="auth"]')?.click();
});
window.addEventListener('beforeunload', () => { S.detector?.stop?.(); });

boot();
