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
import { Sync } from "./sync.js";

const params = new URLSearchParams(location.search);
const AUTO_CAMERA = params.get("autocam") === "1";

const roleParam = (params.get("role") || "solo").toLowerCase();
const ROLE = roleParam === "display" || roleParam === "camera" ? roleParam : "solo";
const IS_DISPLAY = ROLE === "display";
const IS_CAMERA = ROLE === "camera";
const DRIVE_PANELS = !IS_CAMERA; // solo + display update panels locally
const RUN_CAMERA = !IS_DISPLAY;  // solo + camera run pose tracking

document.body.classList.add(`role-${ROLE}`);
if (IS_DISPLAY) document.title = "Open Gravity — Display";
if (IS_CAMERA) document.title = "Open Gravity — Camera";

let lastJumpM = null;
let animFrameId = null;
let cameraActive = false;
let liveMeterMax = null;
let lastLiveUpdate = 0;
let displayConnected = false;
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
const syncStatusEl   = document.getElementById("syncStatus");
const displayPhaseEl = document.getElementById("displayPhase");
const openDisplayBtn = document.getElementById("openDisplayBtn");
const openCameraBtn  = document.getElementById("openCameraBtn");

const PHASE_LABELS = {
  [JT_STATE.AWAITING]:  "Stand in box",
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
  // Exaggerate hop so even small jumps read clearly on screen
  const hopPx = Math.min(
    Math.max(28, Math.round((worldJumpM / 0.5) * 36)),
    280,
  );
  const hopDur = Math.min(2 * Math.sqrt((2 * worldJumpM) / g), 6);
  panel.style.setProperty("--hop-px", `${hopPx}px`);
  panel.style.setProperty("--hop-duration", `${hopDur.toFixed(2)}s`);
}

function setPanelsLive(live) {
  if (!DRIVE_PANELS) return;
  document.querySelectorAll(".panel[data-body]").forEach((panel) => {
    panel.classList.toggle("panel--live", live);
  });
}

function updateLivePanels(earthJumpM) {
  if (!DRIVE_PANELS) return;
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

function applyFinalJump(jumpM) {
  if (!DRIVE_PANELS) return;
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
}

function applySimulation(earthJump) {
  if (!DRIVE_PANELS) return;
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
          : IS_DISPLAY ? "Waiting for camera…" : "Face camera & jump";
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
  if (!DRIVE_PANELS) return;
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
  if (displayPhaseEl && IS_DISPLAY) {
    displayPhaseEl.textContent = text;
    displayPhaseEl.classList.toggle("display-phase--ready", ready);
    displayPhaseEl.classList.toggle("display-phase--jumping", text === "Up!");
  }
}

function setSyncStatus(text, connected = false) {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = text;
  syncStatusEl.classList.toggle("sync-status--ok", connected);
}

function roleUrl(role, extra = {}) {
  const u = new URL(location.href);
  u.searchParams.set("role", role);
  if (role === "camera") u.searchParams.set("autocam", "1");
  else u.searchParams.delete("autocam");
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

/* —— Sync handlers —— */
function onSyncMessage(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === "hello") {
    if (IS_CAMERA && msg.role === "display") {
      displayConnected = true;
      setSyncStatus("Display connected", true);
      Sync.sendHello();
    }
    if (IS_DISPLAY && msg.role === "camera") {
      setSyncStatus("Camera connected", true);
      Sync.sendHello();
    }
    return;
  }

  if (!IS_DISPLAY) return;

  if (msg.type === "phase") {
    const label = PHASE_LABELS[msg.state] || msg.state;
    setPhase(label, msg.state === JT_STATE.READY);
    if (msg.state === JT_STATE.AWAITING || msg.state === JT_STATE.DONE) {
      setPanelsLive(false);
    } else if (msg.state === JT_STATE.JUMPING) {
      setPanelsLive(true);
    }
  } else if (msg.type === "live" && typeof msg.jumpM === "number" && msg.jumpM >= 0.02) {
    updateLivePanels(msg.jumpM);
  } else if (msg.type === "jump" && typeof msg.jumpM === "number") {
    applyFinalJump(msg.jumpM);
  }
}

Sync.init(ROLE, onSyncMessage);

if (IS_CAMERA) setSyncStatus("Waiting for display window…", false);
if (IS_DISPLAY) setSyncStatus("Waiting for camera window…", false);

async function startCamera() {
  if (!RUN_CAMERA) return;
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

    if (IS_CAMERA) Sync.sendPhase(state);

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
      if (IS_CAMERA) Sync.sendLive(metrics.liveJumpM);
      else updateLivePanels(metrics.liveJumpM);
    }
  };

  JumpTracker.onJumpCaptured = (jumpM) => {
    if (IS_CAMERA) {
      Sync.sendJump(jumpM);
      return;
    }
    applyFinalJump(jumpM);
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
    setPhase("Stand in box");
  }
});

aboutBtn?.addEventListener("click", () => aboutModal.showModal());
aboutCloseBtn?.addEventListener("click", () => aboutModal.close());

openDisplayBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  window.open(roleUrl("display"), "og-display");
});

openCameraBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  window.open(roleUrl("camera"), "og-camera");
});

if (DRIVE_PANELS) applySimulation(DEFAULT_EARTH_JUMP);
if (RUN_CAMERA) renderLoop();

if (AUTO_CAMERA && RUN_CAMERA) startCamera();

// Display: periodic hello so late-opened camera can connect
if (IS_DISPLAY || IS_CAMERA) {
  setInterval(() => Sync.sendHello(), 3000);
}
