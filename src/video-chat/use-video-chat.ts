import { validateNarrationGroups } from "../protocol/narration-group.js";
import { MEDIA_RECOVERY_NOTICE } from "./recovery";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { VIDEO_SCHEMA_VERSION } from "../protocol/types.js";
import { createSceneTimeline } from "../protocol/scene-timeline.js";
import { decodeVideoSse } from "../protocol/sse.js";
import { canStartPreparedSequence, preparedSceneDuration } from "../player/scene-readiness.js";
import type { VideoEvent } from "../protocol/events.js";
import type {
  Video,
  VideoOrientation,
  VideoScene,
  VideoStyle,
  VideoStyleOptions,
} from "../protocol/types.js";
import { VideoError } from "../player/video-error.js";
import type { VideoPlayerProps } from "../player/video-player.js";
import { useNarration } from "../player/use-narration.js";
import { preloadBuiltinTemplate } from "../visual-system/catalog/builtin-player.js";
import { getBuiltinTemplateMetadata } from "../visual-system/catalog/builtin-metadata.js";
import type { TemplateRegistry } from "../visual-system/catalog/kit.js";
import { warmSceneMedia } from "../player/warm-scene-media.js";
import { prepareSceneMedia } from "../player/prepare-scene-media.js";
import type {
  VideoChatCapabilities,
  VideoChatAskOptions,
  VideoChatConversationTurn,
  VideoChatMedia,
  VideoChatMode,
  VideoChatSuggestion,
  VideoChatWelcome,
} from "./types.js";
import { withDeadline } from "./deadline.js";
import { sanitizeVideoChatMedia } from "./media.js";
import { createVideoChatVoice, type VideoChatVoice } from "./voice.js";

const DEFAULT_TIMEOUT_MS = 180_000;

export type VideoChatStatus = "idle" | "composing" | "playing" | "paused" | "ended" | "cancelled" | "error";

export interface VideoChatTurn {
  id: string;
  prompt: string;
  /** True only after the complete response has been received. */
  completed: boolean;
  opening?: string;
  /** Concise notices for recovered optional failures. */
  warnings?: readonly string[];
  /** Optional stock footage held behind the opening hook until playback starts. */
  openingMedia?: VideoChatMedia;
  orientation: VideoOrientation;
  /** Generated footage keeps the orientation it was created in. */
  fixedOrientation: boolean;
  video?: Video;
  suggestions: readonly VideoChatSuggestion[];
}

export interface UseVideoChatOptions {
  /** One provider-neutral route created with createVideoChatHandler. */
  endpoint?: string | URL;
  /** Customer-owned templates that replace built-ins and add new renderers. */
  templates?: TemplateRegistry;
  mode?: VideoChatMode;
  orientation?: VideoOrientation;
  style?: VideoStyleOptions;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  fetcher?: typeof fetch;
  /** Replace the SDK speech client while keeping session timing and cancellation. */
  voice?: VideoChatVoice;
  initialMuted?: boolean;
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
  | { type: "stall"; durationMs: number; reason: "scene-generation" }
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
  playbackEnded: boolean;
  /** Changes whenever saved content should restart from zero. */
  playerKey: number;
  /** Spread into VideoPlayer when present. */
  playerProps?: VideoPlayerProps;
}

interface Playback {
  kind: "stream" | "video";
  stream?: AsyncIterable<VideoEvent>;
  video?: Video;
}

interface SessionState {
  turns: VideoChatTurn[];
  shownTurnId?: string;
  capabilities?: VideoChatCapabilities;
  welcome?: VideoChatWelcome;
  status: VideoChatStatus;
  resumeStatus: Exclude<VideoChatStatus, "paused">;
  error?: VideoError;
  caption?: string;
  spokenUpTo: number;
  muted: boolean;
  playbackEnded: boolean;
  playerKey: number;
  playback?: Playback;
  openingSpeaking: boolean;
}

