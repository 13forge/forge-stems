import { describe, expect, it } from "vitest";
import {
  BPM_MAX_CBPM,
  BPM_MIN_CBPM,
  clampBpmCbpm,
  clampLevelPmy,
  clampStemMask,
  UNIT_PMY,
} from "../src/audio/types.js";
import { RemixController } from "../src/state/controller.js";

describe("deck primitives: level", () => {
  it("clamps song level to 0..=10_000 and maps NaN to unity", () => {
    const ctrl = new RemixController();
    expect(ctrl.setDeckLevelPmy(0, 99_000)).toBe(UNIT_PMY);
    expect(ctrl.setDeckLevelPmy(0, -5)).toBe(0);
    expect(ctrl.setDeckLevelPmy(0, Number.NaN)).toBe(10_000);
    expect(clampLevelPmy(Number.POSITIVE_INFINITY)).toBe(10_000);
    expect(ctrl.decks[0].volume_pmy).toBe(10_000);
  });
});

describe("deck primitives: mute / solo masks", () => {
  it("clamps masks to 0..=0x0F", () => {
    expect(clampStemMask(0xff)).toBe(0x0f);
    expect(clampStemMask(-1)).toBe(0);
    expect(clampStemMask(Number.NaN)).toBe(0);
  });

  it("maps bit 1 << stem to the matching stem and effective mute follows solo", () => {
    const ctrl = new RemixController();
    ctrl.setDeckMuteSoloMasks(1, 0b0100, 0b0010); // mute Voice, solo Bass
    expect(ctrl.decks[1].muted).toEqual([false, false, true, false]);
    expect(ctrl.decks[1].solo).toEqual([false, true, false, false]);
    expect(ctrl.effectiveMuted(1, 1)).toBe(false);
    expect(ctrl.effectiveMuted(1, 0)).toBe(true);
    expect(ctrl.effectiveMuted(1, 2)).toBe(true);
    expect(ctrl.effectiveMuted(1, 3)).toBe(true);
    expect(ctrl.muteMask(1)).toBe(0b0100);
  });

  it("clamps an out-of-range mask to 0x0F (all four stems)", () => {
    const ctrl = new RemixController();
    ctrl.setDeckMuteSoloMasks(0, 0xf1, 0x00);
    expect(ctrl.decks[0].muted).toEqual([true, true, true, true]);
  });
});

describe("deck primitives: hotcues", () => {
  it("sets an empty slot at the frame and jumps to it when occupied", () => {
    const ctrl = new RemixController();
    expect(ctrl.triggerOrSetHotcue(2, 3, 12_345)).toBe(12_345);
    expect(ctrl.decks[2].hotcues[3]).toBe(12_345);
    expect(ctrl.triggerOrSetHotcue(2, 3, 99_999)).toBe(12_345);
    expect(ctrl.decks[2].hotcues[3]).toBe(12_345);
  });

  it("clears a slot so the next trigger sets it again", () => {
    const ctrl = new RemixController();
    ctrl.triggerOrSetHotcue(0, 7, 500);
    ctrl.clearHotcue(0, 7);
    expect(ctrl.decks[0].hotcues[7]).toBeNull();
    expect(ctrl.triggerOrSetHotcue(0, 7, 900)).toBe(900);
  });
});

describe("deck primitives: loop resize", () => {
  it("halves the loop with a 64-frame floor", () => {
    const ctrl = new RemixController();
    ctrl.setDeckLoop(0, true, 1_000, 1_000 + 4_096);
    expect(ctrl.loopResize(0, -1)).toBe(1_000 + 2_048);
    expect(ctrl.loopResize(0, -1)).toBe(1_000 + 1_024);
    for (let i = 0; i < 10; i++) ctrl.loopResize(0, -1);
    expect(ctrl.decks[0].loop.end_frame - ctrl.decks[0].loop.start_frame).toBe(64);
  });

  it("doubles the loop length", () => {
    const ctrl = new RemixController();
    ctrl.setDeckLoop(3, true, 0, 256);
    expect(ctrl.loopResize(3, 1)).toBe(512);
    expect(ctrl.decks[3].loop.enabled).toBe(true);
  });

  it("leaves an empty loop unchanged", () => {
    const ctrl = new RemixController();
    expect(ctrl.loopResize(1, 1)).toBe(0);
  });

  it("enables a loop only when end is after start", () => {
    const ctrl = new RemixController();
    ctrl.setDeckLoop(0, true, 500, 500);
    expect(ctrl.decks[0].loop.enabled).toBe(false);
    ctrl.setDeckLoop(0, true, 500, 900);
    expect(ctrl.decks[0].loop.enabled).toBe(true);
  });
});

describe("deck primitives: pace (cbpm)", () => {
  it("clamps to 4_000..=24_000 and maps NaN to 12_000", () => {
    const ctrl = new RemixController();
    expect(ctrl.setDeckBpmCbpm(0, 1_000, true)).toBe(BPM_MIN_CBPM);
    expect(ctrl.setDeckBpmCbpm(0, 50_000, false)).toBe(BPM_MAX_CBPM);
    expect(ctrl.setDeckBpmCbpm(0, Number.NaN, true)).toBe(12_000);
    expect(clampBpmCbpm(12_345.4)).toBe(12_345);
    expect(ctrl.decks[0].beat_snap).toBe(true);
  });
});
