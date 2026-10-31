import type { StemIndex } from "./types.js";

const AUDIO_EXT = /\.(wav|mp3|flac|ogg|oga|m4a|aac|aiff|aif|mp4)$/i;

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  return AUDIO_EXT.test(file.name);
}

/**
 * Map a stem filename to a slot.
 * 0 drums, 1 bass, 2 vocals, 3 music/other.
 * Returns null when the name does not say which part it is.
 */
export function classifyStemName(name: string): StemIndex | null {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(drum|drums|percussion|kick|snare|hihat|hi hat|cymbal)\b/.test(base)) return 0;
  if (/\b(bass|sub)\b/.test(base) || /\b808\b/.test(base)) return 1;
  if (/\b(no vocals?|instrumental|karaoke)\b/.test(base)) return 3;
  if (/\b(vocal|vocals|vox|voice|acapella|a cappella)\b/.test(base)) return 2;
  if (/\b(other|music|inst|accompaniment|harmonic)\b/.test(base)) return 3;
  return null;
}

export interface StemAssignment {
  stem: StemIndex;
  file: File;
}

/** Place files into the four slots by name. Unmatched files fill the free slots in order. */
export function assignStemFiles(files: readonly File[]): StemAssignment[] {
  const used = new Set<number>();
  const assigned: StemAssignment[] = [];
  const unmatched: File[] = [];
  for (const file of files) {
    const stem = classifyStemName(file.name);
    if (stem !== null && !used.has(stem)) {
      used.add(stem);
      assigned.push({ stem, file });
    } else {
      unmatched.push(file);
    }
  }
  const free = ([0, 1, 2, 3] as const).filter((stem) => !used.has(stem));
  for (let i = 0; i < unmatched.length && i < free.length; i++) {
    assigned.push({ stem: free[i], file: unmatched[i] });
  }
  return assigned;
}
