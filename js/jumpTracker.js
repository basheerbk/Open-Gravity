import { feetInZone, EXHIBIT_M_PER_UNIT } from "./standZone.js";

const LM = { L_ANKLE: 27, R_ANKLE: 28 };

const BASELINE_MS = 1200;
const MIN_SAMPLES = 15;
const JUMP_THRESHOLD = 0.018;
const MIN_JUMP_M = 0.02;
const MAX_JUMP_M = 2.5;

export const JT_STATE = {
  IDLE: "idle",
  AWAITING: "awaiting",   // waiting for kid to step on the mark
  BASELINE: "baseline",   // on mark, standing still
  READY: "ready",
  JUMPING: "jumping",
  DONE: "done",
};

export const JumpTracker = {
  state: JT_STATE.IDLE,

  _baselineAnkleY: null,
  _peakAnkleY: null,
  _samples: [],
  _baselineStart: 0,
  _inZone: false,

  onStateChange: null,
  onJumpCaptured: null,

  start() {
    this._baselineAnkleY = null;
    this._peakAnkleY = null;
    this._samples = [];
    this._baselineStart = 0;
    this._inZone = false;
    this._setState(JT_STATE.AWAITING);
  },

  reset() {
    this._setState(JT_STATE.IDLE);
  },

  update(landmarks) {
    if (!landmarks || this.state === JT_STATE.IDLE || this.state === JT_STATE.DONE)
      return;

    const ankleY = this._avgAnkleY(landmarks);
    if (ankleY == null) return;

    const inZone = feetInZone(landmarks);
    this._inZone = inZone;

    if (this.state === JT_STATE.AWAITING) {
      if (inZone) {
        this._samples = [ankleY];
        this._baselineStart = performance.now();
        this._setState(JT_STATE.BASELINE);
      }
      return;
    }

    // Left the zone before jumping — reset
    if (!inZone && this.state !== JT_STATE.JUMPING) {
      this._samples = [];
      this._setState(JT_STATE.AWAITING);
      return;
    }

    if (this.state === JT_STATE.BASELINE) {
      if (!inZone) {
        this._setState(JT_STATE.AWAITING);
        return;
      }
      this._samples.push(ankleY);
      const elapsed = performance.now() - this._baselineStart;

      if (elapsed >= BASELINE_MS && this._samples.length >= MIN_SAMPLES) {
        this._baselineAnkleY =
          this._samples.reduce((a, b) => a + b) / this._samples.length;
        this._peakAnkleY = this._baselineAnkleY;
        this._setState(JT_STATE.READY);
      }
    } else if (this.state === JT_STATE.READY) {
      if (this._baselineAnkleY - ankleY > JUMP_THRESHOLD) {
        this._peakAnkleY = ankleY;
        this._setState(JT_STATE.JUMPING);
      }
    } else if (this.state === JT_STATE.JUMPING) {
      if (ankleY < this._peakAnkleY) this._peakAnkleY = ankleY;

      if (ankleY >= this._baselineAnkleY - JUMP_THRESHOLD * 0.35) {
        const normDelta = this._baselineAnkleY - this._peakAnkleY;
        const jumpM = normDelta * EXHIBIT_M_PER_UNIT;

        if (jumpM >= MIN_JUMP_M && jumpM <= MAX_JUMP_M) {
          this._setState(JT_STATE.DONE);
          if (this.onJumpCaptured) this.onJumpCaptured(jumpM, normDelta);
          setTimeout(() => {
            this._peakAnkleY = this._baselineAnkleY;
            this._samples = [];
            this._setState(JT_STATE.AWAITING);
          }, 1500);
        } else {
          this._peakAnkleY = this._baselineAnkleY;
          this._setState(JT_STATE.READY);
        }
      }
    }
  },

  _avgAnkleY(landmarks) {
    const la = landmarks[LM.L_ANKLE];
    const ra = landmarks[LM.R_ANKLE];
    if (!la && !ra) return null;
    if (!la) return ra.y;
    if (!ra) return la.y;
    return (la.y + ra.y) / 2;
  },

  _setState(state) {
    this.state = state;
    if (this.onStateChange) this.onStateChange(state, this._inZone);
  },
};
