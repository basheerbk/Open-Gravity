import {
  GRAVITY,
  MASS_MIN,
  MASS_MAX,
  weightInNewtons,
  estimatedEarthJump,
  jumpOnWorld,
  meterMaxFor,
  formatMass,
  formatNewtons,
  formatMeters,
} from "./physics.js";

import { Camera } from "./camera.js";
import { PoseDetector } from "./poseDetector.js";
import { JumpTracker, JT_STATE } from "./jumpTracker.js";

// ── Flow states ───────────────────────────────────────────────────────────────
const FLOW = {
  MASS: "mass",
  CAMERA_SETUP: "camera-setup",
  JUMP_CAPTURE: "jump-capture",
  RESULTS: "results",
};

let flow = FLOW.MASS;
let currentMassKg = null;
let currentHeightCm = 170;
let measuredJumpM = null;    // null = use estimated fallback
let animFrameId = null;

// ── URL params ─────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SCALE_UI_ENABLED = params.get("scale") === "auto";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const massModal      = document.getElementById("weightModal");
const massForm       = document.getElementById("weightForm");
const massInput      = document.getElementById("weightInput");
const heightInput    = document.getElementById("heightInput");
const massError      = document.getElementById("weightError");
const cameraStage    = document.getElementById("cameraStage");
const cameraSetupCard= document.getElementById("cameraSetupCard");
const cameraLiveView = document.getElementById("cameraLiveView");
const videoEl        = document.getElementById("poseVideo");
const canvasEl       = document.getElementById("poseCanvas");
const jumpPhaseLabel = document.getElementById("jumpPhaseLabel");
const jumpCountdown  = document.getElementById("jumpCountdown");
const cameraStartBtn = document.getElementById("cameraStartBtn");
const skipCameraBtn  = document.getElementById("skipCameraBtn");
const skipLiveBtn    = document.getElementById("skipLiveBtn");
const cameraBackBtn  = document.getElementById("cameraBackBtn");
const cameraErrEl    = document.getElementById("cameraPermError");
const panelsEl       = document.getElementById("panels");
const resultsBar     = document.getElementById("resultsBar");
const jumpAgainBtn   = document.getElementById("jumpAgainBtn");
const changeMassBtn  = document.getElementById("changeMassBtn");
const jumpResultInfo = document.getElementById("jumpResultInfo");
const settingsModal  = document.getElementById("settingsModal");
const aboutModal     = document.getElementById("aboutModal");
const settingsBtn    = document.getElementById("settingsBtn");
const aboutBtn       = document.getElementById("aboutBtn");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const aboutCloseBtn    = document.getElementById("aboutCloseBtn");
const changeWeightBtn  = document.getElementById("changeWeightBtn");
const exhibitBanner    = document.getElementById("exhibitBanner");
// Scale UI (only relevant in exhibit mode)
const scaleDot       = document.getElementById("scaleDot");
const scaleStatus    = document.getElementById("scaleStatus");
const scaleLiveKg    = document.getElementById("scaleLiveKg");
const scaleConnectBtn= document.getElementById("scaleConnectBtn");
const scaleTareBtn   = document.getElementById("scaleTareBtn");
const scaleResetBtn  = document.getElementById("scaleResetBtn");
const modalModes     = document.getElementById("modalModes");
const modeScaleBtn   = document.getElementById("modeScaleBtn");
const modeManualBtn  = document.getElementById("modeManualBtn");

// ── Phase label helpers ────────────────────────────────────────────────────────
const JUMP_PHASE_TEXT = {
  [JT_STATE.BASELINE]: "Stand still…",
  [JT_STATE.READY]:    "JUMP!",
  [JT_STATE.JUMPING]:  "In the air!",
  [JT_STATE.DONE]:     "Got it!",
};

// ── Validation ────────────────────────────────────────────────────────────────
function validateMass(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= MASS_MIN && n <= MASS_MAX;
}

