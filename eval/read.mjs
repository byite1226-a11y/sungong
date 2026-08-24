/**
 * Phase A — 판독 실행기
 *
 *   eval/photos 의 숙제 사진을 VLM에 보여주고, 문항별로
 *   ① 채점 기호(mark) ② 풀이 흔적(work) 을 읽어 runs/ 에 기록합니다.
 *
 *   사용:  node read.mjs --photos photos --model claude-opus-5 --prompt v1
 *   필요:  ANTHROPIC_API_KEY 환경변수
 *
 *   프롬프트의 철칙 (v3 §4-6): "채점하지 마라" — AI가 문제를 풀어 정오답을
 *   판단하려 드는 순간 정확도가 무너진다. 읽을 것은 이미 그려진 기호와 필기의 유무뿐.
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const PHOTOS_DIR = path.resolve(here, arg('photos', 'photos'));
const MODEL      = arg('model', 'claude-opus-5');
const PROMPT_VER = arg('prompt', 'v1');

export const PROMPTS = {
  v1: `당신은 학생이 이미 채점을 끝낸 숙제 사진을 읽는 판독기입니다.

절대 하지 말 것:
- 문제를 풀지 마세요. 답이 맞았는지 스스로 판단하지 마세요.
- 읽을 것은 오직 두 가지입니다: ① 학생이 이미 그려 놓은 채점 기호 ② 손글씨 필기의 유무.

각 문항 번호에 대해 다음을 판정하세요.

mark — 문항 옆·위에 그려진 채점 기호:
- "circle": 동그라미(○). 정답 표시.
- "slash": 사선(/, ＼, ✓ 형태 포함). 오답 표시.
- "triangle": 세모(△). 부분 정답·애매 표시. 사선과 혼동하기 쉬우니 닫힌 세 변이 보이는지 확인하세요.
- "star": 별(☆, ★). 다시 볼 표시.
- "unmarked": 채점 기호가 없음.

work — 그 문항 영역의 손글씨 풀이 흔적:
- "solved": 손글씨 풀이나 답이 적혀 있음.
- "blank": 손글씨가 없음. 인쇄된 문제 텍스트·보기 번호는 필기가 아닙니다.
- "partial": 풀이가 일부만 있음(시작하다 만 흔적).

confidence 는 각 판정에 대한 확신도(0~1)입니다. 잘 안 보이면 낮게 주세요.

출력은 JSON 배열 하나만, 다른 텍스트 없이:
[{"item_no": 1, "mark": "circle", "work": "solved", "mark_confidence": 0.95, "work_confidence": 0.9}, ...]

사진에서 문항 번호를 식별할 수 없는 항목은 배열에서 빼세요. 번호를 지어내지 마세요.`,
};

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function parseItems(text) {
  const m = text.match(/\[[\s\S]*\]/);           // 코드펜스·서문이 붙어도 배열만 집는다
  if (!m) throw new Error('JSON 배열을 찾지 못함');
  const items = JSON.parse(m[0]);
  if (!Array.isArray(items)) throw new Error('배열이 아님');
  return items.map(it => ({
    item_no: Number(it.item_no),
    mark: String(it.mark),
    work: String(it.work),
    mark_confidence: Number(it.mark_confidence ?? 0),
    work_confidence: Number(it.work_confidence ?? 0),
  }));
}

const prompt = PROMPTS[PROMPT_VER];
if (!prompt) { console.error(`알 수 없는 프롬프트 버전: ${PROMPT_VER} (있는 것: ${Object.keys(PROMPTS)})`); process.exit(1); }
if (!fs.existsSync(PHOTOS_DIR)) { console.error(`사진 폴더가 없습니다: ${PHOTOS_DIR}`); process.exit(1); }

const files = fs.readdirSync(PHOTOS_DIR).filter(f => MEDIA[path.extname(f).toLowerCase()]).sort();
if (!files.length) { console.error(`사진이 없습니다: ${PHOTOS_DIR}`); process.exit(1); }

const client = new Anthropic();
const out = { model: MODEL, prompt_ver: PROMPT_VER, created_at: new Date().toISOString(), photos: {} };

for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  const data = fs.readFileSync(path.join(PHOTOS_DIR, f)).toString('base64');
  const t0 = Date.now();
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: MEDIA[ext], data } },
          { type: 'text', text: prompt },
        ],
      }],
    });
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const latency_ms = Date.now() - t0;
    try {
      const items = parseItems(text);
      out.photos[f] = { items, latency_ms, usage: res.usage };
      console.log(`✓ ${f} — 문항 ${items.length}개, ${latency_ms}ms`);
    } catch (e) {
      out.photos[f] = { error: `parse: ${e.message}`, raw: text, latency_ms, usage: res.usage };
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
console.log(`다음: node measure.mjs --run ${path.relative(here, outFile)} --labels labels.json`);
