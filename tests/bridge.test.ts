import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Engine, initSync } from "@wasm/forge_audio_wasm_v3.js";
import {
  assertWithin300sCap,
  clampNudgePmy,
  clampStemGainPmy,
  deinterleaveStereoBlock,
  STEM_GAIN_MAX_PMY,
  STEM_GAIN_UNITY_PMY,
  WEBAUDIO_QUANTUM_FRAMES,
} from "../src/audio/types.js";

describe("Brief 2: AudioWorklet & Worker Bridge invariants", () => {
  it("clamps stem gain permyriad strictly to integer 0..=12_500 (STEM_GAIN_MAX_PMY)", () => {
    expect(clampStemGainPmy(STEM_GAIN_UNITY_PMY)).toBe(10_000);
    expect(clampStemGainPmy(20_000)).toBe(STEM_GAIN_MAX_PMY);
    expect(clampStemGainPmy(-50)).toBe(0);
    expect(clampStemGainPmy(7500.6)).toBe(7501);
    expect(clampStemGainPmy(Number.NaN)).toBe(0);
    expect(clampStemGainPmy(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("clamps deck nudge permyriad strictly to integer -500..=500", () => {
    expect(clampNudgePmy(0)).toBe(0);
    expect(clampNudgePmy(999)).toBe(500);
    expect(clampNudgePmy(-999)).toBe(-500);
    expect(clampNudgePmy(123.4)).toBe(123);
    expect(clampNudgePmy(Number.NaN)).toBe(0);
  });

  it("de-interleaves 128-frame stereo quantum into planar L and R without cross-talk", () => {
    const frames = WEBAUDIO_QUANTUM_FRAMES;
    const interleaved = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      interleaved[i * 2] = i / 128; // L ramp
      interleaved[i * 2 + 1] = -(i / 128); // R inverted ramp
    }
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);

    deinterleaveStereoBlock(interleaved, outL, outR, frames);

    for (let i = 0; i < frames; i++) {
      expect(outL[i]).toBeCloseTo(i / 128, 6);
      expect(outR[i]).toBeCloseTo(-(i / 128), 6);
    }
  });

  it("staged WASM exposes every Engine method the worklet relies on at runtime", () => {
    const bytes = readFileSync(fileURLToPath(new URL("../vendor/forge-audio-wasm-v3/forge_audio_wasm_v3_bg.wasm", import.meta.url)));
    initSync({ module: bytes });
    const engine = new Engine(48_000, WEBAUDIO_QUANTUM_FRAMES) as unknown as Record<string, unknown>;
    const required = [
      "render_block",
      "render_block_into",
      "set_stem_gain",
      "set_stem_mute",
      "load_stems",
      "set_deck_playing",
      "set_deck_pos",
      "nudge_deck",
      "master_rms",
      "spectrum",
      "set_deck_volume",
      "set_crossfader",
    ];
    const missing = required.filter((name) => typeof engine[name] !== "function");
    expect(missing).toEqual([]);
  });

  it("enforces the 300 s hard duration cap before buffers cross the WASM boundary", () => {
    const sr = 48_000;
    const exactCap = sr * 300; // 14,400,000 samples
    expect(() => assertWithin300sCap(exactCap, sr)).not.toThrow();
    expect(() => assertWithin300sCap(exactCap + 1, sr)).toThrow(/EXPORT_DURATION_EXCEEDS_300S_CAP/);
    expect(() => assertWithin300sCap(0, sr)).toThrow(/ERR_EMPTY_OR_INVALID_BUFFER/);
  });

  it("exports initSync as a named sync initializer distinct from the async default init", async () => {
    const mod = await import("@wasm/forge_audio_wasm_v3.js");
    expect(typeof mod.initSync).toBe("function");
    expect(typeof mod.Engine).toBe("function");
    expect(mod.initSync).not.toBe(mod.default);
  });
});
