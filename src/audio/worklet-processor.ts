import "./worklet-text.js";
import { initSync, Engine } from "@wasm/forge_audio_wasm_v3.js";
import {
  clampBpmCbpm,
  clampEqDb,
  clampFilterPmy,
  clampFxIntensityPmy,
  clampLevelPmy,
  clampNudgePmy,
  clampStemGainPmy,
  clampStemMask,
  clampTempoPmy,
  clampUnitPmy,
  deinterleaveStereoBlock,
  WEBAUDIO_QUANTUM_FRAMES,
  type WorkletInboundMessage,
} from "./types.js";

const TELEMETRY_STRIDE_QUANTA = 6; // ~62.5 Hz at 48 kHz / 128-frame quantum

class ForgeRemixWorkletProcessor extends AudioWorkletProcessor {
  private engine: Engine | null = null;
  private readonly interleavedBuf = new Float32Array(WEBAUDIO_QUANTUM_FRAMES * 2);
  private quantaCounter = 0;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<WorkletInboundMessage>) => {
      this.handleMessage(ev.data);
    };
  }

  private handleMessage(msg: WorkletInboundMessage): void {
    try {
      if (msg.type === "INIT_WASM") {
        initSync({ module: msg.wasmBytes });
        this.engine = new Engine(sampleRate, WEBAUDIO_QUANTUM_FRAMES);
        this.port.postMessage({ type: "READY" });
        return;
      }
      const engine = this.engine;
      if (!engine) return;

      switch (msg.type) {
        case "LOAD_STEMS":
          engine.load_stems(msg.deck, msg.drums, msg.bass, msg.vocal, msg.other);
          for (let stem = 0; stem < 4; stem++) {
            engine.set_stem_gain(msg.deck, stem, clampStemGainPmy(msg.gain_pmy[stem]));
            engine.set_stem_mute(msg.deck, stem, msg.muted[stem]);
          }
          engine.set_deck_volume(msg.deck, clampUnitPmy(msg.volume_pmy));
          engine.set_deck_playing(msg.deck, msg.playing);
          break;
        case "SET_STEM_GAIN":
          engine.set_stem_gain(msg.deck, msg.stem, clampStemGainPmy(msg.gain_pmy));
          break;
        case "SET_STEM_MUTE":
          engine.set_stem_mute(msg.deck, msg.stem, msg.muted);
          break;
        case "SET_DECK_VOLUME":
          engine.set_deck_volume(msg.deck, clampUnitPmy(msg.volume_pmy));
          break;
        case "SET_DECK_PLAYING":
          engine.set_deck_playing(msg.deck, msg.playing);
          break;
        case "SET_DECK_POS":
          engine.set_deck_pos(msg.deck, msg.pos_frames >>> 0);
          break;
        case "NUDGE_DECK":
          engine.nudge_deck(msg.deck, clampNudgePmy(msg.rate_offset_pmy));
          break;
        case "SET_CROSSFADER":
          engine.set_crossfader(clampUnitPmy(msg.position_pmy));
          break;
        case "SET_CROSSFADER_PMY":
          engine.set_crossfader_pmy(clampUnitPmy(msg.cf_pmy));
          break;
        case "SET_CROSSFADER_CURVE":
          engine.set_crossfader_curve(msg.sharp_cut);
          break;
        case "SET_DECK_TEMPO_PMY":
          engine.set_deck_tempo_pmy(msg.deck, clampTempoPmy(msg.tempo_pmy));
          break;
        case "SET_DECK_KEYLOCK":
          engine.set_deck_keylock(msg.deck, msg.enabled);
          break;
        case "SET_DECK_EQ_DB":
          engine.set_deck_eq_db(
            msg.deck,
            clampEqDb(msg.low_db),
            clampEqDb(msg.mid_db),
            clampEqDb(msg.high_db),
          );
          break;
        case "SET_DECK_FILTER_PMY":
          engine.set_deck_filter_pmy(msg.deck, clampFilterPmy(msg.filter_pmy));
          break;
        case "SET_FX_SLOT":
          engine.set_fx_slot(msg.slot, msg.preset);
          break;
        case "TOGGLE_FX_SLOT":
          engine.toggle_fx_slot(msg.slot);
          break;
        case "SET_FX_INTENSITY_PMY":
          engine.set_fx_intensity_pmy(msg.slot, clampFxIntensityPmy(msg.intensity_pmy));
          break;
        case "SET_DECK_LEVEL_PMY":
          engine.set_deck_level_pmy(msg.deck, clampLevelPmy(msg.level_pmy));
          break;
        case "SET_DECK_MUTE_SOLO_MASKS":
          engine.set_deck_mute_solo_masks(
            msg.deck,
            clampStemMask(msg.mute_mask),
            clampStemMask(msg.solo_mask),
          );
          break;
        case "TRIGGER_OR_SET_HOTCUE":
          engine.trigger_or_set_hotcue(msg.deck, msg.slot, msg.frame >>> 0);
          break;
        case "CLEAR_HOTCUE":
          engine.clear_hotcue(msg.deck, msg.slot);
          break;
        case "LOOP_RESIZE":
          engine.loop_resize(msg.deck, msg.direction);
          break;
        case "SET_DECK_BPM_CBPM":
          engine.set_deck_bpm_cbpm(msg.deck, clampBpmCbpm(msg.cbpm), msg.snap);
          break;
        case "SET_DECK_LOOP":
          engine.set_deck_loop(msg.deck, msg.enabled, msg.start_frame >>> 0, msg.end_frame >>> 0);
          break;
      }
    } catch (err) {
      this.port.postMessage({ type: "ERROR", message: String(err) });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out[1] ?? out[0];
    const frames = outL.length;

    const engine = this.engine;
    if (!engine) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    if (frames === WEBAUDIO_QUANTUM_FRAMES) {
      engine.render_block_into(frames, this.interleavedBuf);
      deinterleaveStereoBlock(this.interleavedBuf, outL, outR, frames);
    } else {
      const rendered = engine.render_block(frames);
      deinterleaveStereoBlock(rendered, outL, outR, frames);
    }

    this.quantaCounter++;
    if (this.quantaCounter >= TELEMETRY_STRIDE_QUANTA) {
      this.quantaCounter = 0;
      const rms = engine.master_rms();
      const spectrum = engine.spectrum();
      this.port.postMessage({ type: "TELEMETRY", rms, spectrum }, [spectrum.buffer]);
    }
    return true;
  }
}

registerProcessor("forge-remix-worklet", ForgeRemixWorkletProcessor);
