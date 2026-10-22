/* Room lifecycle is independent of Unity so cancellation and reconnects can be tested. */
(function (root) {
  'use strict';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const normalizeCode = value => String(value).trim().toUpperCase();
  const validCode = value => /^[A-HJ-NP-Z2-9]{6}$/.test(value);
  const roomErrors = {
    32758: 'Esta sala no existe. Revisa el código y la dirección del servidor.',
    32765: 'La sala está llena: ya tiene cuatro jugadores.',
    32764: 'El host ha cerrado la sala.',
    32766: 'Ese código ya está ocupado. Vuelve a crear la sala.',
    32760: 'El servidor no admite más salas en este momento.'
  };

  class RoomController {
    constructor({ adapter, checkServer, onChange = () => {}, now = () => Date.now(), timeout = 30000 }) {
      Object.assign(this, { adapter, checkServer, onChange, now, timeout });
      this.state = { phase: 'loading', message: 'Preparando PEAK…', room: null, needsReload: false };
      this.generation = 0;
      this.pending = null;
    }
    update(change) { Object.assign(this.state, change); this.onChange({ ...this.state }); }
    ready() {
      if (this.state.phase === 'loading') this.update({ phase: 'ready', message: 'Todo listo. Crea una sala o entra con un código.' });
    }
    async start(kind, code, nickname) {
      if (!['ready', 'error'].includes(this.state.phase) || this.state.needsReload) return false;
      code = normalizeCode(code);
      if (!validCode(code)) { this.update({ phase: 'error', message: 'Usa un código de 6 caracteres, sin I, O, 0 ni 1.' }); return false; }
      const generation = ++this.generation;
      const abort = new AbortController();
      this.pending = { kind, code, started: this.now(), sent: false, abort };
      this.update({ phase: 'checking', message: 'Comprobando el servidor…', room: null });
      try {
        await this.checkServer(abort.signal);
        if (generation !== this.generation) return false;
        this.update({ phase: 'connecting', message: 'Conectando con el servidor…' });
        this.adapter.connect(nickname);
        return true;
      } catch (error) {
        if (generation !== this.generation) return false;
        if (this.state.phase === 'checking') {
          this.pending = null;
          this.update({ phase: 'error', message: error.message || 'El servidor no responde. Comprueba que siga abierto.' });
        } else this.stop(error.message, true);
        return false;
      }
    }
    reject(returnCode) {
      if (this.pending) this.stop(roomErrors[returnCode] || 'El servidor rechazó la entrada a la sala (código ' + returnCode + ').', true);
    }
    stop(message = 'Has salido de la sala.', error = false) {
      if (['loading', 'fatal', 'disconnecting'].includes(this.state.phase)) return;
      ++this.generation;
      if (this.pending) this.pending.abort.abort();
      this.pending = null;
      this.stopping = { started: this.now(), message, error };
      this.update({ phase: 'disconnecting', message: 'Cerrando la conexión…', room: null });
      try { this.adapter.disconnect(); }
      catch { this.forceStop(); }
    }
    forceStop() {
      this.adapter.abort?.();
      this.update({ phase: 'fatal', room: null, needsReload: true, message: 'La conexión no se pudo cerrar por completo. Recarga PEAK para volver a intentarlo.' });
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
          if (!this.pending && phase !== 'joined') { this.stop('Se canceló una entrada tardía. Puedes volver a intentarlo.'); return; }
          if (this.pending && snapshot.room.code !== this.pending.code) { this.stop('El servidor devolvió una sala diferente. Vuelve a intentarlo.', true); return; }
          this.pending = null;
          const room = snapshot.room;
          // Avoid live-region announcements on every polling tick.
          if (phase !== 'joined' || JSON.stringify(room) !== JSON.stringify(this.state.room))
            this.update({ phase: 'joined', room, message: room.isHost ? 'Eres el host. Comparte el código para invitar.' : 'Estás en la sala. Espera junto al host.' });
          return;
        }
        if (phase === 'joined') {
          this.stop('Se perdió la conexión con la sala. Comprueba que el servidor siga abierto.', true);
          return;
        }
        if (!this.pending) return;
        if (this.now() - this.pending.started > (phase === 'checking' ? 6000 : this.timeout)) {
          this.stop('Se agotó el tiempo de conexión. Revisa el servidor y vuelve a intentarlo.', true);
          return;
        }
        if (snapshot.disconnected && ['connecting', 'entering'].includes(phase)) {
          this.stop('No se pudo mantener la conexión con el servidor.', true); return;
        }
        if (snapshot.ready && !this.pending.sent && phase === 'connecting') {
          this.pending.sent = true;
          this.update({ phase: 'entering', message: this.adapter.launchesGame
            ? 'Cargando el aeropuerto y conectando la partida…'
            : this.pending.kind === 'create' ? 'Creando tu sala…' : 'Entrando a la sala…' });
          this.adapter.requestRoom(this.pending.kind, this.pending.code);
        }
      } catch (error) { this.stop('No se pudo continuar: ' + error.message, true); }
    }
  }
  const api = { RoomController, normalizeCode, validCode, alphabet };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PeakRooms = api;
})(typeof window === 'object' ? window : globalThis);
