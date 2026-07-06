# Open Gravity

Jump in front of your camera and see how high you'd go on **Earth, Moon, Mars, and Pluto** — all four worlds update in real time from your actual jump height. No mass or height input required.

**Repository:** [github.com/basheerbk/Open-Gravity](https://github.com/basheerbk/Open-Gravity)  
**Live demo:** [open-gravity-one.vercel.app](https://open-gravity-one.vercel.app)

## How it works

1. **Enable camera** — a small picture-in-picture view appears in the corner
2. **Stand in frame** with your full lower body visible
3. **Hold still** briefly while the app calibrates (stillness detection, ~0.5–1 s)
4. **Jump** — meters fill live during the jump; all four astronauts hop on landing
5. **Results** — gravity-scaled heights on Earth, Moon, Mars, and Pluto

Jump height is measured from **ankle rise**, scaled relative to your leg length in the frame. Optional `?mPerUnit=` overrides for fixed-camera installs.

## URL parameters

| Param | Default | Description |
|-------|---------|-------------|
| `autocam=1` | off | Auto-start camera on load |
| `legM` | 0.88 | Estimated leg length (m) for body-relative scaling |
| `mPerUnit` | — | Fixed-camera override: metres per normalised ankle rise |
| `scale=auto` | off | Enable ESP32 load-cell integration (optional) |

## Run locally

```bash
npx serve . -l 3000
```

Open `http://localhost:3000`. Camera access requires HTTPS on non-localhost origins (Vercel handles this automatically).

## Camera requirements

- Modern browser (Chrome, Edge, Safari 16+, Firefox)
- Webcam or phone camera with `getUserMedia` support
- Good lighting; full lower body visible, centred in frame

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
  jumpTracker.js  — stillness baseline + adaptive jump detection
  standZone.js    — pose readiness + body-relative calibration
index.html        — 4-world panels + camera PiP
styles.css        — panel animations, live meter glow, responsive layout
scale.js          — WebSocket client (ESP32 exhibit mode, optional)
firmware/         — ESP32 + HX711 sketch (optional hardware)
```

All pose detection runs **in the browser** — no server-side video processing. MediaPipe loads from CDN; deploy as static files (e.g. Vercel).

## Optional: ESP32 scale mode

Append `?scale=auto` to connect to an ESP32 load-cell scale at `ws://192.168.4.1:81/`. See [`firmware/gravity_scale/gravity_scale.ino`](firmware/gravity_scale/gravity_scale.ino) for wiring and flash instructions.
