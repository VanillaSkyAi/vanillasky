import { primeSoundtrackGesture } from "../player/soundtrack-gesture.js";
import { getIosAudioContext, isIosAudioOutput, resumeIosAudioContext } from "../player/ios-audio-output.js";
import { audioVolume, rampMediaVolume } from "../player/audio-volume.js";
import type { NarrationVoice } from "../player/use-narration.js";
import { withDeadline } from "./deadline.js";
import { estimateNarrationSeconds } from "../protocol/clip-budget.js";
import { parseSpeechWordTimings, type SpeechWordTiming } from "../protocol/speech-timing.js";

const DEFAULT_MAX_CACHED_LINES = 60;
const SPEECH_PREPARATION_TIMEOUT_MS = 3_000;
const FALLBACK_BITS_PER_SECOND = 128_000;
const MAX_AUDIO_BYTES = 1024 * 1024;
const MAX_DECODED_CACHE_BYTES = 32 * 1024 * 1024;
// 25ms of silent PCM, played unmuted to retain Safari permission on this sink.
const ACTIVATION_AUDIO = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YZABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let sharedContext: AudioContext | undefined;

type PreparedLine =
  | ({ source: "generated"; seconds: number; measured?: boolean; wordTimings?: SpeechWordTiming[] }
    & ({ src: string; buffer?: never } | { buffer: AudioBuffer; src?: never }))
  | { source: "browser"; seconds: number };

export interface VideoChatPreparedSpeech {
  /** Measured or conservatively estimated spoken duration, in seconds. */
  seconds: number;
  /** True only for decoded audio with seek support, never duration estimates. */
  supportsOffsets?: boolean;
  /** Validated words aligned to this exact prepared audio. */
  wordTimings?: SpeechWordTiming[];
}

