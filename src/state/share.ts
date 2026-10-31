import {
  clampStemGainPmy,
  clampUnitPmy,
  CROSSFADER_CENTER_PMY,
  STEM_GAIN_MAX_PMY,
  STEM_GAIN_UNITY_PMY,
  UNIT_PMY,
  type DeckIndex,
} from "../audio/types.js";

/**
 * Mix settings that may travel in a URL fragment.
 * Audio buffers, filenames, room ids, and pubkeys are not representable here.
 */
export interface DeckMixSettings {
  playing: boolean;
  volume_pmy: number;
  gain_pmy: [number, number, number, number];
  muted: [boolean, boolean, boolean, boolean];
  solo: [boolean, boolean, boolean, boolean];
}

export interface MixSettings {
  crossfader_pmy: number;
  decks: [DeckMixSettings, DeckMixSettings, DeckMixSettings, DeckMixSettings];
}

const FRAGMENT_PREFIX = "m1.";
/** version u8 + crossfader u16 + 4 decks * 13 bytes. */
const PAYLOAD_BYTES = 55;
const DECK_STRIDE = 13;

export function emptyDeckSettings(): DeckMixSettings {
  return {
    playing: false,
    volume_pmy: UNIT_PMY,
    gain_pmy: [
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
    ],
    muted: [false, false, false, false],
    solo: [false, false, false, false],
  };
}

export function defaultMixSettings(): MixSettings {
  return {
    crossfader_pmy: CROSSFADER_CENTER_PMY,
    decks: [emptyDeckSettings(), emptyDeckSettings(), emptyDeckSettings(), emptyDeckSettings()],
  };
}

function maskOf(flags: readonly [boolean, boolean, boolean, boolean]): number {
  return (flags[0] ? 1 : 0) | (flags[1] ? 2 : 0) | (flags[2] ? 4 : 0) | (flags[3] ? 8 : 0);
}

function flagsOf(mask: number): [boolean, boolean, boolean, boolean] {
  return [(mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0, (mask & 8) !== 0];
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Encodes mix settings as `#m1.` + base64url. The payload is 55 bytes and contains no strings. */
export function encodeMixFragment(settings: MixSettings): string {
  const bytes = new Uint8Array(PAYLOAD_BYTES);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  view.setUint16(1, clampUnitPmy(settings.crossfader_pmy), true);
  for (let deck = 0; deck < 4; deck++) {
    const src = settings.decks[deck as DeckIndex];
    const offset = 3 + deck * DECK_STRIDE;
    bytes[offset] = src.playing ? 1 : 0;
    view.setUint16(offset + 1, clampUnitPmy(src.volume_pmy), true);
    for (let stem = 0; stem < 4; stem++) {
      view.setUint16(offset + 3 + stem * 2, clampStemGainPmy(src.gain_pmy[stem]), true);
    }
    bytes[offset + 11] = maskOf(src.muted);
    bytes[offset + 12] = maskOf(src.solo);
  }
  return `#${FRAGMENT_PREFIX}${bytesToB64Url(bytes)}`;
}

/**
 * Decodes a share fragment. Returns null on any malformation so a bad link
 * cannot throw during page boot. Refuses unknown versions and out-of-range words.
 */
export function decodeMixFragment(fragment: string): MixSettings | null {
  if (typeof fragment !== "string" || fragment.length === 0 || fragment.length > 128) return null;
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!raw.startsWith(FRAGMENT_PREFIX)) return null;
  const bytes = b64UrlToBytes(raw.slice(FRAGMENT_PREFIX.length));
  if (!bytes || bytes.length !== PAYLOAD_BYTES) return null;
  if (bytes[0] !== 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const crossfader = view.getUint16(1, true);
  if (crossfader > UNIT_PMY) return null;

  const decks = defaultMixSettings().decks;
  for (let deck = 0; deck < 4; deck++) {
    const offset = 3 + deck * DECK_STRIDE;
    const playingByte = bytes[offset];
    if (playingByte > 1) return null;
    const volume = view.getUint16(offset + 1, true);
    if (volume > UNIT_PMY) return null;
    const gain_pmy: [number, number, number, number] = [0, 0, 0, 0];
    for (let stem = 0; stem < 4; stem++) {
      const gain = view.getUint16(offset + 3 + stem * 2, true);
      if (gain > STEM_GAIN_MAX_PMY) return null;
      gain_pmy[stem] = gain;
    }
    const muteMask = bytes[offset + 11];
    const soloMask = bytes[offset + 12];
    if (muteMask > 0x0f || soloMask > 0x0f) return null;
    decks[deck] = {
      playing: playingByte === 1,
      volume_pmy: volume,
      gain_pmy,
      muted: flagsOf(muteMask),
      solo: flagsOf(soloMask),
    };
  }
  return { crossfader_pmy: crossfader, decks };
}
