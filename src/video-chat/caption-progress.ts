import type { VideoChatVoice, VideoChatPreparedSpeech } from "./voice.js";
import type { SpeechWordTiming } from "../protocol/speech-timing.js";

/** Private presentation timing; alignment distinguishes real word timing from estimates. */
export interface CaptionProgress {
  text: string;
  elapsedSeconds: number;
  durationSeconds: number;
  timing: "audio" | "estimated";
  wordTimings?: readonly SpeechWordTiming[];
  wordIndex?: number;
  alignment?: "provider" | "browser" | "estimated";
}

/** Observe existing voice calls without preparing or requesting additional audio. */
export function createCaptionVoice(source: VideoChatVoice, now = () => performance.now()) {
  const preparedLines = new Map<string, VideoChatPreparedSpeech>();
  let held = false;
  let current: {
    text: string; duration: number; offset: number; elapsed: number;
    started: boolean; since?: number; browser: boolean; signal: AbortSignal;
    wordTimings?: readonly SpeechWordTiming[]; wordIndex?: number;
  } | undefined;
  const read = (): CaptionProgress | undefined => {
    const state = current;
    if (!state || !state.started || state.signal.aborted) return;
    const audioTime = !state.browser ? source.getCurrentTime?.() : undefined;
    const realClock = typeof audioTime === "number" && Number.isFinite(audioTime);
    if (!held) {
      state.elapsed = realClock ? Math.max(state.offset, audioTime)
        : state.offset + (state.since === undefined ? 0 : (now() - state.since) / 1000);
    }
    const wordTimings = !state.browser ? state.wordTimings : undefined;
    return {text:state.text, elapsedSeconds:Math.min(state.duration, Math.max(0,state.elapsed)), durationSeconds:state.duration, timing:realClock ? "audio" : "estimated",
      ...(wordTimings ? {wordTimings} : {}), ...(state.wordIndex === undefined ? {} : {wordIndex:state.wordIndex}),
      alignment:wordTimings ? "provider" : state.wordIndex === undefined ? "estimated" : "browser"};
  };
  const reset = () => { current = undefined; };
  const voice: VideoChatVoice = {
    get supportsOffsets() { return source.supportsOffsets; },
    ...(source.getCurrentTime ? {getCurrentTime:() => source.getCurrentTime!()} : {}),
    async prepare(text, options) {
      const prepared = await source.prepare(text, options);
      if (!options?.signal?.aborted && Number.isFinite(prepared.seconds) && prepared.seconds > 0) {
        if (preparedLines.size >= 60) preparedLines.delete(preparedLines.keys().next().value!);
        preparedLines.set(text.trim(), prepared);
      }
      return prepared;
    },
    async speak(text, options) {
      const prepared = preparedLines.get(text.trim());
      const state = {text, duration:prepared?.seconds ?? Math.max(1, text.trim().split(/\s+/u).length / 2.5), offset:options.offsetSeconds ?? 0, elapsed:options.offsetSeconds ?? 0, started:false, since:undefined as number | undefined, browser:false, signal:options.signal,
        wordTimings:prepared?.wordTimings, wordIndex:undefined as number | undefined};
      current = state;
      const aborted = () => { if (current === state) reset(); };
      options.signal.addEventListener("abort", aborted, {once:true});
      try {
        await source.speak(text, {...options, onPlaybackSource:kind => {
          if (current !== state || state.signal.aborted) return;
          if (state.started && state.browser !== (kind === "browser")) {
            state.browser = kind === "browser";
            state.offset = 0;
            state.elapsed = 0;
            state.since = now();
            state.wordIndex = undefined;
          }
          options.onPlaybackSource?.(kind);
        }, onBoundary:charIndex => {
          if (current !== state || !state.started || state.signal.aborted || held) return;
          const words = [...text.matchAll(/\S+/gu)];
          const index = words.findIndex(word => charIndex >= word.index && charIndex < word.index + word[0].length);
          if (index < 0) return;
          state.browser = true;
          state.wordIndex = index;
          options.onBoundary?.(charIndex);
        }, onStart:(kind) => {
          if (current !== state || state.signal.aborted) return;
          if (!state.started) {
            state.started = true;
            state.browser = kind === "browser";
            state.since = now();
          }
          options.onStart?.(kind);
        }});
      } finally {
        options.signal.removeEventListener("abort", aborted);
        if (current === state) reset();
      }
    },
    pause() {
      read();
      held = true;
      source.pause();
    },
    resume() {
      if (held && current?.started) {
        current.offset = current.elapsed;
        current.since = now();
      }
      held = false;
      source.resume();
    },
    setMuted: muted => source.setMuted(muted),
  };
  return {voice, getCaptionProgress:read, reset};
}
