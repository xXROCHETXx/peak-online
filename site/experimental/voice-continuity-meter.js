// Test-only observer: measure gaps on the audio thread, independently of FPS.
class PeakVoiceContinuityMeter extends AudioWorkletProcessor {
  constructor() {
    super(); this.reset(); this.port.onmessage = e => { if (e.data?.type === 'reset') this.reset(); };
  }
  reset() {
    this.active = false; this.pending = 0; this.ticks = 0;
    this.stats = { signalSamples: 0, internalSilentSamples: 0, gaps: 0, longestGapSamples: 0 };
  }
  process(inputs) {
    const channels = inputs[0], length = channels?.[0]?.length || 128;
    let energy = 0;
    if (channels?.length) for (let i = 0; i < length; i++) {
      let x = 0; for (const channel of channels) x += channel[i] / channels.length;
      energy += x * x;
    }
    if (Math.sqrt(energy / length) > .002) {
      if (this.active && this.pending) {
        this.stats.gaps++; this.stats.internalSilentSamples += this.pending;
        this.stats.longestGapSamples = Math.max(this.stats.longestGapSamples, this.pending);
      }
      this.active = true; this.pending = 0; this.stats.signalSamples += length;
    } else if (this.active) this.pending += length;
    if (++this.ticks % 40 === 0) this.port.postMessage({ ...this.stats, sampleRate });
    return true;
  }
}
registerProcessor('peak-voice-continuity-meter', PeakVoiceContinuityMeter);
