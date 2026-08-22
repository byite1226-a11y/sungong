/**
 * 착석 · 졸음 판정 — 브라우저 온디바이스
 *
 *   프레임은 판정 직후 버려집니다. 어떤 이미지도 저장·전송되지 않습니다.
 *   서버로 나가는 것은 "몇 시부터 몇 시까지 어떤 종류였다"뿐입니다.
 *
 *   얼굴 없음        N초 지속 → away
 *   눈 감김          N초 지속 → drowsy
 *   고개 떨굼        N초 지속 → drowsy
 */
// wasm·모델 모두 공개 CDN 에서 받아 브라우저 안에서만 실행됩니다.
// 받아오는 것은 "판정 프로그램"이고, 카메라 프레임은 이 기기 밖으로 나가지 않습니다.
// 자체 호스팅하려면 `npm run build -- --vendor-wasm` 로 빌드하고 아래를 './wasm' 으로 바꾸세요.
const WASM  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export const SAMPLE_MS = 500;          // 2fps — 장시간 세션의 발열·배터리를 위해

export class Detector {
  constructor(opts = {}) {
    this.awaySec   = opts.awaySec   ?? 20;
    this.drowsySec = opts.drowsySec ?? 8;
    this.drowsyOn  = opts.drowsyOn  ?? true;
    this.onState   = opts.onState   || (() => {});
    this.onTick    = opts.onTick    || (() => {});
    this.state = 'ok';                 // ok | away | drowsy
    this.pending = null;               // 후보 상태
    this.pendingSince = 0;
    this.ready = false;
    this.failed = null;
    this.last = { present: false, blink: 0, pitch: 0 };
  }

  async start(video) {
    this.video = video;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false
      });
      this.stream = stream;
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      this.failed = e.name === 'NotAllowedError' ? 'denied' : 'nocam';
      throw e;
    }
    try {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      this.lm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      this.ready = true;
    } catch (e) {
      this.failed = 'model';
      throw e;
    }
    this.timer = setInterval(() => this._tick(), SAMPLE_MS);
    return true;
  }

  stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach(t => t.stop());   // 카메라 즉시 해제
    this.lm?.close?.();
    this.ready = false;
  }

  /** 포모도로 휴식 등 — 카메라를 잠시 끈다 */
  pause() { clearInterval(this.timer); this.stream?.getTracks().forEach(t => (t.enabled = false)); }
  resume() { this.stream?.getTracks().forEach(t => (t.enabled = true)); this.timer = setInterval(() => this._tick(), SAMPLE_MS); }

  _tick() {
    if (!this.ready || !this.video || this.video.readyState < 2) return;
    let res;
    try { res = this.lm.detectForVideo(this.video, performance.now()); }
    catch { return; }

    const present = res.faceLandmarks?.length > 0;
    let blink = 0, pitch = 0;

    if (present) {
      const cats = res.faceBlendshapes?.[0]?.categories || [];
      const g = n => cats.find(c => c.categoryName === n)?.score ?? 0;
      blink = (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2;
      const m = res.facialTransformationMatrixes?.[0]?.data;
      if (m) pitch = Math.asin(Math.max(-1, Math.min(1, -m[9]))) * 180 / Math.PI;
    }
    // 프레임은 여기서 끝. 어디에도 남기지 않는다.
    this.last = { present, blink, pitch };
    this.onTick(this.last);

    let want = 'ok';
    if (!present) want = 'away';
    else if (this.drowsyOn && (blink > 0.5 || pitch < -22)) want = 'drowsy';

    const now = Date.now();
    if (want === this.state) { this.pending = null; return; }

    if (this.pending !== want) { this.pending = want; this.pendingSince = now; return; }

    const need = want === 'away' ? this.awaySec * 1000
               : want === 'drowsy' ? this.drowsySec * 1000
               : 1500;                                  // 복귀는 1.5초면 확정
    if (now - this.pendingSince >= need) {
      const prev = this.state;
      this.state = want;
      this.pending = null;
      this.onState(want, prev);
    }
  }
}

/** 카메라 없이 쓰는 사용자를 위한 더미 — 앱은 그대로 동작한다 */
export class ManualDetector {
  constructor(o = {}) { this.state = 'ok'; this.onState = o.onState || (() => {}); this.ready = true; this.manual = true; }
  async start() { return true; }
  stop() {} pause() {} resume() {}
  force(s) { const p = this.state; this.state = s; this.onState(s, p); }
}
