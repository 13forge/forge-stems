/* @ts-self-types="./forge_audio_wasm_v3.d.ts" */

/**
 * Real-time 4-deck stem mixer wrapper exposed to JavaScript as `Engine`.
 */
export class Engine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_engine_free(ptr, 0);
    }
    /**
     * Clear hotcue `slot` (`0..=7`).
     * @param {number} deck
     * @param {number} slot
     */
    clear_hotcue(deck, slot) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_clear_hotcue(retptr, this.__wbg_ptr, deck, slot);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Read current deck playhead position in frames (`playback_pos`).
     * @param {number} deck
     * @returns {number}
     */
    deck_pos(deck) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_deck_pos(retptr, this.__wbg_ptr, deck);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Loads 4 stems (`drums`, `bass`, `vocal`, `other`) into `deck` (`0..=3`),
     * populates the carrier `Deck::buffer` so `Deck::read_block` (`mixer.rs:431`) is armed,
     * and sets `deck.params.playing = true`.
     * @param {number} deck
     * @param {Float32Array} drums
     * @param {Float32Array} bass
     * @param {Float32Array} vocal
     * @param {Float32Array} other
     */
    load_stems(deck, drums, bass, vocal, other) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_load_stems(retptr, this.__wbg_ptr, deck, addHeapObject(drums), addHeapObject(bass), addHeapObject(vocal), addHeapObject(other));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Halve (`direction < 0`, floor 64 frames) or double (`direction > 0`) the active loop length. Returns new `loop_end`.
     * @param {number} deck
     * @param {number} direction
     * @returns {number}
     */
    loop_resize(deck, direction) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_loop_resize(retptr, this.__wbg_ptr, deck, direction);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Master bus RMS energy (`0.0..=1.0`).
     * @returns {number}
     */
    master_rms() {
        const ret = wasm.engine_master_rms(this.__wbg_ptr);
        return ret;
    }
    /**
     * Construct a new `Engine` with device `sample_rate` and pre-allocated `block_frames`.
     * @param {number} sample_rate
     * @param {number} block_frames
     */
    constructor(sample_rate, block_frames) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_new(retptr, sample_rate, block_frames);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            EngineFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Smoothly nudge `deck` (`0..=3`) playback rate via `Deck::scratch_rate` (decays by 0.95/block to 0).
     * `rate_offset_pmy` is signed permyriad clamped to `-500..=500` (-5% to +5% rate offset).
     * @param {number} deck
     * @param {number} rate_offset_pmy
     */
    nudge_deck(deck, rate_offset_pmy) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_nudge_deck(retptr, this.__wbg_ptr, deck, rate_offset_pmy);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Zero-alloc telemetry readback into a caller-supplied slice of at least 8 `u32`:
     * `[0..4]` playhead frames for decks A..D, `[4]` sub (<100 Hz) pmy, `[5]` mid (100 Hz..4 kHz) pmy,
     * `[6]` high (>4 kHz) pmy, `[7]` master RMS pmy. Every energy value is `0..=10_000`.
     * Float-to-permyriad conversion happens here, at the boundary; the mixer stays f32.
     * @param {Uint32Array} out
     */
    read_telemetry_into(out) {
        var ptr0 = passArray32ToWasm0(out, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.engine_read_telemetry_into(this.__wbg_ptr, ptr0, len0, addHeapObject(out));
    }
    /**
     * Renders `frames` stereo frames from `Mixer::mix_block` and returns a `Float32Array`.
     * @param {number} frames
     * @returns {Float32Array}
     */
    render_block(frames) {
        const ret = wasm.engine_render_block(this.__wbg_ptr, frames);
        return takeObject(ret);
    }
    /**
     * Zero-JS-alloc path for AudioWorklet: copies interleaved samples into caller-owned `out` (`Float32Array`).
     * @param {number} frames
     * @param {Float32Array} out
     */
    render_block_into(frames, out) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_render_block_into(retptr, this.__wbg_ptr, frames, addBorrowedObject(out));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            heap[stack_pointer++] = undefined;
        }
    }
    /**
     * Crossfader throw. `0` = full left (decks A and C), `10_000` = full right (decks B and D).
     * Writes both the target and the smoothed value so the next block is already on the throw
     * (offline export and a UI fader should not wait out the 5 ms smoother).
     * @param {number} position_pmy
     */
    set_crossfader(position_pmy) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_crossfader(retptr, this.__wbg_ptr, position_pmy);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Set crossfader curve: `false` = `SmoothBlend` (equal-power), `true` = `SharpCut`.
     * @param {boolean} sharp_cut
     */
    set_crossfader_curve(sharp_cut) {
        wasm.engine_set_crossfader_curve(this.__wbg_ptr, sharp_cut);
    }
    /**
     * Set master crossfader in integer permyriad (`0` = full left A/C, `5_000` = center, `10_000` = full right B/D).
     * @param {number} cf_pmy
     */
    set_crossfader_pmy(cf_pmy) {
        wasm.engine_set_crossfader_pmy(this.__wbg_ptr, cf_pmy);
    }
    /**
     * Set deck BPM in centi-BPM (`12400` = `124.00`), build its `BeatGrid`, optionally snap playhead to nearest beat.
     * @param {number} deck
     * @param {number} cbpm
     * @param {boolean} snap_now
     * @returns {number}
     */
    set_deck_bpm_cbpm(deck, cbpm, snap_now) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_bpm_cbpm(retptr, this.__wbg_ptr, deck, cbpm, snap_now);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Set per-deck 3-band EQ in dB (`-60.0..=12.0` dB; `-60.0` = full kill, `0.0` = flat).
     * @param {number} deck
     * @param {number} low_db
     * @param {number} mid_db
     * @param {number} high_db
     */
    set_deck_eq_db(deck, low_db, mid_db, high_db) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_eq_db(retptr, this.__wbg_ptr, deck, low_db, mid_db, high_db);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Set bipolar DJ filter in signed permyriad (`-10_000` = full LP, `0` = bypass, `+10_000` = full HP).
     * @param {number} deck
     * @param {number} filter_pmy
     */
    set_deck_filter_pmy(deck, filter_pmy) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_filter_pmy(retptr, this.__wbg_ptr, deck, filter_pmy);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Toggle WSOLA keylock (time-stretch without pitch shift) on `deck` (`0..=3`).
     * @param {number} deck
     * @param {boolean} enabled
     */
    set_deck_keylock(deck, enabled) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_keylock(retptr, this.__wbg_ptr, deck, enabled);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Set deck channel level in integer permyriad (`0..=10_000`, `10_000` = unity). Writes `DeckParams::volume` (`0.0..=1.0`).
     * @param {number} deck
     * @param {number} level_pmy
     */
    set_deck_level_pmy(deck, level_pmy) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_level_pmy(retptr, this.__wbg_ptr, deck, level_pmy);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Configure sample-accurate loop region (`loop_start < loop_end`) with 64-frame equal-power seam crossfade.
     * @param {number} deck
     * @param {boolean} enabled
     * @param {number} start_frame
     * @param {number} end_frame
     */
    set_deck_loop(deck, enabled, start_frame, end_frame) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_loop(retptr, this.__wbg_ptr, deck, enabled, start_frame, end_frame);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Apply a 4-bit mute mask and 4-bit solo mask (`bit 0 = drums, 1 = bass, 2 = vocal, 3 = other`) on `deck` (`0..=3`).
     * Any solo bit set mutes every unsoloed stem; an explicit mute bit always mutes.
     * @param {number} deck
     * @param {number} mute_mask
     * @param {number} solo_mask
     */
    set_deck_mute_solo_masks(deck, mute_mask, solo_mask) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_mute_solo_masks(retptr, this.__wbg_ptr, deck, mute_mask, solo_mask);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Start or pause playback on `deck` (`0..=3`).
     * @param {number} deck
     * @param {boolean} playing
     */
    set_deck_playing(deck, playing) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_playing(retptr, this.__wbg_ptr, deck, playing);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Hard-seek `deck` (`0..=3`) to `pos_frames` (used on cue/jump or Nostr drift >= 2048 frames).
     * @param {number} deck
     * @param {number} pos_frames
     */
    set_deck_pos(deck, pos_frames) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_pos(retptr, this.__wbg_ptr, deck, pos_frames);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Set deck tempo in integer permyriad (`5_000` = 0.5x, `10_000` = 1.0x unity, `20_000` = 2.0x).
     * @param {number} deck
     * @param {number} tempo_pmy
     */
    set_deck_tempo_pmy(deck, tempo_pmy) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_tempo_pmy(retptr, this.__wbg_ptr, deck, tempo_pmy);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Deck fader. `volume_pmy` is `0..=10_000` (`10_000` = unity). Values above unity clamp.
     * This is the mixer's `DeckParams::volume` (`0.0..=1.0`), not a stem fader.
     * @param {number} deck
     * @param {number} volume_pmy
     */
    set_deck_volume(deck, volume_pmy) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_deck_volume(retptr, this.__wbg_ptr, deck, volume_pmy);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Set FX slot `0..=3` wet intensity in integer permyriad (`0..=10_000`).
     * @param {number} slot
     * @param {number} intensity_pmy
     */
    set_fx_intensity_pmy(slot, intensity_pmy) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_fx_intensity_pmy(retptr, this.__wbg_ptr, slot, intensity_pmy);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Assign preset (`"echo"`, `"warm"`, `"far-away"`, `"glitch"`, `"freeze"`, `"hollow"`, `"dread"`, `"shatter"`) to FX slot `0..=3`.
     * @param {number} slot
     * @param {string} preset
     */
    set_fx_slot(slot, preset) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(preset, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.engine_set_fx_slot(retptr, this.__wbg_ptr, slot, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Arm or disarm internal master bus recording (`MAX_RECORD_SAMPLES` = 120 min in `mixer.rs`).
     * @param {boolean} on
     */
    set_recording(on) {
        wasm.engine_set_recording(this.__wbg_ptr, on);
    }
    /**
     * Clamps `gain_pmy` to `STEM_GAIN_MAX_PMY` (`12_500`). Stem index: `0=drums, 1=bass, 2=vocal, 3=other`.
     * @param {number} deck
     * @param {number} stem
     * @param {number} gain_pmy
     */
    set_stem_gain(deck, stem, gain_pmy) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_stem_gain(retptr, this.__wbg_ptr, deck, stem, gain_pmy);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Stem index: `0=drums, 1=bass, 2=vocal, 3=other` (`instruments_muted`).
     * @param {number} deck
     * @param {number} stem
     * @param {boolean} muted
     */
    set_stem_mute(deck, stem, muted) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_set_stem_mute(retptr, this.__wbg_ptr, deck, stem, muted);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 64-bin master FFT magnitude snapshot.
     * @returns {Float32Array}
     */
    spectrum() {
        const ret = wasm.engine_spectrum(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Drain recorded master audio as interleaved stereo `Float32Array` (empty if nothing recorded).
     * @returns {Float32Array}
     */
    take_recording() {
        const ret = wasm.engine_take_recording(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Toggle FX slot `0..=3` enabled state.
     * @param {number} slot
     */
    toggle_fx_slot(slot) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_toggle_fx_slot(retptr, this.__wbg_ptr, slot);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Set or jump to hotcue `slot` (`0..=7`). Empty slot stores `Cue(current_or_target_frame)`; `Cue` jumps; `Loop` jumps and arms the loop.
     * @param {number} deck
     * @param {number} slot
     * @param {number} current_or_target_frame
     * @returns {number}
     */
    trigger_or_set_hotcue(deck, slot, current_or_target_frame) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.engine_trigger_or_set_hotcue(retptr, this.__wbg_ptr, deck, slot, current_or_target_frame);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) Engine.prototype[Symbol.dispose] = Engine.prototype.free;

/**
 * Match integrated loudness and spectral balance of `buf` to `reference`.
 * @param {Float32Array} buf
 * @param {Float32Array} reference
 * @param {number} sample_rate
 * @returns {Float32Array}
 */
export function match_master(buf, reference, sample_rate) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.match_master(retptr, addHeapObject(buf), addHeapObject(reference), sample_rate);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Remix a mono buffer to target BPM, Camelot key, and LUFS loudness.
 * @param {Float32Array} buf
 * @param {number} sample_rate
 * @param {any} target
 * @returns {Float32Array}
 */
export function remix(buf, sample_rate, target) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.remix(retptr, addHeapObject(buf), sample_rate, addHeapObject(target));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Split a buffer into `{ a, b }` (`a` = harmonic, `b` = percussive) via HPSS.
 * @param {Float32Array} buf
 * @param {number} sample_rate
 * @returns {any}
 */
export function stem_split(buf, sample_rate) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.stem_split(retptr, addHeapObject(buf), sample_rate);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * 4-way HPSS cascade wrapper (`drums`, `bass`, `voice`, `other`).
 * Returns a flat `Vec<f32>` (a packed `Float32Array` in JS) of length `4 * signal.len()`:
 * `[0..n]` drums, `[n..2n]` bass, `[2n..3n]` voice, `[3n..4n]` other (Music).
 * Load-time only (allocates). Never call from a realtime block path.
 * @param {Float32Array} signal
 * @param {number} sample_rate
 * @returns {Float32Array}
 */
export function stem_split_four(signal, sample_rate) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF32ToWasm0(signal, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.stem_split_four(retptr, ptr0, len0, sample_rate);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayF32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 4, 4);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_c7f28e53671b41e8: function(arg0, arg1, arg2) {
            new Uint8Array(getObject(arg2).buffer, getObject(arg2).byteOffset, getObject(arg2).byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_is_null_7d13f41e1a2d5140: function(arg0) {
            const ret = getObject(arg0) === null;
            return ret;
        },
        __wbg___wbindgen_is_object_a2790eb24c211ea0: function(arg0) {
            const val = getObject(arg0);
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_number_get_136b9679cab35cfb: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_d154f1e671052120: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_get_971a0c45d172643f: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_length_1009454859bb3e03: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_new_ebe3e0f6837f0879: function() {
            const ret = new Object();
            return addHeapObject(ret);
        },
        __wbg_new_from_slice_709ab7061ebcc5da: function(arg0, arg1) {
            const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_with_length_ef112d2291d8ab95: function(arg0) {
            const ret = new Float32Array(arg0 >>> 0);
            return addHeapObject(ret);
        },
        __wbg_prototypesetcall_10722f4fde830f07: function(arg0, arg1, arg2) {
            Float32Array.prototype.set.call(getArrayF32FromWasm0(arg0, arg1), getObject(arg2));
        },
        __wbg_set_577f5f7485b6744e: function(arg0, arg1, arg2) {
            getObject(arg0).set(getArrayF32FromWasm0(arg1, arg2));
        },
        __wbg_set_8155bb79a948541b: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
            return ret;
        }, arguments); },
        __wbg_subarray_095365bb46f94afd: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./forge_audio_wasm_v3_bg.js": import0,
    };
}

const EngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_engine_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function addBorrowedObject(obj) {
    if (stack_pointer == 1) throw new Error('out of js stack');
    heap[--stack_pointer] = obj;
    return stack_pointer;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export3(addHeapObject(e));
    }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let stack_pointer = 1024;

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('forge_audio_wasm_v3_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
