/** Musical effects on the master bus. The wasm engine has no tempo, resonance, or hold-to-tail. */

export type EchoDivision = "1/8" | "1/4" | "1/2" | "1";

const DIVISION_BEATS: Record<EchoDivision, number> = {
  "1/8": 0.5,
  "1/4": 1,
  "1/2": 2,
  "1": 1,
};

function softClipCurve(): Float32Array {
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const shaped = Math.tanh(x * 1.15);
    curve[i] = Math.abs(x) < 1e-4 ? 0 : shaped;
  }
  return curve;
}

function ramp(param: AudioParam, value: number, seconds: number, ctx: AudioContext): void {
  const now = ctx.currentTime;
  const safe = Number.isFinite(value) ? value : 0;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(safe, now, Math.max(0.008, seconds));
}

export interface MixCapture {
  rms: number;
  peak: number;
  nan: boolean;
  time: Float32Array;
  freq: Float32Array;
}

/**
 * Post-worklet rack: resonant peak, tempo-synced echo, a small reverb, and a soft clip.
 * Dry audio stays in the chain when every effect is off.
 */
export class PerformanceFx {
  readonly input: GainNode;
  readonly output: AnalyserNode;
  private readonly ctx: AudioContext;
  private readonly peak: BiquadFilterNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly echoWet: GainNode;
  private readonly reverbWet: GainNode;
  private bpm = 120;
  private division: EchoDivision = "1/4";
  private echoOn = false;
  private echoAmount = 0.55;
  private reverbAmount = 0.4;
  private filterOn = false;
  private filterPmy = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.peak = ctx.createBiquadFilter();
    this.peak.type = "peaking";
    this.peak.frequency.value = 1000;
    this.peak.Q.value = 0.7;
    this.peak.gain.value = 0;

    const dry = ctx.createGain();
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.5;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0;

    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0;
    const reverbIn = ctx.createGain();

    const compressor = ctx.createGain();

    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve() as Float32Array<ArrayBuffer>;
    shaper.oversample = "none";

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.35;
    this.output = analyser;

    this.input.connect(this.peak);
    this.peak.connect(dry);
    dry.connect(compressor);

