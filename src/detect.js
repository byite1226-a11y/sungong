/**
 * 착석 · 졸음 판정 — 브라우저 온디바이스
 *
 *   프레임은 판정 직후 버려집니다. 어떤 이미지도 저장·전송되지 않습니다.
 *   서버로 나가는 것은 "몇 시부터 몇 시까지 어떤 종류였다"뿐입니다.
 *
 *   얼굴 보임 + 눈 감김/고개 떨굼   N초 → drowsy  (reason: 'eyes' | 'pitch')
 *   얼굴 안 보임 + 상체는 보임       N초 → drowsy  (reason: 'slump')   ← 엎드림
 *   얼굴도 상체도 안 보임            N초 → away
 *
 * 두 모델을 쓰되 동시에 돌리지 않습니다.
 *   FaceLandmarker  는 항상 2fps 로 돌고,
 *   PoseLandmarker  는 얼굴이 사라진 동안에만 1fps 로 깨어납니다.
 * 얼굴만 보고 판정하면 엎드려 자는 사람이 '자리 비움'으로 잡힙니다.
 * 그렇다고 Pose 를 매 프레임 같이 돌리면 두 시간짜리 세션에서 발열·배터리를 감당할 수 없습니다.
 */

// wasm·모델 모두 공개 CDN 에서 받아 브라우저 안에서만 실행됩니다.
// 받아오는 것은 "판정 프로그램"이고, 카메라 프레임은 이 기기 밖으로 나가지 않습니다.
// 자체 호스팅하려면 `npm run build -- --vendor-wasm` 로 빌드하고 WASM 을 './wasm' 으로 바꾸세요.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const SAMPLE_MS = 500;          // 2fps — 장시간 세션의 발열·배터리를 위해
const POSE_EVERY      = 2;             // 얼굴이 없을 때만, 그마저도 두 번에 한 번 (1fps)
const POSE_AFTER_MS   = 2000;          // 얼굴이 이만큼 사라져 있어야 Pose 를 깨운다
const SHOULDER_VIS    = 0.55;          // 어깨가 이 정도는 보여야 "사람이 앉아 있다"고 본다

/* MediaPipe Pose 랜드마크 번호 */
const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12;

export class Detector {
  constructor(opts = {}) {
    this.awaySec   = opts.awaySec   ?? 20;
    this.drowsySec = opts.drowsySec ?? 8;
    this.drowsyOn  = opts.drowsyOn  ?? true;
    this.poseOn    = opts.poseOn    ?? true;   // 엎드림 감지 (졸음 감지를 끄면 같이 꺼진다)
    this.onState   = opts.onState   || (() => {});
    this.onTick    = opts.onTick    || (() => {});
    this.onLost    = opts.onLost    || (() => {});   // 카메라가 세션 도중 끊겼을 때
    this.onPhase   = opts.onPhase   || (() => {});   // 'cam' → 'model' → 'run' 진행 보고
    this.lost      = false;
    this.errStreak = 0;                              // 추론이 연속으로 죽은 횟수
    this.state = 'ok';                 // ok | away | drowsy
    this.pending = null;               // 후보 상태
    this.pendingSince = 0;
    this.ready = false;
    this.failed = null;
    this.poseState = 'idle';           // idle | loading | ready | failed
    this.gone = 0;                     // 얼굴이 사라진 채로 흐른 ms
    this.ticks = 0;
    this.last = { present: false, blink: 0, pitch: 0, body: false, reason: null };
  }

