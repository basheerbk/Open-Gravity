/**
 * Fixed "stand here" spot for exhibit / kiosk use.
 * Normalised image coords: x,y in 0–1 (y increases downward).
 * Tune at install via URL: ?zoneX=0.5&zoneY=0.78&zoneW=0.22
 * Web/mobile without floor mark: ?zone=off
 */
const params = new URLSearchParams(location.search);

export const ZONE_OFF = params.get("zone") === "off";

export const STAND_ZONE = {
  cx: parseFloat(params.get("zoneX")) || 0.5,
  cy: parseFloat(params.get("zoneY")) || 0.78,
  rx: parseFloat(params.get("zoneW")) || 0.2,
  ry: parseFloat(params.get("zoneH")) || 0.1,
};

export const EXHIBIT_M_PER_UNIT =
  parseFloat(params.get("mPerUnit")) ||
  parseFloat(localStorage.getItem("og_mPerUnit")) ||
  2.8;

export function saveExhibitScale(mPerUnit) {
  localStorage.setItem("og_mPerUnit", String(mPerUnit));
}

const LM = { L_ANKLE: 27, R_ANKLE: 28, L_HIP: 23, R_HIP: 24 };

/** Web mode: feet visible and roughly centred in lower frame. */
function feetInFrame(landmarks) {
  const la = landmarks[LM.L_ANKLE];
  const ra = landmarks[LM.R_ANKLE];
  if (!la || !ra) return false;
  if ((la.visibility ?? 1) < 0.35 || (ra.visibility ?? 1) < 0.35) return false;

  const footX = (la.x + ra.x) / 2;
  const footY = Math.max(la.y, ra.y);
  return Math.abs(footX - 0.5) < 0.28 && footY > 0.45 && footY < 0.95;
}

function inEllipse(x, y) {
  const dx = (x - STAND_ZONE.cx) / STAND_ZONE.rx;
  const dy = (y - STAND_ZONE.cy) / STAND_ZONE.ry;
  return dx * dx + dy * dy <= 1;
}

/** True when both feet are inside the stand ellipse (or frame centre in zone=off mode). */
export function feetInZone(landmarks) {
  if (!landmarks) return false;
  if (ZONE_OFF) return feetInFrame(landmarks);

  const la = landmarks[LM.L_ANKLE];
  const ra = landmarks[LM.R_ANKLE];
  if (!la || !ra) return false;
  if ((la.visibility ?? 1) < 0.4 || (ra.visibility ?? 1) < 0.4) return false;
  return inEllipse(la.x, la.y) && inEllipse(ra.x, ra.y);
}

/** Progress ring while standing still on the mark (0–1). */
export function drawBaselineProgress(ctx, w, h, progress) {
  const cx = STAND_ZONE.cx * w;
  const cy = STAND_ZONE.cy * h;
  const rx = STAND_ZONE.rx * w;
  const ry = STAND_ZONE.ry * h;
  const ringR = Math.max(rx, ry) + 8;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, ringR, ringR * (ry / rx), 0, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 224, 102, 0.9)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

/** Draw the stand-here marker on the PiP canvas. */
export function drawStandZone(ctx, w, h, personInZone, opts = {}) {
  const { baselineProgress = 0, showZone = !ZONE_OFF } = opts;

  if (!showZone) {
    if (personInZone) {
      ctx.save();
      ctx.font = `700 ${Math.max(10, w * 0.04)}px "Syne", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = personInZone ? "#6ee7a0" : "#9de0ff";
      ctx.fillText(personInZone ? "JUMP!" : "Stand in frame", w / 2, h - 12);
      ctx.restore();
    }
    return;
  }

  const cx = STAND_ZONE.cx * w;
  const cy = STAND_ZONE.cy * h;
  const rx = STAND_ZONE.rx * w;
  const ry = STAND_ZONE.ry * h;

  ctx.save();

  if (baselineProgress > 0 && baselineProgress < 1) {
    drawBaselineProgress(ctx, w, h, baselineProgress);
  }

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = personInZone
    ? "rgba(110, 231, 160, 0.22)"
    : "rgba(126, 200, 255, 0.12)";
  ctx.fill();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = personInZone
    ? "rgba(110, 231, 160, 0.95)"
    : "rgba(126, 200, 255, 0.75)";
  ctx.lineWidth = personInZone ? 2.5 : 2;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = `700 ${Math.max(10, w * 0.045)}px "Syne", "DM Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = personInZone ? "#6ee7a0" : "#9de0ff";
  ctx.fillText(personInZone ? "JUMP!" : "STAND HERE", cx, cy - ry - 6);

  ctx.font = `${Math.max(14, w * 0.06)}px sans-serif`;
  ctx.fillText("👟", cx - rx * 0.35, cy + 4);
  ctx.fillText("👟", cx + rx * 0.35, cy + 4);

  ctx.restore();
}
