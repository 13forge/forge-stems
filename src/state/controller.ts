import {
  BPM_NAN_FALLBACK_CBPM,
  clampBpmCbpm,
  clampEqDb,
  clampFilterPmy,
  clampFxIntensityPmy,
  clampLevelPmy,
  clampStemGainPmy,
  clampStemMask,
  clampTempoPmy,
  clampUnitPmy,
  CROSSFADER_CENTER_PMY,
  STEM_GAIN_MAX_PMY,
  STEM_GAIN_UNITY_PMY,
  TEMPO_UNITY_PMY,
  type CrossfaderCurveName,
  type DeckIndex,
  type EqBand,
  type FxPreset,
  type FxSlotIndex,
  type HotcueSlotIndex,
  type StemIndex,
  type RemixTargetSpec,
} from "../audio/types.js";

/** Floor for `loopResize` halving; mirrors forge-audio-wasm-v3 `loop_resize`. */
const LOOP_MIN_FRAMES = 64;
import {
  defaultMixSettings,
  emptyDeckSettings,
  type DeckMixSettings,
  type MixSettings,
} from "./share.js";

/** Never pure black (0,0,0); canonical floor owned by forge-look-v3: BLACK_FLOOR_RGB = [10, 7, 5]. */
export const BLACK_FLOOR_RGB: readonly [number, number, number] = [10, 7, 5];
export const BLACK_FLOOR_HEX = "#0a0705";

export interface DeckStemUiState extends DeckMixSettings {
  stems: [Float32Array | null, Float32Array | null, Float32Array | null, Float32Array | null];
  stemNames: [string | null, string | null, string | null, string | null];
  lastProcessedMono: Float32Array | null;
  lastSampleRate: number;
  /** Phase 2 deck DSP state. Not part of the share link (`MixSettings`). */
  tempo_pmy: number;
  keylock: boolean;
  filter_pmy: number;
  /** [low, mid, high] in dB, `-60..=12`. */
  eq_db: [number, number, number];
  /** Bookmarks 1–8 as frame positions; `null` = empty. Mirrors the worklet engine. */
  hotcues: [number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
  loop: { enabled: boolean; start_frame: number; end_frame: number };
  /** Pace in centi-BPM, `4_000..=24_000`. */
  bpm_cbpm: number;
  beat_snap: boolean;
}

export interface FxSlotState {
  preset: FxPreset;
  enabled: boolean;
  intensity_pmy: number;
}

function makeDeck(): DeckStemUiState {
  return {
    ...emptyDeckSettings(),
    gain_pmy: [
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
      STEM_GAIN_UNITY_PMY,
    ],
    stems: [null, null, null, null],
    stemNames: [null, null, null, null],
    lastProcessedMono: null,
    lastSampleRate: 48_000,
    tempo_pmy: TEMPO_UNITY_PMY,
    keylock: false,
    filter_pmy: 0,
    eq_db: [0, 0, 0],
    hotcues: [null, null, null, null, null, null, null, null],
    loop: { enabled: false, start_frame: 0, end_frame: 0 },
    bpm_cbpm: BPM_NAN_FALLBACK_CBPM,
    beat_snap: false,
  };
}

export class RemixController {
  readonly decks: [DeckStemUiState, DeckStemUiState, DeckStemUiState, DeckStemUiState] = [
    makeDeck(),
    makeDeck(),
    makeDeck(),
    makeDeck(),
  ];

  crossfader_pmy = CROSSFADER_CENTER_PMY;
  crossfaderCurve: CrossfaderCurveName = "smooth";
  fxSlots: [FxSlotState, FxSlotState, FxSlotState, FxSlotState] = [
    { preset: "echo", enabled: false, intensity_pmy: 5_000 },
    { preset: "echo", enabled: false, intensity_pmy: 5_000 },
    { preset: "echo", enabled: false, intensity_pmy: 5_000 },
    { preset: "echo", enabled: false, intensity_pmy: 5_000 },
  ];
  referenceBuffer: Float32Array | null = null;

  remixTarget: RemixTargetSpec = {
    target_bpm: 124,
    target_key: "8A",
    loudness_lufs: -14.0,
  };

  constructor(initial?: MixSettings) {
    if (initial) this.applyMixSettings(initial);
  }

