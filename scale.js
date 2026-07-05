export const DEFAULT_SCALE_URL = "ws://192.168.4.1:81/";

export const ScaleClient = {
  url: DEFAULT_SCALE_URL,
  ws: null,
  reconnectTimer: null,
  listeners: { phase: [], capture: [], weight: [], status: [] },

  on(event, fn) {
    if (this.listeners[event]) this.listeners[event].push(fn);
  },

  emit(event, data) {
    (this.listeners[event] || []).forEach((fn) => fn(data));
  },

  connect(url) {
    if (url) this.url = url;
    if (this.ws) this.ws.close();

    this.emit("status", { state: "connecting" });

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.emit("status", { state: "error", message: "Invalid WebSocket URL" });
      return;
    }

    this.ws.onopen = () => {
      this.emit("status", { state: "live" });
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "phase") this.emit("phase", msg);
        else if (msg.type === "capture") this.emit("capture", msg);
        else if (msg.type === "weight") this.emit("weight", msg);
        else if (msg.type === "status") this.emit("status", msg);
      } catch {
        /* ignore malformed */
      }
    };

    this.ws.onclose = () => {
      this.emit("status", { state: "disconnected" });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.emit("status", { state: "error" });
    };
  },

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.ws?.readyState !== WebSocket.OPEN) this.connect();
    }, 3000);
  },

  send(cmd) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    }
  },

  tare() {
    this.send({ cmd: "tare" });
  },

  reset() {
    this.send({ cmd: "reset" });
  },

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) this.ws.close();
    this.ws = null;
    this.emit("status", { state: "offline" });
  },
};

// Expose globally for legacy exhibit-mode scripts
window.ScaleClient = ScaleClient;
