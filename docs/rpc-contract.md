# RPC 계약 정본 — ssamplanner 백엔드 (`wiezfwgevjvcoambrngh`)

> **이 문서가 두 저장소(`ssamplanner-app` Flutter / `scheduler` 교사 웹)가 어긋나지 않게 하는
> 유일한 장치입니다.** RPC의 이름·인자·반환 모양을 바꾸려면 반드시 이 문서를 먼저 고치고,
> 양쪽 저장소에 반영하세요.
>
> - 인자 목록의 정본은 이 저장소의 `src/db.js` 입니다 (웹앱 = 살아있는 명세서).
> - 반환 모양은 웹앱 `src/main.js` 의 실사용에서 추출했습니다. `(관측)` 표시는 화면 코드가
>   실제로 읽는 필드만 적었다는 뜻입니다 — DB에는 더 있을 수 있지만, **여기 적힌 필드를
>   빼거나 모양을 바꾸면 클라이언트가 깨집니다.**
> - 전 RPC `SECURITY DEFINER` + 첫 줄 `require_uid()` + `SET search_path TO ''`.
>   RLS 규칙은 `user_id = auth.uid()` 하나입니다.
> - 시간 규약: **KST 고정 · 주 시작 월요일.** 날짜 인자는 `YYYY-MM-DD` 문자열,
>   시각 인자는 ISO 8601 (`toISOString()`).

## 1. 세션 (10)

| RPC | 인자 | 반환 (관측) |
|---|---|---|
| `fn_start_session` | `p_client_id` uuid(멱등) · `p_subject_id?` · `p_todo_id?` · `p_source` `'camera'\|'manual'` · `p_goal_min?` · `p_pomodoro` bool · `p_device_id` · `p_started_at` ISO | 세션 행: `id`, `subject_id`, `goal_min`, … |
| `fn_heartbeat` | `p_session_id` · `p_at` ISO | — |
| `fn_open_span` | `p_session_id` · `p_kind` `'away'\|'drowsy'\|'pause'\|'break'` · `p_started_at` ISO · `p_client_id` uuid · `p_origin` `'auto'\|'manual'` | 열린 span. **활성 세션이 없으면 `P0002` 에러** — 클라이언트 큐가 이 코드를 보고 재시도를 포기한다 |
| `fn_close_span` | `p_session_id` · `p_ended_at` ISO | — |
| `fn_end_session` | `p_session_id` · `p_ended_at` ISO | — |
| `fn_discard_session` | `p_session_id` | — |
| `fn_resume_session` | (없음) | `{ session, net_sec, gross_sec }` — 활성 세션 없으면 null/빈값 |
| `fn_session_detail` | `p_session_id` | `{ session: { id, started_at, ended_at, eff_end, … }, spans: [{ id, kind, started_at, ended_at, seconds, reverted }] }` |
| `fn_revert_span` | `p_span_id` | — (오탐 정정: 구간을 순공으로 되돌림) |
| `fn_unrevert_span` | `p_span_id` | — |

## 2. 집계 (6)

| RPC | 인자 | 반환 (관측) |
|---|---|---|
| `fn_today` | (없음) | `{ net_sec, goal_min, todos: [{ id, title, done_at, plan_min, … }] }` |
| `fn_streak` | (없음) | `{ current, longest }` |
| `fn_calendar_month` | `p_year` · `p_month` (1–12) | `{ from, to, total_sec, studied_days, streak: { longest }, days: [{ day, … }] }` |
| `fn_calendar_week` | `p_monday` `YYYY-MM-DD` | `{ from, to, days: [{ day, net_sec }], sessions: [{ started_at, ended_at, subject_id }] }` |
| `fn_day_detail` | `p_date` `YYYY-MM-DD` | `{ day, net_sec, sessions: […] }` |
| `fn_range_summary` | `p_from` · `p_to` | `{ total_sec, prev_total_sec, studied_days, by_subject, by_weekday, by_hour_bucket, pattern }` |

> ⚠️ **순공시간(net)은 어디에도 저장되지 않습니다.** `net = gross − Σ(away+drowsy+pause+break)`
> 를 집계 RPC가 조회 시점에 계산합니다. 클라이언트에서도 캐시하지 마세요 —
> `fn_revert_span` 정정이 소급 반영되어야 합니다.

