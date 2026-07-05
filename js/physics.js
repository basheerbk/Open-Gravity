export const GRAVITY = {
  earth: 9.81,
  moon:  1.62,
  mars:  3.71,
  pluto: 0.62,
};

export const DEFAULT_EARTH_JUMP = 0.5; // shown before any real jump is measured
export const METER_STEP = 0.5;

/** Scale a measured Earth jump to another world. */
export function jumpOnWorld(earthJumpM, g) {
  return earthJumpM * (GRAVITY.earth / g);
}

/** Jump multiplier vs Earth (e.g. Moon = 6.1). */
export function jumpMultiplier(g) {
  return GRAVITY.earth / g;
}

export function meterMaxFor(jumps) {
  const highest = Math.max(...jumps);
  const rounded = Math.ceil(highest / METER_STEP) * METER_STEP;
  return Math.max(rounded, METER_STEP);
}

export function formatMeters(v) {
  if (v < 0.1) return v.toFixed(2);
  if (v < 10)  return v.toFixed(1);
  return v.toFixed(0);
}
