import {
  conversationFor, initialState, reducer, soundtrackForTurn, transcriptFor,
  type VideoChatStatus, type VideoChatTurn,
} from "./session-state.js";
import {
  consumeVideoChatResponse, errorFrom, requestVideoChat, responseError, untilAborted,
  type ResponseStreamState,
} from "./response-stream.js";
export type { VideoChatStatus, VideoChatTurn } from "./session-state.js";
import { orderWelcomeCards, welcomeVisitSeed } from "./welcome-cards.js";
import { createCaptionVoice, type CaptionProgress } from "./caption-progress.js";
import { createScenePreparation } from "./scene-preparation.js";
import { validateNarrationGroups } from "../protocol/narration-group.js";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createMusicAudio, getMusicTrack, selectMusicTrack } from "../music-catalog.js";
import { DEFAULT_AUDIO_PREFERENCES, readAudioPreferences, saveAudioPreferences, updateAudioPreferences, type AudioPreferences } from "./audio-preferences.js";
import { VIDEO_SCHEMA_VERSION } from "../protocol/types.js";
import { createSceneTimeline } from "../protocol/scene-timeline.js";
import type {
  Video,
  VideoAudio,
  VideoOrientation,
  VideoScene,
  VideoStyleOptions,
} from "../protocol/types.js";
import { VideoError } from "../player/video-error.js";
import type { VideoPlayerProps } from "../player/video-player.js";
import type { MediaPlaybackMetric, PlaybackWaitReason } from "../player/video-player-types.js";
import { useNarration } from "../player/use-narration.js";
import type {
  VideoChatCapabilities,
  VideoChatAskOptions,
  VideoChatMode,
  VideoChatSuggestion,
  VideoChatWelcome,
} from "./types.js";
import { withDeadline } from "./deadline.js";
import { sanitizeVideoChatMedia } from "./media.js";
import { createVideoChatVoice, type VideoChatVoice } from "./voice.js";

const DEFAULT_TIMEOUT_MS = 660_000;

export interface UseVideoChatOptions {
  /** One provider-neutral route created with createVideoChatHandler. */
  endpoint?: string | URL;
  mode?: VideoChatMode;
  orientation?: VideoOrientation;
  style?: VideoStyleOptions;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  fetcher?: typeof fetch;
  /** Replace the default speech client while keeping session timing and cancellation. */
  voice?: VideoChatVoice;
  initialMuted?: boolean;
  /** Initial listening preferences, overriding this device's saved settings. */
  audio?: Partial<AudioPreferences>;
  timeoutMs?: number;
  createTurnId?: () => string;
  /** Observe how long a fresh response takes to display its first actual scene. */
  onFirstFrame?: (metric: VideoChatFirstFrameMetric) => unknown;
  /** Local observations only; no automatic telemetry or prompt/provider data. */
  onPlaybackMetric?: (metric: VideoChatPlaybackMetric) => unknown;
}

export type VideoChatPlaybackMetric = {
  turnId: string;
  mode: VideoChatMode;
  elapsedMs: number;
} & (
  | { type: "first-frame" }
  | { type: "first-media-frame" }
  | { type: "first-speech"; source: "browser" | "generated" | "custom" }
  | { type: "stall"; durationMs: number; reason: PlaybackWaitReason }
  | { type: "scene-duration"; speechDurationSec: number; clipDurationSec: number; recovered: boolean }
  | MediaPlaybackMetric
);

function observe(callback: (() => unknown) | undefined): void {
  try { void Promise.resolve(callback?.()).catch(() => undefined); } catch { /* Observers cannot affect playback. */ }
}

export interface VideoChatFirstFrameMetric {
  turnId: string;
  mode: VideoChatMode;
  timeToFirstFrameMs: number;
}

export interface UseVideoChatResult {
  ask(prompt: string, options?: VideoChatAskOptions): Promise<Video | undefined>;
  cancel(reason?: string): void;
  pause(): void;
  resume(): void;
  replay(): void;
  selectTurn(id: string): void;
  reset(): void;
  turns: readonly VideoChatTurn[];
  currentTurn?: VideoChatTurn;
  shownTurn?: VideoChatTurn;
  capabilities?: VideoChatCapabilities;
  welcome?: VideoChatWelcome;
  availableModes: readonly VideoChatMode[];
  status: VideoChatStatus;
  warnings: readonly string[];
  error?: VideoError;
  suggestions: readonly VideoChatSuggestion[];
  caption?: string;
  /** Narration revealed so far for the shown response. */
  transcript: readonly string[];
  speaking: boolean;
  muted: boolean;
  setMuted(muted: boolean): void;
  audioPreferences: AudioPreferences;
  setAudioPreferences(preferences: Partial<AudioPreferences>): void;
  resetAudioPreferences(): void;
  shuffleMusic(): void;
  soundtrack?: VideoAudio;
  backgroundDucked: boolean;
  backgroundWaiting: boolean;
  playbackEnded: boolean;
  /** Changes whenever saved content should restart from zero. */
  playerKey: number;
  /** Spread into VideoPlayer when present. */
  playerProps?: VideoPlayerProps;
}

