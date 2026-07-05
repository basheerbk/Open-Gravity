// MediaPipe Tasks Vision via CDN — ES module
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Key landmark indices for jump tracking + labeling
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

// Joints highlighted with distinct colours
const KEY_JOINTS = [
  { idx: LM.NOSE,        color: "#ffffff", label: null },
  { idx: LM.L_SHOULDER,  color: "#7ec8ff", label: null },
  { idx: LM.R_SHOULDER,  color: "#7ec8ff", label: null },
  { idx: LM.L_ELBOW,     color: "#a8d8ff", label: null },
  { idx: LM.R_ELBOW,     color: "#a8d8ff", label: null },
  { idx: LM.L_WRIST,     color: "#a8d8ff", label: null },
  { idx: LM.R_WRIST,     color: "#a8d8ff", label: null },
  { idx: LM.L_HIP,       color: "#ffb347", label: "hip" },
  { idx: LM.R_HIP,       color: "#ffb347", label: null },
  { idx: LM.L_KNEE,      color: "#ffe066", label: null },
  { idx: LM.R_KNEE,      color: "#ffe066", label: null },
  { idx: LM.L_ANKLE,     color: "#6ee7a0", label: "ankle" },
  { idx: LM.R_ANKLE,     color: "#6ee7a0", label: null },
];

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

  /**
   * Draw full skeleton + highlighted body points onto the PiP canvas.
   */
  drawSkeleton(canvas, videoEl, landmarks) {
    const ctx = canvas.getContext("2d");
    const vw = videoEl.videoWidth  || 640;
    const vh = videoEl.videoHeight || 480;

    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width  = vw;
      canvas.height = vh;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks) return;

    const scale = Math.min(canvas.width, canvas.height);
    const lineW   = Math.max(2.5, scale / 60);
    const dotR    = Math.max(4,   scale / 45);
    const keyR    = Math.max(5,   scale / 38);

    if (!this._drawingUtils) {
      this._drawingUtils = new DrawingUtils(ctx);
    }

    // Skeleton connectors
    this._drawingUtils.drawConnectors(
      landmarks,
      PoseLandmarker.POSE_CONNECTIONS,
      { color: "rgba(120, 210, 255, 0.75)", lineWidth: lineW },
    );

    // Generic landmark dots (non-key joints)
    this._drawingUtils.drawLandmarks(landmarks, {
      radius: dotR * 0.7,
      color: "rgba(255,255,255,0.85)",
      fillColor: "rgba(120, 210, 255, 0.9)",
      lineWidth: 1,
    });

    // Highlighted key joints with white ring
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

    // Hip-centre marker (used for jump height)
    const lh = landmarks[LM.L_HIP];
    const rh = landmarks[LM.R_HIP];
    if (lh && rh) {
      const hx = ((lh.x + rh.x) / 2) * canvas.width;
      const hy = ((lh.y + rh.y) / 2) * canvas.height;

      // Crosshair at hip centre
      const arm = keyR * 1.6;
      ctx.strokeStyle = "#ffb347";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx - arm, hy); ctx.lineTo(hx + arm, hy);
      ctx.moveTo(hx, hy - arm); ctx.lineTo(hx, hy + arm);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(hx, hy, keyR * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = "#ffb347";
      ctx.fill();
    }
  },
};
