const GRAVITY = {
  earth: 9.81,
  moon: 1.62,
  mars: 3.71,
  pluto: 0.62,
};

const REF_MASS_KG = 70;
const EARTH_JUMP_REF = 0.5;
const METER_STEP = 0.5;
const MASS_MIN = 1;
const MASS_MAX = 300;

const modal = document.getElementById("weightModal");
const form = document.getElementById("weightForm");
const input = document.getElementById("weightInput");
const errorEl = document.getElementById("weightError");
const panels = document.getElementById("panels");
const changeBtn = document.getElementById("changeWeightBtn");

const scaleDot = document.getElementById("scaleDot");
const scaleStatus = document.getElementById("scaleStatus");
const scaleLiveKg = document.getElementById("scaleLiveKg");
const scaleConnectBtn = document.getElementById("scaleConnectBtn");
const scaleTareBtn = document.getElementById("scaleTareBtn");
const scaleResetBtn = document.getElementById("scaleResetBtn");

const exhibitBanner = document.getElementById("exhibitBanner");
const exhibitPhase = document.getElementById("exhibitPhase");
const exhibitCountdown = document.getElementById("exhibitCountdown");
const exhibitImpact = document.getElementById("exhibitImpact");

const modeScaleBtn = document.getElementById("modeScaleBtn");
const modeManualBtn = document.getElementById("modeManualBtn");
const modalModes = document.getElementById("modalModes");
const modalScalePanel = document.getElementById("modalScalePanel");
const modalManualPanel = document.getElementById("modalManualPanel");
const modalLiveKg = document.getElementById("modalLiveKg");
const modalConnectBtn = document.getElementById("modalConnectBtn");
const settingsModal = document.getElementById("settingsModal");
const aboutModal = document.getElementById("aboutModal");
const settingsBtn = document.getElementById("settingsBtn");
const aboutBtn = document.getElementById("aboutBtn");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const aboutCloseBtn = document.getElementById("aboutCloseBtn");

const params = new URLSearchParams(location.search);
const SCALE_UI_ENABLED = params.get("scale") === "auto";

let scaleMode = false;
let scaleConnected = false;

function weightInNewtons(massKg, gravity) {
  return massKg * gravity;
}

function earthJumpM(massKg) {
  return EARTH_JUMP_REF * (REF_MASS_KG / massKg);
}

function jumpHeightM(massKg, gravity) {
  return earthJumpM(massKg) * (GRAVITY.earth / gravity);
}

function formatMass(value) {
  return value.toFixed(1);
}

function formatNewtons(value) {
  return value.toFixed(1);
}

function formatMeters(value) {
  if (value < 0.1) return value.toFixed(2);
  if (value < 10) return value.toFixed(1);
  return value.toFixed(0);
}

function compareText(body, ratio) {
  if (body === "earth") return "Reference";
  return `${Math.round(ratio * 100)}% of Earth`;
}

function jumpNote(body, jumpM, earthJump, massKg) {
  if (body === "pluto") return "Highest jump — weakest gravity!";
  if (body === "earth") {
    if (massKg < REF_MASS_KG - 5) return "Lighter — you jump higher";
    if (massKg > REF_MASS_KG + 5) return "Heavier — you jump lower";
    return "Average weight for this jump";
  }
  const times = (jumpM / earthJump).toFixed(1);
  return `${times}× your Earth jump`;
}

function meterMaxFor(jumps) {
  const highest = Math.max(...jumps);
  const rounded = Math.ceil(highest / METER_STEP) * METER_STEP;
  return Math.max(rounded, METER_STEP);
}

function buildMeterLabels(container, meterMax) {
  container.innerHTML = "";
  [meterMax, 0].forEach((m) => {
    const span = document.createElement("span");
    span.textContent = m === 0 ? "0" : `${formatMeters(m)}`;
    container.appendChild(span);
  });
}

function updateJumpMeter(panel, heightM, meterMax) {
  const pct = Math.min((heightM / meterMax) * 100, 100);
  const fill = panel.querySelector("[data-jump-fill]");
  const cap = panel.querySelector("[data-jump-cap]");
  const display = panel.querySelector("[data-jump-display]");

  fill.style.height = `${pct}%`;
  cap.style.bottom = `${pct}%`;
  display.textContent = formatMeters(heightM);
}

function applySimulation(massKg) {
  const earthForce = weightInNewtons(massKg, GRAVITY.earth);
  const earthJump = earthJumpM(massKg);
  const jumps = Object.values(GRAVITY).map((g) => jumpHeightM(massKg, g));
  const meterMax = meterMaxFor(jumps);
  const massText = formatMass(massKg);

  Object.entries(GRAVITY).forEach(([body, g]) => {
    const panel = document.querySelector(`.panel[data-body="${body}"]`);
    if (!panel) return;

    const massDisplay = panel.querySelector("[data-mass-display]");
    const weightDisplay = panel.querySelector("[data-weight-display]");
    const compare = panel.querySelector("[data-compare-display]");
    const labels = panel.querySelector("[data-meter-labels]");
    const jumpNoteEl = panel.querySelector("[data-jump-note]");
    const track = panel.querySelector(".jump-meter__track");
    const newtons = weightInNewtons(massKg, g);
    const jumpM = jumpHeightM(massKg, g);

    buildMeterLabels(labels, meterMax);
    track.style.setProperty("--meter-steps", 2);
    massDisplay.textContent = massText;
    weightDisplay.textContent = formatNewtons(newtons);
    compare.textContent = compareText(body, newtons / earthForce);
    updateJumpMeter(panel, jumpM, meterMax);
    jumpNoteEl.textContent = jumpNote(body, jumpM, earthJump, massKg);
  });

  panels.hidden = false;
  exhibitBanner.hidden = true;
}

