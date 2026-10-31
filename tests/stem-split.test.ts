import { describe, expect, it } from "vitest";
import { RemixController } from "../src/state/controller.js";
import {
  hasStemSplitFour,
  musicOnlyQuartet,
  quartetHasAudio,
  unpackStemSplitFour,
  type StemSplitFour,
} from "../src/audio/stem-split.js";

function mockSplit(signal: Float32Array): Float32Array {
  const n = signal.length;
  const packed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    packed[i] = signal[i];
    packed[n + i] = signal[i] + 1;
    packed[n * 2 + i] = signal[i] + 2;
    packed[n * 3 + i] = signal[i] + 3;
  }
  return packed;
}

describe("stem_split_four unpack", () => {
  it("copies the four parts and zeroes the packed buffer", () => {
    const pcm = new Float32Array([1, 2, 3, 4]);
    const packed = mockSplit(pcm);
    const parts = unpackStemSplitFour(packed);
    expect(Array.from(packed)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(parts.drums)).toEqual([1, 2, 3, 4]);
    expect(Array.from(parts.bass)).toEqual([2, 3, 4, 5]);
    expect(Array.from(parts.voice)).toEqual([3, 4, 5, 6]);
    expect(Array.from(parts.music)).toEqual([4, 5, 6, 7]);
    parts.drums[0] = 9;
    expect(packed[0]).toBe(0);
  });

  it("zeroes an empty packed buffer and returns empty parts", () => {
    const packed = new Float32Array(0);
    const parts = unpackStemSplitFour(packed);
    expect(packed.length).toBe(0);
    expect(quartetHasAudio(parts)).toBe(false);
    expect(parts.music.length).toBe(0);
  });

  it("feature-detects stem_split_four and a mocked split fills all 4 stems", () => {
    expect(hasStemSplitFour({})).toBe(false);
    expect(hasStemSplitFour({ stem_split_four: () => new Float32Array() })).toBe(true);
    const pcm = new Float32Array([0.25, 0.5]);
    const split: StemSplitFour = (signal) => mockSplit(signal);
    const packed = split(pcm, 48_000);
    const parts = unpackStemSplitFour(packed);
    expect(packed.every((sample) => sample === 0)).toBe(true);
    const ctrl = new RemixController();
    ctrl.decks[0].stems[0] = parts.drums;
    ctrl.decks[0].stems[1] = parts.bass;
    ctrl.decks[0].stems[2] = parts.voice;
    ctrl.decks[0].stems[3] = parts.music;
    expect(ctrl.decks[0].stems.map((stem) => stem?.length)).toEqual([2, 2, 2, 2]);
    expect(ctrl.decks[0].stems[0]?.[0]).toBeCloseTo(0.25);
    expect(ctrl.decks[0].stems[3]?.[1]).toBeCloseTo(3.5);
  });

  it("falls back to Music only when the export is missing", () => {
    const pcm = new Float32Array([4, -4]);
    const parts = musicOnlyQuartet(pcm);
    expect(parts.drums.length).toBe(0);
    expect(parts.bass.length).toBe(0);
    expect(parts.voice.length).toBe(0);
    expect(Array.from(parts.music)).toEqual([4, -4]);
    pcm[0] = 0;
    expect(parts.music[0]).toBe(4);
  });
});
