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

  /**
   * Run pose detection on a single video frame.
   * Returns the first pose's normalized landmarks array, or null.
   */
  detect(videoEl) {
    if (!this.landmarker) return null;
    const result = this.landmarker.detectForVideo(videoEl, performance.now());
    return result.landmarks?.[0] ?? null;
  },

  /**
   * Draw skeleton and keypoints onto a canvas positioned over the video.
   * Syncs canvas dimensions to the video's intrinsic size.
   */
  drawSkeleton(canvas, videoEl, landmarks) {
    const ctx = canvas.getContext("2d");

    // Mirror the canvas to match the mirrored video feed
    if (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight) {
      canvas.width = videoEl.videoWidth || 640;
      canvas.height = videoEl.videoHeight || 480;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks) return;

    if (!this._drawingUtils) {
      this._drawingUtils = new DrawingUtils(ctx);
    }

    this._drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: "rgba(126,200,255,0.55)",
      lineWidth: 2.5,
    });

    this._drawingUtils.drawLandmarks(landmarks, {
      radius: 4,
      color: "rgba(255,255,255,0.9)",
      fillColor: "rgba(126,200,255,0.95)",
      lineWidth: 1,
    });
  },
};