function validateHeight(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 50 && n <= 280;
}

// ── Panel rendering ────────────────────────────────────────────────────────────
function buildMeterLabels(container, meterMax) {
  container.innerHTML = "";
  [meterMax, 0].forEach((m) => {
    const span = document.createElement("span");
    span.textContent = m === 0 ? "0" : formatMeters(m);
    container.appendChild(span);
  });
}

function updateJumpMeter(panel, heightM, meterMax) {
  const pct = Math.min((heightM / meterMax) * 100, 100);
  const fill = panel.querySelector("[data-jump-fill]");
  const cap = panel.querySelector("[data-jump-cap]");
  const display = panel.querySelector("[data-jump-display]");
  if (fill) fill.style.height = `${pct}%`;
  if (cap) cap.style.bottom = `${pct}%`;
  if (display) display.textContent = formatMeters(heightM);
}

function jumpNote(body, jumpM, earthJumpM) {
  if (body === "earth") {
    const suffix = measuredJumpM ? " (measured)" : " (estimated)";
    return `${formatMeters(jumpM)} m on Earth` + suffix;
  }
  if (body === "pluto") return "Highest jump — weakest gravity!";
  const times = (jumpM / earthJumpM).toFixed(1);
  return `${times}× your Earth jump`;
}

/** Update hop animation height and duration via CSS custom properties. */
function setHopCSS(panel, body, earthJumpM, g) {
  const worldJump = jumpOnWorld(earthJumpM, g);
  // Scale factor: Earth 0.5 m ≈ 15 px; cap Pluto/Moon so they stay in frame
  const BASE_PX = 15;
  const BASE_M  = 0.5;
  const hopPx   = Math.min(Math.round((worldJump / BASE_M) * BASE_PX), 240);
  const durations = { earth: 1.55, moon: 3.8, mars: 2.35, pluto: 5.5 };
  panel.style.setProperty("--hop-px", `${hopPx}px`);
  panel.style.setProperty("--hop-duration", `${durations[body] ?? 2}s`);
}

function applySimulation(massKg, earthJump) {
  const earthForce = weightInNewtons(massKg, GRAVITY.earth);
  const jumps = Object.entries(GRAVITY).map(([, g]) => jumpOnWorld(earthJump, g));
  const meterMax = meterMaxFor(jumps);
  const massText = formatMass(massKg);

  Object.entries(GRAVITY).forEach(([body, g]) => {
    const panel = document.querySelector(`.panel[data-body="${body}"]`);
    if (!panel) return;

    const jumpM = jumpOnWorld(earthJump, g);
    panel.querySelector("[data-mass-display]").textContent = massText;
    panel.querySelector("[data-weight-display]").textContent = formatNewtons(weightInNewtons(massKg, g));
    panel.querySelector("[data-compare-display]").textContent =
      body === "earth" ? "Reference" : `${Math.round((weightInNewtons(massKg, g) / earthForce) * 100)}% of Earth`;

    const labels = panel.querySelector("[data-meter-labels]");
    if (labels) buildMeterLabels(labels, meterMax);
    updateJumpMeter(panel, jumpM, meterMax);

    const noteEl = panel.querySelector("[data-jump-note]");
    if (noteEl) noteEl.textContent = jumpNote(body, jumpM, earthJump);

    setHopCSS(panel, body, earthJump, g);
  });

  panelsEl.hidden = false;
  exhibitBanner.hidden = true;
}

// ── Flow transitions ──────────────────────────────────────────────────────────
function goToMass() {
  flow = FLOW.MASS;
  cameraStage.hidden = true;
  panelsEl.hidden = true;
  resultsBar.hidden = true;
  stopCamera();
  massModal.showModal();
  requestAnimationFrame(() => {
    massInput.focus();
    massInput.select();
  });
}

