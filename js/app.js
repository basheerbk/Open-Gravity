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
  MASS:    "mass",
  SETUP:   "setup",   // camera tips + permission
  LIVE:    "live",    // baseline calibration (full-screen camera)
  RESULTS: "results", // panels shown, camera running in background
};

let flow = FLOW.MASS;
let currentMassKg  = null;
let lastJumpM      = null;   // most recently measured Earth jump
let animFrameId    = null;

// ── URL params ────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SCALE_UI_ENABLED = params.get("scale") === "auto";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const massModal       = document.getElementById("weightModal");
const massForm        = document.getElementById("weightForm");
const massInput       = document.getElementById("weightInput");
const massError       = document.getElementById("weightError");
const cameraStage     = document.getElementById("cameraStage");
const cameraSetupCard = document.getElementById("cameraSetupCard");
const cameraLiveView  = document.getElementById("cameraLiveView");
const videoEl         = document.getElementById("poseVideo");
const canvasEl        = document.getElementById("poseCanvas");
const jumpPhaseLabel  = document.getElementById("jumpPhaseLabel");
const jumpCountdown   = document.getElementById("jumpCountdown");
const cameraStartBtn  = document.getElementById("cameraStartBtn");
const skipCameraBtn   = document.getElementById("skipCameraBtn");
const skipLiveBtn     = document.getElementById("skipLiveBtn");
const cameraBackBtn   = document.getElementById("cameraBackBtn");
const cameraErrEl     = document.getElementById("cameraPermError");
const panelsEl        = document.getElementById("panels");
const resultsBar      = document.getElementById("resultsBar");
const jumpAgainBtn    = document.getElementById("jumpAgainBtn");
const changeMassBtn   = document.getElementById("changeMassBtn");
const jumpResultInfo  = document.getElementById("jumpResultInfo");
const cameraChip      = document.getElementById("cameraChip");
const cameraChipText  = document.getElementById("cameraChipText");
const settingsModal   = document.getElementById("settingsModal");
const aboutModal      = document.getElementById("aboutModal");
const settingsBtn     = document.getElementById("settingsBtn");
const aboutBtn        = document.getElementById("aboutBtn");
const settingsCloseBtn  = document.getElementById("settingsCloseBtn");
const aboutCloseBtn     = document.getElementById("aboutCloseBtn");
const changeWeightBtn   = document.getElementById("changeWeightBtn");
const exhibitBanner     = document.getElementById("exhibitBanner");
// Scale UI (exhibit mode only)
const scaleDot        = document.getElementById("scaleDot");
const scaleStatus     = document.getElementById("scaleStatus");
const scaleLiveKg     = document.getElementById("scaleLiveKg");
const scaleConnectBtn = document.getElementById("scaleConnectBtn");
const scaleTareBtn    = document.getElementById("scaleTareBtn");
const scaleResetBtn   = document.getElementById("scaleResetBtn");
const modalModes      = document.getElementById("modalModes");
const modeScaleBtn    = document.getElementById("modeScaleBtn");

// ── Validation ────────────────────────────────────────────────────────────────
function validateMass(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= MASS_MIN && n <= MASS_MAX;
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
  const pct  = Math.min((heightM / meterMax) * 100, 100);
  const fill  = panel.querySelector("[data-jump-fill]");
  const cap   = panel.querySelector("[data-jump-cap]");
  const disp  = panel.querySelector("[data-jump-display]");
  if (fill) fill.style.height = `${pct}%`;
  if (cap)  cap.style.bottom  = `${pct}%`;
  if (disp) disp.textContent  = formatMeters(heightM);
}

/**
 * Compute and apply the CSS hop variables for each panel.
 * px scale: Earth 0.5 m ≈ 15 px, capped at 240 px so Pluto stays in frame.
 * Duration is physics-derived: t = 2 × √(2h / g), capped at 6 s.
 */
function setHopCSS(panel, body, worldJumpM, g) {
  const BASE_PX = 15;
  const BASE_M  = 0.5;
  const hopPx = Math.min(Math.round((worldJumpM / BASE_M) * BASE_PX), 240);
  const hopDuration = Math.min(2 * Math.sqrt((2 * worldJumpM) / g), 6);
  panel.style.setProperty("--hop-px", `${hopPx}px`);
  panel.style.setProperty("--hop-duration", `${hopDuration.toFixed(2)}s`);
}

