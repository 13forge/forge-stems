import { Engine } from "@wasm/forge_audio_wasm_v3.js";
import {
  assertWithin300sCap,
  clampStemGainPmy,
  clampUnitPmy,
  WEBAUDIO_QUANTUM_FRAMES,
  type OfflineDeckSpec,
} from "./types.js";

export interface OfflineMixRequest {
  sampleRate: number;
  frames: number;
  crossfader_pmy: number;
  decks: OfflineDeckSpec[];
}

/**
 * Renders the current mix through a fresh `Engine` on the caller thread.
 * The 128-frame scratch buffer is allocated once and reused for every block.
 * WASM must already be initialized (`init` / `initSync`) before calling.
 */
export function renderMixPcm(request: OfflineMixRequest): { left: Float32Array; right: Float32Array } {
  assertWithin300sCap(request.frames, request.sampleRate);
  const engine = new Engine(request.sampleRate, WEBAUDIO_QUANTUM_FRAMES);
  for (let deck = 0; deck < request.decks.length && deck < 4; deck++) {
    const spec = request.decks[deck];
    if (!spec.playing || spec.drums.length === 0) continue;
    const frames = spec.drums.length;
    if (spec.bass.length !== frames || spec.vocal.length !== frames || spec.other.length !== frames) {
      throw new Error("ERR_STEM_LENGTH_MISMATCH");
    }
    engine.load_stems(deck, spec.drums, spec.bass, spec.vocal, spec.other);
    for (let stem = 0; stem < 4; stem++) {
      engine.set_stem_gain(deck, stem, clampStemGainPmy(spec.gain_pmy[stem]));
      engine.set_stem_mute(deck, stem, spec.muted[stem]);
    }
    engine.set_deck_volume(deck, clampUnitPmy(spec.volume_pmy));
    engine.set_deck_playing(deck, true);
  }
  engine.set_crossfader(clampUnitPmy(request.crossfader_pmy));

  const left = new Float32Array(request.frames);
  const right = new Float32Array(request.frames);
  const interleaved = new Float32Array(WEBAUDIO_QUANTUM_FRAMES * 2);
  let rendered = 0;
  while (rendered < request.frames) {
    const count = Math.min(WEBAUDIO_QUANTUM_FRAMES, request.frames - rendered);
    engine.render_block_into(count, interleaved);
    for (let i = 0; i < count; i++) {
      left[rendered + i] = interleaved[i * 2];
      right[rendered + i] = interleaved[i * 2 + 1];
    }
    rendered += count;
  }
  return { left, right };
}