function goToCameraSetup() {
  flow = FLOW.CAMERA_SETUP;
  massModal.close();
  cameraStage.hidden = false;
  cameraSetupCard.hidden = false;
  cameraLiveView.hidden = true;
  if (cameraErrEl) cameraErrEl.hidden = true;

  if (!Camera.isSupported()) {
    showCameraError("Camera not available in this browser.");
  }
}

async function goToJumpCapture() {
  flow = FLOW.JUMP_CAPTURE;
  cameraSetupCard.hidden = true;
  cameraLiveView.hidden = false;
  jumpPhaseLabel.textContent = "Starting camera…";
  jumpCountdown.hidden = true;

  try {
    await Camera.start(videoEl);
    await PoseDetector.init();
    startJumpTracking();
  } catch (err) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      showCameraError("Camera access was denied. Allow camera access in your browser and try again.");
    } else {
      showCameraError(`Could not start camera: ${err.message}`);
    }
    cameraSetupCard.hidden = false;
    cameraLiveView.hidden = true;
    flow = FLOW.CAMERA_SETUP;
  }
}

function showCameraError(msg) {
  if (!cameraErrEl) return;
  cameraErrEl.textContent = msg;
  cameraErrEl.hidden = false;
}

function skipCamera() {
  measuredJumpM = null;
  stopCamera();
  goToResults();
}

function goToResults() {
  flow = FLOW.RESULTS;
  stopCamera();
  cameraStage.hidden = true;
  massModal.close();

  const earthJump = measuredJumpM ?? estimatedEarthJump(currentMassKg);
  applySimulation(currentMassKg, earthJump);

  resultsBar.hidden = false;
  if (jumpResultInfo) {
    jumpResultInfo.textContent = measuredJumpM
      ? `Your Earth jump: ${formatMeters(measuredJumpM)} m (measured)`
      : `Estimated for ${formatMass(currentMassKg)} kg`;
  }
}

// ── Jump tracking loop ─────────────────────────────────────────────────────────
function startJumpTracking() {
  JumpTracker.onStateChange = (state) => {
    const text = JUMP_PHASE_TEXT[state] ?? "";
    jumpPhaseLabel.textContent = text;

    if (state === JT_STATE.BASELINE) {
      jumpCountdown.hidden = false;
      jumpCountdown.textContent = "Getting baseline…";
    } else if (state === JT_STATE.READY) {
      jumpCountdown.hidden = false;
      jumpCountdown.textContent = "Jump when ready!";
      jumpPhaseLabel.classList.add("camera-phase--ready");
    } else {
      jumpCountdown.hidden = true;
      jumpPhaseLabel.classList.remove("camera-phase--ready");
    }
  };

  JumpTracker.onJumpCaptured = (jumpM) => {
    measuredJumpM = jumpM;
    jumpPhaseLabel.textContent = `Captured: ${formatMeters(jumpM)} m`;
    cancelAnimationFrame(animFrameId);
    // Brief pause so the user sees the "captured" state
    setTimeout(() => goToResults(), 1200);
  };

  JumpTracker.start(currentHeightCm);
  renderLoop();
}

function renderLoop() {
  const landmarks = PoseDetector.detect(videoEl);
  PoseDetector.drawSkeleton(canvasEl, videoEl, landmarks);
  JumpTracker.update(landmarks);
  animFrameId = requestAnimationFrame(renderLoop);
}

function stopCamera() {
  cancelAnimationFrame(animFrameId);
  animFrameId = null;
  Camera.stop();
  JumpTracker.reset();
}