export interface VideoChatVoice extends NarrationVoice {
  prepare(text: string, options?: { signal?: AbortSignal }): Promise<VideoChatPreparedSpeech>;
  pause(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  /** Change loudness without changing timing; browser speech applies it to the next utterance. */
  setVolume?(volume: number): void;
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
  return Math.max(1, estimateNarrationSeconds(text));
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
 * Create the generated-speech client with a browser-voice fallback.
 *
 * The endpoint is provider-neutral. A no-content response (or a compatible
 * endpoint's 404) selects browser speech for the rest of the session.
 */
export function createVideoChatVoice(options: CreateVideoChatVoiceOptions = {}): VideoChatVoice {
  const endpoint = options.endpoint ?? "/api/video-chat";
  const fetcher = options.fetcher ?? fetch;
  const maximum = options.maxCachedLines ?? DEFAULT_MAX_CACHED_LINES;
  const bufferOutput = isIosAudioOutput();
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
  let volume = 1;
  let utterance: SpeechSynthesisUtterance | undefined;
  let activeSpeech = false;
  let buffered: {
    context: AudioContext; gain: GainNode;
    time: () => number; pause: () => void; resume: () => void; fail: () => void;
  } | undefined;
  let outputContext: AudioContext | undefined;
  let nativeVolumeSupported: boolean | undefined;
  let output: { source: MediaElementAudioSourceNode; gain: GainNode } | undefined;
  let cancelVolumeRamp: (() => void) | undefined;
  const applyVolume = (immediate = false) => {
    cancelVolumeRamp?.();
    cancelVolumeRamp = undefined;
    if (buffered) {
      const { context, gain } = buffered;
      gain.gain.cancelScheduledValues(context.currentTime);
      if (immediate || silent) gain.gain.setValueAtTime(silent ? 0 : volume, context.currentTime);
      else gain.gain.setTargetAtTime(volume, context.currentTime, .035);
    }
    if (generatedElement) {
      generatedElement.muted = silent || volume === 0;
      if (output && outputContext) {
        output.gain.gain.cancelScheduledValues(outputContext.currentTime);
        if (immediate) output.gain.gain.setValueAtTime(volume, outputContext.currentTime);
        else output.gain.gain.setTargetAtTime(volume, outputContext.currentTime, .035);
      } else if (immediate) {
        try { generatedElement.volume = volume; } catch { /* Native volume may be fixed on iOS. */ }
      } else cancelVolumeRamp = rampMediaVolume(generatedElement, volume);
    }
  };
  const connectOutput = () => {
    // Only generated blob/data sources enter this graph, after a real gesture
    // unlocks it. Remote videos keep their native, CORS-safe audio path.
    if (output || !generatedElement || outputContext?.state !== "running") return;
    if (nativeVolumeSupported === undefined) {
      const previous = generatedElement.volume;
      const probe = previous === .5 ? .25 : .5;
      try {
        generatedElement.volume = probe;
        nativeVolumeSupported = generatedElement.volume === probe;
      } catch { nativeVolumeSupported = false; }
      finally {
        try { generatedElement.volume = previous; } catch { /* Fixed native gain uses the graph below. */ }
      }
    }
    if (nativeVolumeSupported) {
      // WebKit can buffer this source ahead of its audible output when routed
      // through Web Audio, distorting currentTime and ended. Keep narration's
      // native clock intact whenever its native gain already works.
      void outputContext.close().catch(() => undefined);
      outputContext = undefined;
      return;
    }
    try {
      const source = outputContext.createMediaElementSource(generatedElement);
      const gain = outputContext.createGain();
      source.connect(gain); gain.connect(outputContext.destination);
      generatedElement.volume = 1;
      output = { source, gain };
      applyVolume(true);
    } catch { /* Keep direct speech playback when Web Audio is unavailable. */ }
  };
  let disposed = false;
  let generatedSpeechUnavailable = false;
  let playbackFailure: (() => void) | undefined;
  // Native play promises can reject after pause/resume has superseded them.
  // Only the latest request may fail the current line or release its blob.
  let playbackAttempt = 0;
  const playGenerated = (element: HTMLAudioElement, fail: (() => void) | undefined) => {
    const attempt = ++playbackAttempt;
    const reject = () => { if (attempt === playbackAttempt && !held && sounding === element) fail?.(); };
    try { void element.play().catch(reject); }
    catch { reject(); }
  };
  const notifyFallback = () => {
    try { void Promise.resolve(options.onFallback?.()).catch(() => undefined); }
    catch { /* Observer failures do not affect speech. */ }
  };

  const forgetOldest = () => {
    const decodedBytes = () => [...lines.values()].reduce((total, line) => total + (line.source === "generated" && line.buffer
      ? line.buffer.length * line.buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT : 0), 0);
    // A single larger current line may remain cached; queued PCM cannot grow
    // to sixty compressed-response equivalents on memory-constrained phones.
    while (lines.size > maximum || (lines.size > 1 && decodedBytes() > MAX_DECODED_CACHE_BYTES)) {
      const oldest = lines.keys().next();
      if (oldest.done) return;
      const line = lines.get(oldest.value);
      lines.delete(oldest.value);
      if (line?.source === "generated" && line.src) URL.revokeObjectURL(line.src);
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
            let bytes: ArrayBuffer;
            let wordTimings: SpeechWordTiming[] | undefined;
            let mediaType = response.headers.get("content-type") || "audio/mpeg";
            if (mediaType.split(";")[0]?.trim().toLowerCase() === "application/json") {
              const body = await response.arrayBuffer();
              preparationSignal.throwIfAborted();
              if (body.byteLength > 2 * MAX_AUDIO_BYTES) throw new Error("Speech response is too large");
              const value: unknown = JSON.parse(new TextDecoder().decode(body));
              if (!value || typeof value !== "object" || !("audio" in value) || typeof value.audio !== "string"
                || value.audio.length === 0 || value.audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4
                || !("mediaType" in value) || value.mediaType !== "audio/mpeg") throw new Error("Invalid speech audio");
              const binary = atob(value.audio);
              if (!binary.length || binary.length > MAX_AUDIO_BYTES) throw new Error("Invalid speech audio");
              bytes = Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
              mediaType = value.mediaType;
              if ("wordTimings" in value) wordTimings = parseSpeechWordTimings(value.wordTimings, normalized);
            } else {
              bytes = await response.arrayBuffer();
            }
            preparationSignal.throwIfAborted();
            if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error("Speech response is too large");
            if (bufferOutput) {
              const context = getIosAudioContext();
              if (!context) throw new Error("Speech audio output is unavailable");
              const buffer = await context.decodeAudioData(bytes.slice(0));
              preparationSignal.throwIfAborted();
              if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("Invalid speech duration");
              if (wordTimings) wordTimings = parseSpeechWordTimings(wordTimings, normalized, buffer.duration);
              return { source: "generated", buffer, seconds: buffer.duration, measured: true, ...(wordTimings ? { wordTimings } : {}) };
            }
            const seconds = await measureSeconds(bytes);
            if (wordTimings && seconds.measured) wordTimings = parseSpeechWordTimings(wordTimings, normalized, seconds.seconds);
            preparationSignal.throwIfAborted();
            // Allocate only after every asynchronous step succeeds. A late decode
            // cannot leak an object URL or replace the cached browser fallback.
            createdSrc = URL.createObjectURL(new Blob([bytes], {
              type: mediaType,
            }));
            return { source: "generated", src: createdSrc, ...seconds, ...(wordTimings ? {wordTimings} : {}) };
          }, SPEECH_PREPARATION_TIMEOUT_MS, controller.signal);
        }
      } catch (cause) {
        if (createdSrc) URL.revokeObjectURL(createdSrc);
        if (controller.signal.aborted) throw controller.signal.reason ?? cause;
        notifyFallback();
        prepared = { source: "browser", seconds: estimatedBrowserSeconds(normalized) };
      }

      if (disposed || controller.signal.aborted) {
        if (prepared.source === "generated" && prepared.src) URL.revokeObjectURL(prepared.src);
        throw controller.signal.reason ?? new DOMException("Video chat voice was disposed", "AbortError");
      }
      const existing = lines.get(normalized);
      if (existing) {
        if (prepared.source === "generated" && prepared.src) URL.revokeObjectURL(prepared.src);
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

  const speakBuffer = (buffer: AudioBuffer, text: string, signal: AbortSignal, initialTime: number, notifyStart: () => void) => new Promise<void>((resolve, reject) => {
    const context = getIosAudioContext();
    if (!context) { reject(new Error("Speech audio output is unavailable")); return; }
    const gain = context.createGain();
    gain.connect(context.destination);
    let source: AudioBufferSourceNode | undefined;
    let offset = initialTime;
    let since = context.currentTime;
    let generation = 0;
    let finished = false;
    const time = () => Math.min(buffer.duration, offset + (source ? Math.max(0, context.currentTime - since) : 0));
    const stopSource = () => {
      generation++;
      const previous = source;
      source = undefined;
      if (!previous) return;
      previous.onended = null;
      try { previous.stop(); } catch { /* Already ended or never started. */ }
      previous.disconnect();
    };
    const finish = (failed = false) => {
      if (finished) return;
      finished = true;
      stopSource();
      gain.disconnect();
      clearWatchdog();
      clearInterval(onsetTimer);
      signal.removeEventListener("abort", stop);
      speechStops.delete(stop);
      if (stopGenerated === stop) stopGenerated = undefined;
      if (buffered === playback) { buffered = undefined; activeSpeech = false; }
      if (failed) reject(new Error("Generated speech playback failed"));
      else resolve();
    };
    const stop = () => finish();
    const fail = () => finish(true);
    const resume = () => {
      if (finished || disposed || signal.aborted || held || source) return;
      const attempt = ++generation;
      const start = () => {
        if (finished || attempt !== generation || disposed || signal.aborted || held || source) return;
        if (context.state !== "running") { fail(); return; }
        try {
          const node = context.createBufferSource();
          source = node;
          node.buffer = buffer;
          node.connect(gain);
          node.onended = () => { if (source === node && attempt === generation && !held) finish(); };
          since = context.currentTime;
          node.start(0, offset);
        } catch { fail(); }
      };
      if (context.state === "running") start();
      else void resumeIosAudioContext().then(start, () => { if (attempt === generation && !held) fail(); });
    };
    const playback = { context, gain, time, resume, fail, pause: () => { offset = time(); stopSource(); } };
    buffered = playback;
    stopGenerated = stop;
    applyVolume(true);
    const clearWatchdog = watchSpeech(Math.max(buffer.duration, estimatedBrowserSeconds(text)), fail);
    const onsetTimer = setInterval(() => {
      if (!finished && !held && source && context.state === "running" && time() >= initialTime + .04) notifyStart();
    }, 16);
    speechStops.add(stop);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    else resume();
  });

  return {
    supportsOffsets: true,
    getCurrentTime: () => buffered?.time() ?? sounding?.currentTime,
    async prepare(text, preparation = {}) {
      const line = await load(text, preparation.signal);
      return { seconds: line.seconds, ...(line.source === "generated" && line.measured === true ? { supportsOffsets: true } : {}),
        ...(line.source === "generated" && line.wordTimings ? {wordTimings:line.wordTimings} : {}) };
    },
    pause() {
      playbackAttempt++;
      held = true;
      buffered?.pause();
      sounding?.pause();
      globalThis.speechSynthesis?.pause();
    },
    resume() {
      held = false;
      if (!disposed && bufferOutput) {
        // Resume synchronously from Ask/replay gestures. Voice pause/dispose
        // never suspends or closes the context shared with music.
        const playback = buffered;
        const attempt = ++playbackAttempt;
        const current = () => attempt === playbackAttempt && buffered === playback && !held && !disposed;
        void resumeIosAudioContext().then(
          context => { if (current()) { if (context) playback?.resume(); else playback?.fail(); } },
          () => { if (current()) playback?.fail(); },
        );
      } else if (!disposed) primeSoundtrackGesture();
      if (!bufferOutput && !disposed && nativeVolumeSupported !== true && globalThis.navigator?.userActivation?.isActive) {
        try {
          const Context = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Context) {
            outputContext ??= new Context();
            void outputContext.resume().then(connectOutput).catch(() => undefined);
          }
        } catch { /* The native sink remains the fallback. */ }
      }
      // Ask/replay/resume already enter here synchronously from their gesture.
      // Prime only a fresh sink; never replace current speech or prime on timers.
      if (!bufferOutput && !disposed && !silent && !generatedElement && globalThis.navigator?.userActivation?.isActive) {
        const element = generatedElement = new Audio();
        element.src = ACTIVATION_AUDIO;
        applyVolume(true);
        connectOutput();
        try { void element.play().catch(() => undefined); }
        catch { /* Actual speech retains the existing fallback behavior. */ }
      }
      if (sounding) playGenerated(sounding, playbackFailure);
      if (!silent) globalThis.speechSynthesis?.resume();
    },
    setMuted(muted) {
      silent = muted;
      applyVolume();
      if (muted) stopBrowser();
    },
    setVolume(next) {
      volume = audioVolume(next);
      applyVolume(!activeSpeech);
    },
    async speak(text, { signal, onStart, offsetSeconds, onBoundary, onPlaybackSource }): Promise<void> {
      let started = false;
      const notifyStart = (source?: "browser" | "generated") => {
        if (started || disposed || signal.aborted || silent || held) return;
        started = true;
        activeSpeech = true;
        if (source) {
          try { void Promise.resolve(onPlaybackSource?.(source)).catch(() => undefined); }
          catch { /* Source observers do not affect playback. */ }
        }
        try { void Promise.resolve(onStart?.(source)).catch(() => undefined); }
        catch { /* Observer failures do not affect playback. */ }
      };
      const line = await load(text, signal);
      if (disposed || signal.aborted || silent) return;
      if (offsetSeconds !== undefined && (line.source !== "generated" || !line.measured || !Number.isFinite(offsetSeconds) || offsetSeconds < 0 || offsetSeconds >= line.seconds)) throw new Error("Narration group requires measured, seekable audio");
      if (line.source === "browser") {
        const synthesis = globalThis.speechSynthesis;
        if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") throw new Error("Browser voice is unavailable");
        const browserUtterance = utterance = new SpeechSynthesisUtterance(text);
        browserUtterance.rate = 1;
        // Browsers do not define live mutation of an utterance already passed
        // to speak(). Keep its gain fixed until it ends.
        browserUtterance.volume = volume;
        let unavailable = false;
        await new Promise<void>((resolve) => {
          let finished = false;
          let onsetRemainingMs = 2_000;
          const finish = () => {
            if (finished) return;
            finished = true;
            if (utterance === browserUtterance) { utterance = undefined; activeSpeech = false; }
            clearWatchdog();
            clearInterval(onsetTimer);
            signal.removeEventListener("abort", stop);
            speechStops.delete(stop);
            browserUtterance.onstart = null;
            browserUtterance.onend = null;
            browserUtterance.onerror = null;
            browserUtterance.onboundary = null;
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
          browserUtterance.onstart = () => {
            if (finished) return;
            clearInterval(onsetTimer);
            notifyStart("browser");
          };
          browserUtterance.onend = finish;
          browserUtterance.onerror = fail;
          browserUtterance.onboundary = event => {
            if (finished || !started || disposed || signal.aborted || silent || held || event.name !== "word"
              || !Number.isInteger(event.charIndex) || event.charIndex < 0 || event.charIndex >= text.length) return;
            try { void Promise.resolve(onBoundary?.(event.charIndex)).catch(() => undefined); }
            catch { /* Caption observers cannot interrupt speech. */ }
          };
          signal.addEventListener("abort", stop, { once: true });
          try {
            synthesis.speak(browserUtterance);
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
        if (line.buffer) {
          await speakBuffer(line.buffer, text, signal, offsetSeconds ?? 0, () => notifyStart("generated"));
        } else {
          const element = generatedElement ??= new Audio();
          element.src = line.src;
          applyVolume(true);
          connectOutput();
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
                activeSpeech = false;
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
            if (!held) playGenerated(element, fail);
          });
        }
      } catch {
        playbackFailed = true;
      }
      if (playbackFailed && offsetSeconds !== undefined) throw new Error("Grouped narration playback failed");
      if (playbackFailed && !disposed && !signal.aborted && !silent) {
        notifyFallback();
        if (line.src) URL.revokeObjectURL(line.src);
        lines.set(text.trim(), { source: "browser", seconds: estimatedBrowserSeconds(text) });
        await this.speak(text, { signal, onStart: notifyStart, onBoundary, onPlaybackSource });
      }
    },
    dispose() {
      disposed = true;
      activeSpeech = false;
      cancelVolumeRamp?.();
      output?.source.disconnect();
      output?.gain.disconnect();
      if (typeof outputContext?.close === "function") void outputContext.close().catch(() => undefined);
      output = undefined;
      outputContext = undefined;
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
        if (line.source === "generated" && line.src) URL.revokeObjectURL(line.src);
      }
      lines.clear();
    },
  };
}
