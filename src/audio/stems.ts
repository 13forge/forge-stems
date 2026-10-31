/** Longest loaded stem on a deck, or 0 when the deck is empty. */
export function stemFrameCount(stems: readonly (Float32Array | null)[]): number {
  let n = 0;
  for (const stem of stems) {
    if (stem && stem.length > n) n = stem.length;
  }
  return n;
}

/**
 * Pads every stem to the deck's longest file with silence.
 * Returns null when the deck has no audio. The four buffers share one length,
 * which is what `Engine.load_stems` requires.
 */
export function alignedStems(
  stems: readonly (Float32Array | null)[],
): [Float32Array, Float32Array, Float32Array, Float32Array] | null {
  const frames = stemFrameCount(stems);
  if (frames === 0) return null;
  const out: Float32Array[] = [];
  for (let i = 0; i < 4; i++) {
    const dst = new Float32Array(frames);
    const src = stems[i];
    if (src && src.length > 0) dst.set(src.subarray(0, frames));
    out.push(dst);
  }
  return out as [Float32Array, Float32Array, Float32Array, Float32Array];
}
