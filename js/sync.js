/**
 * Same-browser dual-window sync (TV display + laptop camera).
 * Uses BroadcastChannel — no server required.
 */

const CHANNEL = "open-gravity";

export const Sync = {
  _ch: null,
  _role: "solo",
  _onMessage: null,

  /** @param {"solo"|"display"|"camera"} role */
  init(role, onMessage) {
    this._role = role;
    this._onMessage = onMessage;
    if (role === "solo" || typeof BroadcastChannel === "undefined") return;

    this._ch = new BroadcastChannel(CHANNEL);
    this._ch.onmessage = (e) => {
      if (this._onMessage && e.data) this._onMessage(e.data);
    };

    // Announce presence so the other window can show "connected"
    this.post({ type: "hello", role });
  },

  post(msg) {
    if (!this._ch) return;
    this._ch.postMessage(msg);
  },

  sendPhase(state) {
    this.post({ type: "phase", state });
  },

  sendLive(jumpM) {
    this.post({ type: "live", jumpM });
  },

  sendJump(jumpM) {
    this.post({ type: "jump", jumpM });
  },

  sendHello() {
    this.post({ type: "hello", role: this._role });
  },
};