/** Update all four panels with a given Earth jump height. */
function applySimulation(massKg, earthJump) {
  const earthForce = weightInNewtons(massKg, GRAVITY.earth);
  const worldJumps = Object.entries(GRAVITY).map(([, g]) => jumpOnWorld(earthJump, g));
  const meterMax   = meterMaxFor(worldJumps);
  const massText   = formatMass(massKg);

  Object.entries(GRAVITY).forEach(([body, g], i) => {
    const panel = document.querySelector(`.panel[data-body="${body}"]`);
    if (!panel) return;

    const worldJumpM = worldJumps[i];

    panel.querySelector("[data-mass-display]").textContent   = massText;
    panel.querySelector("[data-weight-display]").textContent = formatNewtons(weightInNewtons(massKg, g));

    const ratio = weightInNewtons(massKg, g) / earthForce;
    panel.querySelector("[data-compare-display]").textContent =
      body === "earth" ? "Reference" : `${Math.round(ratio * 100)}% of Earth`;

    const labels = panel.querySelector("[data-meter-labels]");
    if (labels) buildMeterLabels(labels, meterMax);
    updateJumpMeter(panel, worldJumpM, meterMax);

    const noteEl = panel.querySelector("[data-jump-note]");
    if (noteEl) {
      if (body === "earth") {
        noteEl.textContent = lastJumpM
          ? `Your jump: ${formatMeters(worldJumpM)} m`
          : `Estimated: ${formatMeters(worldJumpM)} m`;
      } else {
        noteEl.textContent = `${(worldJumpM / earthJump).toFixed(1)}× your Earth jump`;
      }
    }

    setHopCSS(panel, body, worldJumpM, g);
  });

  panelsEl.hidden = false;
  exhibitBanner.hidden = true;
}

// ── Jump animation trigger (fires every time a jump is detected) ──────────────
const allAstronauts = () => document.querySelectorAll(".panel[data-body] .astronaut");
const allShadows    = () => document.querySelectorAll(".panel[data-body] .shadow");

function triggerJumpAnimation() {
  allAstronauts().forEach((el) => {
    el.classList.remove("is-hopping");
    void el.offsetWidth; // force reflow to restart animation
    el.classList.add("is-hopping");
  });
  allShadows().forEach((el) => {
    el.classList.remove("is-hopping");
    void el.offsetWidth;
    el.classList.add("is-hopping");
  });
}

// Remove hopping class after animation ends
document.addEventListener("animationend", (e) => {
  if (e.target.classList.contains("is-hopping")) {
    e.target.classList.remove("is-hopping");
  }
});

// ── Camera chip status (shown during RESULTS + live camera) ──────────────────
function setChipText(text, active = false) {
  if (!cameraChip) return;
  cameraChip.hidden = false;
  if (cameraChipText) cameraChipText.textContent = text;
  cameraChip.classList.toggle("camera-chip--active", active);
}

// ── Flow transitions ──────────────────────────────────────────────────────────
function goToMass() {
  flow = FLOW.MASS;
  cameraStage.hidden = true;
  panelsEl.hidden    = true;
  resultsBar.hidden  = true;
  if (cameraChip) cameraChip.hidden = true;
  stopCamera();
  massModal.showModal();
  requestAnimationFrame(() => { massInput.focus(); massInput.select(); });
}

function goToSetup() {
  flow = FLOW.SETUP;
  massModal.close();
  cameraStage.hidden    = false;
  cameraSetupCard.hidden = false;
  cameraLiveView.hidden = true;
  if (cameraErrEl) cameraErrEl.hidden = true;
}

async function goToLive() {
  flow = FLOW.LIVE;
  cameraSetupCard.hidden = true;
  cameraLiveView.hidden  = false;
  jumpPhaseLabel.textContent = "Starting camera…";
  jumpCountdown.hidden = true;

  try {
    await Camera.start(videoEl);
    await PoseDetector.init();
    startTracking();
  } catch (err) {
    const denied = err.name === "NotAllowedError" || err.name === "PermissionDeniedError";
    if (cameraErrEl) {
      cameraErrEl.textContent = denied
        ? "Camera access denied. Allow camera access in your browser and try again."
        : `Could not start camera: ${err.message}`;
      cameraErrEl.hidden = false;
    }
    cameraSetupCard.hidden = false;
    cameraLiveView.hidden  = true;
    flow = FLOW.SETUP;
  }
}