type SessionAction =
  | { type: "capabilities"; value: VideoChatCapabilities }
  | { type: "welcome"; value: VideoChatWelcome }
  | { type: "start"; turn: VideoChatTurn }
  | { type: "opening-start"; id: string; line: string }
  | { type: "opening-media"; id: string; media: VideoChatMedia }
  | { type: "opening-end"; id: string }
  | { type: "player"; id: string; stream: AsyncIterable<VideoEvent> }
  | { type: "partial"; id: string; video: Video }
  | { type: "complete"; id: string; video: Video; suggestions: VideoChatSuggestion[] }
  | { type: "suggestions"; id: string; suggestions: VideoChatSuggestion[] }
  | { type: "scene"; key: number; scene: VideoScene; index: number }
  | { type: "playback-end"; key: number }
  | { type: "warning"; id: string; message: string }
  | { type: "error"; id: string; error: VideoError }
  | { type: "cancelled" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "mute"; value: boolean }
  | { type: "select"; id: string }
  | { type: "replay" }
  | { type: "reset" }
  | { type: "restore"; turns: VideoChatTurn[] };

function initialState(muted: boolean): SessionState {
  return {
    turns: [],
    status: "idle",
    resumeStatus: "idle",
    spokenUpTo: -1,
    muted,
    playbackEnded: false,
    playerKey: 0,
    openingSpeaking: false,
  };
}

function replaceTurn(
  turns: VideoChatTurn[],
  id: string,
  update: (turn: VideoChatTurn) => VideoChatTurn,
): VideoChatTurn[] {
  return turns.map((turn) => turn.id === id ? update(turn) : turn);
}

function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "capabilities": return { ...state, capabilities: action.value };
    case "welcome": return { ...state, welcome: action.value };
    case "start": return {
      ...state,
      turns: [...state.turns, action.turn],
      playerKey: state.playerKey + 1,
      shownTurnId: action.turn.id,
      status: "composing",
      resumeStatus: "composing",
      error: undefined,
      caption: undefined,
      spokenUpTo: -1,
      playbackEnded: false,
      playback: undefined,
      openingSpeaking: false,
    };
    case "opening-start":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return {
        ...state,
        turns: replaceTurn(state.turns, action.id, (turn) => ({
          ...turn,
          opening: turn.opening ? `${turn.opening} ${action.line}` : action.line,
        })),
        status: state.status === "paused" ? "paused" : "playing",
        resumeStatus: "playing",
        caption: action.line,
        openingSpeaking: true,
      };
    case "opening-media":
      if (state.turns.at(-1)?.id !== action.id || state.playback) return state;
      return {
        ...state,
        turns: replaceTurn(state.turns, action.id, (turn) => ({ ...turn, openingMedia: action.media })),
      };
    case "opening-end":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return {
        ...state,
        status: state.status === "paused" ? "paused" : state.playback ? "playing" : "composing",
        resumeStatus: state.playback ? "playing" : "composing",
        openingSpeaking: false,
      };
    case "player":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return {
        ...state,
        status: state.status === "paused" ? "paused" : "playing",
        resumeStatus: "playing",
        playback: { kind: "stream", stream: action.stream },
        playerKey: state.playerKey + 1,
        playbackEnded: false,
      };
    case "partial":
      return { ...state, turns: replaceTurn(state.turns, action.id, (turn) => ({ ...turn, video: action.video })) };
    case "complete":
      return {
        ...state,
        turns: replaceTurn(state.turns, action.id, (turn) => ({
          ...turn,
          completed: true,
          video: action.video,
          suggestions: action.suggestions,
        })),
      };
    case "suggestions":
      return { ...state, turns: replaceTurn(state.turns, action.id, (turn) => ({ ...turn, suggestions: action.suggestions })) };
    case "scene":
      if (state.playerKey !== action.key) return state;
      return {
        ...state,
        caption: action.scene.narration?.trim() || state.caption,
        spokenUpTo: Math.max(state.spokenUpTo, action.index),
      };
    case "playback-end":
      if (state.playerKey !== action.key) return state;
      return { ...state, status: "ended", resumeStatus: "ended", playbackEnded: true, openingSpeaking: false };
    case "warning":
      return { ...state, turns: replaceTurn(state.turns, action.id, (turn) => ({
        ...turn, warnings: [...new Set([...(turn.warnings ?? []), action.message])],
      })) };
    case "error":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return {
        ...state,
        status: "error",
        resumeStatus: "error",
        error: action.error,
        openingSpeaking: false,
        playback: undefined,
      };
    case "cancelled":
      return {
        ...state,
        status: "cancelled",
        resumeStatus: "cancelled",
        openingSpeaking: false,
        playback: undefined,
      };
    case "pause":
      if (state.status === "idle" || state.status === "paused" || state.status === "ended" || state.status === "cancelled" || state.status === "error") return state;
      return { ...state, resumeStatus: state.status, status: "paused" };
    case "resume":
      return state.status === "paused" ? { ...state, status: state.resumeStatus } : state;
    case "mute": return { ...state, muted: action.value };
    case "select": {
      const turn = state.turns.find((entry) => entry.id === action.id);
      if (!turn?.video) return state;
      return {
        ...state,
        shownTurnId: turn.id,
        playback: { kind: "video", video: turn.video },
        status: "playing",
        resumeStatus: "playing",
        playerKey: state.playerKey + 1,
        playbackEnded: false,
        spokenUpTo: -1,
        caption: turn.opening,
        error: undefined,
      };
    }
    case "replay": {
      const turn = state.turns.find((entry) => entry.id === state.shownTurnId);
      if (!turn?.video) return state;
      return {
        ...state,
        playback: { kind: "video", video: turn.video },
        status: "playing",
        resumeStatus: "playing",
        playerKey: state.playerKey + 1,
        playbackEnded: false,
        spokenUpTo: -1,
        caption: turn.opening,
        error: undefined,
      };
    }
    case "restore": {
      const restored = {
        ...initialState(state.muted),
        capabilities: state.capabilities,
        welcome: state.welcome,
        turns: action.turns,
        playerKey: state.playerKey,
      };
      const latest = action.turns.at(-1);
      return latest ? reducer(restored, { type: "select", id: latest.id }) : restored;
    }
    case "reset": return { ...initialState(state.muted), capabilities: state.capabilities, welcome: state.welcome };
  }
}

