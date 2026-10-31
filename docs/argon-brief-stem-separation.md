# Stem separation contract for forge-audio-wasm-v3

The browser mixer does not separate a mixed song yet. `vendor/forge-audio-wasm-v3` exports `stem_split` (two buffers, harmonic and percussive) and does not export `stem_split_four`. Until that export is in the vendored package, the UI says "Auto-split needs the updated engine" and puts the file on Music.

## 1. Export this exact function

```ts
export function stem_split_four(signal: Float32Array, sample_rate: number): Float32Array;
```

- `signal` is mono `f32` PCM at `sample_rate`.
- Return one packed `Float32Array` of length `4 * n`: `[drums | bass | voice | other]`, each part `n` samples.
- `n` is the output length at `sample_rate` (it may differ from `signal.length` if the model resamples internally, but the four parts must be equal).
- An empty input returns an empty array. Do not throw for silence.
- The TypeScript side copies each part with `.slice`, then calls `packed.fill(0)` so the transient buffer is not retained.

The audio engine already loads four mono stems:

```ts
engine.load_stems(deck, drums, bass, voice, other);
```

Index 2 is the vocal slot. Index 3 is the music/other slot. Do not return stereo stems; the deck is mono per stem.

## 2. What the model should be

Implement `stem_split_four` with Hybrid Transformer Demucs (Demucs v4, checkpoint `htdemucs`, four stems: drums, bass, vocals, other). Demucs is MIT licensed. The torch checkpoint is on the order of 80 MB. Do not ship the fine-tuned bag (`htdemucs_ft`) in the first cut; it is several times larger.

Run the network off the audio thread. The `AudioWorklet` must keep rendering. Preferred runtime: ONNX Runtime with the WebGPU backend, invoked from the dedicated worker that already calls this export (`src/audio/stem-split-worker.ts`). A CPU-only wasm runtime (tract, candle, or the wasm ONNX build) is the fallback and will be much slower. Estimate, not a measurement: WebGPU on a discrete GPU is roughly 2–5× realtime for `htdemucs`; the wasm CPU fallback is roughly 0.1–0.3× realtime. Measure both before publishing a number.

The model expects 44.1 kHz. Resample inside the export, then resample the four stems back to `sample_rate` so `load_stems` stays at the device rate. Chunk long songs (Demucs segment about 7.8 s, overlap about 0.25) and overlap-add. Do not hold a whole song's activations at once. A five-minute track should be processed a chunk at a time. Peak memory for one chunk is on the order of several hundred MB and can approach 1 GB; treat that as a budget, not a guarantee.

## 3. Who does what

1. The crate owns resample, chunking, overlap-add, the model run, and the packed `Float32Array`.
2. The worker checks `typeof wasm.stem_split_four === "function"`, calls it, unpacks with `.slice`, then `packed.fill(0)`.
3. The page shows "Splitting 4 stems…" while the worker runs and then calls `load_stems`.
4. If the function is missing or returns empty, the page does not freeze. It loads the mono mix on Music and shows "Auto-split needs the updated engine".

## 4. Acceptance checks

1. Empty input returns length 0.
2. A mix of four sines (one per stem, known frequencies) comes back with each frequency dominant in its own slice. Use a tolerance, not a bit-exact match.
3. Output length is divisible by 4, and the four slices have equal length.
4. A several-minute input completes without allocating one buffer for the whole song's activations.
5. 44.1 kHz in and 48 kHz in both return stems at the requested `sample_rate`.
6. After `load_stems`, muting one stem removes that stem's frequency from `render_block` and leaves the other three.
