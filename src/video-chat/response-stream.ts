import {
  VIDEO_SCHEMA_VERSION,
  type Video,
  type VideoAudio,
  type VideoOrientation,
  type VideoScene,
  type VideoStyle,
  type VideoStyleOptions,
} from "../protocol/types.js";
import { decodeVideoSse } from "../protocol/sse.js";
import { validateNarrationGroups } from "../protocol/narration-group.js";
import { VideoError } from "../player/video-error.js";
import { MEDIA_RECOVERY_NOTICE } from "./recovery.js";
import { withDeadline } from "./deadline.js";
import type { createScenePreparation } from "./scene-preparation.js";
import type { VideoChatVoice } from "./voice.js";
import type { VideoChatConversationTurn, VideoChatMode } from "./types.js";
import type { MusicPreference } from "../music-catalog.js";

function actionEndpoint(endpoint: string | URL, action: string): string {
  const value = String(endpoint);
  return `${value}${value.includes("?") ? "&" : "?"}action=${encodeURIComponent(action)}`;
}

type VideoChatRequest = (action: string, init?: Omit<RequestInit, "signal">, signal?: AbortSignal) => Promise<Response>;

export async function requestVideoChat(
  current: {
    endpoint?: string | URL;
    headers?: HeadersInit;
    credentials?: RequestCredentials;
    fetcher?: typeof fetch;
  },
  action: string,
  init: Omit<RequestInit, "signal"> = {},
  signal?: AbortSignal,
): Promise<Response> {
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
}

export async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

export function errorFrom(cause: unknown): VideoError {
  if (cause instanceof VideoError) return cause;
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new VideoError("Video chat was cancelled", { code: "aborted", recoverable: false });
  }
  if (cause instanceof DOMException && cause.name === "TimeoutError") {
    return new VideoError("Video chat timed out", { code: "timeout", recoverable: false });
  }
  return new VideoError("Video chat could not produce a playable response", { code: "video_chat_failed", recoverable: false });
}

export async function responseError(response: Response): Promise<VideoError> {
  return new VideoError(response.status === 429
    ? "Too many requests right now. Please try again shortly."
    : "Video chat could not produce a playable response", {
    code: "http_error", status: response.status, recoverable: false,
  });
}

/** Shared with the timeline handoff so partial scenes remain recoverable. */
export interface ResponseStreamState {
  style?: VideoStyle;
  audio?: VideoAudio;
  ready: Array<VideoScene | undefined>;
  received: VideoScene[];
  spokenHook: string;
  openingRequested: boolean;
}

interface ResponseStreamOptions {
  request: VideoChatRequest;
  body: {
    prompt: string;
    opening?: string;
    mode: VideoChatMode;
    orientation: VideoOrientation;
    conversation: VideoChatConversationTurn[];
    style?: VideoStyleOptions;
    musicMood?: MusicPreference;
    initialTrackId?: string;
    previousTrackId?: string;
  };
  id: string;
  orientation: VideoOrientation;
  signal: AbortSignal;
  state: ResponseStreamState;
  preparation: ReturnType<typeof createScenePreparation>;
  voice(): VideoChatVoice;
  isCurrent(): boolean;
  warn(message: string): void;
  flush(): void;
  onMode(mode: VideoChatMode): void;
  onOpening(line: string): void;
}

