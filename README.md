# Open Gravity

Enter your mass, jump in front of your camera, and see your real jump height scaled across **Earth, Moon, Mars, and Pluto**.

**Repository:** [github.com/basheerbk/Open-Gravity](https://github.com/basheerbk/Open-Gravity)  
**Live demo:** [open-gravity-one.vercel.app](https://open-gravity-one.vercel.app)

## How it works

1. **Enter your mass** (1–300 kg) and height (for jump calibration)
2. **Allow camera access** — position your full body in frame, 2–3 m from the camera
3. **Stand still** for ~2 s while the app builds a baseline
4. **Jump** — MediaPipe Pose tracks the hip rise in real time
5. **Results** — your measured Earth jump is scaled to all four worlds with correct physics

If you skip the camera, the app falls back to a physics estimate for your mass.

## Run locally

```bash
npx serve .
```

Open `http://localhost:3000`. Camera access requires HTTPS on non-localhost origins (Vercel handles this automatically).

## Camera requirements

- A modern browser (Chrome, Edge, Safari 16+, Firefox)
- Webcam or phone camera with `getUserMedia` support
- Good lighting; full body visible in frame

## Physics

| Formula | Description |
|---------|-------------|
| `W = m × g` | Weight in newtons |
| `h_world = h_earth × (9.81 / g_world)` | Jump height scaled from measured Earth jump |

Gravity values:

| World | g (m/s²) | Jump rank |
|-------|----------|-----------|
| Earth | 9.81 | Baseline |
| Mars  | 3.71 | 2.6× higher |
| Moon  | 1.62 | 6× higher |
| Pluto | 0.62 | 15.8× higher |

## Architecture

```
js/
  app.js          — flow state machine (mass → camera → jump → results)
  physics.js      — gravity constants, weight and jump formulas
  camera.js       — getUserMedia wrapper
  poseDetector.js — MediaPipe Pose Landmarker (CDN WASM)
  jumpTracker.js  — baseline + peak detection state machine
index.html        — UI (4-world panels + camera stage)
styles.css        — CSS-var-driven animations + responsive layout
scale.js          — WebSocket client (ESP32 exhibit mode)
astronaut.svg     — spacesuit graphic
firmware/         — ESP32 + HX711 sketch (optional exhibit hardware)
```

## Exhibit / scale mode (optional)

Append `?scale=auto` to the URL to enable the ESP32 load-cell scale integration. The scale button in the mass modal will unlock, and the app connects to `ws://192.168.4.1:81/` automatically.

### Hardware

| Part | Notes |
|------|-------|
| ESP32 dev board | Any ESP32-WROOM |
| HX711 module | Load-cell amplifier |
| Load cell | Platform scale (50–200 kg rated) |

### Wiring

| HX711 | ESP32 |
|-------|-------|
| VCC | 3.3V |
| GND | GND |
| DT | GPIO 16 |
| SCK | GPIO 17 |

### Flash firmware

1. Install Arduino IDE
2. Install libraries: **HX711**, **WebSockets** (Markus Sattler)
3. Open [`firmware/gravity_scale/gravity_scale.ino`](firmware/gravity_scale/gravity_scale.ino)
4. Upload to ESP32

### Connect

1. ESP32 creates WiFi AP: **`OpenGravity-Scale`** (password: `opengravity`)
2. Connect your device to that network
3. Open app with `?scale=auto`
