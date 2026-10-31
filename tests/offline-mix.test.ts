import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderMixPcm } from "../src/audio/offline-mix.js";
import { STEM_GAIN_UNITY_PMY, UNIT_PMY, type OfflineDeckSpec } from "../src/audio/types.js";
import { initSync } from "@wasm/forge_audio_wasm_v3.js";

const sampleRate = 48_000;
const seconds = 0.25;

function tone(freq: number): Float32Array {
  const frames = Math.floor(sampleRate * seconds);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.25;
  }
  return out;
}

function silence(frames: number): Float32Array {
  return new Float32Array(frames);
}

function deck(active: Float32Array | null, slot: 0 | 1 | 2 | 3, playing: boolean): OfflineDeckSpec {
  const frames = active?.length ?? 0;
  const stems = [silence(frames), silence(frames), silence(frames), silence(frames)];
  if (active) stems[slot] = active;
  return {
    drums: stems[0],
    bass: stems[1],
    vocal: stems[2],
    other: stems[3],
    gain_pmy: [STEM_GAIN_UNITY_PMY, STEM_GAIN_UNITY_PMY, STEM_GAIN_UNITY_PMY, STEM_GAIN_UNITY_PMY],
    muted: [false, false, false, false],
    volume_pmy: UNIT_PMY,
    playing,
  };
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

describe("offline mix through the wasm engine", () => {
  const bytes = readFileSync(fileURLToPath(new URL("../vendor/forge-audio-wasm-v3/forge_audio_wasm_v3_bg.wasm", import.meta.url)));
  initSync({ module: bytes });

  it("keeps a right-side deck silent at full left and audible at full right", () => {
    const frames = Math.floor(sampleRate * seconds);
    const quiet = renderMixPcm({
      sampleRate,
      frames,
      crossfader_pmy: 0,
      decks: [deck(null, 0, false), deck(tone(330), 0, true), deck(null, 0, false), deck(null, 0, false)],
    });
    expect(rms(quiet.left)).toBeLessThan(1e-3);

    const audible = renderMixPcm({
      sampleRate,
      frames,
      crossfader_pmy: 10_000,
      decks: [deck(null, 0, false), deck(tone(330), 0, true), deck(null, 0, false), deck(null, 0, false)],
    });
    expect(rms(audible.left)).toBeGreaterThan(0.05);
  });

  it("drops a muted stem out of the bounce", () => {
    const active = tone(220);
    const playing = deck(active, 0, true);
    playing.muted = [true, false, false, false];
    const rendered = renderMixPcm({
      sampleRate,
      frames: active.length,
      crossfader_pmy: 0,
      decks: [playing, deck(null, 0, false), deck(null, 0, false), deck(null, 0, false)],
    });
    expect(rms(rendered.left)).toBeLessThan(1e-3);

    const open = renderMixPcm({
      sampleRate,
      frames: active.length,
      crossfader_pmy: 0,
      decks: [deck(active, 0, true), deck(null, 0, false), deck(null, 0, false), deck(null, 0, false)],
    });
    expect(rms(open.left)).toBeGreaterThan(0.05);
  });
});
