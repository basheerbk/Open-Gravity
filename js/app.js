import {
  GRAVITY,
  DEFAULT_EARTH_JUMP,
  jumpOnWorld,
  jumpMultiplier,
  meterMaxFor,
  formatMeters,
} from "./physics.js";

import { Camera }       from "./camera.js";
import { PoseDetector } from "./poseDetector.js";
import { JumpTracker, JT_STATE } from "./jumpTracker.js";

// ── Flow states ───────────────────────────────────────────────────────────────
const FLOW = {
  SETUP:   "setup",   // camera tips + permission
  LIVE:    "live",    // baseline calibration (full-screen)
  RESULTS: "results", // panels visible; camera keeps running in background
};

let flow      = FLOW.SETUP;
let lastJumpM = null;   // most recently measured Earth jump
let animFrameId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
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
const cameraErrEl     = document.getElementById("cameraPermError");
const panelsEl        = document.getElementById("panels");
const resultsBar      = document.getElementById("resultsBar");
const jumpResultInfo  = document.getElementById("jumpResultInfo");
const cameraChip      = document.getElementById("cameraChip");
const cameraChipText  = document.getElementById("cameraChipText");
const retryBtn        = document.getElementById("jumpAgainBtn");
const aboutModal      = document.getElementById("aboutModal");
const aboutBtn        = document.getElementById("aboutBtn");
const aboutCloseBtn   = document.getElementById("aboutCloseBtn");
const exhibitBanner    = document.getElementById("exhibitBanner");

// ── Panel rendering ───────────────────────────────────────────────────────────
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
  const fill = panel.querySelector("[data-jump-fill]");
  const cap  = panel.querySelector("[data-jump-cap]");
  const disp = panel.querySelector("[data-jump-display]");
  if (fill) fill.style.height = `${pct}%`;
  if (cap)  cap.style.bottom  = `${pct}%`;
  if (disp) disp.textContent  = formatMeters(heightM);
}

/**
 * Set CSS hop variables for one panel from the world's computed jump height.
 * px scale: 0.5 m Earth ≈ 15 px; capped at 240 px so Pluto stays in frame.
 * Duration: t = 2 × √(2h / g), capped at 6 s.
 */
function setHopCSS(panel, worldJumpM, g) {
  const hopPx      = Math.min(Math.round((worldJumpM / 0.5) * 15), 240);
  const hopDur     = Math.min(2 * Math.sqrt((2 * worldJumpM) / g), 6);
  panel.style.setProperty("--hop-px",       `${hopPx}px`);
  panel.style.setProperty("--hop-duration", `${hopDur.toFixed(2)}s`);
}

/** Render all four panels from a given Earth jump height. */
function applySimulation(earthJump) {
  const worldJumps = Object.entries(GRAVITY).map(([, g]) => jumpOnWorld(earthJump, g));
  const meterMax   = meterMaxFor(worldJumps);

  Object.entries(GRAVITY).forEach(([body, g], i) => {
    const panel = document.querySelector(`.panel[data-body="${body}"]`);
    if (!panel) return;

    const worldJumpM = worldJumps[i];

    // Jump meter
    const labels = panel.querySelector("[data-meter-labels]");
    if (labels) buildMeterLabels(labels, meterMax);
    updateJumpMeter(panel, worldJumpM, meterMax);

    // Stat: gravity
    const gravDisp = panel.querySelector("[data-gravity-display]");
    if (gravDisp) gravDisp.textContent = g.toFixed(2);

    // Stat: multiplier vs Earth
    const multDisp = panel.querySelector("[data-mult-display]");
    if (multDisp) {
      if (body === "earth") {
        multDisp.textContent = "Reference";
      } else {
        multDisp.textContent = `${jumpMultiplier(g).toFixed(1)}× your Earth jump`;
      }
    }

    // Jump note below meter
    const noteEl = panel.querySelector("[data-jump-note]");
    if (noteEl) {
      if (body === "earth") {
        noteEl.textContent = lastJumpM
          ? `Measured: ${formatMeters(earthJump)} m`
          : "Jump to measure!";
      } else {
        noteEl.textContent = `${formatMeters(worldJumpM)} m here`;
      }
    }

    setHopCSS(panel, worldJumpM, g);
  });

  panelsEl.hidden     = false;
  exhibitBanner.hidden = true;
}

// ── Jump animation trigger ────────────────────────────────────────────────────
function triggerJumpAnimation() {
  document.querySelectorAll(".panel[data-body] .astronaut, .panel[data-body] .shadow")
    .forEach((el) => {
      el.classList.remove("is-hopping");
      void el.offsetWidth; // force reflow
      el.classList.add("is-hopping");
    });
}

document.addEventListener("animationend", (e) => {
  if (e.target.classList.contains("is-hopping")) e.target.classList.remove("is-hopping");
});

// ── Camera chip ───────────────────────────────────────────────────────────────
function setChip(text, active = false) {
  if (!cameraChip) return;
  cameraChip.hidden = false;
  if (cameraChipText) cameraChipText.textContent = text;
  cameraChip.classList.toggle("camera-chip--active", active);
}

