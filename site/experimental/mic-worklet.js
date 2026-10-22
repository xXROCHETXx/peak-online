class PeakMicFrames extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Float32Array(960); this.offset = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (channels?.length) {
      const samples = channels[0].length;
      for (let i = 0; i < samples; i++) {
        let sample = 0;
        for (const channel of channels) sample += channel[i] / channels.length;
        this.frame[this.offset++] = sample;
        if (this.offset === this.frame.length) {
          this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
          this.frame = new Float32Array(960); this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('peak-mic-frames', PeakMicFrames);