/** Decode one response attempt while speech and footage prepare concurrently. */
export async function consumeVideoChatResponse(options: ResponseStreamOptions): Promise<{ video: Video; lines: string[] }> {
  const { request, signal, state, preparation, voice, warn, flush, isCurrent, id, orientation } = options;
  const { prepareSpeech } = preparation;
  const response = await request("response", {
    method: "POST",
    headers: { accept: "text/event-stream" },
    body: JSON.stringify(options.body),
  }, signal);
  if (!response.ok) throw await responseError(response);
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new VideoError("Video chat endpoint did not return a video stream", { code: "invalid_response" });
  }

  const resolvedMode = response.headers.get("x-vanillasky-resolved-video-mode");
  if (isCurrent() && (resolvedMode === "pexels" || resolvedMode === "cinematic")) options.onMode(resolvedMode);

  const planned: VideoScene[] = [];
  const lines: string[] = state.spokenHook ? [state.spokenHook] : [];
  const pending: Promise<void>[] = [];
  let narrating: Promise<unknown> = Promise.resolve();
  let terminalError: VideoError | undefined;

  try {
    for await (const event of decodeVideoSse(response.body)) {
      if (!isCurrent()) return { video: { schemaVersion: VIDEO_SCHEMA_VERSION, orientation, scenes: [], style: state.style! }, lines: [] };
      if (event.type === "response.start") state.style = event.data.style;
      if (event.type === "audio.set") state.audio = event.data.audio;
      if (event.type === "response.warning" || (event.type === "response.error" && !event.data.terminal)) {
        warn(event.type === "response.warning" && event.data.warning.message === MEDIA_RECOVERY_NOTICE
          ? MEDIA_RECOVERY_NOTICE
          : "Some parts were simplified so the response could continue.");
      }
      if (event.type === "data.video-chat-preparation") {
        preparation.announce(event.data);
        continue;
      }
      if (event.type === "data.video-chat-opening") {
        const payload = event.data && typeof event.data === "object" && !Array.isArray(event.data)
          ? event.data as { line?: unknown; keyword?: unknown; fallbackKeyword?: unknown }
          : {};
        const line = typeof payload.line === "string" ? payload.line.trim().slice(0, 300) : "";
        if (!state.openingRequested && line) {
          state.spokenHook = line;
          lines.push(line);
          state.openingRequested = true;
          options.onOpening(line);
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
      state.received[position] = plannedScene;
      const visualPreparation = preparation.prepareVisual(plannedScene);

      const narrated = narrating.then(async () => {
        const supplied = plannedScene.narration?.trim();
        if (supplied) return supplied;
        return withDeadline(async (signal) => {
          const narrationResponse = await request("narration", {
            method: "POST",
            body: JSON.stringify({ prompt: options.body.prompt, scene: plannedScene, earlier: [...lines] }),
          }, signal);
          if (!narrationResponse.ok) throw new Error("Narration unavailable");
          const payload = await narrationResponse.json() as { line?: unknown };
          const line = typeof payload.line === "string" ? payload.line.trim() : "";
          if (!line) throw new Error("Narration unavailable");
          return line;
        }, 3_000, signal);
      }).catch((cause: unknown) => {
        if (signal.aborted) throw cause;
        warn("Some narration was simplified so the response could continue.");
        return Object.values(plannedScene.variables).filter((value): value is string => typeof value === "string" && !/^https?:/i.test(value)).join(" ").slice(0, 500);
      }).then((line) => {
        if (line) lines.push(line);
        return line;
      });
      narrating = narrated.catch(() => "");
      pending.push(narrated.then(async (line) => {
        if (!isCurrent()) return;
        const spoken = line
          ? await prepareSpeech(plannedScene.narrationGroup?.text ?? line, signal).catch((cause: unknown) => {
            if (signal.aborted) throw cause;
            warn("Some narration is unavailable; the response will continue.");
            return undefined;
          })
          : undefined;
        if (!isCurrent()) return;
        const visual = await visualPreparation;
        const withNarration = line ? { ...visual, narration: line } : visual;
        const group = plannedScene.narrationGroup;
        if (group && (spoken?.supportsOffsets !== true || voice().supportsOffsets !== true || Math.abs(spoken.seconds - group.totalSeconds) > 0.1)) throw new VideoError("Narration group requires matching measured audio with offset support", { code: "narration_group_invalid" });
        state.ready[position] = group ? withNarration : preparation.pace(withNarration, spoken?.seconds, spoken?.supportsOffsets === true);
        flush();
      }).catch((cause: unknown) => {
        if (!isCurrent()) return;
        if (cause instanceof VideoError && ["media_not_ready", "narration_group_invalid"].includes(cause.code)) { terminalError = cause; return; }
        state.ready[position] = { ...state.received[position]!, timing: { fixedDuration: 5 } };
        warn("Some parts were simplified so the response could continue.");
        flush();
      }));
    }
  } catch (cause) {
    if (signal.aborted) throw cause;
    terminalError = errorFrom(cause);
  }
  await Promise.all(pending);
  if (terminalError && ["media_not_ready", "narration_group_invalid"].includes(terminalError.code)) throw terminalError;
  validateNarrationGroups(state.ready.filter((scene): scene is VideoScene => Boolean(scene)));
  if (terminalError && state.ready.some(Boolean) && state.style) {
    warn("The response was interrupted; completed scenes are still available.");
  } else if (terminalError) throw terminalError;
  if (planned.length === 0 || state.ready.filter(Boolean).length === 0 || !state.style) {
    throw new VideoError("The video response contained no playable scenes", { code: "empty_response" });
  }

  return {
    video: {
      schemaVersion: VIDEO_SCHEMA_VERSION,
      orientation,
      scenes: state.ready.filter((entry): entry is VideoScene => entry != null),
      style: state.style,
      ...(state.audio ? { audio: state.audio } : {}),
    },
    lines,
  };
}
