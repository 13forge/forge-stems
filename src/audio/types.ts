/** Permyriad ceiling. STEM_GAIN_MAX_PMY is 12_500 (+~1.9 dB). 10_000 is unity. */
export const STEM_GAIN_MAX_PMY = 12_500;
export const STEM_GAIN_UNITY_PMY = 10_000;
/** Deck volume and crossfader use the mixer's 0.0..=1.0 range: 10_000 = unity / full right. */
export const UNIT_PMY = 10_000;
export const CROSSFADER_CENTER_PMY = 5_000;
export const WEBAUDIO_QUANTUM_FRAMES = 128;
export const MAX_EXPORT_SECONDS = 300;
export const NUDGE_RATE_MAX_PMY = 500;
/** Phase 2 ranges, mirroring forge-audio-wasm-v3 `Engine` clamps. */
export const TEMPO_MIN_PMY = 5_000;
export const TEMPO_UNITY_PMY = 10_000;
export const TEMPO_MAX_PMY = 20_000;
export const FILTER_MAX_PMY = 10_000;
export const FX_INTENSITY_MAX_PMY = 10_000;
export const EQ_MIN_DB = -60;
export const EQ_MAX_DB = 12;

export type FxSlotIndex = 0 | 1 | 2 | 3;
export type HotcueSlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Song level default when a non-finite value arrives (matches set_deck_level_pmy NaN fallback). */
export const LEVEL_NAN_FALLBACK_PMY = 10_000;
/** Pace range and NaN fallback, mirroring forge-audio-wasm-v3 `set_deck_bpm_cbpm`. */
export const BPM_MIN_CBPM = 4_000;
export const BPM_MAX_CBPM = 24_000;
export const BPM_NAN_FALLBACK_CBPM = 12_000;
/** Four-bit stem mask (`1 << stem`). */
export const STEM_MASK_MAX = 0x0f;
export type EqBand = 0 | 1 | 2; // 0=low, 1=mid, 2=high
export type FxPreset =
  | "echo"
  | "warm"
  | "far-away"
  | "glitch"
  | "freeze"
  | "hollow"
  | "dread"
  | "shatter";
export type CrossfaderCurveName = "smooth" | "sharp";

export const STEM_NAMES = ["DRUMS", "BASS", "VOCAL", "OTHER"] as const;
export const DECK_LETTERS = ["A", "B", "C", "D"] as const;

export type DeckIndex = 0 | 1 | 2 | 3;
export type StemIndex = 0 | 1 | 2 | 3; // 0=drums, 1=bass, 2=vocal, 3=other

export interface RemixTargetSpec {
  target_bpm: number;
  target_key: string;
  loudness_lufs: number;
}

export type WorkletInboundMessage =
  | { type: "INIT_WASM"; wasmBytes: ArrayBuffer }
  | {
      type: "LOAD_STEMS";
      deck: DeckIndex;
      drums: Float32Array;
      bass: Float32Array;
      vocal: Float32Array;
      other: Float32Array;
      gain_pmy: [number, number, number, number];
      muted: [boolean, boolean, boolean, boolean];
      volume_pmy: number;
      playing: boolean;
    }
  | { type: "SET_STEM_GAIN"; deck: DeckIndex; stem: StemIndex; gain_pmy: number }
  | { type: "SET_STEM_MUTE"; deck: DeckIndex; stem: StemIndex; muted: boolean }
  | { type: "SET_DECK_VOLUME"; deck: DeckIndex; volume_pmy: number }
  | { type: "SET_DECK_PLAYING"; deck: DeckIndex; playing: boolean }
  | { type: "SET_DECK_POS"; deck: DeckIndex; pos_frames: number }
  | { type: "NUDGE_DECK"; deck: DeckIndex; rate_offset_pmy: number }
  | { type: "SET_CROSSFADER"; position_pmy: number }
  | { type: "SET_CROSSFADER_PMY"; cf_pmy: number }
  | { type: "SET_CROSSFADER_CURVE"; sharp_cut: boolean }
  | { type: "SET_DECK_TEMPO_PMY"; deck: DeckIndex; tempo_pmy: number }
  | { type: "SET_DECK_KEYLOCK"; deck: DeckIndex; enabled: boolean }
  | { type: "SET_DECK_EQ_DB"; deck: DeckIndex; low_db: number; mid_db: number; high_db: number }
  | { type: "SET_DECK_FILTER_PMY"; deck: DeckIndex; filter_pmy: number }
  | { type: "SET_FX_SLOT"; slot: FxSlotIndex; preset: string }
  | { type: "TOGGLE_FX_SLOT"; slot: FxSlotIndex }
  | { type: "SET_FX_INTENSITY_PMY"; slot: FxSlotIndex; intensity_pmy: number }
  | { type: "SET_DECK_LEVEL_PMY"; deck: DeckIndex; level_pmy: number }
  | { type: "SET_DECK_MUTE_SOLO_MASKS"; deck: DeckIndex; mute_mask: number; solo_mask: number }
  | { type: "TRIGGER_OR_SET_HOTCUE"; deck: DeckIndex; slot: HotcueSlotIndex; frame: number }
  | { type: "CLEAR_HOTCUE"; deck: DeckIndex; slot: HotcueSlotIndex }
  | { type: "LOOP_RESIZE"; deck: DeckIndex; direction: -1 | 1 }
  | { type: "SET_DECK_BPM_CBPM"; deck: DeckIndex; cbpm: number; snap: boolean }
  | { type: "SET_DECK_LOOP"; deck: DeckIndex; enabled: boolean; start_frame: number; end_frame: number };

