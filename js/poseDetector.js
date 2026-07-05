// MediaPipe Tasks Vision via CDN — ES module
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

import { drawStandZone, feetInZone, ZONE_OFF } from "./standZone.js";
import { JT_STATE } from "./jumpTracker.js";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const LM = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
};

const KEY_JOINTS = [
  { idx: LM.NOSE,        color: "#ffffff", label: null },
  { idx: LM.L_SHOULDER,  color: "#7ec8ff", label: null },
  { idx: LM.R_SHOULDER,  color: "#7ec8ff", label: null },
  { idx: LM.L_ELBOW,     color: "#a8d8ff", label: null },
  { idx: LM.R_ELBOW,     color: "#a8d8ff", label: null },
  { idx: LM.L_WRIST,     color: "#a8d8ff", label: null },
  { idx: LM.R_WRIST,     color: "#a8d8ff", label: null },
  { idx: LM.L_HIP,       color: "#ffb347", label: null },
  { idx: LM.R_HIP,       color: "#ffb347", label: null },
  { idx: LM.L_KNEE,      color: "#ffe066", label: null },
  { idx: LM.R_KNEE,      color: "#ffe066", label: null },
  { idx: LM.L_ANKLE,     color: "#6ee7a0", label: "feet" },
  { idx: LM.R_ANKLE,     color: "#6ee7a0", label: null },
];

function skeletonStyle(state, inZone) {
  switch (state) {
    case JT_STATE.BASELINE:
      return { color: "rgba(255, 224, 102, 0.9)", lineWidth: 3, glow: "rgba(255, 224, 102, 0.35)" };
    case JT_STATE.READY:
      return { color: "rgba(110, 231, 160, 1)", lineWidth: 3.5, glow: "rgba(110, 231, 160, 0.5)" };
    case JT_STATE.JUMPING:
      return { color: "rgba(255, 180, 80, 1)", lineWidth: 4, glow: "rgba(255, 180, 80, 0.55)" };
    default:
      return inZone
        ? { color: "rgba(110, 231, 160, 0.85)", lineWidth: 2.5, glow: null }
        : { color: "rgba(120, 210, 255, 0.75)", lineWidth: 2.5, glow: null };
  }
}

export const PoseDetector = {
  landmarker: null,
  _drawingUtils: null,

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  },

  detect(videoEl) {
    if (!this.landmarker) return null;
    const result = this.landmarker.detectForVideo(videoEl, performance.now());
    return result.landmarks?.[0] ?? null;
  },

  drawFrame(canvas, videoEl, landmarks, feedback = {}) {
    const ctx = canvas.getContext("2d");
    const vw = videoEl.videoWidth  || 640;
    const vh = videoEl.videoHeight || 480;

    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width  = vw;
      canvas.height = vh;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const inZone = feetInZone(landmarks);
    const { state = JT_STATE.IDLE, baselineProgress = 0, liveJumpM = 0 } = feedback;

    drawStandZone(ctx, canvas.width, canvas.height, inZone, {
      baselineProgress,
      showZone: !ZONE_OFF,
    });

    if (!landmarks) return;

    const scale = Math.min(canvas.width, canvas.height);
    const dotR    = Math.max(4,   scale / 45);
    const keyR    = Math.max(5,   scale / 38);
    const style   = skeletonStyle(state, inZone);

    if (!this._drawingUtils) {
      this._drawingUtils = new DrawingUtils(ctx);
    }

    if (style.glow) {
      this._drawingUtils.drawConnectors(
        landmarks,
        PoseLandmarker.POSE_CONNECTIONS,
        { color: style.glow, lineWidth: style.lineWidth + 4 },
      );
    }

    this._drawingUtils.drawConnectors(
      landmarks,
      PoseLandmarker.POSE_CONNECTIONS,
      { color: style.color, lineWidth: style.lineWidth },
    );

    this._drawingUtils.drawLandmarks(landmarks, {
      radius: dotR * 0.7,
      color: "rgba(255,255,255,0.85)",
      fillColor: style.color,
      lineWidth: 1,
    });

    for (const { idx, color, label } of KEY_JOINTS) {
      const pt = landmarks[idx];
      if (!pt || (pt.visibility ?? 1) < 0.3) continue;

      const x = pt.x * canvas.width;
      const y = pt.y * canvas.height;

      ctx.beginPath();
      ctx.arc(x, y, keyR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (label) {
        ctx.font = `600 ${Math.max(9, scale / 55)}px "DM Sans", sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(label, x + keyR + 2, y + 3);
      }
    }

    const la = landmarks[LM.L_ANKLE];
    const ra = landmarks[LM.R_ANKLE];
    if (la && ra) {
      const ax = ((la.x + ra.x) / 2) * canvas.width;
      const ay = ((la.y + ra.y) / 2) * canvas.height;

      ctx.strokeStyle = state === JT_STATE.JUMPING ? "#ffb450" : "#6ee7a0";
      ctx.lineWidth = state === JT_STATE.JUMPING ? 2 : 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, ay);
      ctx.lineTo(canvas.width, ay);
      ctx.stroke();
      ctx.setLineDash([]);

      if (state === JT_STATE.JUMPING && liveJumpM > 0.01) {
        ctx.font = `700 ${Math.max(11, scale / 50)}px "Syne", sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffb450";
        ctx.fillText(`${liveJumpM.toFixed(2)} m`, ax, ay - 10);
      }
    }
  },
};