function applyCapture({ massKg, peakForceN }) {
  if (!validateWeight(massKg)) return;
  applySimulation(massKg);
  modal.close();
}

function validateWeight(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= MASS_MIN && n <= MASS_MAX;
}

function setScaleUI(state, message) {
  scaleDot.dataset.state = state;
  if (message) scaleStatus.textContent = message;
  const live = state === "live";
  scaleTareBtn.hidden = !live;
  scaleResetBtn.hidden = !live;
}

function updateLiveKg(kg) {
  const text = Number.isFinite(kg) ? kg.toFixed(1) : "—";
  scaleLiveKg.textContent = `${text} kg`;
  modalLiveKg.textContent = text;
}

function connectScale() {
  const params = new URLSearchParams(location.search);
  const url = params.get("scale") || localStorage.getItem("scaleUrl") || "ws://192.168.4.1:81/";
  ScaleClient.connect(url);
}

function setModalMode(scale) {
  if (scale && !SCALE_UI_ENABLED) return;

  scaleMode = scale;
  modeScaleBtn.classList.toggle("modal__mode-btn--active", scale);
  modeManualBtn.classList.toggle("modal__mode-btn--active", !scale);
  modalScalePanel.hidden = !scale;
  modalManualPanel.hidden = scale;

  if (!scale) {
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }
}

function configureScaleUI() {
  if (SCALE_UI_ENABLED) {
    modeScaleBtn.disabled = false;
    modeScaleBtn.removeAttribute("aria-disabled");
    modalModes.hidden = false;
    return;
  }

  modeScaleBtn.disabled = true;
  modeScaleBtn.setAttribute("aria-disabled", "true");
  modalModes.hidden = true;
  setModalMode(false);
}

const PHASE_LABELS = {
  idle: "Jump onto the pad!",
  impact: "Landing!",
  standing: "Stand still…",
  locked: "Got it!",
};

ScaleClient.on("status", (msg) => {
  if (msg.state === "connecting") setScaleUI("connecting", "Connecting…");
  else if (msg.state === "live") {
    scaleConnected = true;
    setScaleUI("live", "Scale connected");
    exhibitBanner.hidden = false;
  } else if (msg.state === "disconnected") {
    scaleConnected = false;
    setScaleUI("offline", "Scale disconnected — retrying…");
  } else if (msg.state === "offline") setScaleUI("offline", "Scale offline");
  else if (msg.state === "error") setScaleUI("error", "Connection error");
});

ScaleClient.on("phase", (msg) => {
  const phase = msg.phase || "idle";
  exhibitBanner.hidden = false;
  exhibitPhase.textContent = PHASE_LABELS[phase] || phase;

  if (phase === "impact" && msg.peakForceN) {
    exhibitImpact.hidden = false;
    exhibitImpact.textContent = `Landing force: ${formatNewtons(msg.peakForceN)} N`;
    document.querySelector(".panel--earth")?.classList.add("panel--impact-flash");
    setTimeout(() => document.querySelector(".panel--earth")?.classList.remove("panel--impact-flash"), 600);
  } else if (phase !== "impact") {
    exhibitImpact.hidden = true;
  }

  if (phase === "standing" && msg.stableMs != null) {
    const remaining = Math.max(0, Math.ceil((3000 - msg.stableMs) / 1000));
    exhibitCountdown.hidden = false;
    exhibitCountdown.textContent = remaining > 0 ? `${remaining}…` : "";
  } else if (phase !== "standing") {
    exhibitCountdown.hidden = true;
  }

  if (msg.kg != null) updateLiveKg(msg.kg);
});

ScaleClient.on("weight", (msg) => {
  if (msg.kg != null) updateLiveKg(msg.kg);
});

ScaleClient.on("capture", (msg) => {
  applyCapture({ massKg: msg.massKg, peakForceN: msg.peakForceN });
  exhibitPhase.textContent = "Step off to try again";
  ScaleClient.reset();
});

modeScaleBtn.addEventListener("click", () => {
  if (!modeScaleBtn.disabled) setModalMode(true);
});
modeManualBtn.addEventListener("click", () => setModalMode(false));

scaleConnectBtn.addEventListener("click", connectScale);
modalConnectBtn.addEventListener("click", connectScale);
scaleTareBtn.addEventListener("click", () => ScaleClient.tare());
scaleResetBtn.addEventListener("click", () => ScaleClient.reset());

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validateWeight(input.value)) {
    errorEl.hidden = false;
    input.focus();
    input.select();
    return;
  }
  errorEl.hidden = true;
  applySimulation(Number(input.value));
  modal.close();
});

input.addEventListener("input", () => {
  if (errorEl.hidden) return;
  if (validateWeight(input.value)) errorEl.hidden = true;
});

changeBtn.addEventListener("click", () => {
  settingsModal.close();
  openModal();
});

settingsBtn.addEventListener("click", () => settingsModal.showModal());
aboutBtn.addEventListener("click", () => aboutModal.showModal());
settingsCloseBtn.addEventListener("click", () => settingsModal.close());
aboutCloseBtn.addEventListener("click", () => aboutModal.close());

modal.addEventListener("cancel", (e) => {
  if (panels.hidden) e.preventDefault();
});

function openModal() {
  errorEl.hidden = true;
  modal.showModal();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

configureScaleUI();

if (SCALE_UI_ENABLED) {
  setModalMode(true);
  openModal();
  connectScale();
} else {
  setModalMode(false);
  openModal();
}
