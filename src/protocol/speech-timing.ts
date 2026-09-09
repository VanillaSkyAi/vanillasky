/** Seconds on the generated speech audio clock, preserving the written word. */
export interface SpeechWordTiming {
  text: string;
  start: number;
  end: number;
}

const MAX_SPEECH_CHARACTERS = 1000;
const MAX_SPEECH_SECONDS = 300;

/** Reject incomplete alignment instead of presenting estimated times as measured. */
export function parseSpeechWordTimings(
  value: unknown,
  text: string,
  duration?: number,
): SpeechWordTiming[] | undefined {
  if (typeof text !== "string" || text.length > MAX_SPEECH_CHARACTERS) return;
  const words = text.trim().match(/\S+/gu);
  if (!words || !Array.isArray(value) || value.length !== words.length) return;
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SPEECH_SECONDS)) return;
  const maximum = duration ?? MAX_SPEECH_SECONDS;
  const parsed: SpeechWordTiming[] = [];
  let previousStart = 0;
  let previousEnd = 0;
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const { text: word, start, end } = entry as Record<string, unknown>;
    if (word !== words[index] || typeof start !== "number" || typeof end !== "number" ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < previousStart ||
      (index > 0 && start === previousStart) ||
      start < 0 || end <= start || end < previousEnd || end > maximum) return;
    parsed.push({ text: words[index], start, end });
    previousStart = start;
    previousEnd = end;
  }
  return parsed;
}
