import init, * as wasm from "@wasm/forge_audio_wasm_v3.js";
import { hasStemSplitFour, unpackStemSplitFour, type StemSplitFour } from "./stem-split.js";

let ready: Promise<void> | null = null;

interface Request {
  id: number;
  pcm: Float32Array;
  sampleRate: number;
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const { id, pcm, sampleRate } = ev.data;
  void run(id, pcm, sampleRate);
};

async function run(id: number, pcm: Float32Array, sampleRate: number): Promise<void> {
  try {
    if (!ready) ready = init().then(() => undefined);
    await ready;
    if (!hasStemSplitFour(wasm)) {
      post({ id, ok: false, reason: "missing" });
      return;
    }
    const split = (wasm as unknown as { stem_split_four: StemSplitFour }).stem_split_four;
    const packed = split(pcm, sampleRate);
    const parts = unpackStemSplitFour(packed);
    if (parts.drums.length === 0) {
      post({ id, ok: false, reason: "empty" });
      return;
    }
    const transfer = [parts.drums.buffer, parts.bass.buffer, parts.voice.buffer, parts.music.buffer];
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, ...parts }, transfer);
  } catch (err) {
    post({ id, ok: false, reason: String(err) });
  }
}

function post(msg: { id: number; ok: false; reason: string }): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}