## 3. 데이터 관리 (2)

| RPC | 인자 | 반환 |
|---|---|---|
| `fn_export_json` | (없음) | 전체 기록 JSON |
| `fn_delete_all_records` | (없음) | — |

## 4. UI 미구현 (7) — 서버는 완성, 화면만 없음

| RPC | 기능 |
|---|---|
| `fn_defer_todo` | 내일로 미루기 |
| `fn_materialize_todos` | 반복 할 일 생성 |
| `fn_edit_span` | 구간 경계 수동 편집 |
| `fn_reorder_todos` | 할 일 순서 변경 |
| `fn_sync_session` | 오프라인 세션 동기화 |
| `fn_set_threshold` | 임계값 직접 조정 |
| `fn_upsert_push_token` | 푸시 토큰 |

## 5. 직접 테이블 접근 (RPC 아님 — 웹앱이 쓰는 것)

| 대상 | 접근 | 비고 |
|---|---|---|
| `profile` | select single / update | 닉네임·설정 |
| `subject` | select (`archived_at is null`, `sort_order` 정렬) | 과목 5색 |
| `todo` | insert / update / delete | `user_id` 명시 삽입 |
| `v_todo_progress` (뷰) | select (`due_date`, `sort_order`) | 플래너 목록 |
| `correction_log` | select (최신순) | 정정 이력 |

> 🔑 **신규 숙제 데이터는 이 절에 추가하지 마세요.** 전부 RPC 뒤에 둡니다 (아래 6장).
> Phase 2에서 "선생님이 본다"를 붙일 때 RLS 정책이 아니라 RPC 안 WHERE 절 하나만 고치기
> 위한 결정입니다 (설계서 v3 §4-5).

## 6. 신규 RPC 9 — AI 숙제검사 (설계 확정 · 미구현)

전부 첫 줄 `require_uid()` + `SET search_path TO ''`. 마크 `circle|slash|triangle|star|unmarked` ·
풀이 `solved|blank|partial`.

| RPC | 인자(설계) | 하는 일 |
|---|---|---|
| `fn_create_homework` | `p_client_id`(멱등) · `p_subject_id` · `p_todo_id?` | 제출 단위 생성 → `homework` (draft) |
| `fn_attach_photo` | `p_homework_id` · `p_path` · `p_ord` | 업로드된 사진 등록 |
| `fn_submit_homework` | `p_homework_id` | status→reading, Edge Function `grade-read` 트리거 |
| `fn_set_item_mark` | `p_item_id` · `p_mark` · `p_work` | 학생 정정 — 두 축 다. `source='user'`, `corrected_at` 기록 |
| `fn_homework_detail` | `p_homework_id` | 문항 그리드: `[{ item_no, mark, work, mark_confidence, work_confidence, source }]` |
| `fn_homework_check` | `p_homework_id` | 수행 검사 요약 — `{ total, solved, blank, unmarked }` **개수. 퍼센트 금지** |
| `fn_achievement_summary` | `p_from` · `p_to` | 오답률 · △비율 · ☆미해결 · 빈칸 집계 (fn_range_summary 와 같은 기간 규약) |
| `fn_review_queue` | (없음) | `resolved_at IS NULL` 인 slash/star 문항, 날짜순 |
| `fn_resolve_review` | `p_item_id` | 복습 완료 처리 (`resolved_at` 기록) |

스키마(설계): `homework` · `homework_photo` · `homework_item` · `ai_read_run` — 컬럼 정의는
설계서 v3 §4-5. 불변식: `(homework_id, item_no)` 부분 유니크 · `client_id` 유니크 ·
`*_confidence`·`source` 컬럼 GRANT 잠금.

## 변경 절차

1. 이 문서를 먼저 고친다 (PR).
2. 마이그레이션은 **Supabase CLI 이력**으로만 적용한다. Management API 직접 적용 금지
   (기존 쌤플래너에서 `schema_migrations` 누락 사고 전례).
3. `ssamplanner-app`(Flutter)과 `scheduler`(교사 웹) 양쪽에서 이 문서 기준으로 호출부를 맞춘다.
