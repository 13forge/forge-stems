/* tslint:disable */
/* eslint-disable */

/**
 * Real-time 4-deck stem mixer wrapper exposed to JavaScript as `Engine`.
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Clear hotcue `slot` (`0..=7`).
     */
    clear_hotcue(deck: number, slot: number): void;
    /**
     * Read current deck playhead position in frames (`playback_pos`).
     */
    deck_pos(deck: number): number;
    /**
     * Loads 4 stems (`drums`, `bass`, `vocal`, `other`) into `deck` (`0..=3`),
     * populates the carrier `Deck::buffer` so `Deck::read_block` (`mixer.rs:431`) is armed,
     * and sets `deck.params.playing = true`.
     */
    load_stems(deck: number, drums: Float32Array, bass: Float32Array, vocal: Float32Array, other: Float32Array): void;
    /**
     * Halve (`direction < 0`, floor 64 frames) or double (`direction > 0`) the active loop length. Returns new `loop_end`.
     */
    loop_resize(deck: number, direction: number): number;
    /**
     * Master bus RMS energy (`0.0..=1.0`).
     */
    master_rms(): number;
    /**
     * Construct a new `Engine` with device `sample_rate` and pre-allocated `block_frames`.
     */
    constructor(sample_rate: number, block_frames: number);
    /**
     * Smoothly nudge `deck` (`0..=3`) playback rate via `Deck::scratch_rate` (decays by 0.95/block to 0).
     * `rate_offset_pmy` is signed permyriad clamped to `-500..=500` (-5% to +5% rate offset).
     */
    nudge_deck(deck: number, rate_offset_pmy: number): void;
    /**
     * Zero-alloc telemetry readback into a caller-supplied slice of at least 8 `u32`:
     * `[0..4]` playhead frames for decks A..D, `[4]` sub (<100 Hz) pmy, `[5]` mid (100 Hz..4 kHz) pmy,
     * `[6]` high (>4 kHz) pmy, `[7]` master RMS pmy. Every energy value is `0..=10_000`.
     * Float-to-permyriad conversion happens here, at the boundary; the mixer stays f32.
     */
    read_telemetry_into(out: Uint32Array): void;
    /**
     * Renders `frames` stereo frames from `Mixer::mix_block` and returns a `Float32Array`.
     */
    render_block(frames: number): Float32Array;
    /**
     * Zero-JS-alloc path for AudioWorklet: copies interleaved samples into caller-owned `out` (`Float32Array`).
     */
    render_block_into(frames: number, out: Float32Array): void;
    /**
     * Crossfader throw. `0` = full left (decks A and C), `10_000` = full right (decks B and D).
     * Writes both the target and the smoothed value so the next block is already on the throw
     * (offline export and a UI fader should not wait out the 5 ms smoother).
     */
    set_crossfader(position_pmy: number): void;
    /**
     * Set crossfader curve: `false` = `SmoothBlend` (equal-power), `true` = `SharpCut`.
     */
    set_crossfader_curve(sharp_cut: boolean): void;
    /**
     * Set master crossfader in integer permyriad (`0` = full left A/C, `5_000` = center, `10_000` = full right B/D).
     */
    set_crossfader_pmy(cf_pmy: number): void;
    /**
     * Set deck BPM in centi-BPM (`12400` = `124.00`), build its `BeatGrid`, optionally snap playhead to nearest beat.
     */
    set_deck_bpm_cbpm(deck: number, cbpm: number, snap_now: boolean): number;
    /**
     * Set per-deck 3-band EQ in dB (`-60.0..=12.0` dB; `-60.0` = full kill, `0.0` = flat).
     */
    set_deck_eq_db(deck: number, low_db: number, mid_db: number, high_db: number): void;
    /**
     * Set bipolar DJ filter in signed permyriad (`-10_000` = full LP, `0` = bypass, `+10_000` = full HP).
     */
    set_deck_filter_pmy(deck: number, filter_pmy: number): void;
    /**
     * Toggle WSOLA keylock (time-stretch without pitch shift) on `deck` (`0..=3`).
     */
    set_deck_keylock(deck: number, enabled: boolean): void;
    /**
     * Set deck channel level in integer permyriad (`0..=10_000`, `10_000` = unity). Writes `DeckParams::volume` (`0.0..=1.0`).
     */
    set_deck_level_pmy(deck: number, level_pmy: number): void;
    /**
     * Configure sample-accurate loop region (`loop_start < loop_end`) with 64-frame equal-power seam crossfade.
     */
    set_deck_loop(deck: number, enabled: boolean, start_frame: number, end_frame: number): void;
    /**
     * Apply a 4-bit mute mask and 4-bit solo mask (`bit 0 = drums, 1 = bass, 2 = vocal, 3 = other`) on `deck` (`0..=3`).
     * Any solo bit set mutes every unsoloed stem; an explicit mute bit always mutes.
     */
    set_deck_mute_solo_masks(deck: number, mute_mask: number, solo_mask: number): void;
    /**
     * Start or pause playback on `deck` (`0..=3`).
     */
    set_deck_playing(deck: number, playing: boolean): void;
    /**
     * Hard-seek `deck` (`0..=3`) to `pos_frames` (used on cue/jump or Nostr drift >= 2048 frames).
     */
    set_deck_pos(deck: number, pos_frames: number): void;
    /**
     * Set deck tempo in integer permyriad (`5_000` = 0.5x, `10_000` = 1.0x unity, `20_000` = 2.0x).
     */
    set_deck_tempo_pmy(deck: number, tempo_pmy: number): void;
    /**
     * Deck fader. `volume_pmy` is `0..=10_000` (`10_000` = unity). Values above unity clamp.
     * This is the mixer's `DeckParams::volume` (`0.0..=1.0`), not a stem fader.
     */
    set_deck_volume(deck: number, volume_pmy: number): void;
    /**
     * Set FX slot `0..=3` wet intensity in integer permyriad (`0..=10_000`).
     */
    set_fx_intensity_pmy(slot: number, intensity_pmy: number): void;
    /**
     * Assign preset (`"echo"`, `"warm"`, `"far-away"`, `"glitch"`, `"freeze"`, `"hollow"`, `"dread"`, `"shatter"`) to FX slot `0..=3`.
     */
    set_fx_slot(slot: number, preset: string): void;
    /**
     * Arm or disarm internal master bus recording (`MAX_RECORD_SAMPLES` = 120 min in `mixer.rs`).
     */
    set_recording(on: boolean): void;
    /**
     * Clamps `gain_pmy` to `STEM_GAIN_MAX_PMY` (`12_500`). Stem index: `0=drums, 1=bass, 2=vocal, 3=other`.
     */
    set_stem_gain(deck: number, stem: number, gain_pmy: number): void;
    /**
     * Stem index: `0=drums, 1=bass, 2=vocal, 3=other` (`instruments_muted`).
     */
    set_stem_mute(deck: number, stem: number, muted: boolean): void;
    /**
     * 64-bin master FFT magnitude snapshot.
     */
    spectrum(): Float32Array;
    /**
     * Drain recorded master audio as interleaved stereo `Float32Array` (empty if nothing recorded).
     */
    take_recording(): Float32Array;
    /**
     * Toggle FX slot `0..=3` enabled state.
     */
    toggle_fx_slot(slot: number): void;
    /**
     * Set or jump to hotcue `slot` (`0..=7`). Empty slot stores `Cue(current_or_target_frame)`; `Cue` jumps; `Loop` jumps and arms the loop.
     */
    trigger_or_set_hotcue(deck: number, slot: number, current_or_target_frame: number): number;
}