  /** Settings only. Stem buffers and filenames stay on the deck and never enter a link. */
  toMixSettings(): MixSettings {
    const base = defaultMixSettings();
    base.crossfader_pmy = this.crossfader_pmy;
    for (let deck = 0; deck < 4; deck++) {
      const src = this.decks[deck as DeckIndex];
      base.decks[deck as DeckIndex] = {
        playing: src.playing,
        volume_pmy: src.volume_pmy,
        gain_pmy: [src.gain_pmy[0], src.gain_pmy[1], src.gain_pmy[2], src.gain_pmy[3]],
        muted: [src.muted[0], src.muted[1], src.muted[2], src.muted[3]],
        solo: [src.solo[0], src.solo[1], src.solo[2], src.solo[3]],
      };
    }
    return base;
  }

  applyMixSettings(settings: MixSettings): void {
    this.crossfader_pmy = clampUnitPmy(settings.crossfader_pmy);
    for (let deck = 0; deck < 4; deck++) {
      const src = settings.decks[deck as DeckIndex];
      const dst = this.decks[deck as DeckIndex];
      dst.playing = src.playing;
      dst.volume_pmy = clampUnitPmy(src.volume_pmy);
      for (let stem = 0; stem < 4; stem++) {
        dst.gain_pmy[stem as StemIndex] = clampStemGainPmy(src.gain_pmy[stem]);
        dst.muted[stem as StemIndex] = src.muted[stem];
        dst.solo[stem as StemIndex] = src.solo[stem];
      }
    }
  }

  setStemGain(deck: DeckIndex, stem: StemIndex, gain_pmy: number): number {
    const clamped = clampStemGainPmy(gain_pmy);
    this.decks[deck].gain_pmy[stem] = clamped;
    return clamped;
  }

  setStemMute(deck: DeckIndex, stem: StemIndex, muted: boolean): boolean {
    this.decks[deck].muted[stem] = muted;
    return muted;
  }

  toggleStemMute(deck: DeckIndex, stem: StemIndex): boolean {
    return this.setStemMute(deck, stem, !this.decks[deck].muted[stem]);
  }

  setStemSolo(deck: DeckIndex, stem: StemIndex, solo: boolean): boolean {
    this.decks[deck].solo[stem] = solo;
    return solo;
  }

  toggleStemSolo(deck: DeckIndex, stem: StemIndex): boolean {
    return this.setStemSolo(deck, stem, !this.decks[deck].solo[stem]);
  }

  /**
   * User mute always wins. When any stem on the deck is soloed, the others are silenced
   * without forgetting their mute buttons.
   */
  effectiveMuted(deck: DeckIndex, stem: StemIndex): boolean {
    const state = this.decks[deck];
    if (state.muted[stem]) return true;
    const soloing = state.solo[0] || state.solo[1] || state.solo[2] || state.solo[3];
    return soloing && !state.solo[stem];
  }

  setDeckVolume(deck: DeckIndex, volume_pmy: number): number {
    const clamped = clampUnitPmy(volume_pmy);
    this.decks[deck].volume_pmy = clamped;
    return clamped;
  }

  /** "Song Volume". Shares the `volume_pmy` field with `setDeckVolume`; NaN falls back to unity. */
  setDeckLevelPmy(deck: DeckIndex, level_pmy: number): number {
    const clamped = clampLevelPmy(level_pmy);
    this.decks[deck].volume_pmy = clamped;
    return clamped;
  }

  /** Bit `1 << stem` per stem. Only the low four bits are kept. */
  setDeckMuteSoloMasks(deck: DeckIndex, mute_mask: number, solo_mask: number): void {
    const mute = clampStemMask(mute_mask);
    const solo = clampStemMask(solo_mask);
    const state = this.decks[deck];
    for (let stem = 0; stem < 4; stem++) {
      state.muted[stem as StemIndex] = (mute & (1 << stem)) !== 0;
      state.solo[stem as StemIndex] = (solo & (1 << stem)) !== 0;
    }
  }

  /** Empty slot: store `frame` and return it. Occupied slot: return the saved frame to jump to. */
  triggerOrSetHotcue(deck: DeckIndex, slot: HotcueSlotIndex, frame: number): number {
    const state = this.decks[deck];
    const saved = state.hotcues[slot];
    if (saved !== null) return saved;
    const pos = frame >>> 0;
    state.hotcues[slot] = pos;
    return pos;
  }

  clearHotcue(deck: DeckIndex, slot: HotcueSlotIndex): void {
    this.decks[deck].hotcues[slot] = null;
  }

  /** Halve (floor 64 frames) for `direction < 0`, double otherwise. Returns the new `end_frame`. */
  loopResize(deck: DeckIndex, direction: -1 | 1): number {
    const loop = this.decks[deck].loop;
    const len = Math.max(0, loop.end_frame - loop.start_frame);
    if (len > 0) {
      const next = direction < 0 ? Math.max(LOOP_MIN_FRAMES, Math.floor(len / 2)) : len * 2;
      loop.end_frame = loop.start_frame + next;
    }
    return loop.end_frame;
  }

