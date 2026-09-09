import { parseSpeechWordTimings } from "../protocol/speech-timing.js";
import type { CaptionProgress } from "./caption-progress.js";

type CaptionPhrase = { words: string[]; start: number };

/** Keep punctuation with its word and avoid a one-word tail at phrase boundaries. */
export function splitCaptionPhrases(text: string): CaptionPhrase[] {
  const words = text.match(/\S+/gu) ?? [];
  const phrases: CaptionPhrase[] = [];
  let start = 0;
  while (start < words.length) {
    let clauseEnd = start + 1;
    while (clauseEnd < words.length && !/[,.!?;:…]["'”’)]?$/u.test(words[clauseEnd - 1]!)) clauseEnd++;
    while (start < clauseEnd) {
      const remaining = clauseEnd - start;
      const size = remaining <= 4 ? remaining : 3;
      phrases.push({ words: words.slice(start, start + size), start });
      start += size;
    }
  }
  return phrases;
}

/** Exact audio intervals and native speech boundaries win over estimated pacing. */
export function captionWordAt(words: readonly string[], progress: CaptionProgress | undefined) {
  const estimated = { index: 0, active: false, alignment: "estimated" as const };
  if (!words.length || !progress) return estimated;
  const elapsed = Math.max(0, Number.isFinite(progress.elapsedSeconds) ? progress.elapsedSeconds : 0);
  const timings = parseSpeechWordTimings(progress.wordTimings, words.join(" "));
  if (timings) {
    let index = 0;
    while (index + 1 < timings.length && elapsed >= timings[index + 1]!.start) index++;
    return { index, active: elapsed >= timings[index]!.start && elapsed < timings[index]!.end, alignment: "provider" as const };
  }
  if (Number.isInteger(progress.wordIndex) && progress.wordIndex! >= 0) {
    return { index: Math.min(words.length - 1, progress.wordIndex!), active: true, alignment: "browser" as const };
  }
  if (!(progress.durationSeconds > 0) || !Number.isFinite(progress.durationSeconds)) return estimated;
  // Short words still get a beat; punctuation allows a little breathing room.
  const weights = words.map(word => Math.min(9, Math.max(3, Array.from(word).length)) + (/[,.!?;:…]["'”’)]?$/u.test(word) ? 3 : 0));
  const position = elapsed / progress.durationSeconds * weights.reduce((sum, weight) => sum + weight, 0);
  let boundary = 0;
  let index = 0;
  for (; index < words.length - 1; index++) {
    boundary += weights[index]!;
    if (position < boundary) break;
  }
  return { index, active: elapsed < progress.durationSeconds, alignment: "estimated" as const };
}