/** Jump tracking started once camera is live. */
function startTracking() {
  JumpTracker.onStateChange = (state) => {
    if (flow === FLOW.LIVE) {
      // Show calibration UI in the full-screen view
      const text = {
        [JT_STATE.BASELINE]: "Stand still…",
        [JT_STATE.READY]:    "JUMP!",
        [JT_STATE.JUMPING]:  "In the air!",
        [JT_STATE.DONE]:     "Got it!",
      }[state] ?? "";
      jumpPhaseLabel.textContent = text;
      jumpPhaseLabel.classList.toggle("camera-phase--ready", state === JT_STATE.READY);

      if (state === JT_STATE.BASELINE) {
        jumpCountdown.hidden = false;
        jumpCountdown.textContent = "Getting baseline…";
      } else if (state === JT_STATE.READY) {
        jumpCountdown.hidden = false;
        jumpCountdown.textContent = "Jump when ready!";
      } else {
        jumpCountdown.hidden = true;
      }

      // When baseline is set, transition to results so panels are visible
      if (state === JT_STATE.READY && flow === FLOW.LIVE) {
        goToResults();
      }
    } else if (flow === FLOW.RESULTS) {
      // Update the small chip in the results bar
      const chipText = {
        [JT_STATE.READY]:   "Jump!",
        [JT_STATE.JUMPING]: "In the air!",
        [JT_STATE.DONE]:    "Got it!",
        [JT_STATE.BASELINE]: "Calibrating…",
      }[state];
      if (chipText) setChipText(chipText, state === JT_STATE.JUMPING || state === JT_STATE.DONE);
    }
  };

  JumpTracker.onJumpCaptured = (jumpM) => {
    lastJumpM = jumpM;

    // Update CSS hop heights for all panels (triggers proportional animation)
    Object.entries(GRAVITY).forEach(([body, g]) => {
      const panel = document.querySelector(`.panel[data-body="${body}"]`);
      if (!panel) return;
      const worldJump = jumpOnWorld(jumpM, g);
      setHopCSS(panel, body, worldJump, g);

      // Update jump display values
      const noteEl = panel.querySelector("[data-jump-note]");
      if (noteEl) {
        noteEl.textContent = body === "earth"
          ? `Your jump: ${formatMeters(jumpM)} m`
          : `${(worldJump / jumpM).toFixed(1)}× your Earth jump`;
      }
      // Update meter fill
      const worldJumps = Object.values(GRAVITY).map((gv) => jumpOnWorld(jumpM, gv));
      const meterMax   = meterMaxFor(worldJumps);
      updateJumpMeter(panel, worldJump, meterMax);
      const labels = panel.querySelector("[data-meter-labels]");
      if (labels) buildMeterLabels(labels, meterMax);
    });

    // Fire the animated hops
    triggerJumpAnimation();

    // Update results bar info
    if (jumpResultInfo) jumpResultInfo.textContent = `Last jump: ${formatMeters(jumpM)} m on Earth`;
  };

  JumpTracker.start(170); // height defaults to 170 cm
  renderLoop();
}

function renderLoop() {
  const landmarks = PoseDetector.detect(videoEl);
  // Only draw skeleton while still in the LIVE calibration screen
  if (flow === FLOW.LIVE) {
    PoseDetector.drawSkeleton(canvasEl, videoEl, landmarks);
  }
  JumpTracker.update(landmarks);
  animFrameId = requestAnimationFrame(renderLoop);
}

function goToResults() {
  flow = FLOW.RESULTS;
  cameraStage.hidden = true;   // hide full-screen view; render loop continues
  massModal.close();

  const earthJump = lastJumpM ?? estimatedEarthJump(currentMassKg);
  applySimulation(currentMassKg, earthJump);

  resultsBar.hidden = false;
  if (jumpResultInfo) {
    jumpResultInfo.textContent = lastJumpM
      ? `Last jump: ${formatMeters(lastJumpM)} m on Earth`
      : `Estimated for ${formatMass(currentMassKg)} kg — jump to measure!`;
  }

  // Show live camera chip only when camera is actually running
  if (Camera.stream) setChipText("Jump!", false);
}