export type WorkletOutboundMessage =
  | { type: "READY" }
  | { type: "TELEMETRY"; rms: number; spectrum: Float32Array }
  | { type: "ERROR"; message: string };

/** One deck of equal-length stems plus the fader state the offline render should apply. */
export interface OfflineDeckSpec {
  drums: Float32Array;
  bass: Float32Array;
  vocal: Float32Array;
  other: Float32Array;
  gain_pmy: [number, number, number, number];
  muted: [boolean, boolean, boolean, boolean];
  volume_pmy: number;
  playing: boolean;
}

export type WorkerRequest =
  | { id: number; op: "STEM_SPLIT"; buf: Float32Array; sample_rate: number }
  | { id: number; op: "REMIX"; buf: Float32Array; sample_rate: number; target: RemixTargetSpec }
  | {
      id: number;
      op: "MATCH_MASTER";
      buf: Float32Array;
      reference: Float32Array;
      sample_rate: number;
    }
  | {
      id: number;
      op: "RENDER_MIX";
      sample_rate: number;
      frames: number;
      crossfader_pmy: number;
      decks: OfflineDeckSpec[];
    };

export type WorkerResponse =
  | { id: number; ok: true; op: "STEM_SPLIT"; a: Float32Array; b: Float32Array }
  | { id: number; ok: true; op: "REMIX" | "MATCH_MASTER"; out: Float32Array }
  | { id: number; ok: true; op: "RENDER_MIX"; left: Float32Array; right: Float32Array }
  | { id: number; ok: false; error: string };

/** Clamps any JS number into an integer permyriad `u16` in `0..=STEM_GAIN_MAX_PMY` (12_500). */
export function clampStemGainPmy(gain_pmy: number): number {
  if (!Number.isFinite(gain_pmy)) return 0;
  const rounded = Math.round(gain_pmy);
  return Math.max(0, Math.min(STEM_GAIN_MAX_PMY, rounded));
}

/** Clamps deck volume or crossfader into integer permyriad `0..=10_000`. */
export function clampUnitPmy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return Math.max(0, Math.min(UNIT_PMY, rounded));
}

/** Song level: `0..=10_000`; non-finite falls back to unity (10_000). */
export function clampLevelPmy(value: number): number {
  if (!Number.isFinite(value)) return LEVEL_NAN_FALLBACK_PMY;
  return Math.max(0, Math.min(UNIT_PMY, Math.round(value)));
}

/** Pace in centi-BPM `4_000..=24_000`; non-finite falls back to 120.00 BPM. */
export function clampBpmCbpm(value: number): number {
  if (!Number.isFinite(value)) return BPM_NAN_FALLBACK_CBPM;
  return Math.max(BPM_MIN_CBPM, Math.min(BPM_MAX_CBPM, Math.round(value)));
}

/** 4-bit stem mask in `0..=0x0F`; non-finite is empty (0). */
export function clampStemMask(mask: number): number {
  if (!Number.isFinite(mask)) return 0;
  return Math.max(0, Math.min(STEM_MASK_MAX, Math.round(mask)));
}

/** Clamps nudge rate offset into signed integer permyriad `-500..=500`. */
export function clampNudgePmy(rate_offset_pmy: number): number {
  if (!Number.isFinite(rate_offset_pmy)) return 0;
  const rounded = Math.round(rate_offset_pmy);
  return Math.max(-NUDGE_RATE_MAX_PMY, Math.min(NUDGE_RATE_MAX_PMY, rounded));
}

/** Clamps deck tempo into `5_000..=20_000` pmy; non-finite falls back to unity. */
export function clampTempoPmy(value: number): number {
  if (!Number.isFinite(value)) return TEMPO_UNITY_PMY;
  return Math.max(TEMPO_MIN_PMY, Math.min(TEMPO_MAX_PMY, Math.round(value)));
}

/** Clamps bipolar filter into `-10_000..=10_000` pmy; non-finite is bypass (0). */
export function clampFilterPmy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-FILTER_MAX_PMY, Math.min(FILTER_MAX_PMY, Math.round(value)));
}

/** Clamps a 3-band EQ gain into `-60..=12` dB; non-finite is flat (0 dB). */
export function clampEqDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, value));
}

/** Clamps FX slot wet intensity into `0..=10_000` pmy. */
export function clampFxIntensityPmy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(FX_INTENSITY_MAX_PMY, Math.round(value)));
}

/** Enforces the 300 s hard duration cap before buffers cross the WASM boundary. */
export function assertWithin300sCap(samples: number, sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples <= 0) {
    throw new Error("ERR_EMPTY_OR_INVALID_BUFFER");
  }
  const maxSamples = Math.floor(sampleRate) * MAX_EXPORT_SECONDS;
  if (samples > maxSamples) {
    throw new Error(`EXPORT_DURATION_EXCEEDS_300S_CAP: ${samples} > ${maxSamples}`);
  }
}

/** De-interleaves stereo `[L0, R0, L1, R1, ...]` into planar `outL` and `outR` with zero allocations. */
export function deinterleaveStereoBlock(
  interleaved: Float32Array,
  outL: Float32Array,
  outR: Float32Array,
  frames: number,
): void {
  for (let i = 0; i < frames; i++) {
    const idx = i * 2;
    outL[i] = interleaved[idx];
    outR[i] = interleaved[idx + 1];
  }
}