function actionEndpoint(endpoint: string | URL, action: string): string {
  const value = String(endpoint);
  return `${value}${value.includes("?") ? "&" : "?"}action=${encodeURIComponent(action)}`;
}

function defaultTurnId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function transcriptFor(turn: VideoChatTurn): string[] {
  return [
    ...(turn.opening ? [turn.opening] : []),
    ...(turn.video?.scenes.flatMap((entry) => entry.narration?.trim() ? [entry.narration.trim()] : []) ?? []),
  ];
}

function conversationFor(turns: readonly VideoChatTurn[]): VideoChatConversationTurn[] {
  return turns.filter((turn) => turn.completed && turn.video).slice(-12).map((turn) => ({
    prompt: turn.prompt,
    response: [...transcriptFor(turn).join(" ")].slice(0, 8_000).join(""),
  }));
}

async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

function errorFrom(cause: unknown): VideoError {
  if (cause instanceof VideoError) return cause;
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new VideoError("Video chat was cancelled", { code: "aborted", recoverable: false });
  }
  if (cause instanceof DOMException && cause.name === "TimeoutError") {
    return new VideoError("Video chat timed out", { code: "timeout", recoverable: false });
  }
  return new VideoError("Video chat could not produce a playable response", { code: "video_chat_failed", recoverable: false });
}

async function responseError(response: Response): Promise<VideoError> {
  return new VideoError(response.status === 429
    ? "The conversation limit has been reached. Please try again later."
    : "Video chat could not produce a playable response", {
    code: "http_error", status: response.status, recoverable: false,
  });
}

function pacedScene(
  scene: VideoScene,
  spokenSeconds: number | undefined,
  templates?: TemplateRegistry,
): VideoScene {
  const held = preparedSceneDuration(scene, spokenSeconds,
    templates?.getTemplateMetadata(scene.templateId) ?? getBuiltinTemplateMetadata(scene.templateId));
  const {
    startTime: _startTime,
    endTime: _endTime,
    beatStart: _beatStart,
    beatEnd: _beatEnd,
    ...timing
  } = scene.timing ?? {};
  return { ...scene, timing: { ...timing, fixedDuration: held } };
}