// ── Flow ──────────────────────────────────────────────────────────────────────
function showSetup() {
  flow = FLOW.SETUP;
  cameraStage.hidden     = false;
  cameraSetupCard.hidden = false;
  cameraLiveView.hidden  = true;
  panelsEl.hidden        = true;
  resultsBar.hidden      = true;
  if (cameraChip) cameraChip.hidden = true;
  if (cameraErrEl) cameraErrEl.hidden = true;
  stopCamera();
}

async function startLive() {
  flow = FLOW.LIVE;
  cameraSetupCard.hidden = true;
  cameraLiveView.hidden  = false;
  jumpPhaseLabel.textContent = "Starting camera…";
  jumpCountdown.hidden = true;

  try {
    await Camera.start(videoEl);
    await PoseDetector.init();
    beginTracking();
  } catch (err) {
    const denied = err.name === "NotAllowedError" || err.name === "PermissionDeniedError";
    if (cameraErrEl) {
      cameraErrEl.textContent = denied
        ? "Camera access denied. Please allow camera access in your browser settings."
        : `Could not start camera: ${err.message}`;
      cameraErrEl.hidden = false;
    }
    cameraSetupCard.hidden = false;
    cameraLiveView.hidden  = true;
    flow = FLOW.SETUP;
  }
}

function skipToResults() {
  lastJumpM = null;
  stopCamera();
  showResults();
}

function showResults() {
  flow = FLOW.RESULTS;
  cameraStage.hidden = true;

  const earthJump = lastJumpM ?? DEFAULT_EARTH_JUMP;
  applySimulation(earthJump);

  resultsBar.hidden = false;
  if (jumpResultInfo) {
    jumpResultInfo.textContent = lastJumpM
      ? `Last jump: ${formatMeters(lastJumpM)} m`
      : "Estimated — jump to measure!";
  }

  if (Camera.stream) setChip("Jump!", false);
}

// ── Jump tracking ─────────────────────────────────────────────────────────────
function beginTracking() {
  JumpTracker.onStateChange = (state) => {
    if (flow === FLOW.LIVE) {
      const label = {
        [JT_STATE.BASELINE]: "Stand still…",
        [JT_STATE.READY]:    "JUMP!",
        [JT_STATE.JUMPING]:  "In the air!",
        [JT_STATE.DONE]:     "Got it!",
      }[state] ?? "";

      jumpPhaseLabel.textContent = label;
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

      // Once baseline locked → show panels; camera keeps running
      if (state === JT_STATE.READY) showResults();

    } else if (flow === FLOW.RESULTS) {
      const chip = {
        [JT_STATE.READY]:   "Jump!",
        [JT_STATE.JUMPING]: "In the air!",
        [JT_STATE.DONE]:    "Got it!",
        [JT_STATE.BASELINE]: "Calibrating…",
      }[state];
      if (chip) setChip(chip, state === JT_STATE.JUMPING || state === JT_STATE.DONE);
    }
  };

  JumpTracker.onJumpCaptured = (jumpM) => {
    lastJumpM = jumpM;

    // Update hop heights and meters across all panels
    const worldJumps = Object.entries(GRAVITY).map(([, g]) => jumpOnWorld(jumpM, g));
    const meterMax   = meterMaxFor(worldJumps);

    Object.entries(GRAVITY).forEach(([body, g], i) => {
      const panel = document.querySelector(`.panel[data-body="${body}"]`);
      if (!panel) return;

      const worldJumpM = worldJumps[i];
      const labels = panel.querySelector("[data-meter-labels]");
      if (labels) buildMeterLabels(labels, meterMax);
      updateJumpMeter(panel, worldJumpM, meterMax);
      setHopCSS(panel, worldJumpM, g);

      const noteEl = panel.querySelector("[data-jump-note]");
      if (noteEl) {
        noteEl.textContent = body === "earth"
          ? `Measured: ${formatMeters(jumpM)} m`
          : `${formatMeters(worldJumpM)} m here`;
      }
    });

    triggerJumpAnimation();

    if (jumpResultInfo) jumpResultInfo.textContent = `Last jump: ${formatMeters(jumpM)} m`;
  };

  JumpTracker.start(170);
  renderLoop();
}

function renderLoop() {
  const landmarks = PoseDetector.detect(videoEl);
  if (flow === FLOW.LIVE) PoseDetector.drawSkeleton(canvasEl, videoEl, landmarks);
  JumpTracker.update(landmarks);
  animFrameId = requestAnimationFrame(renderLoop);
}

function stopCamera() {
  cancelAnimationFrame(animFrameId);
  animFrameId = null;
  Camera.stop();
  JumpTracker.reset();
  if (cameraChip) cameraChip.hidden = true;
}

// ── Event listeners ───────────────────────────────────────────────────────────
cameraStartBtn?.addEventListener("click", () => startLive());
skipCameraBtn?.addEventListener("click",  () => skipToResults());
skipLiveBtn?.addEventListener("click",    () => skipToResults());

retryBtn?.addEventListener("click", () => {
  if (!Camera.stream) {
    showSetup();
  } else {
    JumpTracker.start(170);
    setChip("Stand still…", false);
  }
});

aboutBtn?.addEventListener("click",      () => aboutModal.showModal());
aboutCloseBtn?.addEventListener("click", () => aboutModal.close());

// ── Boot ──────────────────────────────────────────────────────────────────────
showSetup();