function skipCamera() {
  lastJumpM = null;
  stopCamera();
  goToResults();
}

function stopCamera() {
  cancelAnimationFrame(animFrameId);
  animFrameId = null;
  Camera.stop();
  JumpTracker.reset();
  if (cameraChip) cameraChip.hidden = true;
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
  massError.hidden  = true;
  currentMassKg     = Number(massInput.value);
  goToSetup();
});

massInput.addEventListener("input", () => {
  if (!massError.hidden && validateMass(massInput.value)) massError.hidden = true;
});

massModal.addEventListener("cancel", (e) => {
  if (panelsEl.hidden) e.preventDefault();
});

cameraStartBtn?.addEventListener("click", () => goToLive());
skipCameraBtn?.addEventListener("click",  () => skipCamera());
skipLiveBtn?.addEventListener("click",    () => skipCamera());
cameraBackBtn?.addEventListener("click",  () => { stopCamera(); goToMass(); });

jumpAgainBtn?.addEventListener("click", () => {
  // Re-run baseline so camera is active again in a corner-chip style
  if (!Camera.stream) {
    // Camera was stopped — go back to setup
    panelsEl.hidden   = true;
    resultsBar.hidden = true;
    cameraStage.hidden     = false;
    cameraSetupCard.hidden = false;
    cameraLiveView.hidden  = true;
    if (cameraErrEl) cameraErrEl.hidden = true;
    flow = FLOW.SETUP;
  } else {
    // Camera already running — just restart baseline
    JumpTracker.start(170);
    setChipText("Stand still…", false);
  }
});

changeMassBtn?.addEventListener("click",  () => { stopCamera(); goToMass(); });
changeWeightBtn?.addEventListener("click", () => { settingsModal.close(); stopCamera(); goToMass(); });

settingsBtn?.addEventListener("click",     () => settingsModal.showModal());
aboutBtn?.addEventListener("click",        () => aboutModal.showModal());
settingsCloseBtn?.addEventListener("click",() => settingsModal.close());
aboutCloseBtn?.addEventListener("click",   () => aboutModal.close());

// ── Scale exhibit mode ────────────────────────────────────────────────────────
async function initScaleMode() {
  const { ScaleClient } = await import("../scale.js");
  if (modeScaleBtn)  { modeScaleBtn.disabled = false; modeScaleBtn.removeAttribute("aria-disabled"); }
  if (modalModes)    modalModes.hidden = false;

  ScaleClient.on("status", (msg) => {
    if (!scaleDot) return;
    scaleDot.dataset.state = { live: "live", connecting: "connecting", error: "error" }[msg.state] ?? "offline";
    if (scaleStatus) {
      scaleStatus.textContent = { live: "Scale connected", connecting: "Connecting…", error: "Connection error",
        offline: "Scale offline", disconnected: "Scale disconnected — retrying…" }[msg.state] ?? msg.state;
    }
    if (scaleTareBtn)  scaleTareBtn.hidden  = msg.state !== "live";
    if (scaleResetBtn) scaleResetBtn.hidden = msg.state !== "live";
    if (msg.state === "live" && exhibitBanner) exhibitBanner.hidden = false;
  });

  ScaleClient.on("weight", (msg) => {
    if (msg.kg != null && scaleLiveKg) {
      scaleLiveKg.textContent = `${Number.isFinite(msg.kg) ? msg.kg.toFixed(1) : "—"} kg`;
    }
  });

  ScaleClient.on("capture", (msg) => {
    if (!validateMass(msg.massKg)) return;
    currentMassKg = msg.massKg;
    lastJumpM = null;
    goToResults();
    ScaleClient.reset();
  });

  scaleConnectBtn?.addEventListener("click", () => {
    const url = params.get("scale") || localStorage.getItem("scaleUrl") || "ws://192.168.4.1:81/";
    ScaleClient.connect(url);
  });
  scaleTareBtn?.addEventListener("click",  () => ScaleClient.tare());
  scaleResetBtn?.addEventListener("click", () => ScaleClient.reset());

  ScaleClient.connect(params.get("scale") || "ws://192.168.4.1:81/");
}

// ── Boot ──────────────────────────────────────────────────────────────────────
if (SCALE_UI_ENABLED) initScaleMode();
goToMass();
