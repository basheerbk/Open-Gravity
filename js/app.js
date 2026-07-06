import {
  GRAVITY,
  DEFAULT_EARTH_JUMP,
  jumpOnWorld,
  jumpMultiplier,
  meterMaxFor,
  formatMeters,
} from "./physics.js";

import { Camera } from "./camera.js";
import { PoseDetector } from "./poseDetector.js";
import { JumpTracker, JT_STATE } from "./jumpTracker.js";

const params = new URLSearchParams(location.search);
const AUTO_CAMERA = params.get("autocam") === "1";

let lastJumpM = null;
let animFrameId = null;
let cameraActive = false;
let liveMeterMax = null;
let lastLiveUpdate = 0;
const LIVE_THROTTLE_MS = 1000 / 15;

const videoEl        = document.getElementById("poseVideo");
const canvasEl       = document.getElementById("poseCanvas");
const jumpPhaseLabel = document.getElementById("jumpPhaseLabel");
const cameraStartBtn = document.getElementById("cameraStartBtn");
const cameraOverlay  = document.getElementById("cameraOverlay");
const cameraErrEl    = document.getElementById("cameraPermError");
const retryBtn       = document.getElementById("jumpAgainBtn");
const aboutModal     = document.getElementById("aboutModal");
const aboutBtn       = document.getElementById("aboutBtn");
const aboutCloseBtn  = document.getElementById("aboutCloseBtn");
const exhibitBanner  = document.getElementById("exhibitBanner");

const PHASE_LABELS = {
  [JT_STATE.AWAITING]:  "Step in view",
  [JT_STATE.BASELINE]:  "Hold still…",
  [JT_STATE.READY]:     "JUMP!",
  [JT_STATE.JUMPING]:   "Up!",
  [JT_STATE.DONE]:      "Nice!",
};

function buildMeterLabels(container, meterMax) {
  container.innerHTML = "";
  [meterMax, 0].forEach((m) => {
    const span = document.createElement("span");
    span.textContent = m === 0 ? "0" : formatMeters(m);
    container.appendChild(span);
  });
}

function updateJumpMeter(panel, heightM, meterMax, live = false) {
  const pct  = Math.min((heightM / meterMax) * 100, 100);
  const fill = panel.querySelector("[data-jump-fill]");
  const cap  = panel.querySelector("[data-jump-cap]");
  const disp = panel.querySelector("[data-jump-display]");
  if (fill) {
    fill.style.transition = live ? "height 0.08s linear" : "";
    fill.style.height = `${pct}%`;
  }
  if (cap)  cap.style.bottom  = `${pct}%`;
  if (disp) disp.textContent  = formatMeters(heightM);
}

function setHopCSS(panel, worldJumpM, g) {
  const hopPx  = Math.min(Math.round((worldJumpM / 0.5) * 15), 240);
  const hopDur = Math.min(2 * Math.sqrt((2 * worldJumpM) / g), 6);
  panel.style.setProperty("--hop-px", `${hopPx}px`);
  panel.style.setProperty("--hop-duration", `${hopDur.toFixed(2)}s`);
}

function setPanelsLive(live) {
  document.querySelectorAll(".panel[data-body]").forEach((panel) => {
    panel.classList.toggle("panel--live", live);
  });
}

function updateLivePanels(earthJumpM) {
  const worldJumps = Object.entries(GRAVITY).map(([, g]) => jumpOnWorld(earthJumpM, g));
  const meterMax   = meterMaxFor(worldJumps);
  liveMeterMax = meterMax;

  Object.entries(GRAVITY).forEach(([body, g], i) => {
    const panel = document.querySelector(`.panel[data-body="${body}"]`);
    if (!panel) return;

    const worldJumpM = worldJumps[i];
    const labels = panel.querySelector("[data-meter-labels]");
    if (labels) buildMeterLabels(labels, meterMax);
    updateJumpMeter(panel, worldJumpM, meterMax, true);
    setHopCSS(panel, worldJumpM, g);

    const noteEl = panel.querySelector("[data-jump-note]");
    if (noteEl) {
      noteEl.textContent = body === "earth"
        ? `${formatMeters(earthJumpM)} m`
        : `${formatMeters(worldJumpM)} m (${(worldJumpM / earthJumpM).toFixed(1)}×)`;
    }
  });
}

