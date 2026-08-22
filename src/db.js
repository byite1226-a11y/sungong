import { createClient } from '@supabase/supabase-js';

const URL = 'https://wiezfwgevjvcoambrngh.supabase.co';
const KEY = 'sb_publishable_dyLT85AcBRx5W1VTxwz4mg_PLsK6KiC';

export const sb = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      }));

export function deviceId() {
  let d = localStorage.getItem('device_id');
  if (!d) { d = uuid(); localStorage.setItem('device_id', d); }
  return d;
}

async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

/* ── 인증 ─────────────────────────────────────── */
export const auth = {
  async signUp(email, password, nickname) {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    if (nickname && data.user) {
      await sb.from('profile').update({ nickname }).eq('id', data.user.id);
    }
    return data;
  },
  async signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  signOut: () => sb.auth.signOut(),
  async user() { const { data } = await sb.auth.getUser(); return data.user; },
};

/* ── 프로필 · 과목 ────────────────────────────── */
export async function getProfile() {
  const { data, error } = await sb.from('profile').select('*').single();
  if (error) throw error;
  return data;
}
export async function updateProfile(patch) {
  const { data, error } = await sb.from('profile').update(patch).select().single();
  if (error) throw error;
  return data;
}
export async function getSubjects() {
  const { data, error } = await sb.from('subject')
    .select('*').is('archived_at', null).order('sort_order');
  if (error) throw error;
  return data;
}

/* ── 세션 ─────────────────────────────────────── */
export const startSession = (clientId, o = {}) => rpc('fn_start_session', {
  p_client_id: clientId,
  p_subject_id: o.subjectId ?? undefined,
  p_todo_id: o.todoId ?? undefined,
  p_source: o.source ?? 'camera',
  p_goal_min: o.goalMin ?? undefined,
  p_pomodoro: o.pomodoro ?? false,
  p_device_id: deviceId(),
  p_started_at: new Date().toISOString(),
});
export const heartbeat = (id) => rpc('fn_heartbeat', { p_session_id: id, p_at: new Date().toISOString() });
export const openSpan = (id, kind, at = new Date()) =>
  rpc('fn_open_span', { p_session_id: id, p_kind: kind, p_started_at: at.toISOString(), p_client_id: uuid(), p_origin: 'auto' });
export const closeSpan = (id, at = new Date()) =>
  rpc('fn_close_span', { p_session_id: id, p_ended_at: at.toISOString() });
export const endSession = (id, at = new Date()) =>
  rpc('fn_end_session', { p_session_id: id, p_ended_at: at.toISOString() });
export const discardSession = (id) => rpc('fn_discard_session', { p_session_id: id });
export const resumeSession = () => rpc('fn_resume_session');
export const sessionDetail = (id) => rpc('fn_session_detail', { p_session_id: id });
export const revertSpan = (id) => rpc('fn_revert_span', { p_span_id: id });
export const unrevertSpan = (id) => rpc('fn_unrevert_span', { p_span_id: id });

/* ── 집계 ─────────────────────────────────────── */
export const today = () => rpc('fn_today');
export const streak = () => rpc('fn_streak');
export const calendarMonth = (y, m) => rpc('fn_calendar_month', { p_year: y, p_month: m });
export const calendarWeek = (monday) => rpc('fn_calendar_week', { p_monday: monday });
export const dayDetail = (d) => rpc('fn_day_detail', { p_date: d });
export const rangeSummary = (f, t) => rpc('fn_range_summary', { p_from: f, p_to: t });

/* ── 플래너 ───────────────────────────────────── */
export async function todosOn(date) {
  const { data, error } = await sb.from('v_todo_progress')
    .select('*').eq('due_date', date).order('sort_order');
  if (error) throw error;
  return data;
}
export async function addTodo(t) {
  const u = await auth.user();
  const { data, error } = await sb.from('todo').insert({ ...t, user_id: u.id }).select().single();
  if (error) throw error;
  return data;
}
export async function toggleTodo(id, done) {
  const { data, error } = await sb.from('todo')
    .update({ done_at: done ? new Date().toISOString() : null }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
export async function updateTodo(id, patch) {
  const { data, error } = await sb.from('todo').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
export async function deleteTodo(id) {
  const { error } = await sb.from('todo').delete().eq('id', id);
  if (error) throw error;
}

/* ── 데이터 관리 ─────────────────────────────── */
export const exportJson        = () => rpc('fn_export_json');
export const deleteAllRecords  = () => rpc('fn_delete_all_records');

export async function corrections(limit = 20) {
  const { data, error } = await sb.from('correction_log')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