/**
 * Match integrated loudness and spectral balance of `buf` to `reference`.
 */
export function match_master(buf: Float32Array, reference: Float32Array, sample_rate: number): Float32Array;

/**
 * Remix a mono buffer to target BPM, Camelot key, and LUFS loudness.
 */
export function remix(buf: Float32Array, sample_rate: number, target: any): Float32Array;

/**
 * Split a buffer into `{ a, b }` (`a` = harmonic, `b` = percussive) via HPSS.
 */
export function stem_split(buf: Float32Array, sample_rate: number): any;

/**
 * 4-way HPSS cascade wrapper (`drums`, `bass`, `voice`, `other`).
 * Returns a flat `Vec<f32>` (a packed `Float32Array` in JS) of length `4 * signal.len()`:
 * `[0..n]` drums, `[n..2n]` bass, `[2n..3n]` voice, `[3n..4n]` other (Music).
 * Load-time only (allocates). Never call from a realtime block path.
 */
export function stem_split_four(signal: Float32Array, sample_rate: number): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_clear_hotcue: (a: number, b: number, c: number, d: number) => void;
    readonly engine_deck_pos: (a: number, b: number, c: number) => void;
    readonly engine_load_stems: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly engine_loop_resize: (a: number, b: number, c: number, d: number) => void;
    readonly engine_master_rms: (a: number) => number;
    readonly engine_new: (a: number, b: number, c: number) => void;
    readonly engine_nudge_deck: (a: number, b: number, c: number, d: number) => void;
    readonly engine_read_telemetry_into: (a: number, b: number, c: number, d: number) => void;
    readonly engine_render_block: (a: number, b: number) => number;
    readonly engine_render_block_into: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_crossfader: (a: number, b: number, c: number) => void;
    readonly engine_set_crossfader_curve: (a: number, b: number) => void;
    readonly engine_set_crossfader_pmy: (a: number, b: number) => void;
    readonly engine_set_deck_bpm_cbpm: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_set_deck_eq_db: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly engine_set_deck_filter_pmy: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_deck_keylock: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_deck_level_pmy: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_deck_loop: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly engine_set_deck_mute_solo_masks: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_set_deck_playing: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_deck_pos: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_deck_tempo_pmy: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_deck_volume: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_fx_intensity_pmy: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_fx_slot: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_set_recording: (a: number, b: number) => void;
    readonly engine_set_stem_gain: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_set_stem_mute: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_spectrum: (a: number) => number;
    readonly engine_take_recording: (a: number) => number;
    readonly engine_toggle_fx_slot: (a: number, b: number, c: number) => void;
    readonly engine_trigger_or_set_hotcue: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly match_master: (a: number, b: number, c: number, d: number) => void;
    readonly remix: (a: number, b: number, c: number, d: number) => void;
    readonly stem_split: (a: number, b: number, c: number) => void;
    readonly stem_split_four: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
