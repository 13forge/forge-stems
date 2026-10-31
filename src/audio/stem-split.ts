/**
 * Full-song auto-split.
 *
 * `Engine.load_stems` takes four mono buffers (drums, bass, vocal, other).
 * A stereo file is downmixed to mono at the engine sample rate (the same
 * AudioContext `decodeAudioData` uses) and split once. Splitting L and R
 * apart would produce stereo stems the deck cannot load without a second
 * downmix, and it would do the heavy work twice.
 *
 * The packed export, when the crate ships it, is
 * `stem_split_four(signal: Float32Array, sample_rate: number) -> Float32Array`
 * laid out as [drums | bass | voice | other], each part `n` samples.
 * An empty input returns an empty array.
 */

export interface StemQuartet {
  drums: Float32Array;
  bass: Float32Array;
  voice: Float32Array;
  music: Float32Array;
}

export type StemSplitFour = (signal: Float32Array, sampleRate: number) => Float32Array;

export function hasStemSplitFour(mod: object): boolean {
  return typeof (mod as { stem_split_four?: unknown }).stem_split_four === "function";
}

/**
 * Copy the four parts out, then scrub the packed buffer.
 * `.slice` copies. `fill(0)` drops the transient so it is not retained.
 */
export function unpackStemSplitFour(packed: Float32Array): StemQuartet {
  if (packed.length === 0 || packed.length % 4 !== 0) {
    packed.fill(0);
    const empty = () => new Float32Array(0);
    return { drums: empty(), bass: empty(), voice: empty(), music: empty() };
  }
  const n = packed.length / 4;
  const drums = packed.slice(0, n);
  const bass = packed.slice(n, n * 2);
  const voice = packed.slice(n * 2, n * 3);
  const music = packed.slice(n * 3, n * 4);
  packed.fill(0);
  return { drums, bass, voice, music };
}

export function quartetHasAudio(parts: StemQuartet): boolean {
  return parts.drums.length > 0 && parts.bass.length > 0 && parts.voice.length > 0 && parts.music.length > 0;
}

/** Music keeps the song. The other three slots stay empty until a real split exists. */
export function musicOnlyQuartet(pcm: Float32Array): StemQuartet {
  return {
    drums: new Float32Array(0),
    bass: new Float32Array(0),
    voice: new Float32Array(0),
    music: pcm.slice(),
  };
}

export interface SplitJobResult {
  ok: true;
  drums: Float32Array;
  bass: Float32Array;
  voice: Float32Array;
  music: Float32Array;
  splitMs: number;
}

export interface SplitJobMiss {
  ok: false;
  reason: string;
  pcm?: Float32Array;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (msg: SplitJobResult | SplitJobMiss) => void>();

interface PartialChunk {
  id: number;
  partial: true;
  stem: number;
  offset: number;
  length: number;
  samples: Float32Array;
}

interface SplitDone {
  id: number;
  ok: true;
  splitMs: number;
  frames: number;
}

const assembly = new Map<number, Float32Array[]>();

function workerHandle(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./stem-split-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<PartialChunk | SplitDone | (SplitJobMiss & { id: number })>) => {
      const data = ev.data;
      if ("uploadAck" in data) return;
      if ("partial" in data && data.partial) {
        let parts = assembly.get(data.id);
        if (!parts) {
          parts = new Array<Float32Array>(4);
          assembly.set(data.id, parts);
        }
        if (!parts[data.stem]) parts[data.stem] = new Float32Array(data.length);
        parts[data.stem].set(data.samples, data.offset);
        worker?.postMessage({ ack: data.id });
        return;
      }
      const done = pending.get(data.id);
      if (!done) return;
      pending.delete(data.id);
      if ("ok" in data && data.ok) {
        const parts = assembly.get(data.id);
        assembly.delete(data.id);
        if (!parts) {
          done({ ok: false, reason: "empty" });
          return;
        }
        done({
          ok: true,
          drums: parts[0],
          bass: parts[1],
          voice: parts[2],
          music: parts[3],
          splitMs: data.splitMs,
        });
        return;
      }
      assembly.delete(data.id);
      const miss = data as SplitJobMiss & { id: number };
      done({ ok: false, reason: miss.reason, pcm: miss.pcm });
    };
  }
  return worker;
}

/** Starts the split worker during idle setup so the first drop does not parse it on the UI thread. */
export function warmStemSplit(): void {
  try {
    if (typeof Worker === "undefined") return;
    workerHandle();
  } catch {
    worker = null;
  }
}

/** Runs in a dedicated worker so the audio thread keeps rendering. */
export function splitFullSong(pcm: Float32Array, sampleRate: number): Promise<SplitJobResult | SplitJobMiss> {
  const id = nextId++;
  const handle = workerHandle();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    void uploadPcm(handle, id, pcm, sampleRate).catch((err) => {
      pending.delete(id);
      resolve({ ok: false, reason: String(err), pcm });
    });
  });
}

async function uploadPcm(handle: Worker, id: number, pcm: Float32Array, sampleRate: number): Promise<void> {
  handle.postMessage({ id, begin: true, sampleRate, length: pcm.length });
  const chunk = 48_000;
  for (let offset = 0; offset < pcm.length; offset += chunk) {
    const samples = pcm.slice(offset, Math.min(pcm.length, offset + chunk));
    await new Promise<void>((ack) => {
      const onAck = (ev: MessageEvent<{ uploadAck?: number }>) => {
        if (ev.data?.uploadAck !== id) return;
        handle.removeEventListener("message", onAck);
        ack();
      };
      handle.addEventListener("message", onAck);
      handle.postMessage({ id, upload: true, offset, samples }, [samples.buffer]);
    });
  }
  handle.postMessage({ id, uploadDone: true });
}