// ── Scale exhibit mode ────────────────────────────────────────────────────────
async function initScaleMode() {
  const { ScaleClient } = await import("../scale.js");

  if (modeScaleBtn) {
    modeScaleBtn.disabled = false;
    modeScaleBtn.removeAttribute("aria-disabled");
  }
  if (modalModes) modalModes.hidden = false;

  ScaleClient.on("status", (msg) => {
    if (!scaleDot) return;
    scaleDot.dataset.state = msg.state === "live" ? "live"
      : msg.state === "connecting" ? "connecting"
      : msg.state === "error" ? "error" : "offline";
    if (scaleStatus && msg.state) {
      const labels = { live: "Scale connected", connecting: "Connecting…", error: "Connection error", offline: "Scale offline", disconnected: "Scale disconnected — retrying…" };
      scaleStatus.textContent = labels[msg.state] ?? msg.state;
    }
    if (scaleTareBtn) scaleTareBtn.hidden = msg.state !== "live";
    if (scaleResetBtn) scaleResetBtn.hidden = msg.state !== "live";
    if (msg.state === "live" && exhibitBanner) exhibitBanner.hidden = false;
  });

  ScaleClient.on("weight", (msg) => {
    if (msg.kg != null) {
      const t = Number.isFinite(msg.kg) ? msg.kg.toFixed(1) : "—";
      if (scaleLiveKg) scaleLiveKg.textContent = `${t} kg`;
    }
  });

  ScaleClient.on("capture", (msg) => {
    if (!validateMass(msg.massKg)) return;
    currentMassKg = msg.massKg;
    measuredJumpM = null;
    goToResults();
    ScaleClient.reset();
  });

  if (scaleConnectBtn) scaleConnectBtn.addEventListener("click", () => {
    const url = params.get("scale") || localStorage.getItem("scaleUrl") || "ws://192.168.4.1:81/";
    ScaleClient.connect(url);
  });
  if (scaleTareBtn)  scaleTareBtn.addEventListener("click",  () => ScaleClient.tare());
  if (scaleResetBtn) scaleResetBtn.addEventListener("click", () => ScaleClient.reset());

  const url = params.get("scale") || "ws://192.168.4.1:81/";
  ScaleClient.connect(url);
}

// ── Event listeners ───────────────────────────────────────────────────────────
massForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validateMass(massInput.value)) {
    massError.hidden = false;
    massInput.focus();
    massInput.select();
    return;
  }
  massError.hidden = true;
  currentMassKg = Number(massInput.value);
  currentHeightCm = validateHeight(heightInput?.value)
    ? Number(heightInput.value)
    : 170;

  goToCameraSetup();
});

massInput.addEventListener("input", () => {
  if (!massError.hidden && validateMass(massInput.value)) massError.hidden = true;
});

massModal.addEventListener("cancel", (e) => {
  if (panelsEl.hidden) e.preventDefault();
});

cameraStartBtn?.addEventListener("click", () => goToJumpCapture());
skipCameraBtn?.addEventListener("click", () => skipCamera());
skipLiveBtn?.addEventListener("click", () => skipCamera());
cameraBackBtn?.addEventListener("click", () => {
  stopCamera();
  cameraStage.hidden = true;
  goToMass();
});

jumpAgainBtn?.addEventListener("click", () => {
  panelsEl.hidden = true;
  resultsBar.hidden = true;
  cameraStage.hidden = false;
  cameraSetupCard.hidden = false;
  cameraLiveView.hidden = true;
  if (cameraErrEl) cameraErrEl.hidden = true;
  flow = FLOW.CAMERA_SETUP;
});

changeMassBtn?.addEventListener("click", () => {
  panelsEl.hidden = true;
  resultsBar.hidden = true;
  goToMass();
});

changeWeightBtn?.addEventListener("click", () => {
  settingsModal.close();
  panelsEl.hidden = true;
  resultsBar.hidden = true;
  goToMass();
});

settingsBtn?.addEventListener("click", () => settingsModal.showModal());
aboutBtn?.addEventListener("click",    () => aboutModal.showModal());
settingsCloseBtn?.addEventListener("click", () => settingsModal.close());
aboutCloseBtn?.addEventListener("click",    () => aboutModal.close());

// ── Boot ──────────────────────────────────────────────────────────────────────
if (SCALE_UI_ENABLED) {
  initScaleMode();
}

goToMass();
