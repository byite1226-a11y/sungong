/**
 * Phase A — 판독 실행기 (v3.1)
 *
 *   eval/photos 의 숙제 사진을 VLM에 보여주고, 문항별로
 *   ① 채점 기호(mark 6종) ② 풀이 흔적(work 3종) 을 읽어 runs/ 에 기록합니다.
 *
 *   사용:  node read.mjs --photos photos                       # Gemini Flash-Lite (기본)
 *          node read.mjs --provider gemini --model gemini-3.1-flash-lite --media-res medium
 *          node read.mjs --provider anthropic --model claude-opus-5
 *   필요:  GEMINI_API_KEY (⚠️ 반드시 유료 티어 키 — 무료 티어는 숙제 사진이 모델 학습에
 *          쓰여 프라이버시 약속(v3.1 §8-4)이 무너집니다) 또는 ANTHROPIC_API_KEY
 *
 *   측정 원칙 (v3.1 §8-3):
 *   - temperature 0 — 샘플링 노이즈와 프롬프트 효과가 섞이면 개선 여부를 알 수 없다
 *   - media_resolution 명시 고정 — 기본값에 맡기면 실행마다 토큰이 달라진다
 *   - 429/529 지수 백오프 — 한 번 실패로 사진을 영구 에러로 만들지 않는다
 *   - 출력은 압축 포맷 한 줄/문항 — 출력 단가가 입력의 4~8배다
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};

const PROVIDER   = arg('provider', 'gemini');
// 기본 모델: 2.5 Flash-Lite 는 신규 사용자에게 404 로 막혀 있어(실측) 3.1 Flash-Lite 로 둔다
const MODEL      = arg('model', PROVIDER === 'gemini' ? 'gemini-3.1-flash-lite' : 'claude-opus-5');
const PROMPT_VER = arg('prompt', 'v2');
const MEDIA_RES  = arg('media-res', 'medium');       // gemini 전용: low | medium | high
const PHOTOS_DIR = path.resolve(here, arg('photos', 'photos'));

/* 마크 6종 (v3.1 §4-4 정본) · work 3종 — 코드는 한 글자 */
export const MARK_CODE = { c: 'circle', s: 'slash', t: 'triangle', q: 'question', k: 'check', u: 'unmarked' };
export const WORK_CODE = { s: 'solved', b: 'blank', p: 'partial' };

export const PROMPTS = {
  /* v2 — 마크 6종 재정의 반영. △는 "부분 정답"이 아니라 사선 위에 덧그린 해결 표시,
     ☆·? 는 질문, ✓ 는 채점과 무관한 별도 값이다 (v1의 5종 체계는 폐기). */
  v2: `당신은 학생이 이미 채점을 끝낸 숙제 사진을 읽는 판독기입니다.

절대 하지 말 것:
- 문제를 풀지 마세요. 답이 맞았는지 스스로 판단하지 마세요.
- 읽을 것은 오직 두 가지입니다: ① 학생이 이미 그려 놓은 채점 기호 ② 손글씨 필기의 유무.
- 사진에서 문항 번호를 식별할 수 없는 항목은 출력에서 빼세요. 번호를 지어내지 마세요.

[기호] 각 문항 번호 옆·위의 채점 기호를 다음 중 하나로 판정하세요:
- c : 동그라미(○). 정답 표시.
- s : 사선(/, ＼)만 있음. 오답 표시.
- t : 사선 위에 세모(△)를 덧그림. 오답을 다시 풀어 해결했다는 표시입니다.
      △는 사선을 시각적으로 포함합니다 — 사선이 보이면 그 위에 세모가 겹쳐 있는지 반드시 확인하세요.
      s 와 t 의 구분이 이 판독에서 가장 중요합니다.
- q : 별(☆, ★) 또는 물음표(?). 질문 표시 — 둘은 같은 뜻입니다.
- k : 체크(✓, ✔). 채점과 무관한 표시입니다. 오답이 아닙니다.
- u : 채점 기호가 없음.

[풀이] 그 문항 영역의 손글씨 흔적을 판정하세요:
- s : 손글씨 풀이나 답이 적혀 있음.
- b : 손글씨가 없음. 인쇄된 문제 텍스트·보기 번호·도표는 필기가 아닙니다. 손글씨만 봅니다.
- p : 풀이가 일부만 있음 (시작하다 만 흔적).

출력 형식 — 문항마다 정확히 한 줄, 다른 텍스트 없이:
문항번호:기호:풀이:기호확신도:풀이확신도
확신도는 0~100 정수입니다. 잘 안 보이면 낮게 주세요.

예시:
1:c:s:95:90
2:s:s:90:95
3:t:s:70:90
4:u:b:95:95`,
};

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const LINE_RE = /^(\d+)\s*:\s*([cstqku])\s*:\s*([sbp])\s*:\s*(\d{1,3})\s*:\s*(\d{1,3})$/;

