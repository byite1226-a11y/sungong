/* 아이콘 — 24 그리드 · stroke 1.75 · round cap/join · fill 없음 (play만 예외) */
const P = {
  home:'<path d="M3.4 10.2 12 3.5l8.6 6.7"/><path d="M5.8 9.1v11.4h12.4V9.1"/>',
  cal:'<rect x="3.5" y="5" width="17" height="15.5" rx="3.4"/><path d="M8.2 3.2v3.6M15.8 3.2v3.6M3.5 10.2h17"/>',
  check_sq:'<path d="M20.5 11.4V18.9a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6V5.1a1.6 1.6 0 0 1 1.6-1.6h9.6"/><path d="M8.1 11.5l3.3 3.3L21 5.2"/>',
  chart:'<path d="M5 20.3V12.4M12 20.3V4.4M19 20.3v-5.6"/>',
  cam:'<path d="M3.6 8.9a2 2 0 0 1 2-2h1.9l1.3-2.2h6.4l1.3 2.2h1.9a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.4"/>',
  shield:'<path d="M12 3.2 4.9 6v5.4c0 4.3 2.9 7.6 7.1 9.4 4.2-1.8 7.1-5.1 7.1-9.4V6z"/><path d="M9.1 12.1l2.1 2.2 3.9-4.2"/>',
  eye:'<path d="M3.6 11.2c2.6 3.5 5.5 5.2 8.4 5.2s5.8-1.7 8.4-5.2"/><path d="M5.4 14.2 4 16.5M12 16.4v2.5M18.6 14.2 20 16.5M8.5 15.9v2.3M15.5 15.9v2.3"/>',
  play:'<path d="M8.6 5.4 18.8 12 8.6 18.6z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M9.2 5.5v13M14.8 5.5v13"/>',
  stop:'<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.4" fill="currentColor" stroke="none"/>',
  left:'<path d="M14.6 5.4 8 12l6.6 6.6"/>',
  right:'<path d="M9.4 5.4 16 12l-6.6 6.6"/>',
  plus:'<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  minus:'<path d="M5.2 12h13.6"/>',
  check:'<path d="M5.2 12.5l4.6 4.6L18.9 6.7"/>',
  x:'<path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/>',
  clock:'<circle cx="12" cy="12" r="8.4"/><path d="M12 7.3V12l3.2 2"/>',
  gear:'<path d="M4 7.2h9.2M17.6 7.2h2.4M4 16.8h2.6M11 16.8h9"/><circle cx="15.4" cy="7.2" r="2.3"/><circle cx="8.8" cy="16.8" r="2.3"/>',
  alert:'<circle cx="12" cy="12" r="8.4"/><path d="M12 7.5v5.1"/><path d="M12 16.2h.01"/>',
  pencil:'<path d="M4.6 19.4h4L19.1 8.9a2.1 2.1 0 0 0-3-3L5.6 16.4z"/>',
  trash:'<path d="M4.8 6.6h14.4M9.4 6.6V4.4h5.2v2.2M6.6 6.6l1 12.2a1.6 1.6 0 0 0 1.6 1.5h5.6a1.6 1.6 0 0 0 1.6-1.5l1-12.2"/>',
  seat:'<path d="M7 4.6h10v7H7z"/><path d="M4.8 11.8h14.4v3.4H4.8z"/><path d="M7.4 15.6v3.8M16.6 15.6v3.8"/>',
  bolt:'<path d="M13.4 3.4 5.8 13.4h5.2l-.6 7.2 7.8-10.2h-5.4z"/>',
  coffee:'<path d="M4.6 10.2h12v6.2a3 3 0 0 1-3 3H7.6a3 3 0 0 1-3-3z"/><path d="M16.6 11.6h1.6a2.2 2.2 0 0 1 0 4.4h-1.6"/><path d="M8.4 4.4v2.6M12.4 4.4v2.6"/>',
  bell:'<path d="M17.6 15.4V10.6a5.6 5.6 0 1 0-11.2 0v4.8L4.8 17.6h14.4z"/><path d="M10.2 20.2a2 2 0 0 0 3.6 0"/>',
  out:'<path d="M14.4 15.6v2.8a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8V5.6a1.8 1.8 0 0 1 1.8-1.8h6.4a1.8 1.8 0 0 1 1.8 1.8v2.8"/><path d="M9.6 12h10M16.4 8.8 19.6 12l-3.2 3.2"/>',
};
export const ic = (n, s = 20, w = 1.75) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;

/* ── 포맷 ─────────────────────────────────────── */
export const pad = n => String(n).padStart(2, '0');
export const clock = s => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)}`;
export const mmss  = s => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s) % 60)}`;
export function hm(sec) {
  if (sec == null) return '—';
  const m = Math.round(sec / 60), h = Math.floor(m / 60), mm = m % 60;
  return h ? (mm ? `${h}시간 ${mm}분` : `${h}시간`) : `${mm}분`;
}
export function hmBig(sec) {
  const m = Math.round(sec / 60), h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}<span class="u">시간</span> ${mm}<span class="u">분</span>`
           : `${mm}<span class="u">분</span>`;
}
export const hmc = min => `${Math.floor(min / 60)}:${pad(min % 60)}`;

/* KST 기준 날짜 도구 */
export const kstNow = () => new Date(Date.now() + 9 * 3600e3);
export const kstToday = () => kstNow().toISOString().slice(0, 10);
export function mondayOf(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600e3);
  k.setUTCDate(k.getUTCDate() - ((k.getUTCDay() + 6) % 7));
  return k.toISOString().slice(0, 10);
}
export const DOW = ['월', '화', '수', '목', '금', '토', '일'];
export const dowOf = iso => DOW[(new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7];
export const hhmm = iso => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/* ── 구간 4종 ─────────────────────────────────── */
export const SPAN = {
  away:   { name: '자리 비움', fill: 'var(--acc)',  op: .55, tex: '',        revert: true  },
  drowsy: { name: '졸음',      fill: 'var(--acc)',  op: .55, tex: 'stripe',  revert: true  },
  pause:  { name: '일시정지',  fill: 'var(--tx-3)', op: .4,  tex: '',        revert: false },
  break:  { name: '휴식',      fill: 'var(--tx-3)', op: .4,  tex: 'dotted',  revert: false },
};

/* ── 링 ───────────────────────────────────────── */
export function ring(pct, o = {}) {
  const size = o.size || 250, sw = o.sw || 10;
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring ${o.boot ? 'boot' : ''}" width="${size}" height="${size}"
      viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${o.track||'var(--ring-track)'}" stroke-width="${sw}"/>
    <circle class="val" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${o.color||'var(--pri)'}"
      stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}"
      stroke-dashoffset="${(c * (1 - Math.max(0, Math.min(1, pct)))).toFixed(1)}"/>
  </svg>`;
}

/* ── DOM ──────────────────────────────────────── */
export const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

let toastTimer;
export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = el('<div class="toast"></div>'); document.querySelector('.app').appendChild(t); }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
