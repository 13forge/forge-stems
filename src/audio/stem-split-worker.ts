import init, * as wasm from "@wasm/forge_audio_wasm_v3.js";
import { unpackStemSplitFour } from "./stem-split.js";

let ready: Promise<void> | null = null;

interface Begin {
  id: number;
  begin: true;
  sampleRate: number;
  length: number;
}
interface Upload {
  id: number;
  upload: true;
  offset: number;
  samples: Float32Array;
}
interface UploadDone {
  id: number;
  uploadDone: true;
}

const uploads = new Map<number, { pcm: Float32Array; sampleRate: number }>();

self.onmessage = (ev: MessageEvent<Begin | Upload | UploadDone | { ack?: number }>) => {
  const data = ev.data;
  if (!data || "ack" in data) return;
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  if ("begin" in data && data.begin) {
    uploads.set(data.id, { pcm: new Float32Array(data.length), sampleRate: data.sampleRate });
    return;
  }
  if ("upload" in data && data.upload) {
    uploads.get(data.id)?.pcm.set(data.samples, data.offset);
    scope.postMessage({ uploadAck: data.id });
    return;
  }
  if ("uploadDone" in data && data.uploadDone) {
    const job = uploads.get(data.id);
    uploads.delete(data.id);
    if (!job) return;
    void run(data.id, job.pcm, job.sampleRate);
  }
};

function waitAck(scope: DedicatedWorkerGlobalScope, id: number): Promise<void> {
  return new Promise((resolve) => {
    const onMsg = (ev: MessageEvent<{ ack?: number }>) => {
      if (ev.data?.ack === id) {
        scope.removeEventListener("message", onMsg);
        resolve();
      }
    };
    scope.addEventListener("message", onMsg);
  });
}

async function run(id: number, pcm: Float32Array, sampleRate: number): Promise<void> {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  try {
    if (!ready) ready = init().then(() => undefined);
    await ready;
    if (typeof wasm.stem_split_four !== "function") {
      scope.postMessage({ id, ok: false, reason: "missing", pcm }, [pcm.buffer]);
      return;
    }
    const started = performance.now();
    const packed = wasm.stem_split_four(pcm, sampleRate);
    const parts = unpackStemSplitFour(packed);
    const splitMs = performance.now() - started;
    if (parts.drums.length === 0) {
      scope.postMessage({ id, ok: false, reason: "empty", pcm }, [pcm.buffer]);
      return;
    }
    const stems = [parts.drums, parts.bass, parts.voice, parts.music];
    const chunkFrames = 48_000;
    for (let stem = 0; stem < stems.length; stem++) {
      const src = stems[stem];
      for (let offset = 0; offset < src.length; offset += chunkFrames) {
        const samples = src.slice(offset, Math.min(src.length, offset + chunkFrames));
        const ack = waitAck(scope, id);
        scope.postMessage(
          { id, partial: true, stem, offset, length: src.length, samples },
          [samples.buffer],
        );
        await ack;
      }
    }
    scope.postMessage({ id, ok: true, splitMs, frames: stems[0].length });
  } catch (err) {
    scope.postMessage({ id, ok: false, reason: String(err), pcm }, [pcm.buffer]);
  }
}
