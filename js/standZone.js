/**
 * Pose readiness + body-relative jump calibration (nose spike).
 * Optional URL override: ?mPerUnit=2.8 or ?bodyM=1.65
 */
const params = new URLSearchParams(location.search);

export const M_PER_UNIT_OVERRIDE = params.has("mPerUnit")
  ? parseFloat(params.get("mPerUnit"))
  : null;

export const BODY_HEIGHT_M =
  parseFloat(params.get("bodyM")) ||
  parseFloat(localStorage.getItem("og_bodyM")) ||
  1.65;

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

/** Nose visible — primary jump signal. */
export function noseTracked(landmarks) {
  if (!landmarks) return false;
  const nose = landmarks[LM.NOSE];
  return nose != null && vis(nose) > 0.25;
}

/** Upper body in frame (nose + shoulders or hips). */
export function poseReady(landmarks) {
  if (!noseTracked(landmarks)) return false;

  const hasTorso =
    vis(landmarks[LM.L_SHOULDER]) > 0.2 ||
    vis(landmarks[LM.R_SHOULDER]) > 0.2 ||
    vis(landmarks[LM.L_HIP]) > 0.2 ||
    vis(landmarks[LM.R_HIP]) > 0.2;

  if (!hasTorso) return false;

  const nose = landmarks[LM.NOSE];
  return nose.x > 0.05 && nose.x < 0.95;
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

/** Thin baseline progress bar at bottom of PiP. */
export function drawBaselineBar(ctx, w, h, progress) {
  if (progress <= 0 || progress >= 1) return;

  const barH = 4;
  const y = h - barH - 4;
  const pad = 8;

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fillRect(pad, y, w - pad * 2, barH);
  ctx.fillStyle = "rgba(255, 224, 102, 0.9)";
  ctx.fillRect(pad, y, (w - pad * 2) * progress, barH);
  ctx.restore();
}
