import type { NarrationVoice } from "../player/use-narration.js";
import { withDeadline } from "./deadline.js";

const DEFAULT_MAX_CACHED_LINES = 60;
const SPEECH_PREPARATION_TIMEOUT_MS = 3_000;
const FALLBACK_BITS_PER_SECOND = 128_000;
// 25ms of silent PCM, played unmuted to retain Safari permission on this sink.
const ACTIVATION_AUDIO = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YZABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let sharedContext: AudioContext | undefined;

type PreparedLine =
  | { source: "generated"; src: string; seconds: number; measured?: boolean }
  | { source: "browser"; seconds: number };

export interface VideoChatPreparedSpeech {
  /** Measured or conservatively estimated spoken duration, in seconds. */
  seconds: number;
  /** True only for decoded audio with seek support, never duration estimates. */
  supportsOffsets?: boolean;
}

export interface VideoChatVoice extends NarrationVoice {
  prepare(text: string, options?: { signal?: AbortSignal }): Promise<VideoChatPreparedSpeech>;
  pause(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  dispose?(): void;
}

export interface CreateVideoChatVoiceOptions {
  endpoint?: string | URL;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  fetcher?: typeof fetch;
  maxCachedLines?: number;
  /** Called when optional generated speech falls back to browser speech. */
  onFallback?: () => unknown;
}

function actionEndpoint(endpoint: string | URL, action: string): string {
  const value = String(endpoint);
  return `${value}${value.includes("?") ? "&" : "?"}action=${encodeURIComponent(action)}`;
}

function estimatedBrowserSeconds(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, words / 2.5);
}

async function measureSeconds(bytes: ArrayBuffer): Promise<{ seconds: number; measured: boolean }> {
  try {
    sharedContext ??= new AudioContext();
    const decoded = await sharedContext.decodeAudioData(bytes.slice(0));
    if (decoded.duration > 0) return { seconds: decoded.duration, measured: true };
  } catch {
    // Browsers may keep audio decoding locked until the first user gesture.
  }
  return { seconds: (bytes.byteLength * 8) / FALLBACK_BITS_PER_SECOND, measured: false };
}

/**
 * Create the SDK's generated-speech client with a browser-voice fallback.
 *
 * The endpoint is provider-neutral. A no-content response (or a compatible
 * endpoint's 404) selects browser speech for the rest of the session.
 */
