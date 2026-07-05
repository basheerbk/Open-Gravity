// MediaPipe Pose landmark indices used for jump tracking
const LM = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_HIP: 23,
  R_HIP: 24,
  L_ANKLE: 27,
  R_ANKLE: 28,
};

// Time in ms to collect standing baseline before prompting to jump
const BASELINE_MS = 1800;
const MIN_SAMPLES = 20;

// Minimum normalised Y rise (hip moving up) to register as "in air"
const JUMP_THRESHOLD = 0.025;

// Valid jump height bounds
const MIN_JUMP_M = 0.02;
const MAX_JUMP_M = 2.5;

export const JT_STATE = {
  IDLE: "idle",
  BASELINE: "baseline", // collecting standing still data
  READY: "ready",       // baseline locked, waiting for jump
  JUMPING: "jumping",   // person is in the air
  DONE: "done",         // jump height captured
};

export const JumpTracker = {
  state: JT_STATE.IDLE,

  _heightCm: 170,
  _baselineHipY: null,
  _peakHipY: null,
  _samples: [],
  _baselineStart: 0,
  _mPerUnit: null, // calibrated metres per normalised-Y unit

  /** Called when state changes — set externally. */
  onStateChange: null,

  /** Called with measured jump height in metres — set externally. */
  onJumpCaptured: null,

  /** Start a new tracking session. heightCm is used for px→m calibration. */
  start(heightCm = 170) {
    this._heightCm = heightCm;
    this._baselineHipY = null;
    this._peakHipY = null;
    this._samples = [];
    this._baselineStart = performance.now();
    this._mPerUnit = null;
    this._setState(JT_STATE.BASELINE);
  },

  reset() {
    this._setState(JT_STATE.IDLE);
  },

  /**
   * Feed one frame of MediaPipe landmarks (normalised 0–1, y-axis down).
   * Call this every animation frame while the camera is running.
   */
  update(landmarks) {
    if (
      !landmarks ||
      this.state === JT_STATE.IDLE ||
      this.state === JT_STATE.DONE
    )
      return;

    const hipY = this._avgY(landmarks, LM.L_HIP, LM.R_HIP);
    if (hipY == null) return;

    // Update pixel-to-metre calibration whenever a body measurement is available
    this._calibrate(landmarks);

    if (this.state === JT_STATE.BASELINE) {
      this._samples.push(hipY);
      const elapsed = performance.now() - this._baselineStart;

      if (elapsed >= BASELINE_MS && this._samples.length >= MIN_SAMPLES) {
        this._baselineHipY =
          this._samples.reduce((a, b) => a + b) / this._samples.length;
        this._peakHipY = this._baselineHipY;
        this._setState(JT_STATE.READY);
      }
    } else if (this.state === JT_STATE.READY) {
      // Y decreases as person moves up (y-axis is top→bottom)
      if (this._baselineHipY - hipY > JUMP_THRESHOLD) {
        this._peakHipY = hipY;
        this._setState(JT_STATE.JUMPING);
      }
    } else if (this.state === JT_STATE.JUMPING) {
      // Track the highest point reached (lowest Y value)
      if (hipY < this._peakHipY) this._peakHipY = hipY;

      // Landing detected when hips return near baseline
      if (hipY >= this._baselineHipY - JUMP_THRESHOLD * 0.4) {
        const normDelta = this._baselineHipY - this._peakHipY;
        const jumpM = this._toMetres(normDelta);

        if (jumpM >= MIN_JUMP_M && jumpM <= MAX_JUMP_M) {
          this._setState(JT_STATE.DONE);
          if (this.onJumpCaptured) this.onJumpCaptured(jumpM);
          // Auto-loop: reset for the next jump after a brief pause
          setTimeout(() => {
            this._peakHipY = this._baselineHipY;
            this._setState(JT_STATE.READY);
          }, 600);
        } else {
          // Not a valid jump — go back to ready silently
          this._peakHipY = this._baselineHipY;
          this._setState(JT_STATE.READY);
        }
      }
    }
  },

  _avgY(landmarks, idxA, idxB) {
    const a = landmarks[idxA];
    const b = landmarks[idxB];
    if (!a && !b) return null;
    if (!a) return b.y;
    if (!b) return a.y;
    return (a.y + b.y) / 2;
  },

  _calibrate(landmarks) {
    const nose = landmarks[LM.NOSE];
    const la = landmarks[LM.L_ANKLE];
    const ra = landmarks[LM.R_ANKLE];
    if (!nose || (!la && !ra)) return;
    const ankleY = la && ra ? (la.y + ra.y) / 2 : (la || ra).y;
    const bodyNorm = ankleY - nose.y;
    // Only calibrate when person is clearly visible (body span > 30 % of frame)
    if (bodyNorm > 0.3) {
      this._mPerUnit = (this._heightCm / 100) / bodyNorm;
    }
  },

  _toMetres(normDelta) {
    // Fall back to a rough scale if calibration failed
    const scale = this._mPerUnit ?? (this._heightCm / 100) / 0.85;
    return normDelta * scale;
  },

  _setState(state) {
    this.state = state;
    if (this.onStateChange) this.onStateChange(state);
  },
};
