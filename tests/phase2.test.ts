import { describe, expect, it } from "vitest";
import { demuxHpssToFourStems } from "../src/audio/stem-demux.js";
import { RemixController } from "../src/state/controller.js";
import {
  ClockOffsetEstimator,
  DeckDeltaThrottle,
} from "../src/nostr/client.js";

describe("Phase 2: 4-Stem Demux Reconstruction, Clock Offset Estimator, and 10Hz Fader Throttle", () => {
  it("demuxes HPSS harmonic + percussive into 4 stems whose sample-by-sample sum equals the original mix", () => {
    const sr = 48_000;
    const len = 1024;
    const harmonic = new Float32Array(len);
    const percussive = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      harmonic[i] = Math.sin((2 * Math.PI * 110 * i) / sr) * 0.4 +
        Math.sin((2 * Math.PI * 1200 * i) / sr) * 0.3 +
        Math.sin((2 * Math.PI * 6000 * i) / sr) * 0.2;
      percussive[i] = ((i % 64 === 0 ? 0.5 : -0.05));
    }

    const stems = demuxHpssToFourStems(harmonic, percussive, sr);
    for (let i = 0; i < len; i++) {
      const recon = stems.drums[i] + stems.bass[i] + stems.vocal[i] + stems.other[i];
      const expected = harmonic[i] + percussive[i];
      expect(recon).toBeCloseTo(expected, 5);
    }
  });

  it("estimates clock offset using the lowest-RTT sample out of 3 ping/pong exchanges", () => {
    const clock = new ClockOffsetEstimator();
    // Sample 1: high jitter RTT = 120ms
    clock.recordSample(1000, 1085, 1085, 1120);
    // Sample 2: clean LAN/fast relay RTT = 20ms, true offset = +15ms (t0=2000, t1=2025, t2=2025, t3=2020)
    clock.recordSample(2000, 2025, 2025, 2020);
    // Sample 3: spike RTT = 200ms
    clock.recordSample(3000, 3180, 3180, 3200);

    expect(clock.offsetMs()).toBe(15);
  });

  it("throttles continuous fader drags to 10 Hz (100 ms) while allowing immediate edges and 1 Hz heartbeats", () => {
    const throttle = new DeckDeltaThrottle();
    const baseState = {
      deck: 0 as const,
      playing: true,
      mute_mask: 0,
      explicit_seek: false,
      pos_frames: 0,
      gain_pmy: [10_000, 10_000, 10_000, 10_000] as [number, number, number, number],
    };

    // First fader move at t=1000ms sends immediately (seq = 1)
    const p1 = throttle.stage(0, baseState, 1000, false);
    expect(p1?.seq).toBe(1);

    // Second fader move 30ms later (t=1030ms) is held back by the 100ms throttle
    const p2 = throttle.stage(0, { ...baseState, gain_pmy: [9000, 10_000, 10_000, 10_000] }, 1030, false);
    expect(p2).toBeNull();

    // Flush at t=1105ms (>= 100ms elapsed) emits the staged update (seq = 2)
    const p3 = throttle.flushDue(0, { ...baseState, gain_pmy: [9000, 10_000, 10_000, 10_000] }, 1105);
    expect(p3?.seq).toBe(2);

    // Discrete mute edge at t=1120ms bypasses the 100ms throttle immediately (seq = 3)
    const p4 = throttle.stage(0, { ...baseState, mute_mask: 1 }, 1120, true);
    expect(p4?.seq).toBe(3);

    // Stationary while playing: no heartbeat at t=1500ms (< 1000ms), fires at t=2125ms (>= 1000ms, seq = 4)
    expect(throttle.flushDue(0, baseState, 1500)).toBeNull();
    const p5 = throttle.flushDue(0, baseState, 2125);
    expect(p5?.seq).toBe(4);
  });

  it("clamps crossfader, deck tempo, bipolar filter, 3-band EQ, and FX intensity in RemixController", () => {
    const c = new RemixController();

    // Crossfader: 0..=10_000 pmy
    expect(c.setCrossfaderPmy(-5)).toBe(0);
    expect(c.setCrossfaderPmy(12_345)).toBe(10_000);
    expect(c.setCrossfaderPmy(Number.NaN)).toBe(5_000);

    // Deck tempo: 5_000..=20_000 pmy
    expect(c.setDeckTempoPmy(0, 1_000)).toBe(5_000);
    expect(c.setDeckTempoPmy(0, 99_999)).toBe(20_000);
    expect(c.setDeckTempoPmy(1, 10_400)).toBe(10_400);

    // Bipolar filter: -10_000..=10_000 pmy
    expect(c.setDeckFilterPmy(1, -20_000)).toBe(-10_000);
    expect(c.setDeckFilterPmy(1, 20_000)).toBe(10_000);
    expect(c.setDeckFilterPmy(1, -3_000)).toBe(-3_000);

    // 3-band EQ: -60..=12 dB
    expect(c.setDeckEqDb(0, 0, -100)).toBe(-60);
    expect(c.setDeckEqDb(0, 1, 40)).toBe(12);
    expect(c.setDeckEqDb(0, 2, Number.POSITIVE_INFINITY)).toBe(0);
    expect(c.decks[0].eq_db).toEqual([-60, 12, 0]);

    // FX intensity: 0..=10_000 pmy
    expect(c.setFxIntensityPmy(2, -1)).toBe(0);
    expect(c.setFxIntensityPmy(2, 15_000)).toBe(10_000);

    // Preset + toggle round-trip
    expect(c.setFxSlot(0, "dread")).toBe("dread");
    expect(c.toggleFxSlot(0)).toBe(true);
    expect(c.toggleFxSlot(0)).toBe(false);
  });
});
