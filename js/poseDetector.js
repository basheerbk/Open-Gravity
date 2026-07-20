// MediaPipe Tasks Vision via CDN — ES module
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

import {
  drawBaselineBar,
  drawTrackBox,
  poseReady,
  personInBox,
  setViewport,
  mapToVisible,
  drawMirroredText,
  trackBoxPx,
  TRACK_BOX,
} from "./standZone.js";
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
  { idx: LM.NOSE,        color: "#ffffff", label: "head" },
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
  { idx: LM.L_ANKLE,     color: "#6ee7a0", label: null },
  { idx: LM.R_ANKLE,     color: "#6ee7a0", label: null },
];

function skeletonStyle(state, tracked) {
  switch (state) {
    case JT_STATE.BASELINE:
      return { color: "rgba(255, 224, 102, 0.9)", lineWidth: 3, glow: "rgba(255, 224, 102, 0.35)" };
    case JT_STATE.READY:
      return { color: "rgba(110, 231, 160, 1)", lineWidth: 3.5, glow: "rgba(110, 231, 160, 0.5)" };
    case JT_STATE.JUMPING:
      return { color: "rgba(255, 180, 80, 1)", lineWidth: 4, glow: "rgba(255, 180, 80, 0.55)" };
    default:
      return tracked
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

    // Track the camera's real aspect ratio so overlays match the
    // object-fit: cover crop applied to the <video> element.
    setViewport(videoEl.videoWidth, videoEl.videoHeight);

    // Size the canvas to its actual displayed box (always 4:3, see CSS) so
    // canvas pixels map 1:1 with what's visually shown — no CSS stretching.
    const cw = canvas.clientWidth  || 320;
    const ch = canvas.clientHeight || 240;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width  = cw;
      canvas.height = ch;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const inBox = personInBox(landmarks);
    const tracked = poseReady(landmarks);
    const { state = JT_STATE.IDLE, baselineProgress = 0, liveJumpM = 0 } = feedback;

    drawTrackBox(ctx, canvas.width, canvas.height, inBox);

    if (state === JT_STATE.BASELINE) {
      drawBaselineBar(ctx, canvas.width, canvas.height, baselineProgress);
    }

    if (!landmarks) return;

    // Remap raw (uncropped) landmarks onto the visible, cover-cropped frame
    // so the skeleton lines up with what's actually shown in the video.
    const visLandmarks = landmarks.map((p) => {
      const v = mapToVisible(p.x, p.y);
      return { ...p, x: v.x, y: v.y };
    });

    const scale = Math.min(canvas.width, canvas.height);
    const dotR  = Math.max(4, scale / 45);
    const keyR  = Math.max(5, scale / 38);
    const style = skeletonStyle(state, tracked);

    if (!this._drawingUtils) {
      this._drawingUtils = new DrawingUtils(ctx);
    }

    // Only ever draw/track what's physically inside the box — clip so any
    // limb poking outside it is simply not rendered at all.
    const box = trackBoxPx(canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    ctx.globalAlpha = inBox ? 1 : 0.35;

    if (style.glow && inBox) {
      this._drawingUtils.drawConnectors(
        visLandmarks,
        PoseLandmarker.POSE_CONNECTIONS,
        { color: style.glow, lineWidth: style.lineWidth + 4 },
      );
    }

    this._drawingUtils.drawConnectors(
      visLandmarks,
      PoseLandmarker.POSE_CONNECTIONS,
      { color: style.color, lineWidth: style.lineWidth },
    );

    this._drawingUtils.drawLandmarks(visLandmarks, {
      radius: dotR * 0.7,
      color: "rgba(255,255,255,0.85)",
      fillColor: style.color,
      lineWidth: 1,
    });

    for (const { idx, color, label } of KEY_JOINTS) {
      const raw = landmarks[idx];
      const pt = visLandmarks[idx];
      if (!raw || (raw.visibility ?? 1) < 0.3) continue;

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
        ctx.textAlign = "left";
        ctx.fillStyle = color;
        drawMirroredText(ctx, label, x + keyR + 2, y + 3);
      }
    }

    const rawNose = landmarks[LM.NOSE];
    const nose = visLandmarks[LM.NOSE];
    if (rawNose && (rawNose.visibility ?? 1) > 0.2 && inBox) {
      const nx = nose.x * canvas.width;
      const ny = nose.y * canvas.height;
      const lineL = TRACK_BOX.x * canvas.width;
      const lineR = (TRACK_BOX.x + TRACK_BOX.w) * canvas.width;

      ctx.strokeStyle = state === JT_STATE.JUMPING ? "#ffb450" : "#ffffff";
      ctx.lineWidth = state === JT_STATE.JUMPING ? 2 : 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(lineL, ny);
      ctx.lineTo(lineR, ny);
      ctx.stroke();
      ctx.setLineDash([]);

      if (state === JT_STATE.JUMPING && liveJumpM > 0.01) {
        ctx.font = `700 ${Math.max(11, scale / 50)}px "Syne", sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffb450";
        drawMirroredText(ctx, `${liveJumpM.toFixed(2)} m`, nx, ny - 12);
      }
    }

    ctx.restore();
  },
};