function parseItems(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[-*`>\s]+|[`\s]+$/g, '');
    if (!line) continue;
    const m = line.match(LINE_RE);
    if (!m) continue;                                  // 서문·후문 줄은 무시한다
    items.push({
      item_no: Number(m[1]),
      mark: MARK_CODE[m[2]],
      work: WORK_CODE[m[3]],
      mark_confidence: Math.min(100, Number(m[4])) / 100,
      work_confidence: Math.min(100, Number(m[5])) / 100,
    });
  }
  if (!items.length) throw new Error('압축 포맷 줄을 하나도 찾지 못함');
  return items;
}

/* 429·529·5xx 는 지수 백오프로 재시도한다 (2s → 4s → 8s) */
async function withRetry(fn) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const st = e.status ?? e.response?.status;
      if (![429, 500, 502, 503, 529].includes(st)) throw e;
      if (i < 3) await new Promise(r => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw last;
}

async function callAnthropic(mediaType, data, prompt) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  callAnthropic.client ??= new Anthropic();
  const res = await withRetry(() => callAnthropic.client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: prompt },
      ],
    }],
  }));
  return {
    text: res.content.filter(b => b.type === 'text').map(b => b.text).join(''),
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
  };
}

async function callGemini(mediaType, data, prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 없습니다 (유료 티어 키만 사용할 것 — §8-4)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: mediaType, data } },
      { text: prompt },
    ]}],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8000,
      mediaResolution: `MEDIA_RESOLUTION_${MEDIA_RES.toUpperCase()}`,   // 명시 고정 — 원가 측정이 흔들리지 않게
    },
  };
  const res = await withRetry(async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  });
  const text = (res.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const u = res.usageMetadata || {};
  return { text, usage: { input_tokens: u.promptTokenCount ?? 0, output_tokens: u.candidatesTokenCount ?? 0 } };
}

const CALL = { anthropic: callAnthropic, gemini: callGemini };

const prompt = PROMPTS[PROMPT_VER];
if (!prompt) { console.error(`알 수 없는 프롬프트 버전: ${PROMPT_VER} (있는 것: ${Object.keys(PROMPTS)})`); process.exit(1); }
if (!CALL[PROVIDER]) { console.error(`알 수 없는 프로바이더: ${PROVIDER} (anthropic | gemini)`); process.exit(1); }
if (!fs.existsSync(PHOTOS_DIR)) { console.error(`사진 폴더가 없습니다: ${PHOTOS_DIR}`); process.exit(1); }

const files = fs.readdirSync(PHOTOS_DIR).filter(f => MEDIA[path.extname(f).toLowerCase()]).sort();
if (!files.length) { console.error(`사진이 없습니다: ${PHOTOS_DIR}`); process.exit(1); }

const out = {
  provider: PROVIDER, model: MODEL, prompt_ver: PROMPT_VER,
  media_res: PROVIDER === 'gemini' ? MEDIA_RES : null,
  created_at: new Date().toISOString(), photos: {},
};

for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  const data = fs.readFileSync(path.join(PHOTOS_DIR, f)).toString('base64');
  const t0 = Date.now();
  try {
    const { text, usage } = await CALL[PROVIDER](MEDIA[ext], data, prompt);
    const latency_ms = Date.now() - t0;
    try {
      const items = parseItems(text);
      out.photos[f] = { items, latency_ms, usage };
      console.log(`✓ ${f} — 문항 ${items.length}개, ${latency_ms}ms`);
    } catch (e) {
      out.photos[f] = { error: `parse: ${e.message}`, raw: text, latency_ms, usage };
      console.log(`✗ ${f} — 응답 파싱 실패 (${e.message})`);
    }
  } catch (e) {
    out.photos[f] = { error: String(e.message || e), latency_ms: Date.now() - t0 };
    console.log(`✗ ${f} — API 오류: ${e.message || e}`);
  }
}

fs.mkdirSync(path.join(here, 'runs'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.join(here, 'runs', `${stamp}-${MODEL}-${PROMPT_VER}.json`);
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`\n저장: ${path.relative(process.cwd(), outFile)}`);
console.log('다음: node report.mjs           (방금 run 자동 선택 — 분포·이상 신호 확인)');
console.log('      node measure.mjs --labels labels.json   (라벨이 있으면 게이트 채점)');
