# RPC 계약 정본 — ssamplanner 백엔드 (`wiezfwgevjvcoambrngh`)

> **이 문서가 두 저장소(`ssamplanner-app` Flutter / `scheduler` 교사 웹)가 어긋나지 않게 하는
> 유일한 장치입니다.** RPC의 이름·인자·반환 모양을 바꾸려면 반드시 이 문서를 먼저 고치고,
> 양쪽 저장소에 반영하세요.
>
> **2026-08-25 서버 실조회로 정정.** 아래 시그니처는 문서 추정이 아니라 `public` 스키마
> 실물입니다. 이 문서와 코드가 다르면 코드가 틀린 것입니다.
> (이전 판의 `fn_set_threshold` · `fn_reorder_todos` · `fn_upsert_push_token` 은
> **서버에 존재하지 않아 삭제**했습니다. `push_token` 테이블은 있으나 RPC 는 없습니다.)
>
> - 전 SECURITY DEFINER 함수에 `SET search_path=""` 확인 완료. `require_uid()` 는
>   SECURITY DEFINER 가 아님(정상 — auth.uid() 를 호출자 문맥에서 읽어야 함).
>   신규 RPC 도 동일 규율: **SECURITY DEFINER + `SET search_path TO ''` + 첫 줄 `require_uid()`**.
> - 시간 규약: **KST 고정 · 주 시작 월요일.** date 인자는 `YYYY-MM-DD`, timestamptz 는 ISO 8601.

## 0. Postgres enum 4종 — 문자열이 글자 단위로 정본

```
span_kind      : away | drowsy | pause | break
span_origin    : auto | manual
session_source : camera | manual
session_status : active | ended | discarded
```

⚠️ `break` 는 Dart/JS 예약어 계열 — 클라이언트 enum 이름이 무엇이든 **전송 문자열은
`break`** 여야 한다 (Dart 의 `.name` 그대로 보내는 실수 주의).

## 1. RPC 25개 (서버 실물)

### 1-1. jsonb 반환 (16)

| RPC | 인자 |
|---|---|
| `fn_add_span` | `p_session_id uuid, p_kind span_kind, p_started_at timestamptz, p_ended_at timestamptz` |
| `fn_calendar_month` | `p_year int, p_month int` |
| `fn_calendar_week` | `p_monday date` |
| `fn_day_detail` | `p_date date` |
| `fn_delete_all_records` | — |
| `fn_delete_span` | `p_span_id uuid` |
| `fn_edit_span` | `p_span_id uuid, p_started_at timestamptz, p_ended_at timestamptz` |
| `fn_export_json` | — |
| `fn_range_summary` | `p_from date, p_to date` |
| `fn_resume_session` | — |
| `fn_revert_span` | `p_span_id uuid` |
| `fn_session_detail` | `p_session_id uuid` |
| `fn_streak` | — |
| `fn_sync_session` | `p_payload jsonb` — ⚠️ 웹 정본(src/db.js)에 호출부 없음. **payload 스키마 미확정 — 지어내지 말 것** |
| `fn_today` | — |
| `fn_unrevert_span` | `p_span_id uuid` |

### 1-2. 복합 행(row) 반환 (7) — **jsonb 아님. PostgREST 가 단일 객체로 반환**

| RPC | 인자 (기본값 포함) | 반환 행 |
|---|---|---|
| `fn_close_span` | `p_session_id uuid, p_ended_at timestamptz = now()` | `session_span` |
| `fn_defer_todo` | `p_todo_id uuid, p_days int = 1` | `todo` |
| `fn_discard_session` | `p_session_id uuid` | `session` |
| `fn_end_session` | `p_session_id uuid, p_ended_at timestamptz = now()` | `session` |
| `fn_heartbeat` | `p_session_id uuid, p_at timestamptz = now()` | `session` |
| `fn_open_span` | `p_session_id uuid, p_kind span_kind, p_started_at timestamptz = now(), p_client_id text = null, p_origin span_origin = 'auto'` | `session_span` |
| `fn_start_session` | `p_client_id text` (**유일한 필수 인자**), `p_subject_id uuid = null, p_todo_id uuid = null, p_source session_source = 'camera', p_goal_min int = null, p_pomodoro bool = false, p_device_id text = null, p_started_at timestamptz = now()` | `session` |

> ⛔ **함정 1:** `fn_close_span` 의 첫 인자는 `p_span_id` 가 아니라 **`p_session_id`** —
> 세션 기준으로 열린 구간을 닫는다. `fn_delete_span`·`fn_edit_span`·`fn_revert_span`·
> `fn_unrevert_span` 이 `p_span_id` 다.
> ⛔ **함정 2:** 이 7개를 jsonb 파서로 처리하면 깨진다.

