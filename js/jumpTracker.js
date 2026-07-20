import {
  poseReady,
  noseTracked,
  bodyScaleNorm,
  normDeltaToMeters,
} from "./standZone.js";

const LM = { NOSE: 0 };

const BASELINE_MS = 700;
const MIN_STILL_MS = 300;
const MIN_SAMPLES = 6;
const STILL_VARIANCE = 0.00012;
const LANDING_FRAMES = 4;
const LOST_FRAMES = 18;
const EMA_ALPHA = 0.35;
const JUMP_RATIO = 0.03;
/** Absolute floor — ~1.2% of frame height (works when body fills less of the shot). */
const JUMP_ABS = 0.012;
const LANDING_RATIO = 0.04;
const LANDING_ABS = 0.008;
const MIN_JUMP_M = 0.02;
const MAX_JUMP_M = 2.5;
/** Ignore micro-spikes: must stay above threshold this many frames before JUMPING. */
const TAKEOFF_FRAMES = 2;

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
  _rawY: null,
  _bodyScale: null,
  _samples: [],
  _baselineStart: 0,
  _landingCount: 0,
  _takeoffCount: 0,
  _lostCount: 0,
  _tracked: false,
  _jumpStart: 0,

  onStateChange: null,
  onJumpCaptured: null,
  onLiveUpdate: null,

  start() {
    this._baselineY = null;
    this._peakY = null;
    this._smoothY = null;
    this._rawY = null;
    this._bodyScale = null;
    this._samples = [];
    this._baselineStart = 0;
    this._landingCount = 0;
    this._takeoffCount = 0;
    this._lostCount = 0;
    this._tracked = false;
    this._jumpStart = 0;
    this._setState(JT_STATE.AWAITING);
  },

  reset() {
    this._setState(JT_STATE.IDLE);
  },

  _jumpThreshold() {
    const scale = this._bodyScale || 0.35;
    return Math.min(JUMP_ABS, scale * JUMP_RATIO);
  },

  _landingBand() {
    const scale = this._bodyScale || 0.35;
    return Math.max(LANDING_ABS, scale * LANDING_RATIO);
  },

  /** Best upward delta vs baseline (higher = more rise). */
  _rise(y) {
    if (this._baselineY == null || y == null) return 0;
    return Math.max(0, this._baselineY - y);
  },

  getLiveMetrics() {
    const baselineProgress =
      this.state === JT_STATE.BASELINE && this._baselineStart
        ? Math.min(1, (performance.now() - this._baselineStart) / BASELINE_MS)
        : this.state === JT_STATE.READY || this.state === JT_STATE.JUMPING ? 1 : 0;

    const liveNormDelta = Math.max(
      this._rise(this._smoothY),
      this.state === JT_STATE.JUMPING ? this._rise(this._peakY) : 0,
    );

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
      // Only start when person is inside the track box
      if (tracked) {
        this._samples = [trackY];
        this._baselineStart = performance.now();
        this._setState(JT_STATE.BASELINE);
      }
      this._emitLive();
      return;
    }

    // Left the box before jumping — reset (keep going during JUMPING)
    if (!tracked && this.state !== JT_STATE.JUMPING) {
      this._samples = [];
      this._baselineY = null;
      this._smoothY = null;
      this._rawY = null;
      this._takeoffCount = 0;
      this._setState(JT_STATE.AWAITING);
      this._emitLive();
      return;
    }

    if (this.state === JT_STATE.BASELINE) {
      this._samples.push(trackY);
      const elapsed = performance.now() - this._baselineStart;
      const recent = this._samples.slice(-10);
      const still = recent.length >= MIN_SAMPLES && this._variance(recent) < STILL_VARIANCE;
      const longEnough = elapsed >= BASELINE_MS && this._samples.length >= MIN_SAMPLES;
      const stillLongEnough = elapsed >= MIN_STILL_MS && still;

      if (stillLongEnough || longEnough) {
        this._baselineY = this._samples.reduce((a, b) => a + b) / this._samples.length;
        this._peakY = this._baselineY;
        this._bodyScale = bodyScaleNorm(landmarks);
        this._takeoffCount = 0;
        this._setState(JT_STATE.READY);
      }
    } else if (this.state === JT_STATE.READY) {
      // Use raw + smooth so a fast hop isn't killed by EMA lag
      const rise = Math.max(this._rise(trackY), this._rise(this._rawY));
      const threshold = this._jumpThreshold();

      if (rise > threshold) {
        this._takeoffCount++;
      } else {
        this._takeoffCount = 0;
      }

      if (this._takeoffCount >= TAKEOFF_FRAMES) {
        this._peakY = Math.min(trackY, this._rawY ?? trackY);
        this._landingCount = 0;
        this._jumpStart = performance.now();
        this._setState(JT_STATE.JUMPING);
      }
    } else if (this.state === JT_STATE.JUMPING) {
      const y = Math.min(trackY, this._rawY ?? trackY);
      if (y < this._peakY) this._peakY = y;

      const rise = this._rise(this._peakY);
      const band = this._landingBand();
      const nearGround = trackY >= this._baselineY - band;
      const airTime = performance.now() - this._jumpStart;

      // Only count landing after a real peak (not a flicker)
      if (nearGround && rise > this._jumpThreshold() * 0.8) {
        this._landingCount++;
      } else if (!nearGround) {
        this._landingCount = 0;
      }

      // Timeout: if airborne too long without clean landing, still score peak
      const forceLand = airTime > 1800 && rise > this._jumpThreshold();

      if (this._landingCount >= LANDING_FRAMES || forceLand) {
        this._finishJump(landmarks);
      }
    }

    this._emitLive();
  },

  _finishJump(landmarks) {
    const normDelta = this._baselineY - this._peakY;
    const scale = this._bodyScale || bodyScaleNorm(landmarks);
    const jumpM = normDeltaToMeters(normDelta, scale);

    if (jumpM >= MIN_JUMP_M && jumpM <= MAX_JUMP_M) {
      this._setState(JT_STATE.DONE);
      if (this.onJumpCaptured) this.onJumpCaptured(jumpM, normDelta);
      setTimeout(() => {
        this._resetTracking();
        this._setState(JT_STATE.AWAITING);
      }, 1000);
    } else {
      // Too small — back to ready without full reset
      this._peakY = this._baselineY;
      this._landingCount = 0;
      this._takeoffCount = 0;
      this._setState(JT_STATE.READY);
    }
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
    this._rawY = raw;
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
    this._rawY = null;
    this._bodyScale = null;
    this._samples = [];
    this._landingCount = 0;
    this._takeoffCount = 0;
    this._lostCount = 0;
    this._jumpStart = 0;
  },

  _emitLive() {
    if (this.onLiveUpdate) this.onLiveUpdate(this.getLiveMetrics());
  },

  _setState(state) {
    this.state = state;
    if (this.onStateChange) this.onStateChange(state, this._tracked);
  },
};
