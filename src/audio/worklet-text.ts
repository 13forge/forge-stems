/**
 * AudioWorkletGlobalScope in Chrome does not provide TextEncoder / TextDecoder.
 * wasm-bindgen's glue constructs both while the worklet module evaluates, which
 * must happen before `registerProcessor` or the processor never lands.
 * Installed only when the host is missing them. UTF-8, no DOM, no storage.
 */

function utf8Encode(text: string): Uint8Array {
  const units: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) units.push(code);
    else if (code < 0x800) units.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      units.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      units.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(units);
}

function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      continue;
    }
    const b1 = bytes[i++] & 0x3f;
    if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
      continue;
    }
    const b2 = bytes[i++] & 0x3f;
    if (b0 < 0xf0) {
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
      continue;
    }
    const b3 = bytes[i++] & 0x3f;
    const point = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
    const shifted = point - 0x10000;
    out += String.fromCharCode(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff));
  }
  return out;
}

function installWorkletTextCodecs(): void {
  const scope = globalThis as unknown as {
    TextDecoder?: unknown;
    TextEncoder?: unknown;
  };
  if (typeof scope.TextDecoder !== "function") {
    scope.TextDecoder = class TextDecoder {
      decode(input?: ArrayBufferView): string {
        if (!input || !("byteLength" in input) || input.byteLength === 0) return "";
        const bytes =
          input instanceof Uint8Array ? input : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        return utf8Decode(bytes);
      }
    };
  }
  if (typeof scope.TextEncoder !== "function") {
    scope.TextEncoder = class TextEncoder {
      encode(text: string): Uint8Array {
        return utf8Encode(text);
      }
      encodeInto(text: string, dest: Uint8Array): { read: number; written: number } {
        const encoded = utf8Encode(text);
        const written = Math.min(encoded.length, dest.length);
        dest.set(encoded.subarray(0, written));
        return { read: text.length, written };
      }
    };
  }
}

installWorkletTextCodecs();
