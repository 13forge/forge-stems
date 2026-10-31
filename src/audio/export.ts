import { assertWithin300sCap, MAX_EXPORT_SECONDS } from "./types.js";

export { MAX_EXPORT_SECONDS };

/**
 * Encodes planar stereo (`left`, `right`) or mono (`left` only) `Float32Array` PCM
 * into a 16-bit PCM RIFF WAVE `Uint8Array`. Refuses any input exceeding `300 s`.
 */
export function encodeWavPcm16(
  left: Float32Array,
  right: Float32Array | null,
  sampleRate: number,
): Uint8Array {
  const frames = left.length;
  assertWithin300sCap(frames, sampleRate);
  if (right && right.length !== frames) {
    throw new Error("ERR_CHANNEL_LENGTH_MISMATCH");
  }

  const channels = right ? 2 : 1;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = Math.floor(sampleRate) * blockAlign;
  const dataSize = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, Math.floor(sampleRate), true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    const sl = Math.max(-1, Math.min(1, left[i]));
    view.setInt16(offset, sl < 0 ? sl * 0x8000 : sl * 0x7fff, true);
    offset += 2;
    if (right) {
      const sr = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, sr < 0 ? sr * 0x8000 : sr * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(buf);
}

/**
 * Encodes an interleaved stereo `Float32Array` (`[L0, R0, L1, R1, ...]`) into a 16-bit RIFF WAVE `Uint8Array`.
 * Enforces the 300 s frame cap (`frames = interleaved.length / 2 <= sampleRate * 300`).
 */
export function encodeInterleavedStereoWavPcm16(
  interleaved: Float32Array,
  sampleRate: number,
): Uint8Array {
  if (interleaved.length % 2 !== 0) {
    throw new Error("ERR_INTERLEAVED_LENGTH_MUST_BE_EVEN");
  }
  const frames = interleaved.length / 2;
  assertWithin300sCap(frames, sampleRate);

  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = interleaved[i * 2];
    right[i] = interleaved[i * 2 + 1];
  }
  return encodeWavPcm16(left, right, sampleRate);
}
