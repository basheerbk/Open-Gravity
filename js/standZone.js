/**
 * Pose readiness + track box + body-relative jump calibration (nose spike).
 * Track box: only the person inside the dashed box is measured.
 * Tune: ?boxX=0.22&boxY=0.08&boxW=0.56&boxH=0.84
 * Scale: ?mPerUnit=2.8 or ?bodyM=1.65
 */
const params = new URLSearchParams(location.search);

export const M_PER_UNIT_OVERRIDE = params.has("mPerUnit")
  ? parseFloat(params.get("mPerUnit"))
  : null;

export const BODY_HEIGHT_M =
  parseFloat(params.get("bodyM")) ||
  parseFloat(localStorage.getItem("og_bodyM")) ||
  1.65;

/** Normalised track box inside the camera frame (0–1). */
export const TRACK_BOX = {
  x: clamp01(parseFloat(params.get("boxX")) || 0.34),
  y: clamp01(params.has("boxY") ? parseFloat(params.get("boxY")) : 0),
  w: clamp01(parseFloat(params.get("boxW")) || 0.32),
  h: clamp01(params.has("boxH") ? parseFloat(params.get("boxH")) : 1),
};

function clamp01(v) {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * The camera preview box is styled with a fixed 4:3 aspect ratio (see
 * `.camera-pip__media` in styles.css) and the <video> is shown with
 * `object-fit: cover`, which crops it to fill that box. `object-fit` has
 * no effect on <canvas>, so raw landmark coordinates (normalised over the
 * *uncropped* camera frame) must be remapped onto the visible, cropped
 * frame before they're used for drawing or for the track-box hit test —
 * otherwise everything drifts whenever the webcam's real stream isn't 4:3.
 */
const DEST_ASPECT = 4 / 3;
let _srcAspect = DEST_ASPECT;

/** Call once the video's native resolution is known (updates each frame is fine). */
export function setViewport(videoWidth, videoHeight) {
  if (videoWidth > 0 && videoHeight > 0) {
    _srcAspect = videoWidth / videoHeight;
  }
}

/**
 * The camera canvas is CSS-mirrored (`transform: scaleX(-1)`) to match the
 * mirrored <video>, so any text drawn normally on it comes out backwards
 * ("STAND IN BOX" → "XOB NI DNATS"). Pre-flip the text locally around its
 * own draw point so the outer CSS mirror un-flips it back to readable text.
 */
export function drawMirroredText(ctx, text, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Raw (uncropped) normalised landmark coord → visible/cropped-frame normalised coord. */
export function mapToVisible(x, y) {
  if (_srcAspect >= DEST_ASPECT) {
    const cropW = DEST_ASPECT / _srcAspect;
    const offX = (1 - cropW) / 2;
    return { x: (x - offX) / cropW, y };
  }
  const cropH = _srcAspect / DEST_ASPECT;
  const offY = (1 - cropH) / 2;
  return { x, y: (y - offY) / cropH };
}

const LM = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_HIP: 23,
  R_HIP: 24,
  L_ANKLE: 27,
  R_ANKLE: 28,
};

function vis(p) {
  return p ? (p.visibility ?? 1) : 0;
}

function inBox(x, y) {
  const v = mapToVisible(x, y);
  return (
    v.x >= TRACK_BOX.x &&
    v.x <= TRACK_BOX.x + TRACK_BOX.w &&
    v.y >= TRACK_BOX.y &&
    v.y <= TRACK_BOX.y + TRACK_BOX.h
  );
}

/** Nose (and preferably shoulders) inside the track box. */
export function personInBox(landmarks) {
  if (!landmarks) return false;
  const nose = landmarks[LM.NOSE];
  if (!nose || vis(nose) < 0.15) return false;
  if (!inBox(nose.x, nose.y)) return false;

  const ls = landmarks[LM.L_SHOULDER];
  const rs = landmarks[LM.R_SHOULDER];
  // If shoulders visible, require at least one inside the box
  if (ls && vis(ls) > 0.2 && rs && vis(rs) > 0.2) {
    return inBox(ls.x, ls.y) || inBox(rs.x, rs.y);
  }
  return true;
}

/** Nose visible — primary jump signal. */
export function noseTracked(landmarks) {
  if (!landmarks) return false;
  const nose = landmarks[LM.NOSE];
  return nose != null && vis(nose) > 0.15;
}

/** Ready to measure: nose + torso, and inside the track box. */
export function poseReady(landmarks) {
  if (!noseTracked(landmarks)) return false;
  if (!personInBox(landmarks)) return false;

  const hasTorso =
    vis(landmarks[LM.L_SHOULDER]) > 0.15 ||
    vis(landmarks[LM.R_SHOULDER]) > 0.15 ||
    vis(landmarks[LM.L_HIP]) > 0.15 ||
    vis(landmarks[LM.R_HIP]) > 0.15;

  if (!hasTorso && vis(landmarks[LM.NOSE]) < 0.5) return false;
  return true;
}

/** Visible body height in normalised coords — scales nose rise to metres. */
export function bodyScaleNorm(landmarks) {
  const nose = landmarks[LM.NOSE];
  if (!nose) return 0.35;

  const la = landmarks[LM.L_ANKLE];
  const ra = landmarks[LM.R_ANKLE];
  if (la && ra && vis(la) > 0.2 && vis(ra) > 0.2) {
    return Math.max(0.25, (la.y + ra.y) / 2 - nose.y);
  }

  const lh = landmarks[LM.L_HIP];
  const rh = landmarks[LM.R_HIP];
  if (lh && rh) {
    const torso = (lh.y + rh.y) / 2 - nose.y;
    return Math.max(0.2, torso * 2.2);
  }
  if (lh || rh) {
    const hipY = lh ? lh.y : rh.y;
    return Math.max(0.2, (hipY - nose.y) * 2.2);
  }

  const ls = landmarks[LM.L_SHOULDER];
  const rs = landmarks[LM.R_SHOULDER];
  if (ls && rs) {
    return Math.max(0.2, (ls.y + rs.y) / 2 - nose.y + 0.35);
  }

  return 0.35;
}

/** Nose Y rise (normalised) → jump height in metres. */
export function normDeltaToMeters(normDelta, scaleNorm) {
  if (M_PER_UNIT_OVERRIDE != null) return normDelta * M_PER_UNIT_OVERRIDE;
  return (normDelta / scaleNorm) * BODY_HEIGHT_M;
}

/** Track box in canvas pixel space, given the canvas's current size. */
export function trackBoxPx(w, h) {
  return {
    x: TRACK_BOX.x * w,
    y: TRACK_BOX.y * h,
    w: TRACK_BOX.w * w,
    h: TRACK_BOX.h * h,
  };
}

/** Draw track box + dim outside so only the inner zone is the focus. */
export function drawTrackBox(ctx, w, h, personInside) {
  const { x, y, w: bw, h: bh } = trackBoxPx(w, h);

  ctx.save();

  // Fully mask everything outside the box in solid black
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  ctx.clearRect(x, y, bw, bh);

  // Box border
  ctx.setLineDash([8, 5]);
  ctx.strokeStyle = personInside
    ? "rgba(110, 231, 160, 0.95)"
    : "rgba(126, 200, 255, 0.85)";
  ctx.lineWidth = personInside ? 3 : 2;
  ctx.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
  ctx.setLineDash([]);

  // Corner ticks
  const tick = Math.min(18, bw * 0.08, bh * 0.08);
  ctx.strokeStyle = personInside ? "#6ee7a0" : "#9de0ff";
  ctx.lineWidth = 3;
  ctx.lineCap = "square";
  // TL
  ctx.beginPath();
  ctx.moveTo(x, y + tick); ctx.lineTo(x, y); ctx.lineTo(x + tick, y);
  ctx.stroke();
  // TR
  ctx.beginPath();
  ctx.moveTo(x + bw - tick, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + tick);
  ctx.stroke();
  // BL
  ctx.beginPath();
  ctx.moveTo(x, y + bh - tick); ctx.lineTo(x, y + bh); ctx.lineTo(x + tick, y + bh);
  ctx.stroke();
  // BR
  ctx.beginPath();
  ctx.moveTo(x + bw - tick, y + bh); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw, y + bh - tick);
  ctx.stroke();

  // Label (inside top when box is full-height)
  ctx.font = `700 ${Math.max(11, w * 0.035)}px "Syne", "DM Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = personInside ? "#6ee7a0" : "#9de0ff";
  const labelY = y < 20 ? y + Math.max(18, h * 0.04) : Math.max(y - 8, 16);
  drawMirroredText(
    ctx,
    personInside ? "TRACKING" : "STAND IN BOX",
    x + bw / 2,
    labelY,
  );

  ctx.restore();
}

/** Thin baseline progress bar at bottom of track box. */
export function drawBaselineBar(ctx, w, h, progress) {
  if (progress <= 0 || progress >= 1) return;

  const x = TRACK_BOX.x * w + 8;
  const bw = TRACK_BOX.w * w - 16;
  const barH = 4;
  const y = (TRACK_BOX.y + TRACK_BOX.h) * h - barH - 10;

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fillRect(x, y, bw, barH);
  ctx.fillStyle = "rgba(255, 224, 102, 0.9)";
  ctx.fillRect(x, y, bw * progress, barH);
  ctx.restore();
}
