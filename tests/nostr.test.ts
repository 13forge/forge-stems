import { describe, expect, it } from "vitest";
import {
  B2bRoomGuard,
  computeDriftAction,
  decodeDeckDeltaHex,
  DELTA_HEX_LEN,
  encodeDeckDeltaHex,
  hashFloat32Fnv1a64,
  type DeckDeltaPacket,
} from "../src/nostr/sync.js";

describe("Brief 5: Nostr B2B 24-Byte Wire Codec, Ownership Guard, and Three-Zone Drift", () => {
  const samplePacket: DeckDeltaPacket = {
    version: 1,
    deck: 1,
    playing: true,
    mute_mask: 0b0101,
    explicit_seek: false,
    seq: 42,
    sent_ms: 100_000,
    pos_frames: 48_000,
    gain_pmy: [10_000, 12_500, 8_000, 0],
  };

  it("round-trips a 24-byte (48-hex) DeckDeltaPacket and refuses out-of-domain words", () => {
    const hex = encodeDeckDeltaHex(samplePacket);
    expect(hex.length).toBe(DELTA_HEX_LEN);
    const decoded = decodeDeckDeltaHex(hex);
    expect(decoded).toEqual(samplePacket);

    expect(() => decodeDeckDeltaHex("02" + hex.slice(2))).toThrow(/ERR_UNSUPPORTED_VERSION/);
    expect(() => decodeDeckDeltaHex(hex.slice(0, 2) + "04" + hex.slice(4))).toThrow(
      /ERR_INVALID_DECK/,
    );
    expect(() => decodeDeckDeltaHex(hex.slice(0, 32) + "ffff" + hex.slice(36))).toThrow(
      /ERR_GAIN_PMY_OUT_OF_DOMAIN/,
    );
  });

  it("enforces per-deck single owner and isolates seq per (pubkey, deck)", () => {
    const guard = new B2bRoomGuard();
    guard.setDeckOwner(1, "pubkey_alice");

    expect(guard.acceptEvent("pubkey_bob", { ...samplePacket, seq: 1 })).toBe(false);
    expect(guard.acceptEvent("pubkey_alice", { ...samplePacket, seq: 10 })).toBe(true);
    expect(guard.acceptEvent("pubkey_alice", { ...samplePacket, seq: 10 })).toBe(false);

    guard.setDeckOwner(1, "pubkey_bob");
    expect(guard.acceptEvent("pubkey_bob", { ...samplePacket, seq: 1 })).toBe(true);
  });

  it("routes drift across Deadband (<480), Smooth Nudge (480..2047), and Hard Seek (>=2048)", () => {
    const sr = 48_000;
    const nowMs = 100_080; // 80 ms transit -> expected_pos = 51_840

    const z1 = computeDriftAction(samplePacket, 51_600, nowMs, 0, sr);
    expect(z1.kind).toBe("NONE");

    const z2 = computeDriftAction(samplePacket, 50_840, nowMs, 0, sr);
    expect(z2.kind).toBe("NUDGE");
    if (z2.kind === "NUDGE") {
      expect(z2.rate_offset_pmy).toBeGreaterThan(0);
      expect(z2.rate_offset_pmy).toBeLessThanOrEqual(500);
    }

    const z3 = computeDriftAction(samplePacket, 48_000, nowMs, 0, sr);
    expect(z3).toEqual({ kind: "SEEK", target_pos_frames: 51_840, drift_frames: 3840 });
  });

  it("computes deterministic 64-bit FNV-1a over stem Float32Array", () => {
    const a = new Float32Array([0.25, -0.25, 0.5]);
    const b = new Float32Array([0.25, -0.25, 0.5]);
    const c = new Float32Array([0.25, -0.25, 0.5001]);
    expect(hashFloat32Fnv1a64(a)).toBe(hashFloat32Fnv1a64(b));
    expect(hashFloat32Fnv1a64(a)).not.toBe(hashFloat32Fnv1a64(c));
  });
});
