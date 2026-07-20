# Open Gravity

Jump in front of your camera and see how high you'd go on **all eight planets, the Moon, and Pluto** — ten worlds update in real time from your actual jump height. No mass or height input required.

**Repository:** [github.com/basheerbk/Open-Gravity](https://github.com/basheerbk/Open-Gravity)  
**Live demo:** [open-gravity-one.vercel.app](https://open-gravity-one.vercel.app)

## How it works

1. **Enable camera** — camera bar under the header
2. **Face the camera** with your upper body visible
3. **Hold still** briefly while the app calibrates (~0.5–1 s)
4. **Jump** — meters fill live during the jump; all four astronauts hop on landing
5. **Results** — gravity-scaled heights on Earth, Moon, Mars, and Pluto

Jump height is measured from the **nose spike** in the camera frame, scaled relative to visible body height. Optional `?mPerUnit=` or `?bodyM=` overrides for fixed installs.

## Exhibit dual-window (TV + laptop)

Same laptop, TV as a second screen (HDMI). Two browser windows sync via `BroadcastChannel` — no server.

1. Plug the TV into the laptop and use **Extend** display mode
2. Open **display**: [`/?role=display`](https://open-gravity-one.vercel.app/?role=display) → drag to the TV → fullscreen (`F11`)
3. Open **camera**: [`/?role=camera&autocam=1`](https://open-gravity-one.vercel.app/?role=camera&autocam=1) on the laptop → face the kids
4. Jumps on the laptop drive the TV panels live (meters + hop)

You can also use the **Open display window** / **Open camera window** links in the camera bar or About modal.

| Role | URL | Shows |
|------|-----|--------|
| Display (TV) | `?role=display` | 4 world panels only |
| Camera (laptop) | `?role=camera` | Camera + tracking only |
| Solo (default) | *(none)* | Combined UI |

Both windows must be the **same browser** and **same origin** (e.g. both Chrome on the laptop).

## URL parameters

| Param | Default | Description |
|-------|---------|-------------|
| `role=display` | solo | TV window — panels only, listens for jumps |
| `role=camera` | solo | Laptop window — camera only, broadcasts jumps |
| `autocam=1` | off | Auto-start camera on load |
| `boxX`, `boxY`, `boxW`, `boxH` | 0.34, 0, 0.32, 1 | Track box inside camera (normalised 0–1) |
| `bodyM` | 1.65 | Estimated body height (m) for nose-rise scaling |
| `mPerUnit` | — | Fixed-camera override: metres per normalised rise |
| `scale=auto` | off | Enable ESP32 load-cell integration (optional) |

## Run locally

```bash
npx serve . -l 3000
```

Open `http://localhost:3000`. Camera access requires HTTPS on non-localhost origins (Vercel handles this automatically).

## Camera requirements

- Modern browser (Chrome, Edge, Safari 16+, Firefox)
- Webcam or phone camera with `getUserMedia` support
- Good lighting; face and upper body visible in frame

## Physics

On a world with surface gravity `g`, jump height scales as:

```
h_world = h_earth × (9.81 / g_world)
```

| World | g (m/s²) | vs Earth |
|-------|----------|----------|
| Mercury | 3.7 | 2.7× higher |
| Venus | 8.87 | 1.1× higher |
| Earth | 9.81 | 1× (baseline) |
| Moon | 1.62 | 6.1× higher |
| Mars | 3.71 | 2.6× higher |
| Jupiter | 24.79 | 0.4× (lower) |
| Saturn | 10.44 | 0.9× |
| Uranus | 8.69 | 1.1× higher |
| Neptune | 11.15 | 0.9× |
| Pluto | 0.62 | 15.8× higher |

## Architecture

```
js/
  app.js          — panels UI, camera, dual-window roles
  sync.js         — BroadcastChannel bus (display ↔ camera)
  physics.js      — gravity constants, jump scaling formulas
  camera.js       — getUserMedia wrapper
  poseDetector.js — MediaPipe Pose Landmarker (CDN WASM), skeleton overlay
  jumpTracker.js  — nose spike baseline + jump detection
  standZone.js    — pose readiness + body-relative calibration
index.html        — 4-world panels + camera bar
styles.css        — panel animations, role layouts
scale.js          — WebSocket client (ESP32 exhibit mode, optional)
firmware/         — ESP32 + HX711 sketch (optional hardware)
```

All pose detection runs **in the browser** — no server-side video processing. MediaPipe loads from CDN; deploy as static files (e.g. Vercel).

## Optional: ESP32 scale mode

Append `?scale=auto` to connect to an ESP32 load-cell scale at `ws://192.168.4.1:81/`. See [`firmware/gravity_scale/gravity_scale.ino`](firmware/gravity_scale/gravity_scale.ino) for wiring and flash instructions.
