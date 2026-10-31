import { describe, expect, it } from "vitest";
import { oneBarFrames, nextLoopLength, repeatLabel } from "../src/audio/loop-region.js";
import { paceLabel, sliderToTempoPmy, tempoToSlider } from "../src/audio/pace.js";

describe("pace maps onto engine tempo", () => {
  it("puts 1.0× at the center and speeds up to the right", () => {
    expect(sliderToTempoPmy(500)).toBe(10_000);
    expect(sliderToTempoPmy(0)).toBe(5_000);
    expect(sliderToTempoPmy(1_000)).toBe(20_000);
    expect(sliderToTempoPmy(750)).toBeGreaterThan(sliderToTempoPmy(500));
    expect(sliderToTempoPmy(250)).toBeLessThan(sliderToTempoPmy(500));
    expect(tempoToSlider(10_000)).toBe(500);
    expect(paceLabel(5_000)).toContain("60 BPM");
    expect(paceLabel(20_000)).toContain("240 BPM");
    expect(paceLabel(10_000)).toContain("120 BPM");
  });
});

describe("repeat length", () => {
  it("initializes a non-positive loop to 1 bar (2 s at 120 BPM) and never 0", () => {
    expect(oneBarFrames(12_000, 48_000)).toBe(96_000);
    expect(repeatLabel(96_000, 12_000, 48_000)).toBe("Repeat (4 beats)");
    const halved = nextLoopLength(0, -1, 0, 12_000, 48_000);
    expect(halved).toBeGreaterThanOrEqual(1_200);
    expect(halved).toBe(48_000);
    const doubled = nextLoopLength(96_000, 1, 100_000, 12_000, 48_000);
    expect(doubled).toBe(100_000);
    const floored = nextLoopLength(2_000, -1, 0, 12_000, 48_000);
    expect(floored).toBe(1_200);
  });
});