export function createVideoChatVoice(options: CreateVideoChatVoiceOptions = {}): VideoChatVoice {
  const endpoint = options.endpoint ?? "/api/video-chat";
  const fetcher = options.fetcher ?? fetch;
  const maximum = options.maxCachedLines ?? DEFAULT_MAX_CACHED_LINES;
  if (!Number.isInteger(maximum) || maximum <= 0) throw new Error("maxCachedLines must be a positive integer");

  const lines = new Map<string, PreparedLine>();
  const pendingLoads = new Set<AbortController>();
  let sounding: HTMLAudioElement | undefined;
  // Safari's playback permission belongs to the media element. Keep the sink
  // that played the opening when later lines arrive after user activation expires.
  let generatedElement: HTMLAudioElement | undefined;
  let stopGenerated: (() => void) | undefined;
  let browserFinish: (() => void) | undefined;
  let held = false;
  let silent = false;
  let disposed = false;
  let generatedSpeechUnavailable = false;
  let playbackFailure: (() => void) | undefined;
  const notifyFallback = () => {
    try { void Promise.resolve(options.onFallback?.()).catch(() => undefined); }
    catch { /* Observer failures do not affect speech. */ }
  };

  const forgetOldest = () => {
    while (lines.size > maximum) {
      const oldest = lines.keys().next();
      if (oldest.done) return;
      const line = lines.get(oldest.value);
      lines.delete(oldest.value);
      if (line?.source === "generated") URL.revokeObjectURL(line.src);
    }
  };

  const load = async (text: string, signal?: AbortSignal): Promise<PreparedLine> => {
    if (disposed) throw new DOMException("Video chat voice was disposed", "AbortError");
    const normalized = text.trim();
    const cached = lines.get(normalized);
    if (cached) {
      lines.delete(normalized);
      lines.set(normalized, cached);
      return cached;
    }

    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    pendingLoads.add(controller);
    let prepared: PreparedLine;
    let createdSrc: string | undefined;
    try {
      try {
        if (generatedSpeechUnavailable) {
          prepared = { source: "browser", seconds: estimatedBrowserSeconds(normalized) };
        } else {
          prepared = await withDeadline(async (preparationSignal): Promise<PreparedLine> => {
            const response = await fetcher(actionEndpoint(endpoint, "speech"), {
              method: "POST",
              headers,
              credentials: options.credentials,
              signal: preparationSignal,
              body: JSON.stringify({ text: normalized }),
            });
            preparationSignal.throwIfAborted();
            if (response.status === 204 || response.status === 404) {
              generatedSpeechUnavailable = true;
              return { source: "browser", seconds: estimatedBrowserSeconds(normalized) };
            }
            if (!response.ok) throw new Error("Speech is unavailable");
            const bytes = await response.arrayBuffer();
            preparationSignal.throwIfAborted();
            const seconds = await measureSeconds(bytes);
            preparationSignal.throwIfAborted();
            // Allocate only after every asynchronous step succeeds. A late decode
            // cannot leak an object URL or replace the cached browser fallback.
            createdSrc = URL.createObjectURL(new Blob([bytes], {
              type: response.headers.get("content-type") || "audio/mpeg",
            }));
            return { source: "generated", src: createdSrc, ...seconds };
          }, SPEECH_PREPARATION_TIMEOUT_MS, controller.signal);
        }
      } catch (cause) {
        if (createdSrc) URL.revokeObjectURL(createdSrc);
        if (controller.signal.aborted) throw controller.signal.reason ?? cause;
        notifyFallback();
        prepared = { source: "browser", seconds: estimatedBrowserSeconds(normalized) };
      }

      if (disposed || controller.signal.aborted) {
        if (prepared.source === "generated") URL.revokeObjectURL(prepared.src);
        throw controller.signal.reason ?? new DOMException("Video chat voice was disposed", "AbortError");
      }
      const existing = lines.get(normalized);
      if (existing) {
        if (prepared.source === "generated") URL.revokeObjectURL(prepared.src);
        lines.delete(normalized);
        lines.set(normalized, existing);
        return existing;
      }
      lines.set(normalized, prepared);
      forgetOldest();
      return prepared;
    } finally {
      pendingLoads.delete(controller);
      signal?.removeEventListener("abort", forwardAbort);
    }
  };

  const speechStops = new Set<() => void>();
  const watchSpeech = (seconds: number, expire: () => void) => {
    // Count only active playback time; a deliberate pause must remain paused.
    let remaining = Math.max(1, seconds) * 2_000 + 5_000;
    const timer = setInterval(() => {
      if (held) return;
      remaining -= 250;
      if (remaining <= 0) {
        clearInterval(timer);
        expire();
      }
    }, 250);
    return () => clearInterval(timer);
  };

  const stopBrowser = () => {
    globalThis.speechSynthesis?.cancel();
    browserFinish?.();
  };

  return {
    supportsOffsets: true,
    getCurrentTime: () => sounding?.currentTime,
    async prepare(text, preparation = {}) {
      const line = await load(text, preparation.signal);
      return { seconds: line.seconds, ...(line.source === "generated" && line.measured === true ? { supportsOffsets: true } : {}) };
    },
    pause() {
      held = true;
      sounding?.pause();
      globalThis.speechSynthesis?.pause();
    },
    resume() {
      held = false;
      // Ask/replay/resume already enter here synchronously from their gesture.
      // Prime only a fresh sink; never replace current speech or prime on timers.
      if (!disposed && !silent && !generatedElement && globalThis.navigator?.userActivation?.isActive) {
        const element = generatedElement = new Audio();
        element.src = ACTIVATION_AUDIO;
        try { void element.play().catch(() => undefined); }
        catch { /* Actual speech retains the existing fallback behavior. */ }
      }
      if (sounding) { const fail = playbackFailure; void sounding.play().catch(() => { if (!held) fail?.(); }); }
      if (!silent) globalThis.speechSynthesis?.resume();
    },
    setMuted(muted) {
      silent = muted;
      if (sounding) sounding.muted = muted;
      if (muted) stopBrowser();
    },
    async speak(text, { signal, onStart, offsetSeconds }): Promise<void> {
      let started = false;
      const notifyStart = (source?: "browser" | "generated") => {
        if (started || disposed || signal.aborted || silent || held) return;
        started = true;
        try { void Promise.resolve(onStart?.(source)).catch(() => undefined); }
        catch { /* Observer failures do not affect playback. */ }
      };
      const line = await load(text, signal);
      if (disposed || signal.aborted || silent) return;
      if (offsetSeconds !== undefined && (line.source !== "generated" || !line.measured || !Number.isFinite(offsetSeconds) || offsetSeconds < 0 || offsetSeconds >= line.seconds)) throw new Error("Narration group requires measured, seekable audio");
      if (line.source === "browser") {
        const synthesis = globalThis.speechSynthesis;
        if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") throw new Error("Browser voice is unavailable");
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        let unavailable = false;
        await new Promise<void>((resolve) => {
          let finished = false;
          let onsetRemainingMs = 2_000;
          const finish = () => {
            if (finished) return;
            finished = true;
            clearWatchdog();
            clearInterval(onsetTimer);
            signal.removeEventListener("abort", stop);
            speechStops.delete(stop);
            utterance.onstart = null;
            utterance.onend = null;
            utterance.onerror = null;
            if (browserFinish === finish) browserFinish = undefined;
            resolve();
          };
          const stop = () => {
            finish();
            synthesis.cancel();
          };
          const clearWatchdog = watchSpeech(estimatedBrowserSeconds(text), stop);
          speechStops.add(stop);
          browserFinish = finish;
          const fail = () => { unavailable = true; stop(); };
          // Some embedded/headless browsers accept speak() but never dispatch
          // onstart. Cancel that pending utterance before the player deadline,
          // so late speech cannot start over subtitle-only playback.
          const onsetTimer = setInterval(() => {
            if (held || finished) return;
            onsetRemainingMs -= 250;
            if (onsetRemainingMs <= 0) fail();
          }, 250);
          utterance.onstart = () => {
            if (finished) return;
            clearInterval(onsetTimer);
            notifyStart("browser");
          };
          utterance.onend = finish;
          utterance.onerror = fail;
          signal.addEventListener("abort", stop, { once: true });
          try {
            synthesis.speak(utterance);
            if (held) synthesis.pause();
          } catch {
            fail();
          }
        });
        if (unavailable) throw new Error("Browser voice is unavailable");
        return;
      }

      let playbackFailed = false;
      try {
        stopGenerated?.();
        const element = generatedElement ??= new Audio();
        element.src = line.src;
        element.muted = silent;
        element.currentTime = offsetSeconds ?? 0;
        sounding = element;
        await new Promise<void>((resolve) => {
          let finished = false;
          let onsetTimer: ReturnType<typeof setTimeout> | undefined;
          const initialTime = offsetSeconds ?? 0;
          const finish = () => {
            if (finished) return;
            finished = true;
            clearWatchdog();
            clearTimeout(onsetTimer);
            signal.removeEventListener("abort", stop);
            speechStops.delete(stop);
            element.onplaying = null;
            element.onended = null;
            element.onerror = null;
            if (stopGenerated === stop) stopGenerated = undefined;
            if (sounding === element) {
              sounding = undefined;
              playbackFailure = undefined;
            }
            resolve();
          };
          const stop = () => {
            if (finished) return;
            element.pause();
            finish();
          };
          const fail = () => { if (!finished) { playbackFailed = true; stop(); } };
          stopGenerated = stop;
          const clearWatchdog = watchSpeech(Math.max(line.seconds, estimatedBrowserSeconds(text)), fail);
          speechStops.add(stop);
          playbackFailure = fail;
          // A native playing event may precede a working audio sink. Wait for
          // the actual media clock to advance beyond its seek position; a tiny
          // decoder priming increment alone is not audible onset evidence.
          const observeClock = () => {
            clearTimeout(onsetTimer);
            if (finished || started) return;
            if (!held && element.currentTime >= initialTime + 0.04) notifyStart("generated");
            if (!started) onsetTimer = setTimeout(observeClock, 16);
          };
          element.onplaying = observeClock;
          element.onended = finish;
          element.onerror = fail;
          signal.addEventListener("abort", stop, { once: true });
          try {
            if (!held) void element.play().catch(() => { if (!held) fail(); });
          } catch {
            fail();
          }
        });
      } catch {
        playbackFailed = true;
      }
      if (playbackFailed && offsetSeconds !== undefined) throw new Error("Grouped narration playback failed");
      if (playbackFailed && !disposed && !signal.aborted && !silent) {
        notifyFallback();
        URL.revokeObjectURL(line.src);
        lines.set(text.trim(), { source: "browser", seconds: estimatedBrowserSeconds(text) });
        await this.speak(text, { signal, onStart: notifyStart });
      }
    },
    dispose() {
      disposed = true;
      for (const controller of pendingLoads) {
        controller.abort(new DOMException("Video chat voice was disposed", "AbortError"));
      }
      pendingLoads.clear();
      for (const stop of speechStops) stop();
      speechStops.clear();
      sounding?.pause();
      sounding = undefined;
      // Release the decoder only when the voice is disposed, not between lines.
      generatedElement?.pause();
      generatedElement?.removeAttribute?.("src");
      generatedElement?.load?.();
      generatedElement = undefined;
      stopGenerated = undefined;
      stopBrowser();
      for (const line of lines.values()) {
        if (line.source === "generated") URL.revokeObjectURL(line.src);
      }
      lines.clear();
    },
  };
}
