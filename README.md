# Open Gravity

Jump in front of your camera and see how high you'd go on **Earth, Moon, Mars, and Pluto** — all four worlds update in real time from your actual jump height. No mass or height input required.

**Repository:** [github.com/basheerbk/Open-Gravity](https://github.com/basheerbk/Open-Gravity)  
**Live demo:** [open-gravity-one.vercel.app](https://open-gravity-one.vercel.app)

## How it works

1. **Enable camera** — a small picture-in-picture view appears in the corner
2. **Stand on the mark** (exhibit) or **stand in frame** (web/mobile)
3. **Hold still** ~1.2 s while the app calibrates ankle baseline
4. **Jump** — MediaPipe Pose tracks ankle rise; meters fill live during the jump
5. **Results** — all four astronauts hop with gravity-scaled heights

Jump height is measured from **ankle rise** in the camera image, converted to metres via install calibration (`mPerUnit`).

## Exhibit / kiosk setup

For a fixed camera and floor mark:

1. Tape a "stand here" spot on the floor aligned with the PiP ellipse
2. Tune zone position: `?zoneX=0.5&zoneY=0.78&zoneW=0.2&zoneH=0.1`
3. Calibrate scale once: jump a known height, adjust `?mPerUnit=2.8` until Earth reads correctly
4. Kiosk mode: `?autocam=1` auto-starts the camera

The calibrated `mPerUnit` value is saved in `localStorage` (`og_mPerUnit`).

## Web / mobile (no floor mark)

Append `?zone=off` — the app uses frame-centre detection instead of the stand ellipse. Stand with feet visible in the lower half of the frame.

## URL parameters

| Param | Default | Description |
|-------|---------|-------------|
| `autocam=1` | off | Auto-start camera on load |
| `zone=off` | off | Web mode without floor mark |
| `mPerUnit` | 2.8 | Metres per normalised ankle-rise at fixed spot |
| `zoneX`, `zoneY` | 0.5, 0.78 | Stand ellipse centre (normalised 0–1) |
| `zoneW`, `zoneH` | 0.2, 0.1 | Stand ellipse size (normalised) |
| `scale=auto` | off | Enable ESP32 load-cell integration (optional) |

## Run locally

```bash
npx serve . -l 3000
```

Open `http://localhost:3000`. Camera access requires HTTPS on non-localhost origins (Vercel handles this automatically).

## Camera requirements

- Modern browser (Chrome, Edge, Safari 16+, Firefox)
- Webcam or phone camera with `getUserMedia` support
- Good lighting; full body visible in frame

## Physics

On a world with surface gravity `g`, jump height scales as:

```
h_world = h_earth × (9.81 / g_world)
```

| World | g (m/s²) | vs Earth |
|-------|----------|----------|
| Earth | 9.81 | 1× (baseline) |
| Mars  | 3.71 | 2.6× higher |
| Moon  | 1.62 | 6.1× higher |
| Pluto | 0.62 | 15.8× higher |

## Architecture

```
js/
  app.js          — panels UI, PiP camera, live meter updates
  physics.js      — gravity constants, jump scaling formulas
  camera.js       — getUserMedia wrapper
  poseDetector.js — MediaPipe Pose Landmarker (CDN WASM), skeleton overlay
  jumpTracker.js  — baseline + peak ankle detection state machine
  standZone.js    — exhibit stand-here ellipse + mPerUnit calibration
index.html        — 4-world panels + camera PiP
styles.css        — panel animations, live meter glow, responsive layout
scale.js          — WebSocket client (ESP32 exhibit mode, optional)
firmware/         — ESP32 + HX711 sketch (optional hardware)
```

All pose detection runs **in the browser** — no server-side video processing. MediaPipe loads from CDN; deploy as static files (e.g. Vercel).

## Optional: ESP32 scale mode

Append `?scale=auto` to connect to an ESP32 load-cell scale at `ws://192.168.4.1:81/`. See [`firmware/gravity_scale/gravity_scale.ino`](firmware/gravity_scale/gravity_scale.ino) for wiring and flash instructions.
