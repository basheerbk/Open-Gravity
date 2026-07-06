import {
  poseReady,
  noseTracked,
  bodyScaleNorm,
  normDeltaToMeters,
} from "./standZone.js";

const LM = { NOSE: 0 };

const BASELINE_MS = 800;
const MIN_STILL_MS = 350;
const MIN_SAMPLES = 8;
const STILL_VARIANCE = 0.00006;
const LANDING_FRAMES = 3;
const LOST_FRAMES = 12;
const EMA_ALPHA = 0.5;
const JUMP_RATIO = 0.05;
const LANDING_RATIO = 0.025;
const MIN_JUMP_M = 0.03;
const MAX_JUMP_M = 2.5;

export const JT_STATE = {
  IDLE: "idle",
  AWAITING: "awaiting",
  BASELINE: "baseline",
  READY: "ready",
  JUMPING: "jumping",
  DONE: "done",
};

export const JumpTracker = {
  state: JT_STATE.IDLE,

  _baselineY: null,
  _peakY: null,
  _smoothY: null,
  _bodyScale: null,
  _samples: [],
  _baselineStart: 0,
  _landingCount: 0,
  _lostCount: 0,
  _tracked: false,

  onStateChange: null,
  onJumpCaptured: null,
  onLiveUpdate: null,

  start() {
    this._baselineY = null;
    this._peakY = null;
    this._smoothY = null;
    this._bodyScale = null;
    this._samples = [];
    this._baselineStart = 0;
    this._landingCount = 0;
    this._lostCount = 0;
    this._tracked = false;
    this._setState(JT_STATE.AWAITING);
  },

  reset() {
    this._setState(JT_STATE.IDLE);
  },

  getLiveMetrics() {
    const baselineProgress =
      this.state === JT_STATE.BASELINE && this._baselineStart
        ? Math.min(1, (performance.now() - this._baselineStart) / BASELINE_MS)
        : this.state === JT_STATE.READY || this.state === JT_STATE.JUMPING ? 1 : 0;

    let liveNormDelta = 0;
    if (this._baselineY != null && this._smoothY != null) {
      liveNormDelta = Math.max(0, this._baselineY - this._smoothY);
    }

    const scale = this._bodyScale || 0.35;
    return {
      state: this.state,
      tracked: this._tracked,
      liveNormDelta,
      liveJumpM: normDeltaToMeters(liveNormDelta, scale),
      baselineProgress,
      baselineY: this._baselineY,
      currentY: this._smoothY,
    };
  },

  update(landmarks) {
    if (!landmarks || this.state === JT_STATE.IDLE || this.state === JT_STATE.DONE)
      return;

    const trackY = this._smoothNose(landmarks);
    if (trackY == null) {
      this._onLostTrack();
      this._emitLive();
      return;
    }

    const tracked = poseReady(landmarks);
    this._tracked = tracked;
    this._lostCount = 0;

    if (this.state === JT_STATE.AWAITING) {
      if (tracked || noseTracked(landmarks)) {
        this._samples = [trackY];
        this._baselineStart = performance.now();
        this._setState(JT_STATE.BASELINE);
      }
      this._emitLive();
      return;
    }

    if (this.state === JT_STATE.BASELINE) {
      this._samples.push(trackY);
      const elapsed = performance.now() - this._baselineStart;
      const recent = this._samples.slice(-12);
      const still = recent.length >= MIN_SAMPLES && this._variance(recent) < STILL_VARIANCE;
      const longEnough = elapsed >= BASELINE_MS && this._samples.length >= MIN_SAMPLES;
      const stillLongEnough = elapsed >= MIN_STILL_MS && still;

      if (stillLongEnough || longEnough) {
        this._baselineY = this._samples.reduce((a, b) => a + b) / this._samples.length;
        this._peakY = this._baselineY;
        this._bodyScale = bodyScaleNorm(landmarks);
        this._setState(JT_STATE.READY);
      }
    } else if (this.state === JT_STATE.READY) {
      const threshold = (this._bodyScale || 0.35) * JUMP_RATIO;
      if (this._baselineY - trackY > threshold) {
        this._peakY = trackY;
        this._landingCount = 0;
        this._setState(JT_STATE.JUMPING);
      }
    } else if (this.state === JT_STATE.JUMPING) {
      if (trackY < this._peakY) this._peakY = trackY;

      const landingBand = (this._bodyScale || 0.35) * LANDING_RATIO;
      if (trackY >= this._baselineY - landingBand) {
        this._landingCount++;
      } else {
        this._landingCount = 0;
      }

      if (this._landingCount >= LANDING_FRAMES) {
        const normDelta = this._baselineY - this._peakY;
        const scale = this._bodyScale || bodyScaleNorm(landmarks);
        const jumpM = normDeltaToMeters(normDelta, scale);

        if (jumpM >= MIN_JUMP_M && jumpM <= MAX_JUMP_M) {
          this._setState(JT_STATE.DONE);
          if (this.onJumpCaptured) this.onJumpCaptured(jumpM, normDelta);
          setTimeout(() => {
            this._resetTracking();
            this._setState(JT_STATE.AWAITING);
          }, 1200);
        } else {
          this._peakY = this._baselineY;
          this._landingCount = 0;
          this._setState(JT_STATE.READY);
        }
      }
    }

    this._emitLive();
  },

  _onLostTrack() {
    if (this.state === JT_STATE.JUMPING) return;
    this._tracked = false;
    this._lostCount++;
    if (this._lostCount >= LOST_FRAMES) {
      this._resetTracking();
      this._setState(JT_STATE.AWAITING);
    }
  },

  _smoothNose(landmarks) {
    if (!noseTracked(landmarks)) return null;
    const raw = landmarks[LM.NOSE].y;
    if (this._smoothY == null) {
      this._smoothY = raw;
    } else {
      this._smoothY = EMA_ALPHA * raw + (1 - EMA_ALPHA) * this._smoothY;
    }
    return this._smoothY;
  },

  _variance(samples) {
    const mean = samples.reduce((a, b) => a + b) / samples.length;
    return samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
  },

  _resetTracking() {
    this._baselineY = null;
    this._peakY = null;
    this._smoothY = null;
    this._bodyScale = null;
    this._samples = [];
    this._landingCount = 0;
    this._lostCount = 0;
  },

  _emitLive() {
    if (this.onLiveUpdate) this.onLiveUpdate(this.getLiveMetrics());
  },

  _setState(state) {
    this.state = state;
    if (this.onStateChange) this.onStateChange(state, this._tracked);
  },
};