### 1-3. int 반환 (2)

| RPC | 인자 |
|---|---|
| `fn_close_stale_sessions` | `p_grace interval = '00:10:00'` — interval 은 `'00:10:00'` 문자열로 전달 |
| `fn_materialize_todos` | `p_from date, p_to date` |

### 1-4. fn_open_span 의 P0002

활성 세션이 없으면 `P0002` 로 거절한다 — 클라이언트 구간 큐가 이 코드를 보고 재시도를
포기하고 사용자에게 알린다. **큐가 비기 전에 세션을 끝내면 그 시간이 영영 못 들어간다.**

## 2. 테이블 (8)

| 테이블 | 비고 |
|---|---|
| `profile` | 목표·카메라·졸음 토글, **`away_threshold_sec` / `drowsy_threshold_sec` (사용자별 임계값 override — 웹 정본이 실제로 읽는다: `p.away_threshold_sec ?? 20`)**, 포모도로 5종, 알림 4종 |
| `session` | `client_id`, `device_id`, `source`, `status`, `last_beat_at`, `goal_min`, `pomodoro` |
| `session_span` | `kind`, `origin`, `started_at`, `ended_at`, **`reverted_at`**, `edited_at`, `client_id` |
| `subject` | 이름·색·정렬·보관 |
| `todo` | `subject_id`, `recurrence_id`, `due_date`, `plan_min`, `done_at` |
| `todo_recurrence` | `freq`, `byweekday ARRAY`, `starts_on`, `ends_on`, `active` |
| `correction_log` | 정정 이력. **`threshold_before` / `threshold_after`** — 임계값 자동 조정 흐름이 설계에 있음 |
| `push_token` | `token`, `platform`, `device_id`, `last_seen_at` — **전용 RPC 는 아직 없다** |

⛔ **숙제(AI 판독) 테이블·RPC 는 서버에 하나도 없다** (2026-08-25 전수 확인).
Flutter 스텁이 `HomeworkRpcNotDeployed` 를 던지는 구현이 정확하며 유지한다.

## 3. 뷰 (3) — ⛔ 순공 계산의 정본

```
v_session_net   id, user_id, subject_id, todo_id, status, source, pomodoro, goal_min,
                started_at, ended_at, eff_end, day_kst,
                gross_sec, excluded_sec, net_sec,
                away_sec, away_count, drowsy_sec, drowsy_count,
                pause_sec, break_sec, break_count, reverted_count
v_daily_net     user_id, day_kst, net_sec, gross_sec, excluded_sec,
                away_count, drowsy_count, session_count
v_todo_progress todo 전 컬럼 + actual_sec, actual_min, session_count
```

**순공시간의 정본은 서버 뷰다.** `net = gross − Σ(away+drowsy+pause+break)` ·
저장 금지 · 조회 시 계산은 이 뷰로 구현돼 있다.
클라이언트 계산(`net_time.dart`)은 **진행 중 세션의 실시간 표시 전용** — 이력·통계를
클라이언트에서 재계산하면 홈과 통계 숫자가 갈린다. revert(`reverted_at`)·`eff_end`
클램프 규칙이 뷰와 일치하는지 정합 테스트로 지킨다.

## 4. 직접 테이블 접근 (RPC 아님 — 웹앱이 쓰는 범위)

| 대상 | 접근 | 비고 |
|---|---|---|
| `profile` | select single / update | 닉네임·설정·임계값 |
| `subject` | select (`archived_at is null`, `sort_order` 정렬) | 과목 5색 |
| `todo` | insert / update / delete | `user_id` 명시 삽입 |
| `v_todo_progress` (뷰) | select (`due_date`, `sort_order`) | 플래너 목록 |
| `correction_log` | select (최신순) | 정정 이력 |

> 🔑 **신규 숙제 데이터는 이 절에 추가하지 마세요. 전부 RPC 뒤에** (아래 6장).

## 5. 반환 모양 (웹앱 실사용 관측 — 필드를 빼면 클라이언트가 깨진다)

| RPC | 반환 (관측) |
|---|---|
| `fn_resume_session` | `{ session, net_sec, gross_sec }` — 활성 세션 없으면 null/빈값 |
| `fn_session_detail` | `{ session: { id, started_at, ended_at, eff_end, … }, spans: [{ id, kind, started_at, ended_at, seconds, reverted }] }` |
| `fn_today` | `{ net_sec, goal_min, todos: […] }` |
| `fn_streak` | `{ current, longest }` |
| `fn_calendar_month` | `{ from, to, total_sec, studied_days, streak: { longest }, days: […] }` |
| `fn_calendar_week` | `{ from, to, days: [{ day, net_sec }], sessions: [{ started_at, ended_at, subject_id }] }` |
| `fn_day_detail` | `{ day, net_sec, sessions: […] }` |
| `fn_range_summary` | `{ total_sec, prev_total_sec, studied_days, by_subject, by_weekday, by_hour_bucket, pattern }` |

