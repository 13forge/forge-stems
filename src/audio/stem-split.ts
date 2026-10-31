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
}

export interface SplitJobMiss {
  ok: false;
  reason: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (msg: SplitJobResult | SplitJobMiss) => void>();

function workerHandle(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./stem-split-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<(SplitJobResult | SplitJobMiss) & { id: number }>) => {
      const data = ev.data;
      const id = data.id;
      const done = pending.get(id);
      if (!done) return;
      pending.delete(id);
      if (data.ok) {
        done({ ok: true, drums: data.drums, bass: data.bass, voice: data.voice, music: data.music });
      } else {
        done({ ok: false, reason: data.reason });
      }
    };
  }
  return worker;
}

/** Runs in a dedicated worker so the audio thread keeps rendering. */
export function splitFullSong(pcm: Float32Array, sampleRate: number): Promise<SplitJobResult | SplitJobMiss> {
  const id = nextId++;
  const copy = pcm.slice();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    try {
      workerHandle().postMessage({ id, pcm: copy, sampleRate }, [copy.buffer]);
    } catch (err) {
      pending.delete(id);
      resolve({ ok: false, reason: String(err) });
    }
  });
}
