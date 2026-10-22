/* Advance only the native voice client when audio or network data is ready. */
(() => {
  'use strict';
  class PeakVoicePump {
    constructor(getModule) { this.getModule = getModule; this.connections = new Set(); this.busy = false; this.enabled = true;
      this.stats = { voicePumpRuns: 0, voiceFastDispatches: 0, voiceFastFlushes: 0 }; }
    register(connection) { if (connection) this.connections.add(connection); }
    unregister(connection) { this.connections.delete(connection); }
    run({ peer: requestedPeer = 0, flushOnly = false } = {}) {
      const mod = this.getModule(); if (!this.enabled || !mod || this.busy) return;
      const ptr = address => mod.HEAPU32[address >>> 2];
      const call = (index, self) => mod.asm.__indirect_function_table.get(index)(self, 0);
      this.busy = true;
      try {
        for (const connection of this.connections) {
          const transport = ptr(connection + 52); if (!transport) continue;
          const peer = ptr(transport + 132); if (!peer || requestedPeer && peer !== requestedPeer) continue;
          if (!flushOnly) {
            // These are the same SDK methods used by FixedUpdate and Update.
            for (let n = 0; n < 64; n++) { this.stats.voiceFastDispatches++; if (!call(38353, peer)) break; }
            const client = ptr(transport + 224); if (client) call(41364, client);
            this.stats.voicePumpRuns++;
          }
          for (let n = 0; n < 8; n++) { this.stats.voiceFastFlushes++; if (!call(38351, peer)) break; }
        }
      } finally { this.busy = false; }
    }
    close() { this.connections.clear(); }
  }
  if (typeof module === 'object' && module.exports) module.exports = PeakVoicePump;
  else window.PeakVoicePump = PeakVoicePump;
})();
