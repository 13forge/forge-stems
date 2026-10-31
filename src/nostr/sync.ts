import {
  clampNudgePmy,
  clampStemGainPmy,
  STEM_GAIN_MAX_PMY,
  type DeckIndex,
} from "../audio/types.js";

export const KIND_DECK_DELTA = 21342;
export const KIND_CLOCK_SYNC = 21343;
export const KIND_JOIN_REQUEST = 21344;
export const KIND_ROOM_SNAPSHOT = 31342;

export const WIRE_VERSION = 1;
export const DELTA_BYTE_LEN = 24;
export const DELTA_HEX_LEN = 48;

export const DRIFT_DEADBAND_FRAMES = 480; // 10 ms at 48 kHz
export const DRIFT_HARD_SEEK_FRAMES = 2048; // 42.6 ms at 48 kHz

export interface DeckDeltaPacket {
  version: number;
  deck: DeckIndex;
  playing: boolean;
  mute_mask: number; // 4-bit mask: drums=1, bass=2, vocal=4, other=8
  explicit_seek: boolean;
  seq: number;
  sent_ms: number;
  pos_frames: number;
  gain_pmy: [number, number, number, number];
}

export type DriftAction =
  | { kind: "NONE"; drift_frames: number }
  | { kind: "NUDGE"; rate_offset_pmy: number; drift_frames: number }
  | { kind: "SEEK"; target_pos_frames: number; drift_frames: number };

/** Encodes a `DeckDeltaPacket` into a 24-byte / 48-lowercase-hex string (little-endian). */
export function encodeDeckDeltaHex(pkt: DeckDeltaPacket): string {
  if (pkt.version !== WIRE_VERSION) {
    throw new Error(`ERR_UNSUPPORTED_VERSION: ${pkt.version}`);
  }
  if (pkt.deck < 0 || pkt.deck > 3 || !Number.isInteger(pkt.deck)) {
    throw new Error(`ERR_INVALID_DECK: ${pkt.deck}`);
  }
  const buf = new ArrayBuffer(DELTA_BYTE_LEN);
  const view = new DataView(buf);

  const flags =
    (pkt.playing ? 1 : 0) |
    ((pkt.mute_mask & 0x0f) << 1) |
    (pkt.explicit_seek ? 1 << 5 : 0);

  view.setUint8(0, WIRE_VERSION);
  view.setUint8(1, pkt.deck);
  view.setUint8(2, flags);
  view.setUint8(3, 0);
  view.setUint32(4, pkt.seq >>> 0, true);
  view.setUint32(8, pkt.sent_ms >>> 0, true);
  view.setUint32(12, pkt.pos_frames >>> 0, true);

  for (let i = 0; i < 4; i++) {
    const g = clampStemGainPmy(pkt.gain_pmy[i]);
    view.setUint16(16 + i * 2, g, true);
  }

  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Decodes and validates a 48-hex-char `kind 21342` payload; refuses out-of-domain words. */
export function decodeDeckDeltaHex(hex: string): DeckDeltaPacket {
  if (typeof hex !== "string" || hex.length !== DELTA_HEX_LEN || !/^[0-9a-fA-F]{48}$/.test(hex)) {
    throw new Error("ERR_INVALID_HEX_LENGTH");
  }
  const bytes = new Uint8Array(DELTA_BYTE_LEN);
  for (let i = 0; i < DELTA_BYTE_LEN; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const view = new DataView(bytes.buffer);

  const version = view.getUint8(0);
  if (version !== WIRE_VERSION) {
    throw new Error(`ERR_UNSUPPORTED_VERSION: ${version}`);
  }
  const deck = view.getUint8(1);
  if (deck > 3) {
    throw new Error(`ERR_INVALID_DECK: ${deck}`);
  }
  const flags = view.getUint8(2);
  if ((flags & 0b1100_0000) !== 0) {
    throw new Error("ERR_RESERVED_FLAG_BITS_SET");
  }
  const reserved = view.getUint8(3);
  if (reserved !== 0) {
    throw new Error("ERR_RESERVED_BYTE_NONZERO");
  }

  const gain_pmy: [number, number, number, number] = [
    view.getUint16(16, true),
    view.getUint16(18, true),
    view.getUint16(20, true),
    view.getUint16(22, true),
  ];
  for (let i = 0; i < 4; i++) {
    if (gain_pmy[i] > STEM_GAIN_MAX_PMY) {
      throw new Error(`ERR_GAIN_PMY_OUT_OF_DOMAIN: ${gain_pmy[i]}`);
    }
  }

  return {
    version,
    deck: deck as DeckIndex,
    playing: (flags & 1) !== 0,
    mute_mask: (flags >> 1) & 0x0f,
    explicit_seek: (flags & (1 << 5)) !== 0,
    seq: view.getUint32(4, true),
    sent_ms: view.getUint32(8, true),
    pos_frames: view.getUint32(12, true),
    gain_pmy,
  };
}

/**
 * Computes the Three-Zone drift response for an incoming `DeckDeltaPacket`.
 */
export function computeDriftAction(
  pkt: DeckDeltaPacket,
  localPosFrames: number,
  nowMs: number,
  clockOffsetMs: number,
  sampleRate: number,
): DriftAction {
  const transitMs = Math.max(0, nowMs - pkt.sent_ms - clockOffsetMs);
  const expectedPos = pkt.playing
    ? pkt.pos_frames + Math.round((transitMs * sampleRate) / 1000)
    : pkt.pos_frames;
  const signedDrift = expectedPos - localPosFrames;
  const absDrift = Math.abs(signedDrift);

  if (pkt.explicit_seek || !pkt.playing || absDrift >= DRIFT_HARD_SEEK_FRAMES) {
    return {
      kind: "SEEK",
      target_pos_frames: Math.max(0, expectedPos),
      drift_frames: signedDrift,
    };
  }
  if (absDrift < DRIFT_DEADBAND_FRAMES) {
    return { kind: "NONE", drift_frames: signedDrift };
  }
  const rawOffset = (signedDrift / DRIFT_HARD_SEEK_FRAMES) * 500;
  return {
    kind: "NUDGE",
    rate_offset_pmy: clampNudgePmy(rawOffset),
    drift_frames: signedDrift,
  };
}

/** Tracks per-deck pubkey ownership and `(pubkey, deck)` sequence numbers. */
export class B2bRoomGuard {
  private deckOwners: [string | null, string | null, string | null, string | null] = [
    null,
    null,
    null,
    null,
  ];
  private lastSeq = new Map<string, number>();

  setDeckOwner(deck: DeckIndex, pubkey: string | null): void {
    this.deckOwners[deck] = pubkey;
  }

  acceptEvent(senderPubkey: string, pkt: DeckDeltaPacket): boolean {
    const owner = this.deckOwners[pkt.deck];
    if (!owner || owner !== senderPubkey) {
      return false;
    }
    const key = `${senderPubkey}:${pkt.deck}`;
    const prev = this.lastSeq.get(key) ?? 0;
    if (pkt.seq <= prev) {
      return false;
    }
    this.lastSeq.set(key, pkt.seq);
    return true;
  }
}

/** 64-bit FNV-1a over Float32Array raw bytes (honest accidental-mismatch guard). */
export function hashFloat32Fnv1a64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & mask;
  }
  return `0x${hash.toString(16).padStart(16, "0")}`;
}
