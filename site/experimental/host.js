(() => {
  'use strict';
  const roomsOnly = new URLSearchParams(location.search).has('salas');
  const autoHost = new URLSearchParams(location.search).get('autohost') === '1';
  let menuReady = false, instance = null, controller = null, mounted = false;
  let createAction = null;
  const logs = [];
  const el = id => document.getElementById(id);
  const safeStorage = {
    get() { try { return localStorage.getItem('peak.nickname') || ''; } catch { return ''; } },
    set(value) { try { localStorage.setItem('peak.nickname', value); } catch { /* Storage can be disabled. */ } }
  };
  function log(value) {
    logs.push(String(value).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[id]').slice(0, 700));
    if (logs.length > 60) logs.shift();
    if (mounted && el('host-diagnostics').open) renderLog();
  }
  function renderLog() { el('host-log').textContent = logs.join('\n'); }
  function generateCode() {
    return [...crypto.getRandomValues(new Uint8Array(6))].map(n => PeakRooms.alphabet[n % 32]).join('');
  }
  function notice(message) { el('host-notice').textContent = message; }
  function render(state) {
    const busy = ['checking', 'connecting', 'entering', 'disconnecting'].includes(state.phase);
    const joined = state.phase === 'joined';
    const canStart = ['ready', 'error'].includes(state.phase) && !state.needsReload;
    el('peak-host').dataset.phase = state.phase;
    el('host-status').textContent = state.message;
    el('host-step').textContent = ({ loading: 'PREPARANDO', ready: 'LISTO PARA CONECTAR', checking: 'CONECTANDO', connecting: 'CONECTANDO', entering: 'ENTRANDO A LA SALA', joined: 'SALA CONECTADA', disconnecting: 'DESCONECTANDO', error: 'CONEXIÓN INTERRUMPIDA', fatal: 'RECARGA NECESARIA' })[state.phase];
    el('host-create').disabled = !canStart;
    el('host-join').disabled = !canStart;
    el('host-nickname').disabled = busy || joined || state.needsReload;
    el('host-code').disabled = busy || joined || state.needsReload;
    el('host-form').hidden = joined || state.needsReload || state.phase === 'fatal';
    el('host-room').hidden = !joined;
    el('host-cancel').hidden = !busy || state.phase === 'disconnecting';
    el('host-reload').hidden = !state.needsReload && state.phase !== 'fatal';
    el('host-progress').hidden = state.phase !== 'loading';
    el('host-busy').hidden = !busy;
    if (state.room) {
      el('host-room-code').textContent = state.room.code;
      el('host-players').textContent = state.room.count + ' / 4 jugadores';
      el('host-role').textContent = state.room.isHost ? 'HOST' : 'INVITADO';
      el('host-compact').textContent = state.room.code + ' · ' + state.room.count + '/4';
    } else {
      el('host-room-code').textContent = '';
      el('host-players').textContent = '';
      el('host-role').textContent = '';
      el('host-compact').textContent = busy ? 'Conectando…' : 'Salas privadas';
    }
  }
  async function checkServer(signal) {
    try {
      const response = await fetch(new URL('api/status', location.href), { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const result = await response.json();
      if (result.mode !== 'self-hosted' || result.cloud !== false) throw new Error('Servidor incompatible');
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('El servidor no responde. Abre iniciar-host.ps1 y vuelve a intentarlo.');
    }
  }
  function initialize() {
    if (!mounted || !instance || !menuReady || controller) return;
    controller = new PeakRooms.RoomController({
      adapter: createPeakNativeClient(instance, roomsOnly), checkServer,
      timeout: roomsOnly ? 30000 : 120000, onChange: render
    });
    controller.ready();
    setInterval(() => controller.tick(), 250);
    log('Cliente preparado. Destino: servidor de esta web, sin cuenta.');
    if (controller.adapter.repairMenu) queueMicrotask(() => {
      try { log(controller.adapter.repairMenu()); } catch (error) { log('No se pudo preparar Host Game: ' + error); }
    });
    if (autoHost && !roomsOnly) createAction?.();
  }
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      const value = args.map(String).join(' ');
      if (value.includes('[PeakDecomp] Menu ready.')) { menuReady = true; initialize(); }
      if (/photon|socket|exception|connected|room|network/i.test(value)) log(value);
      if (/InvalidCastException.*Vector3|function signature mismatch|null function/i.test(value) && mounted) {
        el('host-game-error').hidden = false;
        el('host-game-error').textContent = 'Se detectó un fallo de sincronización del juego. Sal de la sala y recarga para volver al menú.';
      }
    };
  }
  window.peakHostReady = value => { instance = value; initialize(); };
  window.peakHostProgress = (fraction, label) => {
    if (!mounted || controller) return;
    el('host-progress').value = Math.max(0, Math.min(1, fraction));
    el('host-status').textContent = label;
  };
  window.peakHostFailure = error => {
    const message = 'PEAK no pudo cargarse. Recarga para volver a intentarlo.';
    log(error);
    if (controller) controller.fault(message);
    else if (mounted) { el('host-status').textContent = message; el('host-progress').hidden = true; el('host-reload').hidden = false; el('peak-host').dataset.phase = 'fatal'; }
  };
  window.addEventListener('peak-room-rejected', event => controller?.reject(event.detail.returnCode));
  document.addEventListener('DOMContentLoaded', () => {
    mounted = true;
    el('host-mode').textContent = roomsOnly ? 'PRUEBA DE SALAS' : 'PARTIDA EXPERIMENTAL';
    el('host-mode-note').textContent = roomsOnly
      ? 'Solo comprueba conexiones. Para jugar, abre la partida y crea allí un código nuevo.'
      : 'Crear partida carga el aeropuerto. Tus amigos entran aquí con el código. Cooperativo en desarrollo.';
    el('host-create').textContent = roomsOnly ? 'Crear sala de prueba' : 'Host Game · Crear partida';
    el('host-join').textContent = roomsOnly ? 'Entrar' : 'Entrar a partida';
    el('host-open-game').hidden = !roomsOnly;
    function gameUrl(autostart = false) {
      const url = new URL(location.href);
      url.searchParams.delete('salas'); url.searchParams.delete('autohost'); url.hash = '';
      if (autostart) url.searchParams.set('autohost', '1');
      return url;
    }
    el('host-open-game').onclick = () => location.assign(gameUrl());
    if (autoHost) {
      const clean = new URL(location.href); clean.searchParams.delete('autohost');
      history.replaceState(null, '', clean);
    }
    const switchUrl = new URL(location.href);
    if (roomsOnly) switchUrl.searchParams.delete('salas'); else switchUrl.searchParams.set('salas', '1');
    switchUrl.hash = '';
    el('host-switch-mode').href = switchUrl.href;
    el('host-switch-mode').textContent = roomsOnly ? 'Abrir partida experimental ↗' : 'Comprobar solo las salas ↗';
    el('host-server').textContent = location.host;
    const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(location.hostname);
    el('host-local-note').hidden = !local;
    el('host-nickname').value = safeStorage.get();
    const sharedCode = new URLSearchParams(location.hash.slice(1)).get('room');
    if (sharedCode) {
      el('host-code').value = PeakRooms.normalizeCode(sharedCode).slice(0, 6);
      notice('Tienes una invitación. Cuando cargue PEAK, pulsa Entrar.');
    }
    el('host-code').addEventListener('input', () => { el('host-code').value = el('host-code').value.toUpperCase(); el('host-code').removeAttribute('aria-invalid'); el('host-code-error').textContent = ''; });
    function start(kind) {
      const code = kind === 'create' ? generateCode() : PeakRooms.normalizeCode(el('host-code').value);
      if (!PeakRooms.validCode(code)) {
        el('host-code').setAttribute('aria-invalid', 'true');
        el('host-code-error').textContent = 'Escribe 6 letras o números. El código no usa I, O, 0 ni 1.';
        el('host-code').focus(); return;
      }
      const nickname = el('host-nickname').value.trim() || 'Scout-' + generateCode().slice(0, 3);
      el('host-nickname').value = nickname;
      safeStorage.set(nickname); notice('');
      el('host-game-error').hidden = true;
      controller?.start(kind, code, nickname);
    }
    createAction = () => start('create');
    el('host-create').onclick = createAction;
    el('host-form').onsubmit = event => { event.preventDefault(); if (!el('host-join').disabled) start('join'); };
    el('host-cancel').onclick = () => controller?.stop('Conexión cancelada.');
    el('host-leave').onclick = () => { notice(''); controller?.stop(); };
    el('host-reload').onclick = () => location.reload();
    el('host-toggle').onclick = () => {
      const collapsed = el('host-toggle').getAttribute('aria-expanded') === 'true';
      el('host-toggle').setAttribute('aria-expanded', String(!collapsed));
      el('host-toggle').setAttribute('aria-label', collapsed ? 'Mostrar panel de sala' : 'Minimizar panel de sala');
      el('host-toggle').textContent = collapsed ? '+' : '−';
      el('host-body').hidden = collapsed;
      el('peak-host').dataset.collapsed = String(collapsed);
    };
    el('host-diagnostics').addEventListener('toggle', renderLog);
    async function copy(value, message) {
      try { await navigator.clipboard.writeText(value); notice(message); el('host-copy-fallback').hidden = true; }
      catch {
        el('host-copy-fallback').hidden = false;
        el('host-copy-text').value = value; el('host-copy-text').focus(); el('host-copy-text').select();
        notice('El navegador bloqueó el portapapeles. Copia el texto seleccionado.');
      }
    }
    el('host-copy-code').onclick = () => copy(controller.state.room.code, 'Código copiado.');
    el('host-copy').onclick = () => {
      const url = new URL(location.href); url.searchParams.delete('cdn'); url.searchParams.delete('voicetest');
      url.hash = 'room=' + controller.state.room.code;
      copy(url.href, local ? 'Enlace copiado. En otros equipos usa la dirección de red del host.' : 'Enlace copiado. Tus amigos deben abrir este mismo servidor.');
    };
    el('host-copy-diagnostics').onclick = () => copy('PEAK · ' + (roomsOnly ? 'salas' : 'partida') + '\n' + logs.join('\n'), 'Diagnóstico copiado.');
    // Install before Unity registers its global keyboard hooks. Keep browser input
    // defaults (typing, Tab, clipboard), and handle Enter explicitly for this form.
    for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, event => {
      if (!el('peak-host').contains(event.target)) return;
      event.stopImmediatePropagation();
      if (type === 'keydown' && event.key === 'Enter' && !event.isComposing && event.target === el('host-code')) {
        event.preventDefault();
        if (!el('host-join').disabled) start('join');
      }
    }, true);
    initialize();
  });
})();
