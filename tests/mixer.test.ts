import { describe, expect, it } from "vitest";
import { STEM_GAIN_MAX_PMY, UNIT_PMY } from "../src/audio/types.js";
import { RemixController } from "../src/state/controller.js";

describe("four-deck mixer state", () => {
  it("keeps four decks at unity with a centered crossfader", () => {
    const ctrl = new RemixController();
    expect(ctrl.decks).toHaveLength(4);
    expect(ctrl.crossfader_pmy).toBe(5_000);
    for (const deck of ctrl.decks) {
      expect(deck.volume_pmy).toBe(UNIT_PMY);
      expect(deck.gain_pmy).toEqual([10_000, 10_000, 10_000, 10_000]);
      expect(deck.playing).toBe(false);
    }
  });

  it("lets a user mute win over solo and silences the unsoloed stems", () => {
    const ctrl = new RemixController();
    ctrl.toggleStemSolo(2, 1);
    expect(ctrl.effectiveMuted(2, 1)).toBe(false);
    expect(ctrl.effectiveMuted(2, 0)).toBe(true);
    expect(ctrl.effectiveMuted(2, 3)).toBe(true);
    ctrl.toggleStemMute(2, 1);
    expect(ctrl.effectiveMuted(2, 1)).toBe(true);
    expect(ctrl.muteMask(2)).toBe(0b0010);
  });

  it("clamps deck volume and the crossfader to 0..=10_000", () => {
    const ctrl = new RemixController();
    expect(ctrl.setDeckVolume(3, 99_000)).toBe(UNIT_PMY);
    expect(ctrl.setCrossfader(-20)).toBe(0);
    expect(ctrl.setStemGain(1, 0, 20_000)).toBe(STEM_GAIN_MAX_PMY);
    expect(RemixController.formatCrossfader(5_000)).toBe("CENTER");
    expect(RemixController.formatCrossfader(0)).toContain("A/C");
  });

  it("applies share settings without touching stem audio or names", () => {
    const ctrl = new RemixController();
    const tone = new Float32Array([0.2, -0.2, 0.2]);
    ctrl.decks[0].stems[0] = tone;
    ctrl.decks[0].stemNames[0] = "private-take.wav";
    ctrl.applyMixSettings({
      crossfader_pmy: 7_500,
      decks: [
        {
          playing: true,
          volume_pmy: 2_000,
          gain_pmy: [1_000, 2_000, 3_000, 4_000],
          muted: [true, false, false, false],
          solo: [false, false, true, false],
        },
        ctrl.toMixSettings().decks[1],
        ctrl.toMixSettings().decks[2],
        ctrl.toMixSettings().decks[3],
      ],
    });
    expect(ctrl.decks[0].playing).toBe(true);
    expect(ctrl.decks[0].stems[0]).toBe(tone);
    expect(ctrl.decks[0].stemNames[0]).toBe("private-take.wav");
    expect(JSON.stringify(ctrl.toMixSettings())).not.toContain("private-take");
  });
});
