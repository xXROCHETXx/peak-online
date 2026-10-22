/* Stream fresh PCM buffers into Unity's own channel/panner/gain graph. */
(() => {
  'use strict';
  class PeakVoiceOutput {
    constructor({ meterModule = null, trace = false, profile = 'fast' } = {}) { this.outputs = new Map(); this.pending = 0; this.context = null;
      this.meterModule = meterModule; this.trace = trace ? [] : null;
      this.profile = profile; this.baseReserve = profile === 'stable' ? .32 : .12;
      this.stats = { scheduledFrames: 0, renderedPeakRms: 0, outputSuspended: false,
        outputUnderruns: 0, outputGapMs: 0, droppedOutputFrames: 0, maxArrivalGapMs: 0 }; }
    entry(id) {
      if (!this.outputs.has(id)) this.outputs.set(id, { queue: [], sources: new Set(), next: 0,
        channel: null, reserve: this.baseReserve, lastArrival: null });
      return this.outputs.get(id);
    }
    bind(webAudio, channelId) {
      if (!this.pending || !webAudio.audioContext) return;
      const channel = webAudio.audioInstances[channelId];
      if (!channel?.gain) return;
      this.context = webAudio.audioContext;
      const entry = this.entry(this.pending);
      try { if (entry.analyser && entry.channel) entry.channel.gain.disconnect(entry.analyser); } catch {}
      try { if (entry.meter && entry.channel) entry.channel.gain.disconnect(entry.meter); } catch {}
      entry.channel = channel; entry.sourceReference = channel.source;
      entry.analyser?.disconnect(); entry.silent?.disconnect();
      entry.analyser = this.context.createAnalyser(); entry.analyser.fftSize = 1024;
      entry.silent = this.context.createGain(); entry.silent.gain.value = 0;
      // Observe samples after Unity's volume/panning, keeping the normal output.
      channel.gain.connect(entry.analyser); entry.analyser.connect(entry.silent); entry.silent.connect(this.context.destination);
      if (entry.meter) { entry.meter.disconnect(); channel.gain.connect(entry.meter); entry.meter.connect(entry.silent); }
      else if (this.meterModule) this.attachMeter(entry);
      const queued = entry.queue.splice(0); queued.forEach(pcm => this.schedule(entry, pcm));
    }
    async attachMeter(entry) {
      try {
        this.meterReady ||= this.context.audioWorklet.addModule(this.meterModule);
        await this.meterReady;
        if (![...this.outputs.values()].includes(entry) || entry.meter) return;
        entry.meter = new AudioWorkletNode(this.context, 'peak-voice-continuity-meter');
        entry.meter.port.onmessage = e => { entry.continuity = e.data; };
        entry.channel.gain.connect(entry.meter); entry.meter.connect(entry.silent);
      } catch (e) { this.stats.meterError = String(e); }
    }
    push(id, pcm) {
      const entry = this.entry(id);
      if (!entry.channel) { entry.queue.push(pcm); if (entry.queue.length > 8) entry.queue.shift(); return; }
      this.schedule(entry, pcm);
    }
    schedule(entry, pcm) {
      const ctx = this.context;
      if (!ctx || ctx.state !== 'running') { this.stats.outputSuspended = true; return; }
      this.stats.outputSuspended = false;
      const now = ctx.currentTime;
      const trace = this.trace ? [now, entry.next, pcm.length, 0] : null;
      const arrivalGap = entry.lastArrival === null ? 0 : now - entry.lastArrival;
      entry.lastArrival = now;
      this.stats.maxArrivalGapMs = Math.max(this.stats.maxArrivalGapMs, arrivalGap * 1000);
      // Photon Service and decoder callbacks arrive in batches on the game thread.
      // Keep a playout reserve instead of starting each late packet 40 ms away.
      // After a longer pause, treat the next frame as a new talk spurt.
      if (!entry.next || now - entry.next > .75) {
        entry.reserve = this.baseReserve; entry.next = now + entry.reserve;
      } else if (entry.next < now) {
        this.stats.outputUnderruns++;
        this.stats.outputGapMs += Math.max(0, now - entry.next) * 1000;
        entry.reserve = Math.min(.48, entry.reserve + .04);
        entry.next = now + entry.reserve;
      }
      // Bound latency during bursts without turning a normal 100–200 ms batch
      // into repeated discarded blocks of speech.
      if (entry.next > now + 1) {
        this.stats.droppedOutputFrames++; if (trace) { trace[3] = -1; this.trace.push(trace); } return;
      }
      const buffer = ctx.createBuffer(1, pcm.length, 48000); buffer.copyToChannel(pcm, 0);
      const source = ctx.createBufferSource(); source.buffer = buffer;
      const channel = entry.channel;
      if (channel.spatialBlendLevel > 0) {
        source.connect(channel.spatialBlendDryGain); source.connect(channel.spatialBlendWetGain);
      } else source.connect(channel.gain);
      const when = entry.next; entry.next += pcm.length / 48000;
      if (!this.stats.firstOutputAtWallMs)
        this.stats.firstOutputAtWallMs = performance.timeOrigin + performance.now() + (when - now) * 1000;
      if (trace) { trace[3] = when; this.trace.push(trace); if (this.trace.length > 400) this.trace.shift(); }
      entry.sources.add(source); source.onended = () => { source.disconnect(); entry.sources.delete(source); };
      source.start(when); this.stats.scheduledFrames++;
    }
    measure() {
      for (const [id, entry] of this.outputs) if (entry.analyser) {
        if (entry.channel.source !== entry.sourceReference) {
          // Unity reconnects its graph when resuming a previously suspended clip.
          entry.sourceReference = entry.channel.source;
          try { entry.channel.gain.disconnect(entry.analyser); } catch {}
          entry.channel.gain.connect(entry.analyser);
          if (entry.meter) entry.channel.gain.connect(entry.meter);
        }
        const values = new Float32Array(entry.analyser.fftSize); entry.analyser.getFloatTimeDomainData(values);
        const rms = Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length);
        this.stats.renderedPeakRms = Math.max(this.stats.renderedPeakRms, rms);
        const buffer = entry.channel.source?.buffer;
        if (buffer?.getChannelData) {
          const loop = buffer.getChannelData(0);
          const loopRms = Math.sqrt(loop.reduce((sum, x) => sum + x * x, 0) / loop.length);
          this.stats.nativeLoopPeakRms = Math.max(this.stats.nativeLoopPeakRms || 0, loopRms);
        }
      }
      this.stats.outputSuspended = !!this.context && this.context.state !== 'running';
      return { ...this.stats, audioContextState: this.context?.state || 'not-bound', outputChannels: this.outputs.size,
        playoutReserveMs: Math.max(0, ...[...this.outputs.values()].map(e => e.reserve * 1000)),
        voiceLatencyProfile: this.profile,
        outputBaseLatencyMs: (this.context?.baseLatency || 0) * 1000,
        outputDeviceLatencyMs: (this.context?.outputLatency || 0) * 1000,
        ...(this.trace ? { timingTrace: this.trace } : {}),
        ...(this.meterModule ? { continuity: [...this.outputs.values()].map(e => e.continuity || null) } : {}) };
    }
    async resume() { if (this.context?.state === 'suspended') await this.context.resume(); }
    setProfile(profile) {
      this.profile = profile === 'stable' ? 'stable' : 'fast'; this.baseReserve = this.profile === 'stable' ? .32 : .12;
      for (const entry of this.outputs.values()) if (!entry.sources.size) { entry.next = 0; entry.reserve = this.baseReserve; }
    }
    resetDiagnostics() {
      for (const key of Object.keys(this.stats)) this.stats[key] = typeof this.stats[key] === 'boolean' ? false : 0;
      if (this.trace) this.trace.length = 0;
      for (const entry of this.outputs.values()) {
        entry.meter?.port.postMessage({ type: 'reset' }); entry.continuity = null;
        entry.lastArrival = null;
        if (!entry.sources.size) { entry.next = 0; entry.reserve = this.baseReserve; }
      }
    }
    stop(id) {
      const entry = this.outputs.get(id); if (!entry) return;
      entry.sources.forEach(s => { s.onended = null; try { s.stop(); } catch {} s.disconnect(); });
      try { if (entry.analyser && entry.channel) entry.channel.gain.disconnect(entry.analyser); } catch {}
      try { if (entry.meter && entry.channel) entry.channel.gain.disconnect(entry.meter); } catch {}
      if (entry.meter) { entry.meter.port.onmessage = null; entry.meter.port.close(); entry.meter.disconnect(); }
      entry.analyser?.disconnect(); entry.silent?.disconnect(); this.outputs.delete(id);
    }
    close() { for (const id of [...this.outputs.keys()]) this.stop(id); this.pending = 0; }
  }
  if (typeof module === 'object' && module.exports) module.exports = PeakVoiceOutput;
  else window.PeakVoiceOutput = PeakVoiceOutput;
})();