/** Own a complete video conversation while the application owns its UI. */
export function useVideoChat(options: UseVideoChatOptions = {}): UseVideoChatResult {
  return useVideoChatSession(options).chat;
}

/** Internal shell access to in-memory history; not exported by the SDK entry. */
export function useVideoChatSession(options: UseVideoChatOptions = {}): {
  chat: UseVideoChatResult;
  restoreSession(turns: readonly VideoChatTurn[]): void;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const voiceWarningRef = useRef<() => void>(() => undefined);
  const ownedVoiceRef = useRef<VideoChatVoice | undefined>(undefined);
  if (!options.voice && !ownedVoiceRef.current) {
    ownedVoiceRef.current = createVideoChatVoice({
      endpoint: options.endpoint,
      headers: options.headers,
      credentials: options.credentials,
      fetcher: options.fetcher,
      onFallback: () => voiceWarningRef.current(),
    });
  }
  const voice = options.voice ?? ownedVoiceRef.current!;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const unavailableVoiceLines = useRef(new Set<string>());
  const speechStartRef = useRef<(source?: "browser" | "generated") => void>(() => undefined);
  const narration = useNarration({ onSpeechStart: (source) => speechStartRef.current(source), voice: {
    supportsOffsets: voice.supportsOffsets,
    speak: (text, options) => unavailableVoiceLines.current.has(text) ? undefined : voice.speak(text, options),
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
      durationMs: Math.max(0, Math.round(now - started)), reason: "scene-generation" });
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

  const request = useCallback(async (
    action: string,
    init: Omit<RequestInit, "signal"> = {},
    signal?: AbortSignal,
  ): Promise<Response> => {
    const current = optionsRef.current;
    const headers = new Headers(current.headers);
    new Headers(init.headers).forEach((header, name) => headers.set(name, header));
    if (init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob)) {
      headers.set("content-type", "application/json");
    }
    return (current.fetcher ?? fetch)(actionEndpoint(current.endpoint ?? "/api/video-chat", action), {
      ...init,
      headers,
      credentials: current.credentials,
      signal,
    });
  }, []);

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
      .then((value) => { if (mountedRef.current) dispatch({ type: "welcome", value }); })
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
    const timeoutMs = currentOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      inFlightRef.current = undefined;
      throw new VideoError("timeoutMs must be positive", { code: "invalid_option" });
    }
    const timeout = setTimeout(() => controller.abort(new DOMException("Video chat timed out", "TimeoutError")), timeoutMs);
    const mode = "cinematic" as const;
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
      suggestions: [],
      ...(openingMedia ? { openingMedia } : {}),
    };
    firstFrameRef.current = { turnId: id, mode, startedAt: monotonicNow(), reported: false, speechReported: false, active: true };
    dispatch({ type: "start", turn });

    let timeline: ReturnType<typeof createSceneTimeline> | undefined;
    let style: VideoStyle | undefined;
    let openingActive = false;
    let openingRequested = false;
    let spokenHook = suppliedOpening;
    let planDone = false;
    let timelineCompleted = false;
    let terminal = false;
    let attempt = 0;
    let ready: Array<VideoScene | undefined> = [];
    let received: VideoScene[] = [];
    let appended = 0;

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
    voiceWarningRef.current = () => warn("Using browser voice for this response.");
    const flush = () => {
      if (!isCurrent()) return;
      let available = appended;
      while (ready[available]) {
        const group = ready[available]!.narrationGroup;
        if (!group) { available++; continue; }
        let end = available;
        while (ready[end]?.narrationGroup?.id === group.id) end++;
        const last = ready[end - 1]!.narrationGroup!;
        if (Math.abs(last.offsetSeconds + last.durationSeconds - group.totalSeconds) > 0.02) break;
        validateNarrationGroups(ready.slice(available, end) as VideoScene[]);
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
        if (!style || openingActive || heldRef.current || available === appended
          || !canStartPreparedSequence(ready.slice(0, available), planDone)) return;
        timeline = createSceneTimeline({ style, orientation });
        timelineRef.current = timeline;
        openingController.abort(new DOMException("Opening replaced by response", "AbortError"));
        if (openingRef.current === openingController) openingRef.current = undefined;
        dispatch({ type: "player", id, stream: timeline.stream });
      }
      while (appended < available) timeline.add(ready[appended++]!);
      dispatch({
        type: "partial",
        id,
        video: { schemaVersion: VIDEO_SCHEMA_VERSION, orientation, scenes: ready.slice(0, appended) as VideoScene[], style: style! },
      });
      if (planDone && !timelineCompleted) {
        timelineCompleted = true;
        timeline.complete();
        if (timelineRef.current === timeline) timelineRef.current = undefined;
      }
    };
    flushRef.current = flush;

    const resolveOpeningMedia = async (keyword: string, fallbackKeyword?: string) => {
      try {
        const response = await request("opening-media", {
          method: "POST",
          body: JSON.stringify({ keyword, ...(fallbackKeyword ? { fallbackKeyword } : {}), orientation }),
        }, openingController.signal);
        if (!response.ok || !isOpeningCurrent() || timeline) return;
        const payload = await response.json() as { media?: unknown };
        const media = sanitizeVideoChatMedia(payload.media);
        if (media && isOpeningCurrent() && !timeline) dispatch({ type: "opening-media", id, media });
      } catch {
        // Stock footage is an enhancement; the black ground remains usable.
      }
    };

    const prepareSpeech = async (text: string, signal: AbortSignal) => {
      try {
        return currentOptions.voice
          ? await withDeadline((child) => voiceRef.current.prepare(text, { signal: child }), 3_000, signal)
          : await voiceRef.current.prepare(text, { signal });
      } catch (cause) {
        if (currentOptions.voice && !signal.aborted && isCurrent()) unavailableVoiceLines.current.add(text);
        throw cause;
      }
    };

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

    if (spokenHook) {
      openingRequested = true;
      openingActive = true;
      void speakOpening(spokenHook);
    }

    const runAttempt = async (currentAttempt: number): Promise<{ video: Video; lines: string[] }> => {
      const response = await request("response", {
        method: "POST",
        headers: { accept: "text/event-stream" },
        body: JSON.stringify({
          prompt,
          ...(spokenHook ? { opening: spokenHook } : {}),
          mode,
          orientation,
          conversation,
          ...(currentOptions.style ? { style: currentOptions.style } : {}),
        }),
      }, controller.signal);
      if (!response.ok) throw await responseError(response);
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        throw new VideoError("Video chat endpoint did not return a video stream", { code: "invalid_response" });
      }

      const planned: VideoScene[] = [];
      const lines: string[] = spokenHook ? [spokenHook] : [];
      const pending: Promise<void>[] = [];
      let narrating: Promise<unknown> = Promise.resolve();
      let terminalError: VideoError | undefined;

      try {
        for await (const event of decodeVideoSse(response.body)) {
          if (!isCurrent() || currentAttempt !== attempt) return { video: { schemaVersion: VIDEO_SCHEMA_VERSION, orientation, scenes: [], style: style! }, lines: [] };
          if (event.type === "response.start") style = event.data.style;
          if (event.type === "response.warning" || (event.type === "response.error" && !event.data.terminal)) {
            warn(event.type === "response.warning" && event.data.warning.message === MEDIA_RECOVERY_NOTICE
              ? MEDIA_RECOVERY_NOTICE
              : "Some parts were simplified so the response could continue.");
          }
          if (event.type === "data.video-chat-opening") {
            const payload = event.data && typeof event.data === "object" && !Array.isArray(event.data)
              ? event.data as { line?: unknown; keyword?: unknown; fallbackKeyword?: unknown }
              : {};
            const line = typeof payload.line === "string" ? payload.line.trim().slice(0, 300) : "";
            const keyword = typeof payload.keyword === "string" ? payload.keyword.trim().slice(0, 80) : "";
            const fallbackKeyword = typeof payload.fallbackKeyword === "string" ? payload.fallbackKeyword.trim().slice(0, 80) : undefined;
            if (!openingMedia && keyword) void resolveOpeningMedia(keyword, fallbackKeyword);
            if (!openingRequested && line) {
              spokenHook = line;
              lines.push(line);
              openingRequested = true;
              openingActive = true;
              void speakOpening(line);
            }
            continue;
          }
          if (event.type === "response.error" && event.data.terminal) {
            terminalError = new VideoError("Video chat could not finish this response", {
              code: event.data.error.code,
              requestId: event.data.snapshot ? undefined : id,
              recoverable: event.data.error.recoverable,
            });
          }
          if (event.type === "response.abort") {
            terminalError = new VideoError("Video chat was interrupted", { code: "aborted", recoverable: false });
          }
          if (event.type !== "scene.add") continue;
          const position = event.data.position;
          const plannedScene = event.data.scene;
          planned[position] = plannedScene;
          received[position] = plannedScene;
          const rendererReady = currentOptions.templates?.getTemplate(plannedScene.templateId)
            ? Promise.resolve() : Promise.resolve(preloadBuiltinTemplate(plannedScene.templateId));
          const visualPreparation = Promise.all([rendererReady, prepareSceneMedia(plannedScene.variables, controller.signal)])
            .then(() => undefined, () => { throw new VideoError("Scene could not prepare its visual", { code: "media_not_ready" }); });
          // Attach a handler immediately while speech preparation runs in parallel.
          void visualPreparation.catch(() => undefined);
          warmSceneMedia(plannedScene.variables);

          const narrated = narrating.then(async () => {
            const supplied = plannedScene.narration?.trim();
            if (supplied) return supplied;
            return withDeadline(async (signal) => {
              const narrationResponse = await request("narration", {
                method: "POST",
                body: JSON.stringify({ prompt, scene: plannedScene, earlier: [...lines] }),
              }, signal);
              if (!narrationResponse.ok) throw new Error("Narration unavailable");
              const payload = await narrationResponse.json() as { line?: unknown };
              const line = typeof payload.line === "string" ? payload.line.trim() : "";
              if (!line) throw new Error("Narration unavailable");
              return line;
            }, 3_000, controller.signal);
          }).catch((cause: unknown) => {
            if (controller.signal.aborted) throw cause;
            warn("Some narration was simplified so the response could continue.");
            return Object.values(plannedScene.variables).filter((value): value is string => typeof value === "string" && !/^https?:/i.test(value)).join(" ").slice(0, 500);
          }).then((line) => {
            if (line) lines.push(line);
            return line;
          });
          narrating = narrated.catch(() => "");
          pending.push(narrated.then(async (line) => {
            if (!isCurrent() || currentAttempt !== attempt) return;
            const visual = plannedScene;
            const withNarration = line ? { ...visual, narration: line } : visual;
            const spoken = line
              ? await prepareSpeech(plannedScene.narrationGroup?.text ?? line, controller.signal).catch((cause: unknown) => {
                if (controller.signal.aborted) throw cause;
                warn("Some narration is unavailable; the response will continue.");
                return undefined;
              })
              : undefined;
            if (!isCurrent() || currentAttempt !== attempt) return;
            await visualPreparation;
            const group = plannedScene.narrationGroup;
            if (group && (spoken?.supportsOffsets !== true || voiceRef.current.supportsOffsets !== true || Math.abs(spoken.seconds - group.totalSeconds) > 0.1)) throw new VideoError("Narration group requires matching measured audio with offset support", { code: "narration_group_invalid" });
            ready[position] = group ? withNarration : pacedScene(withNarration, spoken?.seconds, currentOptions.templates);
            flush();
          }).catch((cause: unknown) => {
            if (!isCurrent() || currentAttempt !== attempt) return;
            if (cause instanceof VideoError && ["media_not_ready", "narration_group_invalid"].includes(cause.code)) { terminalError = cause; return; }
            ready[position] = { ...received[position]!, timing: { fixedDuration: 5 } };
            warn("Some parts were simplified so the response could continue.");
            flush();
          }));
        }
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        terminalError = errorFrom(cause);
      }
      await Promise.all(pending);
      if (terminalError && ["media_not_ready", "narration_group_invalid"].includes(terminalError.code)) throw terminalError;
      validateNarrationGroups(ready.filter((scene): scene is VideoScene => Boolean(scene)));
      if (terminalError && ready.some(Boolean) && style) {
        warn("The response was interrupted; completed scenes are still available.");
      } else if (terminalError) throw terminalError;
      if (planned.length === 0 || ready.filter(Boolean).length === 0 || !style) {
        throw new VideoError("The video response contained no playable scenes", { code: "empty_response" });
      }

      return {
        video: {
          schemaVersion: VIDEO_SCHEMA_VERSION,
          orientation,
          scenes: ready.filter((entry): entry is VideoScene => entry != null),
          style,
        },
        lines,
      };
    };

    try {
      let response: { video: Video; lines: string[] };
      try {
        response = await untilAborted(runAttempt(attempt), controller.signal);
      } catch (cause) {
        if (controller.signal.aborted || timeline || spokenHook
            || (cause instanceof VideoError && ["media_not_ready", "narration_group_invalid"].includes(cause.code)) || received.some((scene) => scene?.narrationGroup)) throw cause;
        attempt += 1;
        ready = [];
        received = [];
        appended = 0;
        style = undefined;
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
      const recovered = received.some((scene) => scene?.narrationGroup) || (cause instanceof VideoError && ["media_not_ready", "narration_group_invalid"].includes(cause.code)) ? [] : received.flatMap((scene, index) => scene
        ? [ready[index] ?? { ...scene, timing: { fixedDuration: 5 } }]
        : []);
      if (recovered.length > 0) {
        style ??= { density: "normal", motion: "normal", defaultBackgroundEffect: "static", defaultTextArchetype: "subtle", defaultTransition: "crossfade" };
        openingController.abort(new DOMException("Continuing completed response", "AbortError"));
        if (!timeline) {
          timeline = createSceneTimeline({ style, orientation });
          dispatch({ type: "player", id, stream: timeline.stream });
        }
        for (const scene of recovered.slice(appended)) timeline.add(scene);
        timeline.complete();
        if (timelineRef.current === timeline) timelineRef.current = undefined;
        const video: Video = { schemaVersion: VIDEO_SCHEMA_VERSION, orientation, style, scenes: recovered };
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

  const currentTurn = state.turns.at(-1);
  const shownTurn = state.turns.find((turn) => turn.id === state.shownTurnId) ?? currentTurn;
  const availableModes = state.capabilities?.modes ?? (["cinematic"] as const);
  const suggestions = shownTurn?.suggestions ?? [];
  const fullTranscript = shownTurn ? transcriptFor(shownTurn) : [];
  const transcript = shownTurn && shownTurn === currentTurn && state.playback?.kind !== "video"
    ? fullTranscript.slice(0, (shownTurn.opening ? 1 : 0) + state.spokenUpTo + 1)
    : fullTranscript;
  const playbackKey = state.playerKey;
  const playerProps = state.playback ? {
    ...(options.templates ? { templates: options.templates } : {}),
    ...(state.playback.kind === "stream"
      ? { stream: state.playback.stream! }
      : { video: state.playback.video! }),
    autoPlay: true,
    paused: state.status === "paused",
    controls: false,
    narrationReady: narration.isReady,
    narrationTime: narration.getTime,
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
    onStallChange: (stalled: boolean) => {
      if (stateRef.current.playerKey !== playbackKey) return;
      if (stalled) voiceRef.current.pause();
      else if (!heldRef.current) voiceRef.current.resume();
      if (state.playback?.kind !== "stream") return;
      const timing = firstFrameRef.current;
      if (!timing?.active || !timing.reported) return;
      if (!stalled) finishStall();
      else if (!heldRef.current && timing.stallStartedAt == null) timing.stallStartedAt = monotonicNow();
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
    playbackEnded: state.playbackEnded,
    playerKey: state.playerKey,
    playerProps,
  };
  return { chat, restoreSession };
}
