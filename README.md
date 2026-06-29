# Open Gravity

Compare your **mass**, **weight**, and **jump height** on **Earth**, **Moon**, **Mars**, and **Pluto** — with optional live input from an ESP32 load-cell scale.

**Repository:** [github.com/basheerbk/Open-Gravity](https://github.com/basheerbk/Open-Gravity)

## Run the web app

```bash
npx serve .
```

Open `http://localhost:3000` (or the URL shown in the terminal).

### Auto-connect to scale

```
http://localhost:3000/?scale=auto
```

## Manual mode

1. Open the app → choose **Enter manually**
2. Type mass in kg (1–300)
3. See weight (N), jump height (m), and astronaut hops on all four worlds

## Scale mode (ESP32 + load cell)

### Hardware

| Part | Notes |
|------|-------|
| ESP32 dev board | Any ESP32-WROOM |
| HX711 module | Load-cell amplifier |
| Load cell | Platform scale (e.g. 50–200 kg rated) |

**Wiring**

| HX711 | ESP32 |
|-------|-------|
| VCC | 3.3V |
| GND | GND |
| DT (DOUT) | GPIO 16 |
| SCK | GPIO 17 |

### Flash firmware

1. Install Arduino IDE (or PlatformIO)
2. Install libraries: **HX711**, **WebSockets** (Markus Sattler)
3. Open [`firmware/gravity_scale/gravity_scale.ino`](firmware/gravity_scale/gravity_scale.ino)
4. Select your ESP32 board and upload

### Calibrate

1. Power on with **nothing** on the pad → firmware auto-tares
2. Place a **known mass** (e.g. 5 kg) on the pad
3. Adjust `scale.set_scale(-7050.0f)` in the sketch until Serial Monitor shows correct kg
4. Re-upload

### Connect

1. ESP32 creates WiFi AP: **`GravityLab-Scale`** (password: `gravitylab`)
2. Connect the display PC to that network (or use ESP32 station mode in a future update)
3. In the app, click **Connect scale** (or use `?scale=auto`)
4. WebSocket URL: `ws://192.168.4.1:81/`

### Exhibit flow

1. **Jump** onto the pad → landing force flashes on Earth
2. **Stand still 3 seconds** → countdown on screen
3. Mass is locked → all four worlds update (weight, jump meters, landing force estimates)
4. **Step off** → ready for the next person

## Gravity values

| World | g (m/s²) | Jump rank |
|-------|----------|-----------|
| Pluto | 0.62 | Highest |
| Moon | 1.62 | 2nd |
| Mars | 3.71 | 3rd |
| Earth | 9.81 | Lowest |

## Physics

- **Weight:** `W = mass × g` (newtons)
- **Jump height:** `h = 0.5 m × (70 / mass) × (9.81 / g)` — lighter people jump higher; weaker gravity helps more
- **Landing force (other worlds):** estimated as `peakEarth × (g_planet / g_earth)`

## Files

```
index.html    — UI
app.js        — simulation + scale orchestration
scale.js      — WebSocket client
styles.css    — layout (4 panels)
astronaut.svg — spacesuit graphic
firmware/     — ESP32 sketch
```
