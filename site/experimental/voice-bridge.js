/* Browser audio adapter for the pinned PEAK/Photon Voice build. */
(() => {
  'use strict';
  const assetBase = new URL('./', document.currentScript.src);
  const encoders = new Map(), decoders = new Map(), recorders = new Set(), speakers = new Set();
  const ring = new Float32Array(9600); // at most 200 ms when the tab stalls
  const voiceTest = new URLSearchParams(location.search).has('voicetest');
  const output = new PeakVoiceOutput({ meterModule: voiceTest ? new URL('voice-continuity-meter.js', assetBase).href : null, trace: voiceTest });
  const pump = new PeakVoicePump(() => module);
  const wallNow = () => performance.timeOrigin + performance.now();
  const stats = { inputFrames: 0, nativeReads: 0, encodersCreated: 0, encodedFrames: 0,
    decodersCreated: 0, receivedPackets: 0, decodedFrames: 0, decodedSamples: 0, decodedPeak: 0,
    speakerFrames: 0, outputWrites: 0, playbackObserved: false, inputDroppedSamples: 0,
    encoderQueueDrops: 0, decoderQueueDrops: 0, maxDecoderBacklog: 0, errors: [] };
  let module, stream, context, source, worklet, oscillator, generation = 0;
  let head = 0, size = 0, enabled = false, pending = false, held = false, testing = false, supported = false;
  let mode = 'game', deviceId = '', message = 'Comprobando audio del navegador…';
  const el = id => document.getElementById(id);
  const pointer = address => module.HEAPU32[address >>> 2];
  const write = (address, value) => { module.HEAPU32[address >>> 2] = value; };
  const admitted = () => enabled && (testing || mode !== 'ptt' || held);
  const error = value => { const text = String(value); stats.errors.push(text); stats.errors = stats.errors.slice(-5); message = 'Error de voz: ' + text; console.warn('[PeakVoice] ' + text); paint(); };
  function enqueue(pcm) {
    const rms = Math.sqrt(pcm.reduce((sum, x) => sum + x * x, 0) / pcm.length);
    stats.inputRms = rms; stats.inputPeakRms = Math.max(stats.inputPeakRms || 0, rms);
    if (!admitted()) { head = size = 0; return; }
    for (const sample of pcm) {
      if (size === ring.length) { head = (head + 1) % ring.length; size--; stats.inputDroppedSamples++; }
      ring[(head + size) % ring.length] = sample; size++;
    }
    stats.inputFrames++;
    try { pump.run(); } catch (e) { error(e); }
  }
  function allocateBytes(self, length) {
    let array = pointer(self + 24);
    if (!array || pointer(array + 12) < length) {
      module.asm.PeakProbe_MetadataInit(10434004);
      array = module.asm.PeakProbe_NewArray(pointer(10434004), Math.max(4000, length));
      write(self + 24, array); // Managed owner roots the temporary buffer.
    }
    return array;
  }
  function newEncoder(self, bitrate) {
    closeEncoder(self);
    const rate = pointer(self + 16), channels = pointer(self + 20);
    const entry = { timestamp: 0, closed: false, bitrate: bitrate > 0 ? bitrate : 24000 };
    entry.codec = new AudioEncoder({ output(chunk) {
      if (entry.closed || encoders.get(self) !== entry || !admitted()) return;
      try {
        const array = allocateBytes(self, chunk.byteLength);
        chunk.copyTo(module.HEAPU8.subarray(array + 16, array + 16 + chunk.byteLength));
        module.asm.PeakVoice_Encoded(self, array + 16, chunk.byteLength, 0);
        if (!stats.firstEncodedAtWallMs) stats.firstEncodedAtWallMs = wallNow();
        stats.encodedFrames++;
        pump.run({ flushOnly: true });
      } catch (e) { error(e); }
    }, error });
    entry.codec.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: channels,
      bitrate: bitrate > 0 ? bitrate : 24000 });
    encoders.set(self, entry); stats.encodersCreated++;
    console.log('[PeakVoice] Opus encoder: ' + rate + ' Hz / ' + channels);
  }
  function closeEncoder(self) {
    const entry = encoders.get(self);
    if (entry) { entry.closed = true; try { if (entry.codec.state !== 'closed') entry.codec.close(); } catch {} encoders.delete(self); }
  }
  function encode(self, array, shorts) {
    const entry = encoders.get(self);
    if (!entry || !array || !admitted() || entry.codec.state !== 'configured') return;
    if (entry.codec.encodeQueueSize > 4) { stats.encoderQueueDrops++; return; }
    const count = pointer(array + 12), channels = pointer(self + 20), rate = pointer(self + 16);
    if (count < 1 || count > 11520 || !channels) return;
    const pcm = shorts
      ? Float32Array.from(module.HEAP16.subarray((array + 16) >>> 1, ((array + 16) >>> 1) + count), x => x / 32768)
      : module.HEAPF32.slice((array + 16) >>> 2, ((array + 16) >>> 2) + count);
    const data = new AudioData({ format: 'f32', sampleRate: rate, numberOfChannels: channels,
      numberOfFrames: count / channels, timestamp: entry.timestamp, data: pcm });
    try { entry.codec.encode(data); entry.timestamp += count / channels / rate * 1000000; }
    finally { data.close(); }
  }
  function closeDecoder(self) {
    const entry = decoders.get(self);
    if (entry) { entry.closed = true; entry.pending.length = 0; entry.codec.ondequeue = null;
      try { if (entry.codec.state !== 'closed') entry.codec.close(); } catch {} decoders.delete(self); }
  }
  function pumpDecoder(entry) {
    if (entry.closed || entry.codec.state !== 'configured') return;
    try {
      while (entry.pending.length && entry.codec.decodeQueueSize < 4)
        entry.codec.decode(entry.pending.shift());
    } catch (e) { error(e); }
  }
  function newDecoder(self, methodInfo) {
    closeDecoder(self);
    const entry = { timestamp: 0, methodInfo, closed: false, channels: pointer(self + 28),
      rate: 48000, isFloat: !!module.HEAPU8[self + 12], pending: [] };
    entry.codec = new AudioDecoder({ output(data) {
      try {
        if (entry.closed || decoders.get(self) !== entry) return;
        const channels = data.numberOfChannels, count = data.numberOfFrames * channels;
        const pcm = new Float32Array(count);
        if (channels === 1) data.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
        else {
          for (let c = 0; c < channels; c++) {
            const plane = new Float32Array(data.numberOfFrames); data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
            for (let i = 0; i < plane.length; i++) pcm[i * channels + c] = plane[i];
          }
        }
        let array = pointer(self + 36);
        if (!array) throw new Error('El decoder nativo no tiene buffer de salida.');
        if (pointer(array + 12) !== count) { array = module.asm.PeakProbe_NewArray(pointer(array), count); write(self + 36, array); }
        if (entry.isFloat) module.HEAPF32.set(pcm, (array + 16) >>> 2);
        else module.HEAP16.set(Int16Array.from(pcm, x => Math.max(-32768, Math.min(32767, Math.round(x * 32767)))), (array + 16) >>> 1);
        module.asm.PeakVoice_Decoded(self, array, 0, methodInfo);
        if (!stats.firstDecodedAtWallMs) stats.firstDecodedAtWallMs = wallNow();
        stats.decodedFrames++; stats.decodedSamples += count;
        stats.decodedPeak = Math.max(stats.decodedPeak, ...pcm.map(Math.abs));
      } catch (e) { error(e); } finally { data.close(); }
    }, error });
    entry.codec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: entry.channels });
    entry.codec.ondequeue = () => pumpDecoder(entry);
    decoders.set(self, entry); stats.decodersCreated++;
    console.log('[PeakVoice] Opus decoder conectado al Speaker nativo.');
  }
  function decode(self, frame) {
    const entry = decoders.get(self);
    if (!entry || entry.closed || entry.codec.state !== 'configured') return;
    const array = pointer(frame), offset = pointer(frame + 4), count = pointer(frame + 8);
    if (!array || count < 1 || count > 8192 || offset + count > pointer(array + 12)) return;
    const bytes = module.HEAPU8.slice(array + 16 + offset, array + 16 + offset + count);
    // Service can deliver many ordered Photon frames in one game update. A small
    // WebCodecs queue is backpressure, not a reason to discard received speech.
    if (entry.pending.length >= 100) { entry.pending.shift(); stats.decoderQueueDrops++; }
    entry.pending.push(new EncodedAudioChunk({ type: 'key', timestamp: entry.timestamp, data: bytes }));
    entry.timestamp += 20000; stats.receivedPackets++;
    if (!stats.firstPacketAtWallMs) stats.firstPacketAtWallMs = wallNow();
    stats.maxDecoderBacklog = Math.max(stats.maxDecoderBacklog, entry.pending.length);
    pumpDecoder(entry);
  }
  function native(mod, command, a, b) {
    module = mod;
    try {
      switch (command) {
        case 23: pump.register(a); break;
        case 24: pump.unregister(a); break;
        case 3: {
          if (!admitted() || !b) return 0;
          const count = pointer(b + 12);
          if (count > size || count < 1 || count > ring.length) return 0;
          const dest = (b + 16) >>> 2;
          for (let i = 0; i < count; i++) module.HEAPF32[dest + i] = ring[(head + i) % ring.length];
          head = (head + count) % ring.length; size -= count; stats.nativeReads++; return 1;
        }
        case 4: newEncoder(a, b); break;
        case 5: encode(a, b, false); break;
        case 6: encode(a, b, true); break;
        case 7: closeEncoder(a); break;
        case 8: newDecoder(a, b); break;
        case 9: decode(a, b); break;
        case 10: closeDecoder(a); break;
        case 12:
          recorders.add(a); write(a + 60, 48000); write(a + 64, 20000); write(a + 68, 24000);
          write(a + 76, 0); module.HEAPU8[a + 109] = 0; // polling reader, not OnAudioFilterRead
          break;
        case 15: {
          speakers.add(a); stats.speakerFrames++;
          const audioOutput = pointer(a + 20), array = b ? pointer(b + 8) : 0;
          const count = array ? pointer(array + 12) : 0;
          if (audioOutput && count > 0 && count <= 11520)
            output.push(audioOutput, module.HEAPF32.slice((array + 16) >>> 2, ((array + 16) >>> 2) + count));
          break;
        }
        case 16: stats.outputWrites++; break;
        case 17: speakers.delete(a); break;
        case 19: output.pending = a; break;
        case 20: output.pending = 0; break;
        case 21: output.stop(a); break;
        case 22: {
          if (mode === 'game' && !testing) return 0;
          const recorder = pointer(a + 60);
          if (recorder) {
            const transmit = !!admitted();
            if (!!module.HEAPU8[recorder + 59] !== transmit)
              module.asm.__indirect_function_table.get(41736)(recorder, transmit ? 1 : 0, 0);
          }
          module.HEAPU8[a + 72] = 1; // reapply the game's setting when returning to game mode
          return 1;
        }
      }
    } catch (e) { error(e); }
    return 0;
  }
  async function stop(text = 'Micrófono apagado.') {
    generation++; enabled = pending = held = testing = false; head = size = 0; ring.fill(0); stats.inputRms = 0;
    // A fresh encoder instance prevents delayed packets from a previous capture
    // being delivered after the user starts a new one on the same native voice.
    for (const [self, entry] of [...encoders]) {
      try { newEncoder(self, entry.bitrate); } catch (e) { error(e); }
    }
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    try { oscillator?.stop(); } catch {} oscillator = null;
    source?.disconnect(); worklet?.disconnect(); source = worklet = null;
    const old = context; context = null;
    if (old && old.state !== 'closed') await old.close().catch(() => {});
    message = text; paint();
  }
  async function start(tone = false) {
    await stop(); const token = ++generation; pending = true; message = tone ? 'Preparando tono…' : 'Esperando permiso del micrófono…'; paint();
    try {
      context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }); await context.resume();
      await output.resume();
      if (!tone) {
        const constraints = { channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        if (deviceId) constraints.deviceId = { exact: deviceId };
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
        if (token !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
        stream = acquired; stream.getAudioTracks()[0].addEventListener('ended', () => { if (token === generation) stop('El micrófono se desconectó.'); });
        await devices();
      }
      if (token !== generation || !context) return;
      await context.audioWorklet.addModule(new URL('mic-worklet.js', assetBase).href);
      if (token !== generation || !context) return;
      worklet = new AudioWorkletNode(context, 'peak-mic-frames');
      worklet.port.onmessage = e => { if (token === generation) enqueue(new Float32Array(e.data)); };
      worklet.connect(context.destination); // zero output: do not play the local microphone
      if (tone) {
        oscillator = context.createOscillator(); oscillator.frequency.value = 440;
        const gain = context.createGain(); gain.gain.value = .08; oscillator.connect(gain); source = gain;
        source.connect(worklet); stats.testSignalStartWallMs = wallNow(); oscillator.start();
        setTimeout(() => { if (token === generation) stop('Tono terminado. Micrófono apagado.'); }, 6000);
      } else { source = context.createMediaStreamSource(stream); source.connect(worklet); }
      testing = tone; enabled = true; pending = false;
      message = tone ? 'Enviando tono por la voz del juego…' : 'Micrófono activo.'; paint();
    } catch (e) {
      if (token !== generation) return;
      await stop(e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Revisa el permiso de esta página.' : 'No se pudo activar el micrófono: ' + e.message);
      error(e);
    }
  }
  async function devices() {
    if (!navigator.mediaDevices?.enumerateDevices || !el('peak-voice-device')) return;
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const select = el('peak-voice-device'); select.replaceChildren(new Option('Predeterminado del sistema', ''));
    for (const input of inputs) if (input.deviceId && input.deviceId !== 'default') select.append(new Option(input.label || 'Micrófono', input.deviceId));
    select.value = deviceId;
  }
  function snapshot() {
    const playback = [];
    if (module) for (const speaker of speakers) {
      try {
        const output = pointer(speaker + 20), audioSource = output ? pointer(output + 124) : 0;
        if (!audioSource) continue;
        const call = (i, ...args) => module.asm.__indirect_function_table.get(i)(...args);
        const playing = !!call(62096, audioSource, 0), cursor = call(62078, audioSource, 0);
        playback.push({ playing, cursor, clip: !!pointer(output + 128), volume: call(62072, audioSource, 0), muted: !!call(62135, audioSource, 0) });
        if (playing && cursor > 0) stats.playbackObserved = true;
      } catch { speakers.delete(speaker); }
    }
    return { ...stats, ...output.measure(), ...pump.stats, fastVoiceService: pump.enabled, errors: [...stats.errors], capture: enabled, tracksLive: stream?.getTracks().filter(t => t.readyState === 'live').length || 0,
      mode, speaking: admitted(), bufferedSamples: size, activeEncoders: encoders.size, activeDecoders: decoders.size,
      playback, recorders: module ? [...recorders].map(p => ({ localVoice: !!pointer(p + 36), transmit: !!module.HEAPU8[p + 59], recording: !!module.HEAPU8[p + 85] })) : [] };
  }
  function paint() {
    if (!el('peak-voice-status')) return;
    const joined = el('peak-host')?.dataset.phase === 'joined';
    el('peak-voice-start').disabled = !supported || !joined || enabled || pending;
    el('peak-voice-stop').disabled = !enabled && !pending;
    el('peak-voice-device').disabled = enabled || pending;
    el('peak-voice-mode').disabled = pending;
    el('peak-voice-status').textContent = message + (enabled && !testing && mode === 'ptt' ? (held ? ' Hablando…' : ' Mantén V para hablar.') : '');
    const gameTransmitting = mode !== 'game' || !module || [...recorders].some(p => !!module.HEAPU8[p + 59]);
    el('peak-voice-badge').textContent = enabled ? (admitted() && gameTransmitting ? 'ACTIVO' : 'SILENCIADO') : 'APAGADO';
    el('peak-voice-level').value = Math.min(1, (stats.inputRms || 0) * 8);
    el('peak-voice-listen').hidden = !output.context || output.context.state === 'running';
    if (el('peak-voice-tone')) el('peak-voice-tone').disabled = !supported || !joined || enabled || pending;
    el('voice-native-stats').textContent = JSON.stringify(snapshot(), null, 2);
    if (!joined && (enabled || pending)) stop('Fuera de la sala. Micrófono apagado.');
  }
  window.peakVoiceBridge = { native, stop, snapshot,
    onSocketPacket(mod, peer) { module = mod; try { pump.run({ peer }); } catch (e) { error(e); } },
    bindOutput(mod, webAudio, channel) { module = mod; output.bind(webAudio, channel); } };
  window.addEventListener('pagehide', () => { generation++; stream?.getTracks().forEach(t => t.stop()); for (const p of [...encoders.keys()]) closeEncoder(p); for (const p of [...decoders.keys()]) closeDecoder(p); pump.close(); output.close(); context?.close().catch(() => {}); });
  window.addEventListener('blur', () => { held = false; head = size = 0; paint(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { held = false; head = size = 0; paint(); } });
  window.addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { held = true; paint(); } }, true);
  window.addEventListener('keyup', e => { if (e.code === 'KeyV') { held = false; head = size = 0; paint(); } }, true);
  document.addEventListener('DOMContentLoaded', async () => {
    const panel = document.createElement('section'); panel.id = 'peak-voice-panel';
    panel.innerHTML = `<style>#peak-voice-panel{border-top:1px solid #ffffff20;margin-top:16px;padding-top:13px}#peak-voice-panel label{font-size:11px;display:block;margin:9px 0 4px}#peak-voice-panel select{background:#102018;color:#e8eee5;border:1px solid #ffffff26;border-radius:7px;padding:7px;width:100%;font:12px system-ui}#peak-voice-panel p{font-size:11px;margin:8px 0}#peak-voice-badge{color:#d4ed9b;font-size:10px;float:right}#peak-voice-panel button{margin-top:9px}#peak-voice-panel pre{max-height:180px;overflow:auto;white-space:pre-wrap;font:10px/1.4 monospace}#peak-voice-panel summary{cursor:pointer;font-size:11px;margin-top:10px}</style>
      <b>Micrófono</b><span id="peak-voice-badge">APAGADO</span>
      <label for="peak-voice-device">Entrada de voz</label><select id="peak-voice-device"><option value="">Predeterminado del sistema</option></select>
      <label for="peak-voice-mode">Cómo hablar</label><select id="peak-voice-mode"><option value="game">Controles de PEAK</option><option value="ptt">Mantener V para hablar</option><option value="open">Micrófono abierto</option></select>
      <label for="peak-voice-latency">Retardo de voz</label><select id="peak-voice-latency"><option value="fast">Menor retardo</option><option value="stable">Más estabilidad</option></select>
      <button class="primary" id="peak-voice-start" disabled>Activar micrófono</button> <button class="host-secondary" id="peak-voice-stop" disabled>Apagar</button>
      <meter id="peak-voice-level" min="0" max="1" value="0" aria-label="Nivel de entrada del micrófono" style="display:block;width:100%;margin-top:8px"></meter>
      <button class="host-secondary" id="peak-voice-listen" hidden>Activar sonido</button>
      <p id="peak-voice-status" role="status"></p><details><summary>Diagnóstico de voz</summary><pre id="voice-native-stats"></pre></details>`;
    el('host-body').insertBefore(panel, document.querySelector('.host-server-info'));
    el('peak-voice-start').onclick = () => start(false); el('peak-voice-stop').onclick = () => stop();
    el('peak-voice-listen').onclick = () => output.resume().catch(error);
    el('peak-voice-device').onchange = e => { deviceId = e.target.value; };
    el('peak-voice-mode').onchange = e => { mode = e.target.value; held = false; head = size = 0; paint(); };
    el('peak-voice-latency').onchange = e => { output.setProfile(e.target.value); paint(); };
    if (voiceTest) {
      const button = document.createElement('button'); button.id = 'peak-voice-tone'; button.className = 'host-secondary'; button.textContent = 'Enviar tono de prueba (6 s)'; button.onclick = () => start(true); panel.append(button);
      const reset = document.createElement('button'); reset.id = 'peak-voice-reset'; reset.className = 'host-secondary'; reset.textContent = 'Reiniciar medición de voz';
      reset.onclick = () => {
        for (const key of Object.keys(stats)) if (key !== 'errors') stats[key] = typeof stats[key] === 'boolean' ? false : 0;
        stats.errors = []; output.resetDiagnostics(); for (const key of Object.keys(pump.stats)) pump.stats[key] = 0;
        output.resume().catch(error); paint();
      }; panel.append(reset);
      const legacy = document.createElement('label'); legacy.innerHTML = '<input type="checkbox" id="peak-voice-legacy"> Comparar ciclo anterior (solo prueba)';
      panel.append(legacy); el('peak-voice-legacy').onchange = e => {
        pump.enabled = !e.target.checked; const profile = e.target.checked ? 'stable' : 'fast';
        el('peak-voice-latency').value = profile; output.setProfile(profile); paint();
      };
    }
    try {
      supported = isSecureContext && typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && typeof AudioWorkletNode === 'function';
      if (supported) supported = (await AudioEncoder.isConfigSupported({ codec:'opus', sampleRate:48000, numberOfChannels:1, bitrate:24000 })).supported && (await AudioDecoder.isConfigSupported({ codec:'opus', sampleRate:48000, numberOfChannels:1 })).supported;
      message = supported ? 'Actívalo al entrar en una sala. El navegador pedirá permiso.' : 'La voz necesita HTTPS y un navegador con WebCodecs Opus.';
      await devices();
    } catch (e) { error(e); }
    setInterval(paint, 500); paint();
  });
})();
