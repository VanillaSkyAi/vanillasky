import type { VideoChatVoice } from "./voice.js";

/** Private presentation timing. Text positions derived from this are estimates. */
export interface CaptionProgress {
  text: string;
  elapsedSeconds: number;
  durationSeconds: number;
  timing: "audio" | "estimated";
}

/** Observe existing voice calls without preparing or requesting additional audio. */
export function createCaptionVoice(source: VideoChatVoice, now = () => performance.now()) {
  const durations = new Map<string, number>();
  let held = false;
  let current: {
    text: string; duration: number; offset: number; elapsed: number;
    started: boolean; since?: number; browser: boolean; signal: AbortSignal;
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
    return {text:state.text, elapsedSeconds:Math.min(state.duration, Math.max(0,state.elapsed)), durationSeconds:state.duration, timing:realClock ? "audio" : "estimated"};
  };
  const reset = () => { current = undefined; };
  const voice: VideoChatVoice = {
    get supportsOffsets() { return source.supportsOffsets; },
    ...(source.getCurrentTime ? {getCurrentTime:() => source.getCurrentTime!()} : {}),
    async prepare(text, options) {
      const prepared = await source.prepare(text, options);
      if (!options?.signal?.aborted && Number.isFinite(prepared.seconds) && prepared.seconds > 0) {
        if (durations.size >= 60) durations.delete(durations.keys().next().value!);
        durations.set(text.trim(), prepared.seconds);
      }
      return prepared;
    },
    async speak(text, options) {
      const state = {text, duration:durations.get(text.trim()) ?? Math.max(1, text.trim().split(/\s+/u).length / 2.5), offset:options.offsetSeconds ?? 0, elapsed:options.offsetSeconds ?? 0, started:false, since:undefined as number | undefined, browser:false, signal:options.signal};
      current = state;
      const aborted = () => { if (current === state) reset(); };
      options.signal.addEventListener("abort", aborted, {once:true});
      try {
        await source.speak(text, {...options, onStart:(kind) => {
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
    ...(source.setVolume ? { setVolume: (volume: number) => source.setVolume!(volume) } : {}),
  };
  return {voice, getCaptionProgress:read, reset};
}
