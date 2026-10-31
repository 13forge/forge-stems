import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initSync, stem_split_four } from "@wasm/forge_audio_wasm_v3.js";
import { RemixController } from "../src/state/controller.js";
import {
  hasStemSplitFour,
  musicOnlyQuartet,
  quartetHasAudio,
  unpackStemSplitFour,
} from "../src/audio/stem-split.js";

describe("stem_split_four unpack", () => {
  it("copies the four parts and zeroes the packed buffer", () => {
    const pcm = new Float32Array([1, 2, 3, 4]);
    const n = pcm.length;
    const packed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      packed[i] = pcm[i];
      packed[n + i] = pcm[i] + 1;
      packed[n * 2 + i] = pcm[i] + 2;
      packed[n * 3 + i] = pcm[i] + 3;
    }
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

  it("runs the vendored stem_split_four and zeroes the packed buffer", () => {
    expect(hasStemSplitFour({})).toBe(false);
    const bytes = readFileSync(
      fileURLToPath(new URL("../vendor/forge-audio-wasm-v3/forge_audio_wasm_v3_bg.wasm", import.meta.url)),
    );
    initSync({ module: bytes });
    expect(typeof stem_split_four).toBe("function");
    const pcm = new Float32Array(4_800);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 8) * 0.25;
    const packed = stem_split_four(pcm, 48_000);
    expect(packed.length).toBe(pcm.length * 4);
    const parts = unpackStemSplitFour(packed);
    expect(packed.every((sample) => sample === 0)).toBe(true);
    const ctrl = new RemixController();
    ctrl.decks[0].stems[0] = parts.drums;
    ctrl.decks[0].stems[1] = parts.bass;
    ctrl.decks[0].stems[2] = parts.voice;
    ctrl.decks[0].stems[3] = parts.music;
    expect(ctrl.decks[0].stems.every((stem) => stem && stem.length === pcm.length)).toBe(true);
    const energy = (buf: Float32Array) => buf.reduce((sum, sample) => sum + sample * sample, 0);
    expect(energy(parts.drums) + energy(parts.bass) + energy(parts.voice) + energy(parts.music)).toBeGreaterThan(0);
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
