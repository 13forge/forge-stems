export interface FourStems {
  drums: Float32Array;
  bass: Float32Array;
  vocal: Float32Array;
  other: Float32Array;
}

/**
 * First-order all-pole lowpass split used in complementary subtraction:
 * `low[i] + high[i] === input[i]` by construction, so the stems re-sum to the
 * input without phase cancellation at unity fader gain.
 * Slope is 6 dB/oct (first-order); steeper rejection is out of scope.
 */
function splitLowPassComplementary(
  input: Float32Array,
  cutoffHz: number,
  sampleRate: number,
): { low: Float32Array; high: Float32Array } {
  const n = input.length;
  const low = new Float32Array(n);
  const high = new Float32Array(n);
  const rc = 1.0 / (2.0 * Math.PI * Math.max(20, cutoffHz));
  const dt = 1.0 / Math.max(8000, sampleRate);
  const alpha = dt / (rc + dt);

  let y = 0.0;
  for (let i = 0; i < n; i++) {
    const x = input[i];
    y = y + alpha * (x - y);
    low[i] = y;
    high[i] = x - y; // Complementary residual: low[i] + high[i] === x
  }
  return { low, high };
}

/**
 * Converts `{ a: harmonic, b: percussive }` from `forge-audio-wasm-v3::stem_split`
 * into 4 stems (`drums`, `bass`, `vocal`, `other`) whose sum equals `a + b`.
 * Crossovers: 200 Hz (bass | mid-high), 3400 Hz (vocal | other).
 */
export function demuxHpssToFourStems(
  harmonic: Float32Array,
  percussive: Float32Array,
  sampleRate: number,
): FourStems {
  if (harmonic.length !== percussive.length) {
    throw new Error("ERR_HPSS_LENGTH_MISMATCH");
  }
  // 1. Drums = percussive stem directly
  const drums = percussive.slice();

  // 2. Split harmonic at 200 Hz -> bass (< 200 Hz) + midHigh (>= 200 Hz)
  const { low: bass, high: midHigh } = splitLowPassComplementary(harmonic, 200, sampleRate);

  // 3. Split midHigh at 3400 Hz -> vocal (200..3400 Hz) + other (>= 3400 Hz)
  const { low: vocal, high: other } = splitLowPassComplementary(midHigh, 3400, sampleRate);

  return { drums, bass, vocal, other };
}
