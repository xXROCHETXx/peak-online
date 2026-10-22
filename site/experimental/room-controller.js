/* Room lifecycle is independent of Unity so cancellation and reconnects can be tested. */
(function (root) {
  'use strict';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const normalizeCode = value => String(value).trim().toUpperCase();
  const validCode = value => /^[A-HJ-NP-Z2-9]{6}$/.test(value);
  const roomErrors = {
    32758: 'Room not found. Check the code and ask the host to keep their tab open.',
    32765: 'Room full: four players have already joined.',
    32764: 'The host closed the room.',
    32766: 'That code is taken. Create another room.',
    32760: 'The host cannot create more rooms right now.'
  };

  class RoomController {
    constructor({ adapter, checkServer, onChange = () => {}, now = () => Date.now(), timeout = 30000, checkTimeout = 6000 }) {
      Object.assign(this, { adapter, checkServer, onChange, now, timeout, checkTimeout });
      this.state = { phase: 'loading', message: 'Preparing PEAK…', room: null, needsReload: false };
      this.generation = 0;
      this.pending = null;
    }
    update(change) { Object.assign(this.state, change); this.onChange({ ...this.state }); }
    ready() {
      if (this.state.phase === 'loading') this.update({ phase: 'ready', message: 'Ready. Create a room or join with a code.' });
    }
    async start(kind, code, nickname) {
      if (!['ready', 'error'].includes(this.state.phase) || this.state.needsReload) return false;
      code = normalizeCode(code);
      if (!validCode(code)) { this.update({ phase: 'error', message: 'Use a 6-character code, without I, O, 0 or 1.' }); return false; }
      const generation = ++this.generation;
      const abort = new AbortController();
      this.pending = { kind, code, started: this.now(), sent: false, abort };
      this.update({ phase: 'checking', message: 'Finding the host…', room: null });
      try {
        await this.checkServer(abort.signal);
        if (generation !== this.generation) return false;
        this.update({ phase: 'connecting', message: 'Connecting to the host…' });
        this.adapter.connect(nickname);
        return true;
      } catch (error) {
        if (generation !== this.generation) return false;
        if (this.state.phase === 'checking') {
          this.pending = null;
          this.update({ phase: 'error', message: error.message || 'The host is not responding. Ask them to keep their tab open.' });
        } else this.stop(error.message, true);
        return false;
      }
    }
    reject(returnCode) {
      if (this.pending) this.stop(roomErrors[returnCode] || 'The host rejected the room request (code ' + returnCode + ').', true);
    }
    stop(message = 'You left the room.', error = false) {
      if (['loading', 'fatal', 'disconnecting'].includes(this.state.phase)) return;
      ++this.generation;
      if (this.pending) this.pending.abort.abort();
      this.pending = null;
      this.stopping = { started: this.now(), message, error };
      this.update({ phase: 'disconnecting', message: 'Closing the connection…', room: null });
      try { this.adapter.disconnect(); }
      catch { this.forceStop(); }
    }
    forceStop() {
      this.adapter.abort?.();
      this.update({ phase: 'fatal', room: null, needsReload: true, message: 'The connection did not close completely. Reload PEAK to try again.' });
    }
    fault(message) {
      this.pending?.abort.abort();
      this.pending = null;
      ++this.generation;
      try { this.adapter.disconnect(); this.adapter.abort?.(); } catch { /* Unity may already be unavailable. */ }
      this.update({ phase: 'fatal', room: null, needsReload: true, message });
    }
    tick() {
      if (['loading', 'fatal'].includes(this.state.phase)) return;
      try {
        const snapshot = this.adapter.snapshot();
        const phase = this.state.phase;
        if (phase === 'disconnecting') {
          if (!snapshot.connected && !snapshot.inRoom) {
            const { message, error } = this.stopping;
            this.update({ phase: error ? 'error' : 'ready', message, needsReload: !!this.adapter.needsReload });
          } else if (this.now() - this.stopping.started > 5000) this.forceStop();
          return;
        }
        if (snapshot.inRoom) {
          if (!this.pending && phase !== 'joined') { this.stop('A late room entry was cancelled. You can try again.'); return; }
          if (this.pending && snapshot.room.code !== this.pending.code) { this.stop('The host returned a different room. Try again.', true); return; }
          this.pending = null;
          const room = snapshot.room;
          // Avoid live-region announcements on every polling tick.
          if (phase !== 'joined' || JSON.stringify(room) !== JSON.stringify(this.state.room))
            this.update({ phase: 'joined', room, message: room.isHost ? 'You are the host. Share the room code to invite friends.' : 'You joined the room. Meet the host at the airport.' });
          return;
        }
        if (phase === 'joined') {
          this.stop('Room connection lost. Check that the host tab is still open.', true);
          return;
        }
        if (!this.pending) return;
        if (this.now() - this.pending.started > (phase === 'checking' ? this.checkTimeout : this.timeout)) {
          this.stop('Connection timed out. Check the code and try again.', true);
          return;
        }
        if (snapshot.disconnected && ['connecting', 'entering'].includes(phase)) {
          this.stop('Could not maintain the connection to the host.', true); return;
        }
        if (snapshot.ready && !this.pending.sent && phase === 'connecting') {
          this.pending.sent = true;
          this.update({ phase: 'entering', message: this.adapter.launchesGame
            ? 'Loading the airport and connecting the game…'
            : this.pending.kind === 'create' ? 'Creating your room…' : 'Joining the room…' });
          this.adapter.requestRoom(this.pending.kind, this.pending.code);
        }
      } catch (error) { this.stop('Could not continue: ' + error.message, true); }
    }
  }
  const api = { RoomController, normalizeCode, validCode, alphabet };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PeakRooms = api;
})(typeof window === 'object' ? window : globalThis);
