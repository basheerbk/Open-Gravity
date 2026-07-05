/**
 * Fixed "stand here" spot for exhibit / kiosk use.
 * Normalised image coords: x,y in 0–1 (y increases downward).
 * Tune at install via URL: ?zoneX=0.5&zoneY=0.78&zoneW=0.22
 */
const params = new URLSearchParams(location.search);

export const STAND_ZONE = {
  cx: parseFloat(params.get("zoneX")) || 0.5,
  cy: parseFloat(params.get("zoneY")) || 0.78,
  rx: parseFloat(params.get("zoneW")) || 0.2,
  ry: parseFloat(params.get("zoneH")) || 0.1,
};

/** Meters per normalised ankle-rise at this fixed camera + spot (staff calibrates once). */
export const EXHIBIT_M_PER_UNIT =
  parseFloat(params.get("mPerUnit")) ||
  parseFloat(localStorage.getItem("og_mPerUnit")) ||
  2.8;

export function saveExhibitScale(mPerUnit) {
  localStorage.setItem("og_mPerUnit", String(mPerUnit));
}

const LM = { L_ANKLE: 27, R_ANKLE: 28 };

/** True when both feet are inside the stand ellipse. */
export function feetInZone(landmarks) {
  if (!landmarks) return false;
  const la = landmarks[LM.L_ANKLE];
  const ra = landmarks[LM.R_ANKLE];
  if (!la || !ra) return false;
  if ((la.visibility ?? 1) < 0.4 || (ra.visibility ?? 1) < 0.4) return false;

  const zx = STAND_ZONE.cx;
  const zy = STAND_ZONE.cy;
  const rx = STAND_ZONE.rx;
  const ry = STAND_ZONE.ry;

  const inEllipse = (x, y) => {
    const dx = (x - zx) / rx;
    const dy = (y - zy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  return inEllipse(la.x, la.y) && inEllipse(ra.x, ra.y);
}

/** Draw the stand-here marker on the PiP canvas. */
export function drawStandZone(ctx, w, h, personInZone) {
  const cx = STAND_ZONE.cx * w;
  const cy = STAND_ZONE.cy * h;
  const rx = STAND_ZONE.rx * w;
  const ry = STAND_ZONE.ry * h;

  ctx.save();

  // Ground ellipse
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = personInZone
    ? "rgba(110, 231, 160, 0.18)"
    : "rgba(126, 200, 255, 0.12)";
  ctx.fill();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = personInZone
    ? "rgba(110, 231, 160, 0.95)"
    : "rgba(126, 200, 255, 0.75)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // Label
  ctx.font = `700 ${Math.max(10, w * 0.045)}px "Syne", "DM Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = personInZone ? "#6ee7a0" : "#9de0ff";
  ctx.fillText(personInZone ? "JUMP!" : "STAND HERE", cx, cy - ry - 6);

  // Foot icons
  ctx.font = `${Math.max(14, w * 0.06)}px sans-serif`;
  ctx.fillText("👟", cx - rx * 0.35, cy + 4);
  ctx.fillText("👟", cx + rx * 0.35, cy + 4);

  ctx.restore();
}
