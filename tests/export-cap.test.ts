import { describe, expect, it } from "vitest";
import {
  encodeInterleavedStereoWavPcm16,
  encodeWavPcm16,
  MAX_EXPORT_SECONDS,
} from "../src/audio/export.js";
import { STEM_GAIN_MAX_PMY, STEM_GAIN_UNITY_PMY } from "../src/audio/types.js";
import {
  BLACK_FLOOR_HEX,
  BLACK_FLOOR_RGB,
  RemixController,
} from "../src/state/controller.js";

describe("Brief 3 & Brief 4: Controller, Never-Black Floor, and 300s WAV Export Cap", () => {
  it("pins BLACK_FLOOR_RGB to [10, 7, 5] (#0a0705) and never pure black", () => {
    expect(BLACK_FLOOR_RGB).toEqual([10, 7, 5]);
    expect(BLACK_FLOOR_HEX).toBe("#0a0705");
  });

  it("maintains integer permyriad faders in RemixController clamped to 0..=12_500", () => {
    const ctrl = new RemixController();
    expect(ctrl.decks[0].gain_pmy).toEqual([
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
    ]);
    expect(ctrl.setStemGain(0, 1, 99_999)).toBe(STEM_GAIN_MAX_PMY);
    expect(ctrl.decks[0].gain_pmy[1]).toBe(12_500);
    expect(RemixController.formatPermyriadPct(10_000)).toBe("100.0%");
    expect(RemixController.formatPermyriadPct(12_500)).toBe("125.0%");
  });

  it("encodes valid RIFF WAVE header and refuses buffers over 300 s", () => {
    const sr = 8000;
    const left = new Float32Array([0.0, 0.5, -0.5, 1.0]);
    const right = new Float32Array([0.0, -0.5, 0.5, -1.0]);
    const wav = encodeWavPcm16(left, right, sr);

    expect(wav.byteLength).toBe(44 + 4 * 4);
    const ascii = String.fromCharCode(...wav.subarray(0, 4), ...wav.subarray(8, 12));
    expect(ascii).toBe("RIFFWAVE");

    const overCapInterleaved = new Float32Array(sr * MAX_EXPORT_SECONDS * 2 + 2);
    expect(() => encodeInterleavedStereoWavPcm16(overCapInterleaved, sr)).toThrow(
      /EXPORT_DURATION_EXCEEDS_300S_CAP/,
    );
  });
});