function defaultTurnId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

/** Own a complete video conversation while the application owns its UI. */
export function useVideoChat(options: UseVideoChatOptions = {}): UseVideoChatResult {
  return useVideoChatSession(options).chat;
}

/** Internal shell access to in-memory history and caption progress. */
export function useVideoChatSession(options: UseVideoChatOptions = {}): {
  chat: UseVideoChatResult;
  restoreSession(turns: readonly VideoChatTurn[]): void;
  getCaptionProgress(): CaptionProgress | undefined;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [audioPreferences, setAudioState] = useState(() => updateAudioPreferences(readAudioPreferences(), options.audio));
  const audioPreferencesRef = useRef(audioPreferences);
  audioPreferencesRef.current = audioPreferences;
  const [voiceActive, setVoiceActive] = useState(false);
  const [backgroundWaiting, setBackgroundWaiting] = useState(false);
  const voiceWarningRef = useRef<(message?: string) => void>(() => undefined);
  const ownedVoiceRef = useRef<VideoChatVoice | undefined>(undefined);
  if (!options.voice && !ownedVoiceRef.current) {
    ownedVoiceRef.current = createVideoChatVoice({
      endpoint: options.endpoint,
      headers: options.headers,
      credentials: options.credentials,
      fetcher: options.fetcher,
      onFallback: () => voiceWarningRef.current(),
      onActivityChange: setVoiceActive,
    });
  }
  const rawVoice = options.voice ?? ownedVoiceRef.current!;
  const captionVoice = useMemo(() => createCaptionVoice(rawVoice), [rawVoice]);
  useEffect(() => () => captionVoice.reset(), [captionVoice]);
  const speechActivityId = useRef(0);
  const voice = useMemo(() => options.voice ? {
    ...captionVoice.voice,
    async speak(text: string, options: Parameters<VideoChatVoice["speak"]>[1]) {
      const id = ++speechActivityId.current;
      try { await captionVoice.voice.speak(text, { ...options, onStart: source => {
        if (!options.signal.aborted && id === speechActivityId.current) setVoiceActive(true);
        options.onStart?.(source);
      } }); }
      finally { if (id === speechActivityId.current) setVoiceActive(false); }
    },
  } : captionVoice.voice, [captionVoice, options.voice]);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const unavailableVoiceLines = useRef(new Set<string>());
  const speechStartRef = useRef<(source?: "browser" | "generated") => void>(() => undefined);
  const narration = useNarration({ onSpeechStart: (source) => speechStartRef.current(source), voice: {
    supportsOffsets: voice.supportsOffsets,
    ...(voice.getCurrentTime ? { getCurrentTime: () => voice.getCurrentTime!() } : {}),
    speak: async (text, options) => {
      if (unavailableVoiceLines.current.has(text)) return;
      try { await voice.speak(text, options); }
      catch (error) {
        if (!options.signal.aborted) voiceWarningRef.current("Voice playback is unavailable. Continuing with subtitles.");
        throw error;
      }
    },
  } });
  const narrationRef = useRef(narration);
  narrationRef.current = narration;

  const [state, dispatch] = useReducer(reducer, options.initialMuted ?? false, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const runRef = useRef(0);
  const inFlightRef = useRef<AbortController | undefined>(undefined);
  const suggestionsRef = useRef<AbortController | undefined>(undefined);
  const openingRef = useRef<AbortController | undefined>(undefined);
  const timelineRef = useRef<ReturnType<typeof createSceneTimeline> | undefined>(undefined);
  const heldRef = useRef(false);
  const flushRef = useRef<(() => void) | undefined>(undefined);
  const mountedRef = useRef(true);
  const firstFrameRef = useRef<{
    turnId: string;
    mode: VideoChatMode;
    startedAt: number;
    reported: boolean;
    speechReported: boolean;
    mediaReported?: boolean;
    active: boolean;
    stallStartedAt?: number;
    stallReason?: PlaybackWaitReason;
  } | undefined>(undefined);

  const reportMetric = useCallback((metric: VideoChatPlaybackMetric) => {
    observe(() => optionsRef.current.onPlaybackMetric?.(metric));
  }, []);
  const finishStall = useCallback(() => {
    const timing = firstFrameRef.current;
    if (!timing?.active || timing.stallStartedAt == null) return;
    const now = monotonicNow();
    const started = timing.stallStartedAt;
    timing.stallStartedAt = undefined;
    reportMetric({ type: "stall", turnId: timing.turnId, mode: timing.mode,
      elapsedMs: Math.max(0, Math.round(now - timing.startedAt)),
      durationMs: Math.max(0, Math.round(now - started)), reason: timing.stallReason ?? "scene-generation" });
  }, [reportMetric]);
  const endTiming = useCallback(() => {
    finishStall();
    if (firstFrameRef.current) firstFrameRef.current.active = false;
  }, [finishStall]);
  speechStartRef.current = (source) => {
    const timing = firstFrameRef.current;
    if (!mountedRef.current || !timing?.active || timing.speechReported || heldRef.current || stateRef.current.muted) return;
    timing.speechReported = true;
    reportMetric({ type: "first-speech", turnId: timing.turnId, mode: timing.mode,
      elapsedMs: Math.max(0, Math.round(monotonicNow() - timing.startedAt)),
      source: optionsRef.current.voice ? "custom" : source === "generated" ? "generated" : "browser" });
  };

  const request = useCallback((action: string, init: Omit<RequestInit, "signal"> = {}, signal?: AbortSignal) =>
    requestVideoChat(optionsRef.current, action, init, signal), []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void request("capabilities", {}, controller.signal)
      .then(async (response) => {
        if (!response.ok) throw await responseError(response);
        return response.json() as Promise<VideoChatCapabilities>;
      })
      .then((value) => { if (mountedRef.current) dispatch({ type: "capabilities", value }); })
      .catch(() => undefined);
    void request("welcome", {}, controller.signal)
      .then(async (response) => {
        if (!response.ok) throw await responseError(response);
        return response.json() as Promise<VideoChatWelcome>;
      })
      .then((value) => { if (mountedRef.current) dispatch({ type: "welcome", value: {...value, cards: orderWelcomeCards(value.cards, welcomeVisitSeed())} }); })
      .catch(() => undefined);
    return () => {
      endTiming();
      mountedRef.current = false;
      controller.abort();
      runRef.current += 1;
      inFlightRef.current?.abort(new DOMException("Component unmounted", "AbortError"));
      openingRef.current?.abort(new DOMException("Component unmounted", "AbortError"));
      suggestionsRef.current?.abort();
      timelineRef.current?.complete();
      timelineRef.current = undefined;
      narrationRef.current.interrupt();
      queueMicrotask(() => {
        if (!mountedRef.current) ownedVoiceRef.current?.dispose?.();
      });
    };
  }, [request, endTiming]);

  useEffect(() => voice.setMuted(state.muted), [state.muted, voice]);
  useEffect(() => voice.setVolume?.(audioPreferences.voiceVolume), [audioPreferences.voiceVolume, voice]);

  const cancel = useCallback((reason = "Video chat was cancelled") => {
    endTiming();
    runRef.current += 1;
    inFlightRef.current?.abort(new DOMException(reason, "AbortError"));
    openingRef.current?.abort(new DOMException(reason, "AbortError"));
    suggestionsRef.current?.abort();
    inFlightRef.current = undefined;
    openingRef.current = undefined;
    timelineRef.current?.complete();
    timelineRef.current = undefined;
    flushRef.current = undefined;
    narrationRef.current.interrupt();
    setBackgroundWaiting(false);
    dispatch({ type: "cancelled" });
  }, [endTiming]);

  const ask = useCallback(async (
    value: string,
    askOptions: VideoChatAskOptions = {},
  ): Promise<Video | undefined> => {
    const prompt = value.trim();
    if (!prompt) return undefined;
    endTiming();

    inFlightRef.current?.abort(new DOMException("Replaced by a new prompt", "AbortError"));
    openingRef.current?.abort(new DOMException("Replaced by a new prompt", "AbortError"));
    suggestionsRef.current?.abort();
    timelineRef.current?.complete();
    timelineRef.current = undefined;
    narrationRef.current.interrupt();
    voiceRef.current.resume();
    unavailableVoiceLines.current.clear();
    heldRef.current = false;
    const controller = new AbortController();
    const openingController = new AbortController();
    inFlightRef.current = controller;
    openingRef.current = openingController;
    controller.signal.addEventListener("abort", () => {
      openingController.abort(controller.signal.reason);
    }, { once: true });
    const run = runRef.current + 1;
    runRef.current = run;
    const currentOptions = optionsRef.current;
    const listeningPreferences = audioPreferencesRef.current;
    const previousTrackId = soundtrackForTurn(stateRef.current.turns.at(-1))?.trackId;
    const initialTrack = selectMusicTrack(listeningPreferences.musicMood === "auto" ? "calm" : listeningPreferences.musicMood, previousTrackId);
    setBackgroundWaiting(false);
    const timeoutMs = currentOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      inFlightRef.current = undefined;
      throw new VideoError("timeoutMs must be positive", { code: "invalid_option" });
    }
    const timeout = setTimeout(() => controller.abort(new DOMException("Video chat timed out", "TimeoutError")), timeoutMs);
    let mode = currentOptions.mode ?? "cinematic";
    const orientation = currentOptions.orientation ?? "landscape";
    const id = (currentOptions.createTurnId ?? defaultTurnId)();
    const conversation = conversationFor(stateRef.current.turns);
    const openingMedia = sanitizeVideoChatMedia(askOptions.openingMedia);
    const suppliedOpening = typeof askOptions.opening === "string"
      ? askOptions.opening.trim().slice(0, 300)
      : "";
    const turn: VideoChatTurn = {
      id,
      prompt,
      completed: false,
      orientation,
      fixedOrientation: true,
      mode,
      suggestions: [],
      ...(initialTrack ? { initialSoundtrack: createMusicAudio(initialTrack) } : {}),
      ...(openingMedia ? { openingMedia } : {}),
    };
    firstFrameRef.current = { turnId: id, mode, startedAt: monotonicNow(), reported: false, speechReported: false, active: true };
    dispatch({ type: "start", turn });

    let timeline: ReturnType<typeof createSceneTimeline> | undefined;
    let openingActive = false;
    let planDone = false;
    let timelineCompleted = false;
    let terminal = false;
    let attempt = 0;
    let appended = 0;
    const responseState: ResponseStreamState = { ready: [], received: [], spokenHook: suppliedOpening, openingRequested: false };

    const isCurrent = () => mountedRef.current && runRef.current === run && !controller.signal.aborted && !terminal;
    const isOpeningCurrent = () => (
      isCurrent()
      && !terminal
      && openingRef.current === openingController
      && !openingController.signal.aborted
    );
    const warn = (message: string) => {
      if (isCurrent()) dispatch({ type: "warning", id, message });
    };
    voiceWarningRef.current = (message = "Using browser voice for this response.") => warn(message);
    const flush = () => {
      if (!isCurrent()) return;
      let available = appended;
      while (responseState.ready[available]) {
        const group = responseState.ready[available]!.narrationGroup;
        if (!group) { available++; continue; }
        let end = available;
        while (responseState.ready[end]?.narrationGroup?.id === group.id) end++;
        const last = responseState.ready[end - 1]!.narrationGroup!;
        if (Math.abs(last.offsetSeconds + last.durationSeconds - group.totalSeconds) > 0.02) break;
        validateNarrationGroups(responseState.ready.slice(available, end) as VideoScene[]);
        available = end;
      }
      if (available === appended && timeline) {
        if (planDone && !timelineCompleted) {
          timelineCompleted = true;
          timeline.complete();
          if (timelineRef.current === timeline) timelineRef.current = undefined;
        }
        return;
      }
      if (!timeline) {
        if (!responseState.style || openingActive || heldRef.current || available === appended) return;
        timeline = createSceneTimeline({ style: responseState.style, orientation, audio: responseState.audio });
        timelineRef.current = timeline;
        openingController.abort(new DOMException("Opening replaced by response", "AbortError"));
        if (openingRef.current === openingController) openingRef.current = undefined;
        dispatch({ type: "player", id, stream: timeline.stream });
      }
      while (appended < available) timeline.add(responseState.ready[appended++]!);
      dispatch({
        type: "partial",
        id,
        video: { schemaVersion: VIDEO_SCHEMA_VERSION, orientation, scenes: responseState.ready.slice(0, appended) as VideoScene[], style: responseState.style!,
          ...(responseState.audio ? { audio: responseState.audio } : {}) },
      });
      if (planDone && !timelineCompleted) {
        timelineCompleted = true;
        timeline.complete();
        if (timelineRef.current === timeline) timelineRef.current = undefined;
      }
    };
    flushRef.current = flush;

    const preparation = createScenePreparation({
      voice: () => voiceRef.current, customVoice: Boolean(currentOptions.voice), signal: controller.signal,
      onVoiceUnavailable: text => { if (isCurrent()) unavailableVoiceLines.current.add(text); },
      warn,
      onDuration: value => {
        const timing = firstFrameRef.current;
        if (isCurrent() && timing?.active) reportMetric({ type: "scene-duration", ...value,
          turnId: id, mode, elapsedMs: Math.max(0, Math.round(monotonicNow() - timing.startedAt)) });
      },
    });
    const { prepareSpeech } = preparation;

    const speakOpening = async (text: string) => {
      try {
        if (!isOpeningCurrent()) return;
        dispatch({ type: "opening-start", id, line: text });
        await prepareSpeech(text, openingController.signal);
        if (!isOpeningCurrent()) return;
        await voiceRef.current.speak(text, { signal: openingController.signal, onStart: (source) => { if (isOpeningCurrent()) speechStartRef.current(source); } });
      } catch {
        if (isOpeningCurrent()) warn("Some narration is unavailable; the response will continue.");
      } finally {
        openingActive = false;
        if (isOpeningCurrent()) dispatch({ type: "opening-end", id });
        flush();
      }
    };

    if (responseState.spokenHook) {
      responseState.openingRequested = true;
      openingActive = true;
      void speakOpening(responseState.spokenHook);
    }

    const runAttempt = (currentAttempt: number) => consumeVideoChatResponse({
      request,
      body: {
        prompt,
        ...(responseState.spokenHook ? { opening: responseState.spokenHook } : {}),
        mode,
        orientation,
        conversation,
        musicMood: listeningPreferences.musicMood,
        ...(initialTrack ? { initialTrackId: initialTrack.id } : {}),
        ...(previousTrackId ? { previousTrackId } : {}),
        ...(currentOptions.style ? { style: currentOptions.style } : {}),
      },
      id, orientation, signal: controller.signal, state: responseState, preparation,
      voice: () => voiceRef.current,
      isCurrent: () => isCurrent() && currentAttempt === attempt,
      warn, flush,
      onMode: (resolvedMode) => {
        mode = resolvedMode;
        dispatch({ type: "resolved-mode", id, mode });
        if (firstFrameRef.current?.turnId === id) firstFrameRef.current.mode = mode;
      },
      onOpening: (line) => {
        openingActive = true;
        void speakOpening(line);
      },
    });

    try {
      let response: { video: Video; lines: string[] };
      try {
        response = await untilAborted(runAttempt(attempt), controller.signal);
      } catch (cause) {
        if (mode !== "pexels" || controller.signal.aborted || timeline || responseState.spokenHook
            || (cause instanceof VideoError && ["media_not_ready", "narration_group_invalid"].includes(cause.code)) || responseState.received.some((scene) => scene?.narrationGroup)) throw cause;
        attempt += 1;
        responseState.ready = [];
        responseState.received = [];
        appended = 0;
        responseState.style = undefined;
        responseState.audio = undefined;
        response = await untilAborted(runAttempt(attempt), controller.signal);
      }
      if (!isCurrent()) return undefined;
      planDone = true;
      flush();
      dispatch({ type: "complete", id, video: response.video, suggestions: [] });
      const suggestionsController = new AbortController();
      suggestionsRef.current = suggestionsController;
      void withDeadline(async (signal) => {
        const result = await request("suggestions", {
          method: "POST", body: JSON.stringify({ prompt, lines: response.lines }),
        }, signal);
        if (!result.ok) return [];
        const payload = await result.json() as { suggestions?: VideoChatSuggestion[] };
        return Array.isArray(payload.suggestions) ? payload.suggestions : [];
      }, 7_000, suggestionsController.signal).then((suggestions) => {
        if (mountedRef.current && runRef.current === run && !suggestionsController.signal.aborted) {
          dispatch({ type: "suggestions", id, suggestions });
        }
      }).catch(() => undefined).finally(() => {
        if (suggestionsRef.current === suggestionsController) suggestionsRef.current = undefined;
      });
      return response.video;
    } catch (cause) {
      if (runRef.current !== run) return undefined;
      if (controller.signal.aborted && !(controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError")) {
        return undefined;
      }
      terminal = true;
      const recovered = responseState.received.some((scene) => scene?.narrationGroup) || (cause instanceof VideoError && ["media_not_ready", "narration_group_invalid"].includes(cause.code)) ? [] : responseState.received.flatMap((scene, index) => scene
        ? [responseState.ready[index] ?? { ...scene, timing: { fixedDuration: 5 } }]
        : []);
      if (recovered.length > 0) {
        responseState.style ??= { density: "normal", motion: "normal", defaultBackgroundEffect: "static", defaultTextArchetype: "subtle", defaultTransition: "crossfade" };
        openingController.abort(new DOMException("Continuing completed response", "AbortError"));
        if (!timeline) {
          timeline = createSceneTimeline({ style: responseState.style, orientation, audio: responseState.audio });
          dispatch({ type: "player", id, stream: timeline.stream });
        }
        for (const scene of recovered.slice(appended)) timeline.add(scene);
        timeline.complete();
        if (timelineRef.current === timeline) timelineRef.current = undefined;
        const video: Video = { schemaVersion: VIDEO_SCHEMA_VERSION, orientation, style: responseState.style, scenes: recovered,
          ...(responseState.audio ? { audio: responseState.audio } : {}) };
        dispatch({ type: "warning", id, message: "The response was interrupted; completed scenes are still available." });
        dispatch({ type: "complete", id, video, suggestions: [] });
        return video;
      }
      openingController.abort(new DOMException("Response failed", "AbortError"));
      timeline?.complete();
      if (timelineRef.current === timeline) timelineRef.current = undefined;
      const error = errorFrom(cause);
      dispatch({ type: "error", id, error });
      return undefined;
    } finally {
      clearTimeout(timeout);
      if (runRef.current === run) inFlightRef.current = undefined;
    }
  }, [request, endTiming]);

  const pause = useCallback(() => {
    finishStall();
    heldRef.current = true;
    voiceRef.current.pause();
    dispatch({ type: "pause" });
  }, [finishStall]);

  const resume = useCallback(() => {
    heldRef.current = false;
    voiceRef.current.resume();
    dispatch({ type: "resume" });
    flushRef.current?.();
  }, []);

  const prepareSavedGroups = useCallback(async (video: Video) => {
    validateNarrationGroups(video.scenes);
    const groups = new Map(video.scenes.flatMap((scene) => scene.narrationGroup ? [[scene.narrationGroup.id, scene.narrationGroup] as const] : []));
    for (const group of groups.values()) {
      const prepared = await withDeadline((signal) => voiceRef.current.prepare(group.text, { signal }), 3000);
      if (voiceRef.current.supportsOffsets !== true || prepared.supportsOffsets !== true || Math.abs(prepared.seconds - group.totalSeconds) > 0.1) throw new VideoError("Saved narration group requires matching measured audio", { code: "narration_group_invalid" });
    }
  }, []);

  const replay = useCallback(() => {
    const turn = stateRef.current.turns.find((entry) => entry.id === stateRef.current.shownTurnId);
    if (!turn?.completed || !turn.video) return;
    setBackgroundWaiting(false);
    runRef.current += 1;
    endTiming();
    if (inFlightRef.current) {
      runRef.current += 1;
      inFlightRef.current.abort(new DOMException("Replaying a saved response", "AbortError"));
      inFlightRef.current = undefined;
    }
    openingRef.current?.abort(new DOMException("Replaying a saved response", "AbortError"));
    openingRef.current = undefined;
    timelineRef.current?.complete();
    timelineRef.current = undefined;
    narrationRef.current.interrupt();
    heldRef.current = false;
    voiceRef.current.resume();
    if (turn.video.scenes.some((scene) => scene.narrationGroup)) {
      const selection = ++runRef.current;
      dispatch({ type: "pause" });
      void prepareSavedGroups(turn.video).then(() => {
        if (mountedRef.current && runRef.current === selection) dispatch({ type: "replay" });
      }).catch((cause: unknown) => {
        if (mountedRef.current && runRef.current === selection) dispatch({ type: "error", id: turn.id, error: errorFrom(cause) });
      });
    } else dispatch({ type: "replay" });
  }, [endTiming, prepareSavedGroups]);

  const selectTurn = useCallback((id: string) => {
    const turn = stateRef.current.turns.find((entry) => entry.id === id);
    if (!turn?.completed || !turn.video) return;
    setBackgroundWaiting(false);
    runRef.current += 1;
    endTiming();
    if (inFlightRef.current) {
      runRef.current += 1;
      inFlightRef.current.abort(new DOMException("Viewing a saved response", "AbortError"));
      inFlightRef.current = undefined;
    }
    openingRef.current?.abort(new DOMException("Viewing a saved response", "AbortError"));
    openingRef.current = undefined;
    timelineRef.current?.complete();
    timelineRef.current = undefined;
    narrationRef.current.interrupt();
    heldRef.current = false;
    voiceRef.current.resume();
    if (turn.video.scenes.some((scene) => scene.narrationGroup)) {
      const selection = ++runRef.current;
      dispatch({ type: "pause" });
      void prepareSavedGroups(turn.video).then(() => {
        if (mountedRef.current && runRef.current === selection) dispatch({ type: "select", id });
      }).catch((cause: unknown) => {
        if (mountedRef.current && runRef.current === selection) dispatch({ type: "error", id, error: errorFrom(cause) });
      });
    } else dispatch({ type: "select", id });
  }, [endTiming, prepareSavedGroups]);

  const reset = useCallback(() => {
    cancel("Session reset");
    heldRef.current = false;
    voiceRef.current.resume();
    dispatch({ type: "reset" });
  }, [cancel]);

  const restoreSession = useCallback((turns: readonly VideoChatTurn[]) => {
    cancel("Restoring session");
    heldRef.current = false;
    voiceRef.current.resume();
    // These are completed turns previously produced by this mounted shell.
    // Limit retained history even when a session has run for a long time.
    dispatch({ type: "restore", turns: turns.filter((turn) => turn.completed && turn.video).slice(-100) });
  }, [cancel]);

  const setMuted = useCallback((muted: boolean) => dispatch({ type: "mute", value: muted }), []);

  const setAudioPreferences = useCallback((preferences: Partial<AudioPreferences>) => {
    const previous = audioPreferencesRef.current;
    const next = updateAudioPreferences(previous, preferences);
    audioPreferencesRef.current = next;
    setAudioState(next);
    saveAudioPreferences(next);
    if (next.musicMood === previous.musicMood) return;
    const current = stateRef.current;
    const turn = current.turns.find(turn => turn.id === current.shownTurnId) ?? current.turns.at(-1);
    if (!turn) return;
    const track = next.musicMood === "auto" ? undefined : selectMusicTrack(next.musicMood, soundtrackForTurn(turn)?.trackId);
    dispatch({ type: "soundtrack", id: turn.id,
      audio: next.musicMood === "auto" ? turn.originalSoundtrack : track ? createMusicAudio(track) : false });
  }, []);
  const resetAudioPreferences = useCallback(() => setAudioPreferences(DEFAULT_AUDIO_PREFERENCES), [setAudioPreferences]);
  const shuffleMusic = useCallback(() => {
    const current = stateRef.current;
    const turn = current.turns.find(turn => turn.id === current.shownTurnId) ?? current.turns.at(-1);
    const preference = audioPreferencesRef.current.musicMood;
    if (!turn || preference === "off") return;
    const audio = soundtrackForTurn(turn);
    const mood = preference === "auto" ? getMusicTrack(audio?.trackId ?? "")?.mood : preference;
    if (!mood) return;
    const track = selectMusicTrack(mood, audio?.trackId);
    if (track) dispatch({ type: "soundtrack", id: turn.id, audio: createMusicAudio(track) });
  }, []);

  const currentTurn = state.turns.at(-1);
  const shownTurn = state.turns.find((turn) => turn.id === state.shownTurnId) ?? currentTurn;
  const soundtrack = audioPreferences.musicMood === "off" ? undefined : soundtrackForTurn(shownTurn);
  const backgroundDucked = voiceActive && (!options.voice || audioPreferences.voiceVolume > 0) && !state.muted && state.status !== "paused";
  const availableModes = state.capabilities?.modes ?? (["cinematic"] as const);
  const suggestions = shownTurn?.suggestions ?? [];
  const fullTranscript = shownTurn ? transcriptFor(shownTurn) : [];
  const transcript = shownTurn && shownTurn === currentTurn && state.playback?.kind !== "video"
    ? fullTranscript.slice(0, (shownTurn.opening ? 1 : 0) + state.spokenUpTo + 1)
    : fullTranscript;
  const playbackKey = state.playerKey;
  const playerProps = state.playback ? {
    ...(state.playback.kind === "stream"
      ? { stream: state.playback.stream! }
      : { video: state.playback.video! }),
    autoPlay: true,
    muted: state.muted,
    soundtrack: audioPreferences.musicMood === "off" ? false : shownTurn?.soundtrack,
    soundtrackVolume: audioPreferences.musicVolume,
    nativeMediaAudio: { volume: audioPreferences.sceneVolume, ambientOnly: true },
    backgroundDucked,
    backgroundWaiting,
    paused: state.status === "paused",
    controls: false,
    narrationReady: narration.isReady,
    narrationTime: narration.getTime,
    narrationActive: narration.isSpeaking,
    orientation: shownTurn?.fixedOrientation ? shownTurn.orientation : "auto" as const,
    onFramePresented: () => {
      const timing = firstFrameRef.current;
      if (stateRef.current.playerKey !== playbackKey || state.playback?.kind !== "stream" || !timing?.active || timing.reported) return;
      timing.reported = true;
      const elapsedMs = Math.max(0, Math.round(monotonicNow() - timing.startedAt));
      observe(() => optionsRef.current.onFirstFrame?.({ turnId: timing.turnId, mode: timing.mode, timeToFirstFrameMs: elapsedMs }));
      reportMetric({ type: "first-frame", turnId: timing.turnId, mode: timing.mode, elapsedMs });
    },
    onMediaFramePresented: () => {
      const timing = firstFrameRef.current;
      if (stateRef.current.playerKey !== playbackKey || state.playback?.kind !== "stream" || !timing?.active || timing.mediaReported) return;
      timing.mediaReported = true;
      reportMetric({type: "first-media-frame", turnId: timing.turnId, mode: timing.mode,
        elapsedMs: Math.max(0, Math.round(monotonicNow() - timing.startedAt))});
    },
    onPlaybackMetric: options.onPlaybackMetric ? (metric: MediaPlaybackMetric) => {
      const timing = firstFrameRef.current;
      if (stateRef.current.playerKey !== playbackKey || !timing?.active || state.playback?.kind !== "stream") return;
      reportMetric({ ...metric, turnId: timing.turnId, mode: timing.mode, elapsedMs: Math.max(0, Math.round(monotonicNow() - timing.startedAt)) });
    } : undefined,
    onStallChange: (stalled: boolean, reason: PlaybackWaitReason = "scene-generation") => {
      if (stateRef.current.playerKey !== playbackKey) return;
      setBackgroundWaiting(stalled);
      if (stalled && reason !== "speech") voiceRef.current.pause();
      else if (!heldRef.current) voiceRef.current.resume();
      if (state.playback?.kind !== "stream") return;
      const timing = firstFrameRef.current;
      if (!timing?.active || !timing.reported) return;
      if (!stalled) finishStall();
      else if (!heldRef.current && timing.stallStartedAt == null) { timing.stallStartedAt = monotonicNow(); timing.stallReason = reason; }
    },
    onSceneChange: (scene: VideoScene, index: number) => {
      if (stateRef.current.playerKey !== playbackKey) return;
      dispatch({ type: "scene", key: playbackKey, scene, index });
      narrationRef.current.onSceneChange(scene, index);
    },
    onPlaybackEnd: () => {
      if (stateRef.current.playerKey !== playbackKey) return;
      endTiming();
      dispatch({ type: "playback-end", key: playbackKey });
    },
    onError: (cause: Error) => {
      if (stateRef.current.playerKey !== playbackKey) return;
      narrationRef.current.interrupt();
      const id = stateRef.current.turns.at(-1)?.id;
      if (id) dispatch({ type: "error", id, error: errorFrom(cause) });
    },
  } satisfies VideoPlayerProps : undefined;

  const chat: UseVideoChatResult = {
    ask,
    cancel,
    pause,
    resume,
    replay,
    selectTurn,
    reset,
    turns: state.turns,
    currentTurn,
    shownTurn,
    capabilities: state.capabilities,
    welcome: state.welcome,
    availableModes,
    status: state.status,
    warnings: shownTurn?.warnings ?? [],
    error: state.error,
    suggestions,
    caption: state.caption,
    transcript,
    speaking: narration.speaking || state.openingSpeaking,
    muted: state.muted,
    setMuted,
    audioPreferences,
    setAudioPreferences,
    resetAudioPreferences,
    shuffleMusic,
    soundtrack,
    backgroundDucked,
    backgroundWaiting,
    playbackEnded: state.playbackEnded,
    playerKey: state.playerKey,
    playerProps,
  };
  return { chat, restoreSession, getCaptionProgress: captionVoice.getCaptionProgress };
}
