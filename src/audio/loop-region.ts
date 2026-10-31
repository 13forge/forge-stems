/** Musical loop length in sample frames. 4/4: one bar is 4 beats. */

export const DEFAULT_LOOP_BARS = 4;
export const DEFAULT_BPM_CBPM = 12_000;
export const BEATS_PER_BAR = 4;
export const LOOP_BAR_CHOICES = [1, 2, 4, 8] as const;
export type LoopBars = (typeof LOOP_BAR_CHOICES)[number];

export function isLoopBars(value: number): value is LoopBars {
  return value === 1 || value === 2 || value === 4 || value === 8;
}

/**
 * Frames for `bars` at `bpmCbpm` (centi-BPM, 12000 = 120.00).
 * Unknown or non-positive pace falls back to 120 BPM, so 4 bars is 8 seconds.
 * Units are sample frames, never milliseconds or permyriad.
 */
export function loopLengthFrames(bars: number, bpmCbpm: number, sampleRate: number): number {
  const safeBars = isLoopBars(bars) ? bars : DEFAULT_LOOP_BARS;
  const bpm = Number.isFinite(bpmCbpm) && bpmCbpm > 0 ? bpmCbpm / 100 : DEFAULT_BPM_CBPM / 100;
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48_000;
  const seconds = (safeBars * BEATS_PER_BAR * 60) / bpm;
  return Math.max(64, Math.round(seconds * rate));
}

/** One bar (4 beats). At 120 BPM this is 2 seconds. */
export function oneBarFrames(bpmCbpm: number, sampleRate: number): number {
  return loopLengthFrames(1, bpmCbpm, sampleRate);
}

export const LOOP_MIN_FRAMES = 1_200;

export function beatsInLoop(lengthFrames: number, bpmCbpm: number, sampleRate: number): number {
  const bpm = Number.isFinite(bpmCbpm) && bpmCbpm > 0 ? bpmCbpm / 100 : DEFAULT_BPM_CBPM / 100;
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48_000;
  const framesPerBeat = (rate * 60) / bpm;
  if (framesPerBeat <= 0 || !Number.isFinite(lengthFrames) || lengthFrames <= 0) return 0;
  return lengthFrames / framesPerBeat;
}

/** Example: `Repeat (4 beats)` for one bar at the current pace. */
export function repeatLabel(lengthFrames: number, bpmCbpm: number, sampleRate: number): string {
  const beats = beatsInLoop(lengthFrames, bpmCbpm, sampleRate);
  const rounded = Math.round(beats * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  const unit = rounded === 1 ? "beat" : "beats";
  return `Repeat (${text} ${unit})`;
}

/**
 * Halve (floor, at least 1200 frames) or double (at most the track, when the track is non-empty).
 * A non-positive length is initialized to 1 bar first, never 0.
 */
export function nextLoopLength(
  length: number,
  direction: -1 | 1,
  trackFrames: number,
  bpmCbpm: number,
  sampleRate: number,
): number {
  let len = length > 0 ? length : oneBarFrames(bpmCbpm, sampleRate);
  len = direction < 0 ? Math.floor(len / 2) : len * 2;
  const min = trackFrames > 0 ? Math.min(LOOP_MIN_FRAMES, trackFrames) : LOOP_MIN_FRAMES;
  if (len < min) len = min;
  if (trackFrames > 0 && len > trackFrames) len = trackFrames;
  if (len < 1) len = min;
  return len;
}

/** Anchor a loop on the current playhead. Length stays musical even past the file. */
export function loopRegionAtPlayhead(args: {
  bars: number;
  bpmCbpm: number;
  sampleRate: number;
  playhead: number;
  trackFrames: number;
}): { start_frame: number; end_frame: number; bars: LoopBars } {
  const bars: LoopBars = isLoopBars(args.bars) ? args.bars : DEFAULT_LOOP_BARS;
  const length = loopLengthFrames(bars, args.bpmCbpm, args.sampleRate);
  let start = Number.isFinite(args.playhead) ? Math.max(0, Math.floor(args.playhead)) : 0;
  if (args.trackFrames > 0 && start >= args.trackFrames) {
    start = Math.max(0, args.trackFrames - 1);
  }
  return { start_frame: start >>> 0, end_frame: (start + length) >>> 0, bars };
}
