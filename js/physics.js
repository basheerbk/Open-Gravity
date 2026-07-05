export const GRAVITY = {
  earth: 9.81,
  moon: 1.62,
  mars: 3.71,
  pluto: 0.62,
};

export const MASS_MIN = 1;
export const MASS_MAX = 300;
export const METER_STEP = 0.5;

const REF_MASS_KG = 70;
const EARTH_JUMP_REF = 0.5; // 70 kg person jumps ~0.5 m on Earth

export function weightInNewtons(massKg, g) {
  return massKg * g;
}

/** Physics-estimated Earth jump for a given mass (no camera needed). */
export function estimatedEarthJump(massKg) {
  return EARTH_JUMP_REF * (REF_MASS_KG / massKg);
}

/** Scale a measured (or estimated) Earth jump height to another world's gravity. */
export function jumpOnWorld(earthJumpM, g) {
  return earthJumpM * (GRAVITY.earth / g);
}

export function meterMaxFor(jumps) {
  const highest = Math.max(...jumps);
  const rounded = Math.ceil(highest / METER_STEP) * METER_STEP;
  return Math.max(rounded, METER_STEP);
}

export function formatMass(v) {
  return v.toFixed(1);
}

export function formatNewtons(v) {
  return v.toFixed(1);
}

export function formatMeters(v) {
  if (v < 0.1) return v.toFixed(2);
  if (v < 10) return v.toFixed(1);
  return v.toFixed(0);
}