function applySimulation(earthJump) {
  const worldJumps = Object.entries(GRAVITY).map(([, g]) => jumpOnWorld(earthJump, g));
  const meterMax   = meterMaxFor(worldJumps);
  liveMeterMax = meterMax;

  Object.entries(GRAVITY).forEach(([body, g], i) => {
    const panel = document.querySelector(`.panel[data-body="${body}"]`);
    if (!panel) return;

    const worldJumpM = worldJumps[i];
    const labels = panel.querySelector("[data-meter-labels]");
    if (labels) buildMeterLabels(labels, meterMax);
    updateJumpMeter(panel, worldJumpM, meterMax);

    const multDisp = panel.querySelector("[data-mult-display]");
    if (multDisp) {
      multDisp.textContent = body === "earth"
        ? "Your jump"
        : `${jumpMultiplier(g).toFixed(1)}× higher`;
    }

    const noteEl = panel.querySelector("[data-jump-note]");
    if (noteEl) {
      if (body === "earth") {
        noteEl.textContent = lastJumpM
          ? `${formatMeters(earthJump)} m`
          : "Face camera & jump";
      } else {
        const times = (worldJumpM / earthJump).toFixed(1);
        noteEl.textContent = `${formatMeters(worldJumpM)} m (${times}×)`;
      }
    }

    setHopCSS(panel, worldJumpM, g);
  });

  if (exhibitBanner) exhibitBanner.hidden = true;
}

function triggerJumpAnimation() {
  document.querySelectorAll(".panel[data-body] .astronaut, .panel[data-body] .shadow")
    .forEach((el) => {
      el.classList.remove("is-hopping");
      void el.offsetWidth;
      el.classList.add("is-hopping");
    });
}

document.addEventListener("animationend", (e) => {
  if (e.target.classList.contains("is-hopping")) e.target.classList.remove("is-hopping");
});

function setPhase(text, ready = false) {
  if (jumpPhaseLabel) {
    jumpPhaseLabel.textContent = text;
    jumpPhaseLabel.classList.toggle("camera-pip__phase--ready", ready);
    jumpPhaseLabel.classList.toggle("camera-pip__phase--jumping", text === "Up!");
  }
}

async function startCamera() {
  if (cameraErrEl) cameraErrEl.hidden = true;
  setPhase("Starting…");
  if (cameraOverlay) cameraOverlay.classList.add("camera-pip__overlay--off");

  try {
    await Camera.start(videoEl);
    await PoseDetector.init();
    cameraActive = true;
    if (retryBtn) retryBtn.hidden = false;
    beginTracking();
  } catch (err) {
    cameraActive = false;
    if (cameraOverlay) cameraOverlay.classList.remove("camera-pip__overlay--off");
    setPhase("Camera off");
    if (cameraErrEl) {
      cameraErrEl.textContent = err.name === "NotAllowedError"
        ? "Allow camera access to play"
        : err.message;
      cameraErrEl.hidden = false;
    }
  }
}

function beginTracking() {
  JumpTracker.onStateChange = (state) => {
    const label = PHASE_LABELS[state];
    if (label) setPhase(label, state === JT_STATE.READY);

    if (state === JT_STATE.AWAITING) {
      setPanelsLive(false);
    } else if (state === JT_STATE.JUMPING) {
      setPanelsLive(true);
    } else if (state === JT_STATE.DONE) {
      setPanelsLive(false);
    }
  };

  JumpTracker.onLiveUpdate = (metrics) => {
    const now = performance.now();
    if (metrics.state !== JT_STATE.JUMPING) return;
    if (now - lastLiveUpdate < LIVE_THROTTLE_MS) return;
    lastLiveUpdate = now;

    if (metrics.liveJumpM >= 0.02) {
      updateLivePanels(metrics.liveJumpM);
    }
  };

  JumpTracker.onJumpCaptured = (jumpM) => {
    lastJumpM = jumpM;
    setPanelsLive(false);

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
          ? `${formatMeters(jumpM)} m`
          : `${formatMeters(worldJumpM)} m (${(worldJumpM / jumpM).toFixed(1)}×)`;
      }
    });

    triggerJumpAnimation();
  };

  JumpTracker.start();
  if (!animFrameId) renderLoop();
}

function renderLoop() {
  if (cameraActive && PoseDetector.landmarker) {
    const landmarks = PoseDetector.detect(videoEl);
    JumpTracker.update(landmarks);
    const metrics = JumpTracker.getLiveMetrics();
    PoseDetector.drawFrame(canvasEl, videoEl, landmarks, {
      state: metrics.state,
      baselineProgress: metrics.baselineProgress,
      liveJumpM: metrics.liveJumpM,
    });
  }
  animFrameId = requestAnimationFrame(renderLoop);
}

cameraStartBtn?.addEventListener("click", () => startCamera());

retryBtn?.addEventListener("click", () => {
  if (cameraActive) {
    JumpTracker.start();
    setPhase("Step in view");
  }
});

aboutBtn?.addEventListener("click", () => aboutModal.showModal());
aboutCloseBtn?.addEventListener("click", () => aboutModal.close());

applySimulation(DEFAULT_EARTH_JUMP);
renderLoop();

if (AUTO_CAMERA) startCamera();