    this.peak.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.echoWet);
    this.echoWet.connect(compressor);

    this.peak.connect(reverbIn);
    this.buildReverb(reverbIn);
    this.reverbWet.connect(compressor);

    compressor.connect(shaper);
    shaper.connect(analyser);
    this.syncDelay(true);
  }

  connect(destination: AudioNode): void {
    this.output.connect(destination);
  }

  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) return;
    this.bpm = bpm;
    this.syncDelay(false);
  }

  setEcho(on: boolean, amountPmy: number, division: EchoDivision): void {
    this.echoOn = on;
    this.division = division;
    this.echoAmount = clamp01(amountPmy / 10_000);
    this.syncDelay(false);
    if (on) {
      ramp(this.echoWet.gain, this.echoAmount * 0.65, 0.03, this.ctx);
      ramp(this.feedback.gain, 0.28 + this.echoAmount * 0.35, 0.04, this.ctx);
    } else {
      ramp(this.echoWet.gain, 0, 0.2, this.ctx);
      ramp(this.feedback.gain, 0.15, 0.35, this.ctx);
    }
  }

  setReverb(on: boolean, amountPmy: number): void {
    this.reverbAmount = clamp01(amountPmy / 10_000);
    ramp(this.reverbWet.gain, on ? this.reverbAmount * 0.55 : 0, on ? 0.04 : 0.25, this.ctx);
  }

  /** Resonant peak that follows the engine's bipolar filter. Off = flat gain. */
  setFilter(on: boolean, pmy: number): void {
    this.filterOn = on;
    this.filterPmy = Number.isFinite(pmy) ? pmy : 0;
    const now = this.ctx.currentTime;
    if (!on || Math.abs(this.filterPmy) < 50) {
      this.peak.gain.setTargetAtTime(0, now, 0.03);
      this.peak.Q.setTargetAtTime(0.7, now, 0.03);
      return;
    }
    const hz = resonanceHz(this.filterPmy);
    const db = Math.min(9, (Math.abs(this.filterPmy) / 10_000) * 8);
    this.peak.frequency.setTargetAtTime(hz, now, 0.02);
    this.peak.gain.setTargetAtTime(db, now, 0.03);
    this.peak.Q.setTargetAtTime(0.9 + (Math.abs(this.filterPmy) / 10_000) * 3.2, now, 0.03);
  }

  /** Echo out: high feedback while held, then a decaying tail. */
  holdEchoOut(): void {
    this.syncDelay(false);
    ramp(this.echoWet.gain, 0.8, 0.02, this.ctx);
    ramp(this.feedback.gain, 0.86, 0.03, this.ctx);
  }

  releaseEchoOut(): void {
    ramp(this.feedback.gain, this.echoOn ? 0.28 + this.echoAmount * 0.35 : 0.12, 0.45, this.ctx);
    ramp(this.echoWet.gain, this.echoOn ? this.echoAmount * 0.65 : 0, 0.55, this.ctx);
  }

  /** Build-up: resonance rises and the peak sweeps down while held. */
  holdBuildup(): void {
    const now = this.ctx.currentTime;
    this.peak.frequency.setTargetAtTime(480, now, 0.08);
    this.peak.gain.setTargetAtTime(8, now, 0.08);
    this.peak.Q.setTargetAtTime(6, now, 0.08);
    ramp(this.echoWet.gain, 0.35, 0.1, this.ctx);
    ramp(this.feedback.gain, 0.55, 0.1, this.ctx);
  }

  releaseBuildup(): void {
    this.setFilter(this.filterOn, this.filterPmy);
    this.setEcho(this.echoOn, Math.round(this.echoAmount * 10_000), this.division);
  }

  capture(): MixCapture {
    const time = new Float32Array(this.output.fftSize);
    const freq = new Float32Array(this.output.frequencyBinCount);
    this.output.getFloatTimeDomainData(time);
    this.output.getFloatFrequencyData(freq);
    let sum = 0;
    let peak = 0;
    let nan = false;
    for (let i = 0; i < time.length; i++) {
      const x = time[i];
      if (!Number.isFinite(x)) {
        nan = true;
        continue;
      }
      sum += x * x;
      const mag = Math.abs(x);
      if (mag > peak) peak = mag;
    }
    return { rms: Math.sqrt(sum / time.length), peak, nan, time, freq };
  }

  private syncDelay(immediate: boolean): void {
    const beats = DIVISION_BEATS[this.division];
    const seconds = Math.min(1.9, Math.max(0.02, (beats * 60) / this.bpm));
    if (immediate) this.delay.delayTime.value = seconds;
    else ramp(this.delay.delayTime, seconds, 0.03, this.ctx);
  }

  private buildReverb(source: GainNode): void {
    const combs = [1557, 1617, 1491, 1422].map((samples) => {
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = samples / 44_100;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.78;
      const into = this.ctx.createGain();
      into.gain.value = 0.25;
      source.connect(into);
      into.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      return delay;
    });
    const mix = this.ctx.createGain();
    for (const comb of combs) comb.connect(mix);
    let node: AudioNode = mix;
    for (const samples of [225, 556]) {
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = samples / 44_100;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.5;
      const fwd = this.ctx.createGain();
      fwd.gain.value = -0.5;
      node.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      node.connect(fwd);
      const sum = this.ctx.createGain();
      delay.connect(sum);
      fwd.connect(sum);
      node = sum;
    }
    node.connect(this.reverbWet);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function resonanceHz(pmy: number): number {
  const t = Math.max(-1, Math.min(1, pmy / 10_000));
  if (t < 0) return 180 * Math.pow(40, t + 1);
  return 500 * Math.pow(16, t);
}
