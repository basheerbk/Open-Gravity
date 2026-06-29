/**
 * Gravity Lab — ESP32 + HX711 load cell
 *
 * Libraries (Arduino Library Manager):
 *   - HX711 by Bogdan Necula
 *   - WebSockets by Markus Sattler
 *
 * Wiring:
 *   HX711 VCC  -> 3.3V (or 5V per module)
 *   HX711 GND  -> GND
 *   HX711 DT   -> GPIO 16 (DOUT)
 *   HX711 SCK  -> GPIO 17 (SCK)
 *
 * WiFi AP: GravityLab-Scale  (password: gravitylab)
 * WebSocket: ws://192.168.4.1:81/
 */

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <HX711.h>

// —— Config ——
#define DOUT_PIN 16
#define SCK_PIN 17

#define WIFI_SSID "GravityLab-Scale"
#define WIFI_PASS "gravitylab"
#define WS_PORT 81

#define STABLE_TIME_MS 3000
#define STABLE_DELTA_KG 0.3
#define IMPACT_WINDOW_MS 800
#define EMPTY_THRESHOLD_KG 3.0
#define MASS_MIN_KG 1.0
#define MASS_MAX_KG 300.0
#define EARTH_G 9.81f

#define FILTER_SIZE 8

HX711 scale;
WebSocketsServer webSocket(WS_PORT);

enum Phase { PHASE_IDLE, PHASE_IMPACT, PHASE_STANDING, PHASE_LOCKED };

Phase phase = PHASE_IDLE;
float peakForceN = 0;
float peakKg = 0;
unsigned long phaseStartMs = 0;
unsigned long stableStartMs = 0;
unsigned long lastBroadcastMs = 0;
float filterBuf[FILTER_SIZE];
int filterIdx = 0;
bool filterFull = false;

float readFilteredKg() {
  if (!scale.is_ready()) return 0;
  float raw = scale.get_units(3);
  filterBuf[filterIdx] = raw;
  filterIdx = (filterIdx + 1) % FILTER_SIZE;
  if (filterIdx == 0) filterFull = true;

  int count = filterFull ? FILTER_SIZE : filterIdx;
  if (count == 0) return raw;

  float sum = 0;
  for (int i = 0; i < count; i++) sum += filterBuf[i];
  return sum / count;
}

void broadcastJson(const String& json) {
  webSocket.broadcastTXT(json);
  Serial.println(json);
}

void sendPhase(const char* p, float kg, float peak, unsigned long stableMs) {
  String json = "{\"type\":\"phase\",\"phase\":\"" + String(p) + "\"";
  json += ",\"kg\":" + String(kg, 1);
  if (peak > 0) json += ",\"peakForceN\":" + String(peak, 0);
  if (stableMs > 0) json += ",\"stableMs\":" + String(stableMs);
  json += "}";
  broadcastJson(json);
}

void sendCapture(float massKg, float peakN) {
  String json = "{\"type\":\"capture\",\"massKg\":" + String(massKg, 1);
  json += ",\"peakForceN\":" + String(peakN, 0);
  json += ",\"earthWeightN\":" + String(massKg * EARTH_G, 0);
  json += "}";
  broadcastJson(json);
}

void resetPhase() {
  phase = PHASE_IDLE;
  peakForceN = 0;
  peakKg = 0;
  stableStartMs = 0;
  sendPhase("idle", 0, 0, 0);
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  if (type != WStype_TEXT) return;

  String msg = String((char*)payload);
  if (msg.indexOf("\"tare\"") >= 0) {
    scale.tare(FILTER_SIZE);
    resetPhase();
    broadcastJson("{\"type\":\"status\",\"state\":\"tared\"}");
  } else if (msg.indexOf("\"reset\"") >= 0) {
    resetPhase();
  }
}

void setup() {
  Serial.begin(115200);

  scale.begin(DOUT_PIN, SCK_PIN);
  scale.set_scale(-7050.0f);  // CALIBRATE: adjust after tare with known mass
  scale.tare(FILTER_SIZE);

  WiFi.softAP(WIFI_SSID, WIFI_PASS);
  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  broadcastJson("{\"type\":\"status\",\"state\":\"ready\"}");
  sendPhase("idle", 0, 0, 0);
}

static float lastKg = 0;

void loop() {
  webSocket.loop();

  float kg = readFilteredKg();
  float forceN = kg * EARTH_G;
  unsigned long now = millis();

  // Peak tracking during impact
  if (forceN > peakForceN) {
    peakForceN = forceN;
    peakKg = kg;
  }

  switch (phase) {
    case PHASE_IDLE:
      if (kg > EMPTY_THRESHOLD_KG) {
        phase = PHASE_IMPACT;
        phaseStartMs = now;
        peakForceN = forceN;
        peakKg = kg;
        sendPhase("impact", kg, peakForceN, 0);
      }
      break;

    case PHASE_IMPACT:
      if (kg < EMPTY_THRESHOLD_KG) {
        resetPhase();
        break;
      }
      if (now - phaseStartMs > IMPACT_WINDOW_MS) {
        phase = PHASE_STANDING;
        stableStartMs = now;
        lastKg = kg;
        sendPhase("standing", kg, peakForceN, 0);
      }
      break;

    case PHASE_STANDING: {
      if (kg < EMPTY_THRESHOLD_KG) {
        resetPhase();
        break;
      }
      float delta = fabs(kg - lastKg);
      if (delta > STABLE_DELTA_KG) {
        stableStartMs = now;
        lastKg = kg;
      }
      unsigned long stableMs = now - stableStartMs;
      if (now - lastBroadcastMs > 200) {
        sendPhase("standing", kg, peakForceN, stableMs);
        lastBroadcastMs = now;
      }
      if (stableMs >= STABLE_TIME_MS && kg >= MASS_MIN_KG && kg <= MASS_MAX_KG) {
        phase = PHASE_LOCKED;
        sendPhase("locked", kg, peakForceN, stableMs);
        sendCapture(kg, peakForceN);
      }
      break;
    }

    case PHASE_LOCKED:
      if (kg < EMPTY_THRESHOLD_KG) {
        resetPhase();
      }
      break;
  }

  // Live weight stream (~5 Hz)
  if (now - lastBroadcastMs > 200 && phase != PHASE_LOCKED) {
    String w = "{\"type\":\"weight\",\"kg\":" + String(kg, 1) + "}";
    broadcastJson(w);
    lastBroadcastMs = now;
  }

  delay(20);
}