## 6. 신규 RPC — AI 숙제검사 (설계 확정 v3.1 · 미구현)

전부 첫 줄 `require_uid()` + `SET search_path TO ''`.

**마크 6종 (v3.1 §4-4 — 실제 채점 관습):** `circle`(정답) · `slash`(사선만 = 오답) ·
`triangle`(사선 위에 △ 덧그림 = **오답→해결**) · `question`(☆·? = 질문) ·
`check`(✓ = 채점과 무관, 집계 제외) · `unmarked`. 풀이 `solved|blank|partial`.

> ⚠️ v3의 「△=부분 정답, ☆=다시 볼 것」은 **틀린 정의**였습니다. 복습 큐 의미가 바뀝니다:
> `slash`만 남은 문항이 복습 큐(`resolved_at IS NULL`), `triangle`은 종이에서 이미 고친 것이라
> 큐에서 빠지고, `question`은 복습 큐가 아니라 **별도 질문 목록**(Phase 2에서 선생님에게 전달).

| RPC | 인자(설계) | 하는 일 |
|---|---|---|
| `fn_create_homework` | `p_client_id`(멱등) · `p_subject_id` · `p_todo_id?` | 제출 단위 생성 → `homework` (draft) |
| `fn_attach_photo` | `p_homework_id` · `p_path` · `p_ord` | 업로드된 사진 등록 |
| `fn_submit_homework` | `p_homework_id` | status→reading, Edge Function `grade-read` 트리거 |
| `fn_set_item_mark` | `p_item_id` · `p_mark` · `p_work` | 학생 정정 — 두 축 다. `source='user'`, `corrected_at` 기록 |
| `fn_homework_detail` | `p_homework_id` | 문항 그리드: `[{ item_no, mark, work, mark_confidence, work_confidence, source }]` |
| `fn_homework_check` | `p_homework_id` | 수행 검사 요약 — `{ total, solved, blank, unmarked }` **개수. 퍼센트 금지** |
| `fn_flag_pages` | `p_homework_id` | **확인 필요 페이지** 두 종류를 각각 반환 — 판독 의심(저신뢰 다수)과 내용 의심(`circle×blank`·`unmarked×solved`·빈칸 다수). 완성 비율(%) 대신 쓰는 플래그 (v3.1 §6-3) |
| `fn_achievement_summary` | `p_from` · `p_to` | 오답률 · 미해결 오답 · 질문 수 · 빈칸 집계 (fn_range_summary 와 같은 기간 규약) |
| `fn_review_queue` | (없음) | **`slash` 이고 `resolved_at IS NULL`** 인 문항, 날짜순. (`triangle`은 해결된 것 — 제외) |
| `fn_question_list` | (없음) | `question` 문항 목록 — 복습 큐와 별도 (이름 미확정, v3.1 §4-4·§6-4의 "질문 목록") |
| `fn_resolve_review` | `p_item_id` | 복습 완료 처리 (`resolved_at` 기록). 종이에 △를 덧그린 경우 재제출 판독이 같은 효과 |

> 참고: v3.1 본문은 "RPC 11개"라 하면서 표에는 9개만 명시하고 §6-3에서 `fn_flag_pages`를
> 추가로 언급합니다. 위 표는 그 10개에 질문 목록 조회(가칭 `fn_question_list`)를 더해 11개로
> 맞춘 것입니다 — **이름·시그니처는 구현 전에 확정하고 이 문서를 먼저 고치세요.**

스키마(설계): `homework` · `homework_photo` · `homework_item` · `ai_read_run` — 컬럼 정의는
설계서 v3.1 §4-5 (`mark` enum은 6종). 불변식: `(homework_id, item_no)` 부분 유니크 ·
`client_id` 유니크 · `*_confidence`·`source` 컬럼 GRANT 잠금.

## 변경 절차

1. 이 문서를 먼저 고친다 (PR).
2. 마이그레이션은 **Supabase CLI 이력**으로만 적용한다. Management API 직접 적용 금지
   (기존 쌤플래너에서 `schema_migrations` 누락 사고 전례).
3. `ssamplanner-app`(Flutter)과 `scheduler`(교사 웹) 양쪽에서 이 문서 기준으로 호출부를 맞춘다.