  setDeckBpmCbpm(deck: DeckIndex, cbpm: number, snap: boolean): number {
    const clamped = clampBpmCbpm(cbpm);
    this.decks[deck].bpm_cbpm = clamped;
    this.decks[deck].beat_snap = snap;
    return clamped;
  }

  /** Loop is active only when enabled and `end_frame > start_frame`. */
  setDeckLoop(deck: DeckIndex, enabled: boolean, start_frame: number, end_frame: number): void {
    const start = start_frame >>> 0;
    const end = end_frame >>> 0;
    this.decks[deck].loop = { enabled: enabled && end > start, start_frame: start, end_frame: end };
  }

  setDeckPlaying(deck: DeckIndex, playing: boolean): boolean {
    this.decks[deck].playing = playing;
    return playing;
  }

  toggleDeckPlaying(deck: DeckIndex): boolean {
    return this.setDeckPlaying(deck, !this.decks[deck].playing);
  }

  setCrossfader(position_pmy: number): number {
    const clamped = clampUnitPmy(position_pmy);
    this.crossfader_pmy = clamped;
    return clamped;
  }

  /** Non-finite input parks the crossfader at center. */
  setCrossfaderPmy(value: number): number {
    return this.setCrossfader(Number.isFinite(value) ? value : CROSSFADER_CENTER_PMY);
  }

  setCrossfaderCurve(curve: CrossfaderCurveName): CrossfaderCurveName {
    this.crossfaderCurve = curve;
    return curve;
  }

  setDeckTempoPmy(deck: DeckIndex, value: number): number {
    this.decks[deck].tempo_pmy = clampTempoPmy(value);
    return this.decks[deck].tempo_pmy;
  }

  setDeckKeylock(deck: DeckIndex, enabled: boolean): boolean {
    this.decks[deck].keylock = enabled;
    return enabled;
  }

  setDeckFilterPmy(deck: DeckIndex, value: number): number {
    this.decks[deck].filter_pmy = clampFilterPmy(value);
    return this.decks[deck].filter_pmy;
  }

  setDeckEqDb(deck: DeckIndex, band: EqBand, value: number): number {
    const clamped = clampEqDb(value);
    this.decks[deck].eq_db[band] = clamped;
    return clamped;
  }

  setFxSlot(slot: FxSlotIndex, preset: FxPreset): FxPreset {
    this.fxSlots[slot].preset = preset;
    return preset;
  }

  toggleFxSlot(slot: FxSlotIndex): boolean {
    const next = !this.fxSlots[slot].enabled;
    this.fxSlots[slot].enabled = next;
    return next;
  }

  setFxIntensityPmy(slot: FxSlotIndex, value: number): number {
    const clamped = clampFxIntensityPmy(value);
    this.fxSlots[slot].intensity_pmy = clamped;
    return clamped;
  }

  /**
   * User mute bits, `1 << stem` (drums=1, bass=2, voice=4, music=8). Solo is not part of the Nostr word.
   * Stem 3 (bit 8 / 0b1000) is named "other" in the WASM doc comment and "instruments_muted" on Rust
   * StemState; displayed as "Music" in the UI (not a 5th stem).
   */
  muteMask(deck: DeckIndex): number {
    const muted = this.decks[deck].muted;
    return (muted[0] ? 1 : 0) | (muted[1] ? 2 : 0) | (muted[2] ? 4 : 0) | (muted[3] ? 8 : 0);
  }

  /** Solo bits, `1 << stem`. Same stem-3 mapping as `muteMask` (bit 8 = "other" = "Music"). */
  soloMask(deck: DeckIndex): number {
    const solo = this.decks[deck].solo;
    return (solo[0] ? 1 : 0) | (solo[1] ? 2 : 0) | (solo[2] ? 4 : 0) | (solo[3] ? 8 : 0);
  }

  static formatPermyriadPct(gain_pmy: number): string {
    const clamped = Math.max(0, Math.min(STEM_GAIN_MAX_PMY, Math.round(gain_pmy)));
    return `${(clamped / 100).toFixed(1)}%`;
  }

  static formatCrossfader(position_pmy: number): string {
    const position = clampUnitPmy(position_pmy);
    if (position >= 4_900 && position <= 5_100) return "CENTER";
    const right = position / 100;
    const left = 100 - right;
    return `A/C ${left.toFixed(0)}  ·  B/D ${right.toFixed(0)}`;
  }
}
