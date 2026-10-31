import { PerformanceFx, type EchoDivision, type MixCapture } from "./performance-fx.js";
import { planFxArm, type FxArmMessage } from "./fx-arm.js";
import {
  clampBpmCbpm,
  clampLevelPmy,
  clampNudgePmy,
  clampStemGainPmy,
  clampStemMask,
  clampUnitPmy,
  type DeckIndex,
  type FxSlotIndex,
  type HotcueSlotIndex,
  type OfflineDeckSpec,
  type RemixTargetSpec,
  type StemIndex,
  type WorkerRequest,
  type WorkerResponse,
  type WorkletInboundMessage,
  type WorkletOutboundMessage,
} from "./types.js";

export interface TelemetryListener {
  (rms: number, spectrum: Float32Array, positions: [number, number, number, number]): void;
}

export class RemixAudioBridge {
  private ctx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private dspWorker: Worker | null = null;
  private nextReqId = 1;
  private pending = new Map<
    number,
    { resolve: (val: WorkerResponse) => void; reject: (err: Error) => void }
  >();
  private telemetryListener: TelemetryListener | null = null;
  private errorListener: ((message: string) => void) | null = null;
  private initPromise: Promise<void> | null = null;
  private fx: PerformanceFx | null = null;
  private readonly positions: [number, number, number, number] = [0, 0, 0, 0];
  /** Engine `toggle_fx_slot` is relative. This tracks the bit we last sent. */
  private readonly engineFxOn: [boolean, boolean, boolean, boolean] = [false, false, false, false];

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48_000;
  }

  get isReady(): boolean {
    return this.ctx !== null && this.workletNode !== null;
  }

  get audioState(): AudioContextState | "closed" {
    return this.ctx?.state ?? "closed";
  }

  get playheads(): readonly [number, number, number, number] {
    return this.positions;
  }

  /** First play (and any later play) must resume a suspended context. */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  async init(wasmUrl: string | URL, workletModuleUrl: string | URL): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.start(wasmUrl, workletModuleUrl).catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  private async start(wasmUrl: string | URL, workletModuleUrl: string | URL): Promise<void> {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule(workletModuleUrl);

    const wasmResp = await fetch(wasmUrl);
    const wasmBytes = await wasmResp.arrayBuffer();

    const node = new AudioWorkletNode(ctx, "forge-remix-worklet", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const fx = new PerformanceFx(ctx);
    node.connect(fx.input);
    fx.connect(ctx.destination);
    this.fx = fx;

    await new Promise<void>((resolve, reject) => {
      node.port.onmessage = (ev: MessageEvent<WorkletOutboundMessage>) => {
        const msg = ev.data;
        if (msg.type === "READY") {
          resolve();
        } else if (msg.type === "TELEMETRY") {
          this.positions[0] = msg.positions[0] ?? 0;
          this.positions[1] = msg.positions[1] ?? 0;
          this.positions[2] = msg.positions[2] ?? 0;
          this.positions[3] = msg.positions[3] ?? 0;
          this.telemetryListener?.(msg.rms, msg.spectrum, this.positions);
        } else if (msg.type === "ERROR") {
          if (this.isReady) this.errorListener?.(msg.message);
          else reject(new Error(msg.message));
        }
      };
      this.postToWorklet(node, { type: "INIT_WASM", wasmBytes }, [wasmBytes]);
    });

    this.ctx = ctx;
    this.workletNode = node;
    this.dspWorker = new Worker(new URL("./dsp-worker.ts", import.meta.url), {
      type: "module",
    });
    this.dspWorker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      const entry = this.pending.get(res.id);
      if (!entry) return;
      this.pending.delete(res.id);
      if (res.ok) {
        entry.resolve(res);
      } else {
        entry.reject(new Error(res.error));
      }
    };
  }

  async decodeFileToMono(file: File): Promise<{ pcm: Float32Array; sampleRate: number }> {
    const arrayBuf = await file.arrayBuffer();
    const tempCtx = this.ctx ?? new AudioContext();
    const audioBuf = await tempCtx.decodeAudioData(arrayBuf);
    const len = audioBuf.length;
    const ch0 = audioBuf.getChannelData(0);
    if (audioBuf.numberOfChannels === 1) {
      return { pcm: ch0.slice(), sampleRate: audioBuf.sampleRate };
    }
    const ch1 = audioBuf.getChannelData(1);
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      mono[i] = 0.5 * (ch0[i] + ch1[i]);
    }
    return { pcm: mono, sampleRate: audioBuf.sampleRate };
  }

  onTelemetry(listener: TelemetryListener): void {
    this.telemetryListener = listener;
  }

  onError(listener: (message: string) => void): void {
    this.errorListener = listener;
  }

  /**
   * Loads four equal-length stems and applies fader state in the same worklet turn,
   * so `load_stems` (which starts the deck) cannot audibly outrun mute and play.
   * Transfers `drums/bass/vocal/other`. Pass copies; the originals are neutered.
   */
  loadStems(
    deck: DeckIndex,
    drums: Float32Array,
    bass: Float32Array,
    vocal: Float32Array,
    other: Float32Array,
    state: {
      gain_pmy: [number, number, number, number];
      muted: [boolean, boolean, boolean, boolean];
      volume_pmy: number;
      playing: boolean;
    },
  ): void {
    if (!this.workletNode) throw new Error("ERR_BRIDGE_NOT_INITIALIZED");
    this.postToWorklet(
      this.workletNode,
      {
        type: "LOAD_STEMS",
        deck,
        drums,
        bass,
        vocal,
        other,
        gain_pmy: state.gain_pmy,
        muted: state.muted,
        volume_pmy: clampUnitPmy(state.volume_pmy),
        playing: state.playing,
      },
      [drums.buffer, bass.buffer, vocal.buffer, other.buffer],
    );
  }

  setStemGain(deck: DeckIndex, stem: StemIndex, gain_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "SET_STEM_GAIN",
      deck,
      stem,
      gain_pmy: clampStemGainPmy(gain_pmy),
    });
  }

  setStemMute(deck: DeckIndex, stem: StemIndex, muted: boolean): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_STEM_MUTE", deck, stem, muted });
  }

  setDeckVolume(deck: DeckIndex, volume_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "SET_DECK_VOLUME",
      deck,
      volume_pmy: clampUnitPmy(volume_pmy),
    });
  }

  setCrossfader(position_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "SET_CROSSFADER",
      position_pmy: clampUnitPmy(position_pmy),
    });
  }

  setDeckPlaying(deck: DeckIndex, playing: boolean): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_DECK_PLAYING", deck, playing });
  }

  setDeckPos(deck: DeckIndex, pos_frames: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "SET_DECK_POS",
      deck,
      pos_frames: pos_frames >>> 0,
    });
  }

  nudgeDeck(deck: DeckIndex, rate_offset_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "NUDGE_DECK",
      deck,
      rate_offset_pmy: clampNudgePmy(rate_offset_pmy),
    });
  }

  setCrossfaderPmy(cf_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_CROSSFADER_PMY", cf_pmy });
  }

  setCrossfaderCurve(sharp_cut: boolean): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_CROSSFADER_CURVE", sharp_cut });
  }

  setDeckTempoPmy(deck: DeckIndex, tempo_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_DECK_TEMPO_PMY", deck, tempo_pmy });
  }

  setDeckKeylock(deck: DeckIndex, enabled: boolean): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_DECK_KEYLOCK", deck, enabled });
  }

  setDeckEqDb(deck: DeckIndex, low_db: number, mid_db: number, high_db: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_DECK_EQ_DB", deck, low_db, mid_db, high_db });
  }

  setDeckFilterPmy(deck: DeckIndex, filter_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_DECK_FILTER_PMY", deck, filter_pmy });
  }

  applyFxPlan(messages: readonly FxArmMessage[]): void {
    for (const msg of messages) {
      if (msg.type === "SET_FX_SLOT") this.setFxSlot(msg.slot, msg.preset);
      else if (msg.type === "SET_FX_INTENSITY_PMY") this.setFxIntensityPmy(msg.slot, msg.intensity_pmy);
      else this.toggleFxSlot(msg.slot);
    }
  }

  /**
   * Send preset and wet amount before any toggle. A bare `toggle_fx_slot` opens a dry-killing insert.
   * Returns the intensity that was sent.
   */
  armFxSlot(slot: FxSlotIndex, preset: string, intensity_pmy: number, nextOn: boolean): number {
    const plan = planFxArm({
      slot,
      preset,
      intensity_pmy,
      engineOn: this.engineFxOn[slot],
      nextOn,
    });
    const intensity = plan[1].type === "SET_FX_INTENSITY_PMY" ? plan[1].intensity_pmy : intensity_pmy;
    if (!this.workletNode) return intensity;
    this.applyFxPlan(plan);
    if (plan.some((msg) => msg.type === "TOGGLE_FX_SLOT")) this.engineFxOn[slot] = nextOn;
    return intensity;
  }

  setPerformanceEcho(on: boolean, amountPmy: number, division: EchoDivision, bpm: number): void {
    this.fx?.setBpm(bpm);
    this.fx?.setEcho(on, amountPmy, division);
  }

  setPerformanceReverb(on: boolean, amountPmy: number): void {
    this.fx?.setReverb(on, amountPmy);
  }

  setPerformanceFilter(on: boolean, pmy: number): void {
    this.fx?.setFilter(on, pmy);
  }

  holdEchoOut(): void {
    this.fx?.holdEchoOut();
  }

  releaseEchoOut(): void {
    this.fx?.releaseEchoOut();
  }

  holdBuildup(): void {
    this.fx?.holdBuildup();
  }

  releaseBuildup(): void {
    this.fx?.releaseBuildup();
  }

  captureMix(): MixCapture | null {
    return this.fx?.capture() ?? null;
  }

  setFxSlot(slot: 0 | 1 | 2 | 3, preset: string): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_FX_SLOT", slot, preset });
  }

  toggleFxSlot(slot: 0 | 1 | 2 | 3): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "TOGGLE_FX_SLOT", slot });
  }

  setFxIntensityPmy(slot: 0 | 1 | 2 | 3, intensity_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "SET_FX_INTENSITY_PMY", slot, intensity_pmy });
  }

  setDeckLevelPmy(deck: DeckIndex, level_pmy: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "SET_DECK_LEVEL_PMY",
      deck,
      level_pmy: clampLevelPmy(level_pmy),
    });
  }

  /** `mute_mask` / `solo_mask` are 4-bit masks where stem `s` is bit `1 << s`. */
  setDeckMuteSoloMasks(deck: DeckIndex, mute_mask: number, solo_mask: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "SET_DECK_MUTE_SOLO_MASKS",
      deck,
      mute_mask: clampStemMask(mute_mask),
      solo_mask: clampStemMask(solo_mask),
    });
  }

  triggerOrSetHotcue(deck: DeckIndex, slot: HotcueSlotIndex, frame: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "TRIGGER_OR_SET_HOTCUE",
      deck,
      slot,
      frame: frame >>> 0,
    });
  }

  clearHotcue(deck: DeckIndex, slot: HotcueSlotIndex): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "CLEAR_HOTCUE", deck, slot });
  }

  loopResize(deck: DeckIndex, direction: -1 | 1): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, { type: "LOOP_RESIZE", deck, direction });
  }

  setDeckBpmCbpm(deck: DeckIndex, cbpm: number, snap: boolean): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "SET_DECK_BPM_CBPM",
      deck,
      cbpm: clampBpmCbpm(cbpm),
      snap,
    });
  }

  setDeckLoop(deck: DeckIndex, enabled: boolean, start_frame: number, end_frame: number): void {
    if (!this.workletNode) return;
    this.postToWorklet(this.workletNode, {
      type: "SET_DECK_LOOP",
      deck,
      enabled,
      start_frame: start_frame >>> 0,
      end_frame: end_frame >>> 0,
    });
  }

  async stemSplit(
    buf: Float32Array,
    sample_rate: number,
  ): Promise<{ a: Float32Array; b: Float32Array }> {
    const copy = buf.slice();
    const res = await this.dispatchWorker(
      { id: this.nextReqId++, op: "STEM_SPLIT", buf: copy, sample_rate },
      [copy.buffer],
    );
    if (res.ok && res.op === "STEM_SPLIT") return { a: res.a, b: res.b };
    throw new Error("ERR_UNEXPECTED_WORKER_RESPONSE");
  }

  async remixTrack(
    buf: Float32Array,
    sample_rate: number,
    target: RemixTargetSpec,
  ): Promise<Float32Array> {
    const copy = buf.slice();
    const res = await this.dispatchWorker(
      { id: this.nextReqId++, op: "REMIX", buf: copy, sample_rate, target },
      [copy.buffer],
    );
    if (res.ok && res.op === "REMIX") return res.out;
    throw new Error("ERR_UNEXPECTED_WORKER_RESPONSE");
  }

  async renderMix(
    sampleRate: number,
    frames: number,
    crossfaderPmy: number,
    decks: OfflineDeckSpec[],
  ): Promise<{ left: Float32Array; right: Float32Array }> {
    const copies: OfflineDeckSpec[] = decks.map((deck) => ({
      drums: deck.drums.slice(),
      bass: deck.bass.slice(),
      vocal: deck.vocal.slice(),
      other: deck.other.slice(),
      gain_pmy: [deck.gain_pmy[0], deck.gain_pmy[1], deck.gain_pmy[2], deck.gain_pmy[3]],
      muted: [deck.muted[0], deck.muted[1], deck.muted[2], deck.muted[3]],
      volume_pmy: deck.volume_pmy,
      playing: deck.playing,
    }));
    const transfer = copies.flatMap((deck) => [
      deck.drums.buffer,
      deck.bass.buffer,
      deck.vocal.buffer,
      deck.other.buffer,
    ]);
    const res = await this.dispatchWorker(
      {
        id: this.nextReqId++,
        op: "RENDER_MIX",
        sample_rate: sampleRate,
        frames,
        crossfader_pmy: clampUnitPmy(crossfaderPmy),
        decks: copies,
      },
      transfer,
    );
    if (res.ok && res.op === "RENDER_MIX") return { left: res.left, right: res.right };
    throw new Error("ERR_UNEXPECTED_WORKER_RESPONSE");
  }

  async matchMaster(
    buf: Float32Array,
    reference: Float32Array,
    sample_rate: number,
  ): Promise<Float32Array> {
    const bCopy = buf.slice();
    const rCopy = reference.slice();
    const res = await this.dispatchWorker(
      {
        id: this.nextReqId++,
        op: "MATCH_MASTER",
        buf: bCopy,
        reference: rCopy,
        sample_rate,
      },
      [bCopy.buffer, rCopy.buffer],
    );
    if (res.ok && res.op === "MATCH_MASTER") return res.out;
    throw new Error("ERR_UNEXPECTED_WORKER_RESPONSE");
  }

  private postToWorklet(
    node: AudioWorkletNode,
    msg: WorkletInboundMessage,
    transfer: Transferable[] = [],
  ): void {
    node.port.postMessage(msg, transfer);
  }

  private dispatchWorker(req: WorkerRequest, transfer: Transferable[]): Promise<WorkerResponse> {
    if (!this.dspWorker) return Promise.reject(new Error("ERR_DSP_WORKER_NOT_INITIALIZED"));
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      this.dspWorker!.postMessage(req, transfer);
    });
  }
}