  async start(video) {
    this.video = video;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false
      });
      this.stream = stream;
      video.srcObject = stream;
      let camT;
      try {
        await Promise.race([
          video.play(),
          new Promise((_, rej) => { camT = setTimeout(() => rej(Object.assign(new Error('camera start timeout'), { name: 'CamTimeout' })), 10000); }),
        ]);
      } finally { clearTimeout(camT); }
      // 다른 앱이 카메라를 가져가거나 사용자가 권한을 회수하면 트랙이 'ended' 로 끝난다.
      // 이걸 잡지 않으면 얼굴이 영영 안 보이는 것으로 읽혀 세션 내내 '자리 비움'이 된다.
      stream.getVideoTracks().forEach(tr => tr.addEventListener('ended', () => this._lost()));
    } catch (e) {
      this.failed = e.name === 'NotAllowedError' ? 'denied' : 'nocam';
      throw e;
    }
    this.onPhase('model');            // 여기부터는 다운로드 — UI 가 '내려받는 중'을 보여줄 수 있게
    let modelT;
    try {
      /* 느린 망에서 CDN 요청이 실패 대신 매달리면 '준비 중'에 무한히 걸린다.
         모델 준비 전체에 시간 상한을 둔다 — 모바일 데이터에서 첫 다운로드(약 13MB)가
         오래 걸릴 수 있어 여유 있게 잡는다. 권한 프롬프트는 위에서 이미 끝났다. */
      const deadline = new Promise((_, rej) =>
        { modelT = setTimeout(() => rej(new Error('model load timeout')), 35000); });
      const load = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      this._fileset = await FilesetResolver.forVisionTasks(WASM);
      const make = (delegate) => FaceLandmarker.createFromOptions(this._fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      /* 구형 폰에서 GPU 델리게이트가 흔하게 죽는다. CPU 로 한 번 더 시도한다 —
         2fps 라 CPU 로도 충분히 돈다. */
      try { this.lm = await make('GPU'); }
      catch { this.lm = await make('CPU'); this.cpuOnly = true; }
      })();
      await Promise.race([load, deadline]);
      this.ready = true;
    } catch (e) {
      this.failed = 'model';
      throw e;
    } finally { clearTimeout(modelT); }
    this.onPhase('run');
    this.timer = setInterval(() => this._tick(), SAMPLE_MS);
    return true;
  }

  /** 얼굴이 한동안 안 보일 때만 부른다. 실패해도 앱은 그대로 돈다 — 엎드림만 못 가릴 뿐이다 */
  async _wakePose() {
    if (this.poseState !== 'idle' || !this.poseOn || !this._fileset) return;
    this.poseState = 'loading';
    try {
      const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const makePose = (delegate) => PoseLandmarker.createFromOptions(this._fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
      });
      try { this.pose = await makePose(this.cpuOnly ? 'CPU' : 'GPU'); }
      catch { this.pose = await makePose('CPU'); }
      this.poseState = 'ready';
    } catch {
      this.poseState = 'failed';       // 조용히 포기 — 이 경우 엎드림은 away 로 잡힌다
    }
  }

  /* 추론이 GPU 에서 반복해서 죽을 때 — 같은 fileset 으로 CPU 랜드마커를 다시 만든다 */
  async _rebuildCpu() {
    if (this._rebuilding || !this._fileset) return;
    this._rebuilding = true;
    try {
      const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
      const next = await FaceLandmarker.createFromOptions(this._fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      this.lm?.close?.();
      this.lm = next; this.cpuOnly = true; this.errStreak = 0;
    } catch { this._fatal(); }
    this._rebuilding = false;
  }

  _fatal() {
    if (this.lost) return;
    this.lost = true;
    clearInterval(this.timer);
    this.ready = false;
    this.failed = 'model';
    this.onLost();
  }

  _lost() {
    if (this.lost) return;
    this.lost = true;
    clearInterval(this.timer);
    this.ready = false;
    this.failed = 'lost';
    this.onLost();
  }

  stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach(t => t.stop());   // 카메라 즉시 해제
    this.lm?.close?.();
    this.pose?.close?.();
    this.ready = false;
    this.poseState = 'idle';
  }

  /** 포모도로 휴식 등 — 카메라를 잠시 끈다 */
  pause() { clearInterval(this.timer); this.stream?.getTracks().forEach(t => (t.enabled = false)); }
  resume() { this.stream?.getTracks().forEach(t => (t.enabled = true)); this.timer = setInterval(() => this._tick(), SAMPLE_MS); }

  /** 얼굴이 없을 때 상체가 보이는가 = 사람은 있는데 얼굴만 안 보인다 = 엎드림 */
  _bodyPresent() {
    if (this.poseState !== 'ready') return false;
    let res;
    try { res = this.pose.detectForVideo(this.video, performance.now()); }
    catch { return false; }
    const pts = res?.landmarks?.[0];
    if (!pts) return false;
    const ls = pts[L_SHOULDER], rs = pts[R_SHOULDER];
    if (!ls || !rs) return false;
    const vis = p => (p.visibility ?? 1);
    if (vis(ls) < SHOULDER_VIS || vis(rs) < SHOULDER_VIS) return false;
    // 코가 어깨선보다 아래로 내려가 있으면 엎드림이 거의 확실하다 (y 는 아래로 갈수록 큼).
    // 코가 안 보이면 그것대로 얼굴이 가려졌다는 뜻이라 어깨만으로 판단한다.
    const nose = pts[NOSE];
    if (nose && vis(nose) >= SHOULDER_VIS) {
      return nose.y > (ls.y + rs.y) / 2 - 0.02;
    }
    return true;
  }

  _tick() {
    if (!this.ready || !this.video) return;
    const tr = this.stream?.getVideoTracks?.()[0];
    if (!tr || tr.readyState === 'ended' || !this.stream.active) return this._lost();
    if (this.video.readyState < 2) return;
    let res;
    try { res = this.lm.detectForVideo(this.video, performance.now()); this.errStreak = 0; }
    catch (e) {
      /* 생성은 됐는데 추론에서 죽는 기기가 있다(주로 GPU 런타임).
         조용히 삼키면 '카메라는 보이는데 아무 판정도 없는' 상태가 된다 —
         화면에 알리고, 몇 번 이상 반복되면 CPU 로 갈아탄 뒤, 그래도 안 되면 실패 처리한다. */
      this.errStreak++;
      this.onTick({ present: false, blink: 0, pitch: 0, body: false, reason: null,
                    error: String((e && e.message) || e), errStreak: this.errStreak });
      if (this.errStreak === 6 && !this.cpuOnly) this._rebuildCpu();
      else if (this.errStreak >= 20) this._fatal();
      return;
    }

    const present = res.faceLandmarks?.length > 0;
    let blink = 0, pitch = 0;

    if (present) {
      const cats = res.faceBlendshapes?.[0]?.categories || [];
      const g = n => cats.find(c => c.categoryName === n)?.score ?? 0;
      blink = (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2;
      const m = res.facialTransformationMatrixes?.[0]?.data;
      if (m) pitch = Math.asin(Math.max(-1, Math.min(1, -m[9]))) * 180 / Math.PI;
    }

    /* ── 얼굴이 없는 동안에만 Pose 를 깨워 상체를 확인한다 ── */
    let body = false;
    this.ticks++;
    if (present) {
      this.gone = 0;
      if (this.poseState === 'ready') { this.pose.close?.(); this.pose = null; this.poseState = 'idle'; }
    } else {
      this.gone += SAMPLE_MS;
      if (this.drowsyOn && this.poseOn && this.gone >= POSE_AFTER_MS) {
        if (this.poseState === 'idle') this._wakePose();          // await 하지 않는다 — 다음 tick 부터 쓴다
        else if (this.poseState === 'ready' && this.ticks % POSE_EVERY === 0) body = this._bodyPresent();
        else if (this.poseState === 'ready') body = this.last.body;   // 쉬는 tick 은 직전 판정을 잇는다
      }
    }

    // 프레임은 여기서 끝. 어디에도 남기지 않는다.
    const reason = present ? (blink > 0.5 ? 'eyes' : pitch < -22 ? 'pitch' : null)
                 : body ? 'slump' : null;
    this.last = { present, blink, pitch, body, reason };
    this.onTick(this.last);

    let want = 'ok';
    if (present) {
      if (this.drowsyOn && (blink > 0.5 || pitch < -22)) want = 'drowsy';
    } else {
      want = body ? 'drowsy' : 'away';
    }

    const now = Date.now();
    if (want === this.state) { this.pending = null; return; }

    if (this.pending !== want) { this.pending = want; this.pendingSince = now; return; }

    const need = want === 'away' ? this.awaySec * 1000
               : want === 'drowsy' ? this.drowsySec * 1000
               : 1500;                                  // 복귀는 1.5초면 확정
    if (now - this.pendingSince >= need) {
      const prev = this.state;
      this.state = want;
      this.reason = this.last.reason;
      this.pending = null;
      this.onState(want, prev);
    }
  }
}

/** 카메라 없이 쓰는 사용자를 위한 더미 — 앱은 그대로 동작한다 */
export class ManualDetector {
  constructor(o = {}) { this.state = 'ok'; this.onState = o.onState || (() => {}); this.ready = true; this.manual = true; this.last = { present: false, reason: null }; }
  async start() { return true; }
  stop() {} pause() {} resume() {}
  force(s) { const p = this.state; this.state = s; this.onState(s, p); }
}
