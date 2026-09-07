import { MEDIA_RECOVERY_NOTICE } from "../video-chat/recovery";
import {
  VIDEO_PROTOCOL_VERSION,
  type VideoOrientation,
  type VideoScene,
  type VideoStyleOptions,
} from "../protocol/types.js";
import {
  createVideoHandler,
  type VideoHandlerOptions,
} from "./create-video-handler.js";
import type { ResolvedMedia } from "./media-resolver.js";
import { getGenerationLifecycleSink, type VideoGenerationLifecycleSink } from "./lifecycle.js";
import { withDeadline } from "../video-chat/deadline.js";
import { sanitizeVideoChatMedia } from "../video-chat/media.js";
import { createVideoStreamHandler } from "./video-stream-handler.js";
import { createChatShotPlanner } from "./chat-shot-planner.js";
import {
  createNarrationUserPrompt,
  createVideoChatResponseInstructions,
  VIDEO_CHAT_NARRATION_PROMPT,
  VIDEO_CHAT_SUGGESTIONS_PROMPT,
} from "./video-chat-prompts.js";
import { decodeVideoSse, encodeVideoSseEvent } from "../protocol/sse.js";
import type { VideoEvent } from "../protocol/events.js";
import type {
  VideoChatCapabilities,
  VideoChatConversationTurn,
  VideoChatMode,
  VideoChatWelcomeOptions,
  VideoChatWelcomePrompt,
} from "../video-chat/types.js";

export type {
  VideoChatCapabilities,
  VideoChatConversationTurn,
  VideoChatMode,
  VideoChatWelcomeOptions,
  VideoChatWelcomePrompt,
} from "../video-chat/types.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
// Timelapse of Clouds by Dmitry Marchenkov, Pexels 11335959.
// https://www.pexels.com/video/timelapse-of-clouds-11335959/
const DEFAULT_WELCOME_HERO = {
  url: "https://videos.pexels.com/video-files/11335959/11335959-hd_1920_1080_30fps.mp4",
  type: "video" as const,
  posterUrl: "https://images.pexels.com/videos/11335959/pexels-photo-11335959.jpeg?auto=compress&fit=crop&w=1920",
};
const DEFAULT_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARACTERS = 8_000;
const MAX_CONVERSATION_TURNS = 12;
const MAX_CONVERSATION_RESPONSE_CHARACTERS = 8_000;

export type VideoChatTextTask =
  | "narration"
  | "suggestions";

export interface VideoChatTextContext {
  task: VideoChatTextTask;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export type VideoChatTextGenerator = (
  context: VideoChatTextContext,
) => string | Promise<string>;

export interface VideoChatSpeechContext {
  text: string;
  signal: AbortSignal;
}

export interface VideoChatSpeechResult {
  audio: Uint8Array | ArrayBuffer;
  mediaType?: string;
}

export type VideoChatSpeechGenerator = (
  context: VideoChatSpeechContext,
) => VideoChatSpeechResult | Promise<VideoChatSpeechResult>;

export interface VideoChatTranscriptionContext {
  audio: Uint8Array;
  mediaType: string;
  signal: AbortSignal;
}

export type VideoChatTranscriber = (
  context: VideoChatTranscriptionContext,
) => string | Promise<string>;

export interface VideoChatMediaContext {
  purpose: "response" | "welcome" | "suggestion";
  orientation: VideoOrientation;
  generatedLook?: string;
  signal: AbortSignal;
  requestId?: string;
  scene?: Readonly<VideoScene>;
  templateId?: string;
  preferredType?: "image" | "video" | "any";
  /** Optional broader subject for atmospheric opening stock, not instructional footage. */
  fallbackQuery?: string;
}

export type VideoChatMediaResolver = (
  query: string,
  context: VideoChatMediaContext,
) => ResolvedMedia | null | Promise<ResolvedMedia | null>;

export interface VideoChatHandlerOptions extends Pick<
  VideoHandlerOptions,
  | "templates" | "streamText" | "includeRawProviderData" | "mediaConcurrency"
  | "allowedOrigins" | "authorize" | "maxBodyBytes" | "heartbeatMs"
  | "onError" | "onWarning" | "onComplete" | "invalidPartBehavior"
  | "requireCloser" | "allowCredentials"
> {
  /** Generate the small non-streaming text tasks around the visual plan. */
  generateText: VideoChatTextGenerator;
  /** Optional generated speech. Browsers can speak locally when absent. */
  generateSpeech?: VideoChatSpeechGenerator;
  /** Optional server transcription used when browser recognition is unavailable. */
  transcribe?: VideoChatTranscriber;
  /** Optional stock or application-owned media search. */
  searchMedia?: VideoChatMediaResolver;
  /** Optional generated-video provider. Its presence enables paid visual modes. */
  generateVideo?: VideoChatMediaResolver;
  /** Maximum generated-video attempts per response, including failures. Defaults to 5. */
  maxGeneratedVideos?: number;
  /** Generated media deadline in milliseconds, 1–120000. Defaults to 15000. Host providers must honor cancellation. */
  generateVideoTimeoutMs?: number;
  /** Provider-supported clip duration in seconds, 2–20. Defaults to 5; does not change provider billing configuration. */
  generatedClipDurationSec?: number;
  /** Safe host-only phase timings; never includes prompts, narration, media URLs or provider error text. */
  onDiagnostic?: (event: {
    requestId: string;
    mode: VideoChatMode;
    phase: "request-accepted" | "opening-authored" | "shot-authored" | "media-start" | "media-end" | "media-skipped";
    elapsedMs: number;
    sceneId?: string;
    durationMs?: number;
    reason?: "ready" | "empty" | "provider-error" | "timeout" | "cancelled" | "allowance" | "deadline" | "not-configured";
  }) => unknown;
  /** Trusted application guidance appended to the general-purpose response brief. */
  instructions?: string;
  /** Application-owned prompts and visual searches shown before the first turn. */
  welcome?: VideoChatWelcomeOptions;
  /** Maximum accepted transcription body. Defaults to 8 MiB. */
  maxAudioBytes?: number;
}

export type VideoChatHandler = (request: Request) => Promise<Response>;

interface ParsedResponseRequest {
  prompt: string;
  opening?: string;
  mode: VideoChatMode;
  orientation: VideoOrientation;
  conversation: VideoChatConversationTurn[];
  style?: VideoStyleOptions;
}

interface SuggestionSubject {
  prompt: string;
  keyword: string;
}

interface OpeningSubject {
  line: string;
  keyword: string;
  fallbackKeyword?: string;
}

const VIDEO_CHAT_OPENING_EVENT_TYPE = "data.video-chat-opening" as const;

const DEFAULT_WELCOME_PROMPTS: readonly VideoChatWelcomePrompt[] = [
  {
    prompt: "Why does the Moon always show one face?",
    opening: "The Moon turns, perfectly matching its orbit.",
    mediaQuery: "full moon night sky",
  },
  {
    prompt: "Tell me a tiny story about a robot growing a garden on Mars",
    opening: "One patient robot is about to make Mars bloom.",
    mediaQuery: "robot garden mars",
  },
  {
    prompt: "Recommend a perfect rainy afternoon in Amsterdam",
    opening: "Rain makes Amsterdam's best afternoons feel even warmer.",
    mediaQuery: "Amsterdam rain cafe",
  },
  {
    prompt: "Pitch a playful ad for a coffee mug that never spills",
    opening: "This mug makes gravity look completely optional.",
    mediaQuery: "coffee mug desk",
  },
];

function jsonError(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

function allowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const permitted = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !permitted.has(key));
  if (unexpected) throw new Error(`${label}.${unexpected} is not supported`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum = MAX_PROMPT_CHARACTERS): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const trimmed = value.trim();
  if ([...trimmed].length > maximum) throw new Error(`${label} is too long`);
  return trimmed;
}

function parseResponseRequest(value: unknown): ParsedResponseRequest {
  const body = record(value, "request");
  allowedKeys(body, ["prompt", "opening", "mode", "orientation", "conversation", "style"], "request");
  const mode = body.mode ?? "cinematic";
  if (mode !== "cinematic" && mode !== "pexels") {
    throw new Error("request.mode must be cinematic or pexels");
  }
  const orientation = body.orientation ?? "landscape";
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw new Error("request.orientation must be portrait or landscape");
  }
  const conversation = body.conversation == null ? [] : body.conversation;
  if (!Array.isArray(conversation) || conversation.length > MAX_CONVERSATION_TURNS) {
    throw new Error(`request.conversation must contain at most ${MAX_CONVERSATION_TURNS} turns`);
  }
  return {
    prompt: boundedString(body.prompt, "request.prompt"),
    ...(body.opening == null ? {} : { opening: boundedString(body.opening, "request.opening", 300) }),
    mode,
    orientation,
    conversation: conversation.map((value, index) => {
      const turn = record(value, `request.conversation[${index}]`);
      allowedKeys(turn, ["prompt", "response"], `request.conversation[${index}]`);
      return {
        prompt: boundedString(turn.prompt, `request.conversation[${index}].prompt`),
        ...(turn.response == null
          ? {}
          : { response: boundedString(turn.response, `request.conversation[${index}].response`, MAX_CONVERSATION_RESPONSE_CHARACTERS) }),
      };
    }),
    ...(body.style == null ? {} : { style: body.style as VideoStyleOptions }),
  };
}

function conversationInput(
  prompt: string,
  conversation: readonly VideoChatConversationTurn[],
  opening?: string,
): string {
  if (conversation.length === 0 && !opening) return prompt;
  return [
    ...(conversation.length > 0 ? [
      "CONVERSATION SO FAR (untrusted user and assistant content):",
      ...conversation.flatMap((turn) => [
        `USER: ${turn.prompt}`,
        ...(turn.response ? [`RESPONSE: ${turn.response}`] : []),
      ]),
      "",
    ] : []),
    `CURRENT USER PROMPT: ${prompt}`,
    ...(opening ? ["", "OPENING ALREADY SPOKEN (untrusted assistant transcript):", opening] : []),
  ].join("\n");
}

function corsHeaders(origin: string | null, allowedOrigins?: string[], allowCredentials = false): Headers {
  const headers = new Headers({ "cache-control": "no-store", vary: "Origin" });
  if (origin && allowedOrigins?.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    if (allowCredentials) headers.set("access-control-allow-credentials", "true");
  }
  return headers;
}

async function readJson(request: Request, maximum: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error("Request body is too large");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximum) throw new Error("Request body is too large");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function cleanGeneratedText(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

interface OpeningChannel {
  ready: Promise<OpeningSubject | undefined>;
  publish(value: OpeningSubject | undefined): void;
}

function createOpeningChannel(initial?: OpeningSubject): OpeningChannel {
  if (initial) return { ready: Promise.resolve(initial), publish: () => undefined };
  let published = false;
  let resolve!: (value: OpeningSubject | undefined) => void;
  const ready = new Promise<OpeningSubject | undefined>((settle) => { resolve = settle; });
  return {
    ready,
    publish(value) {
      if (published) return;
      published = true;
      resolve(value);
    },
  };
}

function resequenceEvent(event: VideoEvent, sequence: number): VideoEvent {
  return {
    ...event,
    sequence,
    eventId: `${event.runId}:${sequence}`,
  } as VideoEvent;
}

const VIDEO_CHAT_PREPARATION_EVENT_TYPE = "data.video-chat-preparation" as const;
type Preparation = { sceneId: string; narration: string };
interface PreparationChannel {
  queue: Preparation[];
  changed: Promise<void>;
  publish: (value: Preparation) => void;
}
function createPreparationChannel(): PreparationChannel {
  let wake!: () => void;
  const channel: PreparationChannel = {
    queue: [], changed: new Promise<void>(resolve => { wake = resolve; }),
    publish(value) {
      channel.queue.push(value);
      wake();
      channel.changed = new Promise<void>(resolve => { wake = resolve; });
    },
  };
  return channel;
}

function streamVideoChatOpening(
  response: Response,
  openingReady: Promise<OpeningSubject | undefined>,
  preparations: PreparationChannel,
  cancel: () => void,
): Response {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
  const events = decodeVideoSse(response.body)[Symbol.asyncIterator]();
  const encoded = (async function* () {
    try {
      const first = await events.next();
      if (first.done) return;
      let sequence = 0;
      const started = first.value.type === "response.start"
        ? {
            ...first.value,
            data: {
              ...first.value.data,
              capabilities: {
                ...first.value.data.capabilities,
                extensions: Array.from(new Set([
                  ...(first.value.data.capabilities?.extensions ?? []),
                  VIDEO_CHAT_OPENING_EVENT_TYPE,
                  VIDEO_CHAT_PREPARATION_EVENT_TYPE,
                ])),
              },
            },
          } as VideoEvent
        : first.value;
      yield encodeVideoSseEvent(resequenceEvent(started, sequence++));

      const nextEvent = events.next();
      const opening = await openingReady;
      if (opening?.line) {
        yield encodeVideoSseEvent({
          protocolVersion: first.value.protocolVersion,
          runId: first.value.runId,
          sequence,
          eventId: `${first.value.runId}:${sequence}`,
          type: VIDEO_CHAT_OPENING_EVENT_TYPE,
          data: {
            line: opening.line,
            ...(opening.keyword ? { keyword: opening.keyword } : {}),
            ...(opening.fallbackKeyword ? { fallbackKeyword: opening.fallbackKeyword } : {}),
          },
        });
        sequence += 1;
      }

      let pending = nextEvent;
      while (true) {
        while (preparations.queue.length) {
          const data = preparations.queue.shift()!;
          yield encodeVideoSseEvent({ protocolVersion: first.value.protocolVersion,
            runId: first.value.runId, sequence, eventId: `${first.value.runId}:${sequence}`,
            type: VIDEO_CHAT_PREPARATION_EVENT_TYPE, data });
          sequence += 1;
        }
        const next = await Promise.race([
          pending.then(value => ({ value })),
          preparations.changed.then(() => undefined),
        ]);
        if (!next || preparations.queue.length) continue;
        if (next.value.done) break;
        yield encodeVideoSseEvent(resequenceEvent(next.value.value, sequence++));
        pending = events.next();
      }
    } finally {
      await events.return?.(undefined);
    }
  })();
  const encoder = new TextEncoder();
  const iterator = encoded[Symbol.asyncIterator]();
  let completed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          if (!completed) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          completed = true;
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (cause) {
        completed = true;
        controller.error(cause);
      }
    },
    async cancel() {
      cancel();
      completed = true;
      await iterator.return?.();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function readSuggestionSubjects(text: string): SuggestionSubject[] {
  const opening = text.indexOf("{");
  const closing = text.lastIndexOf("}");
  if (opening < 0 || closing <= opening) return [];
  const parsed = JSON.parse(text.slice(opening, closing + 1)) as { suggestions?: unknown };
  return (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as { prompt?: unknown; keyword?: unknown };
      const prompt = typeof item.prompt === "string" ? item.prompt.trim().replace(/\s+/gu, " ") : "";
      const keyword = typeof item.keyword === "string" ? item.keyword.trim() : "";
      // Keep whole questions: omit oversized suggestions rather than clipping meaning.
      if (!prompt || Array.from(prompt).length > 60 || prompt.split(" ").length > 8) return [];
      return [{ prompt, keyword: keyword.slice(0, 80) }];
    })
    .slice(0, 4);
}

function audioBody(value: Uint8Array | ArrayBuffer): ArrayBuffer {
  const source = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Uint8Array.from(source).buffer;
}

class VideoChatProviderError extends Error {
  constructor(readonly task: VideoChatTextTask) {
    super(`Video chat ${task} provider failed`);
  }
}

/**
 * Create the complete provider-neutral server endpoint for a video chat.
 *
 * Mount the returned handler once and select operations with the `action`
 * query parameter. Provider libraries and credentials stay in the application
 * closures passed here; only bounded prompts, media, and capability booleans
 * cross the browser boundary.
 */
export function createVideoChatHandler(options: VideoChatHandlerOptions): VideoChatHandler {
  if (!options || typeof options.streamText !== "function" || typeof options.generateText !== "function") {
    throw new Error("createVideoChatHandler requires streamText and generateText");
  }
  if (options.authorize !== "none" && typeof options.authorize !== "function") {
    throw new Error('createVideoChatHandler requires authorize or authorize: "none"');
  }
  const reportError = (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    try { void Promise.resolve(options.onError?.(error)).catch(() => undefined); } catch {
      // Private diagnostics must never alter the public response.
    }
  };
  const {
    authorize,
    generateText,
    generateSpeech,
    transcribe,
    searchMedia,
    generateVideo,
    instructions,
    welcome: welcomeOptions,
    maxAudioBytes = DEFAULT_MAX_AUDIO_BYTES,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    allowedOrigins,
    allowCredentials,
    mediaConcurrency = 5,
    maxGeneratedVideos = 5,
    generateVideoTimeoutMs = 15_000,
    generatedClipDurationSec = 5,
  } = options;
  // Forward only the chat contract, including for untyped JavaScript callers.
  const videoOptions = {
    templates: options.templates,
    streamText: options.streamText,
    includeRawProviderData: options.includeRawProviderData,
    heartbeatMs: options.heartbeatMs,
    onError: options.onError,
    onWarning: options.onWarning,
    onComplete: options.onComplete,
    invalidPartBehavior: options.invalidPartBehavior,
    requireCloser: options.requireCloser,
  };
  if (!Number.isFinite(maxAudioBytes) || maxAudioBytes <= 0) throw new Error("maxAudioBytes must be positive");
  if (!Number.isFinite(maxBodyBytes) || maxBodyBytes <= 0) throw new Error("maxBodyBytes must be positive");

  if (!Number.isSafeInteger(generateVideoTimeoutMs) || generateVideoTimeoutMs < 1 || generateVideoTimeoutMs > 120_000) throw new Error("generateVideoTimeoutMs must be an integer from 1 to 120000");
  if (!Number.isFinite(generatedClipDurationSec) || generatedClipDurationSec < 2 || generatedClipDurationSec > 20) throw new Error("generatedClipDurationSec must be from 2 to 20");
  if (!Number.isSafeInteger(maxGeneratedVideos) || maxGeneratedVideos < 0) throw new Error("maxGeneratedVideos must be a nonnegative safe integer");

  const capabilities: VideoChatCapabilities = {
    templates: true,
    generatedSpeech: generateSpeech != null,
    generatedVideo: generateVideo != null,
    stockMedia: searchMedia != null,
    transcription: transcribe != null,
    modes: searchMedia ? ["cinematic", "pexels"] : ["cinematic"],
  };
  const welcomePrompts = (welcomeOptions?.prompts ?? DEFAULT_WELCOME_PROMPTS).slice(0, 4);
  const heroQuery = welcomeOptions?.heroQuery;
  let welcomeResponse: Record<string, unknown> | undefined;
  let requestSequence = 0;

  const responseHandler = (
    requestId: string,
    openingProvided: boolean,
    openingChannel: OpeningChannel,
    openingLine: string | undefined,
    mode: VideoChatMode,
    preparations: PreparationChannel,
  ) => {
    const startedAt = Date.now();
    type Diagnostic = Parameters<NonNullable<VideoChatHandlerOptions["onDiagnostic"]>>[0];
    const diagnose = (event: Omit<Diagnostic, "requestId" | "mode" | "elapsedMs">) => {
      try { void Promise.resolve(options.onDiagnostic?.({ requestId, mode, elapsedMs: Math.max(0, Date.now() - startedAt), ...event })).catch(() => undefined); }
      catch { /* Diagnostics cannot change response delivery. */ }
    };
    diagnose({ phase: "request-accepted" });
    const generatedVideoAvailable = mode === "cinematic" && generateVideo != null && maxGeneratedVideos > 0;
    let lifecycle: VideoGenerationLifecycleSink | undefined;
    let generatedAttempts = 0;
    // The first media request starts the response visual clock. Later queued
    // shots get their narrative offset, rather than a fresh full startup wait.
    let mediaStartedAt: number | undefined;
    let mediaIndex = 0;
    const resolveSelected: VideoHandlerOptions["resolveMedia"] = generateVideo || searchMedia
      ? async (query, context) => {
          mediaStartedAt ??= Date.now();
          const remainingMs = mediaStartedAt + generateVideoTimeoutMs + mediaIndex++ * generatedClipDurationSec * 1_000 - Date.now();
          // A delayed authored shot cannot meet a deadline that already passed.
          // Settle its chapter without starting billable work or using allowance.
          if (remainingMs <= 0) { diagnose({ phase: "media-skipped", sceneId: context.scene.id, reason: "deadline" }); return null; }
          if (mode === "cinematic" && (!generateVideo || generatedAttempts >= maxGeneratedVideos)) {
            diagnose({ phase: "media-skipped", sceneId: context.scene.id, reason: !generateVideo ? "not-configured" : "allowance" });
            return null;
          }
          if (mode === "pexels" && !searchMedia) {
            diagnose({ phase: "media-skipped", sceneId: context.scene.id, reason: "not-configured" });
            return null;
          }
          const mediaContext: VideoChatMediaContext = {
            purpose: "response",
            orientation: context.input.orientation ?? "landscape",
            generatedLook: context.generatedLook,
            signal: context.signal,
            requestId: context.requestId,
            scene: context.scene,
            templateId: context.templateId,
            preferredType: context.preferredType,
          };
          const attempt = async (resolver: VideoChatMediaResolver | undefined, timeoutMs: number) => {
            context.signal.throwIfAborted();
            if (!resolver) return null;
            const mediaStart = Date.now();
            diagnose({ phase: "media-start", sceneId: context.scene.id });
            try {
              const result = sanitizeVideoChatMedia(await withDeadline(
                (signal) => resolver(query, { ...mediaContext, signal }), timeoutMs, context.signal,
              ));
              context.signal.throwIfAborted();
              diagnose({ phase: "media-end", sceneId: context.scene.id, durationMs: Math.max(0, Date.now() - mediaStart),
                reason: result && (result.type === "video" || (options.templates && resolver === searchMedia)) ? "ready" : "empty" });
              return result;
            } catch (cause) {
              diagnose({ phase: "media-end", sceneId: context.scene.id, durationMs: Math.max(0, Date.now() - mediaStart),
                reason: context.signal.aborted ? "cancelled" : cause instanceof DOMException && cause.name === "TimeoutError" ? "timeout" : "provider-error" });
              // A provider deadline is local to this shot. Only cancellation of
              // the response itself stops the remaining scenes and providers.
              context.signal.throwIfAborted();
              reportError(cause);
              return null;
            }
          };
          if (generatedVideoAvailable && (!options.templates || context.scene.variables.mediaSource === "generate")) {
            const generated = generatedAttempts < maxGeneratedVideos
              ? (generatedAttempts++, await attempt(generateVideo, remainingMs))
              : null;
            if (generated?.type === "video") return generated;
            lifecycle?.reportWarning?.({
              code: "provider_warning",
              category: "provider",
              message: MEDIA_RECOVERY_NOTICE,
              recoverable: true,
            });
          }
          if (mode !== "pexels") return null;
          const stock = await attempt(searchMedia, Math.min(3_000, remainingMs));
          if (stock && (options.templates || stock.type === "video")) return stock;
          return null;
        }
      : undefined;
    if (options.templates) {
      openingChannel.publish(undefined);
      return createVideoHandler({
        ...videoOptions,
        authorize: "none", allowedOrigins, allowCredentials, maxBodyBytes,
        mediaConcurrency, resolveMedia: resolveSelected, narrate: true,
        basePrompt: instructions,
      });
    }
    const handler = createVideoStreamHandler({
      heartbeatMs: videoOptions.heartbeatMs,
      onError: videoOptions.onError,
      onWarning: videoOptions.onWarning,
      onComplete: videoOptions.onComplete,
      invalidPartBehavior: videoOptions.invalidPartBehavior,
      requireCloser: options.requireCloser ?? true,
      generate: createChatShotPlanner({
        mode,
        streamText: (context) => {
          lifecycle = getGenerationLifecycleSink(context);
          return videoOptions.streamText(context);
        },
        includeRawProviderData: videoOptions.includeRawProviderData,
        openingLine,
        publishOpening: opening => {
          if (opening) diagnose({ phase: "opening-authored" });
          openingChannel.publish(opening);
        },
        prepareScene: scene => {
          diagnose({ phase: "shot-authored", sceneId: scene.sceneId });
          if (!resolveSelected) diagnose({ phase: "media-skipped", sceneId: scene.sceneId, reason: "not-configured" });
          preparations.publish(scene);
        },
        generatedClipDurationSec,
        resolveMedia: resolveSelected,
        mediaConcurrency,
      }),
      authorize: "none", allowedOrigins, allowCredentials, maxBodyBytes,
      systemPrompt: [createVideoChatResponseInstructions(generatedVideoAvailable, openingProvided, maxGeneratedVideos, generatedClipDurationSec, mode), instructions?.trim()]
        .filter(Boolean).join("\n\nAPPLICATION GUIDANCE\n"),
    });
    return handler;
  };

  const callText = async (
    task: VideoChatTextTask,
    systemPrompt: string,
    userPrompt: string,
    maxOutputTokens: number,
    signal: AbortSignal,
  ) => {
    try {
      return cleanGeneratedText(await generateText({ task, systemPrompt, userPrompt, maxOutputTokens, signal }));
    } catch (cause) {
      reportError(cause);
      throw new VideoChatProviderError(task);
    }
  };

  return async function handleVideoChat(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const origin = request.headers.get("origin");
    const headers = corsHeaders(origin, allowedOrigins, allowCredentials);

    if (request.method === "OPTIONS") {
      if (origin && allowedOrigins && !allowedOrigins.includes(origin)) {
        return jsonError(403, "origin_forbidden", "Origin is not allowed", headers);
      }
      headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
      headers.set("access-control-allow-headers", "Authorization, Content-Type");
      return new Response(null, { status: 204, headers });
    }
    if (origin && allowedOrigins && !allowedOrigins.includes(origin)) {
      return jsonError(403, "origin_forbidden", "Origin is not allowed", headers);
    }
    if (authorize !== "none") {
      let authorized = false;
      try { authorized = await authorize(request); } catch (cause) {
        reportError(cause);
        authorized = false;
      }
      if (!authorized) return jsonError(401, "unauthorized", "Authentication required", headers);
    }

    if (action === "capabilities") {
      if (request.method !== "GET") return jsonError(405, "method_not_allowed", "Use GET", headers);
      return Response.json(capabilities, { headers });
    }
    if (action === "welcome") {
      if (request.method !== "GET") return jsonError(405, "method_not_allowed", "Use GET", headers);
      if (welcomeResponse) return Response.json(welcomeResponse, { headers });
      const resolvedWelcome = await (async () => {
        let failed = false;
        const mediaResolver = searchMedia;
        const resolve = async (query: string | undefined) => {
          if (!mediaResolver || !query) return null;
          try {
            const raw = await withDeadline((signal) => mediaResolver(query, {
              purpose: "welcome",
              orientation: "landscape",
              signal,
            }), 3_000, request.signal);
            const media = sanitizeVideoChatMedia(raw);
            if (request.signal.aborted || (raw != null && !media)) failed = true;
            return media;
          } catch (cause) {
            failed = true;
            if (!request.signal.aborted) reportError(cause);
            return null;
          }
        };
        const [hero, ...cards] = await Promise.all([
          heroQuery === undefined ? DEFAULT_WELCOME_HERO : resolve(heroQuery),
          ...welcomePrompts.map((entry) => resolve(entry.mediaQuery)),
        ]);
        return {
          cacheable: !failed,
          body: {
            hero,
            cards: welcomePrompts.map((entry, index) => ({
              prompt: entry.prompt,
              ...(entry.opening ? { opening: entry.opening } : {}),
              media: cards[index] ?? null,
            })),
          },
        };
      })();
      if (!request.signal.aborted && resolvedWelcome.cacheable) welcomeResponse = resolvedWelcome.body;
      return Response.json(resolvedWelcome.body, { headers });
    }
    if (request.method !== "POST") return jsonError(405, "method_not_allowed", "Use POST", headers);

    if (action === "transcription") {
      if (!transcribe) return jsonError(404, "capability_unavailable", "Transcription is not configured", headers);
      const declared = Number(request.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxAudioBytes) {
        return jsonError(413, "body_too_large", "The recording is too large", headers);
      }
      const audio = new Uint8Array(await request.arrayBuffer());
      if (audio.byteLength === 0) return jsonError(400, "empty_audio", "No audio was provided", headers);
      if (audio.byteLength > maxAudioBytes) return jsonError(413, "body_too_large", "The recording is too large", headers);
      try {
        const text = await transcribe({
          audio,
          mediaType: request.headers.get("content-type") || "audio/webm",
          signal: request.signal,
        });
        return Response.json({ text: text.trim() }, { headers });
      } catch (cause) {
        reportError(cause);
        return jsonError(502, "transcription_failed", "The recording could not be transcribed", headers);
      }
    }

    let body: unknown;
    try {
      body = await readJson(request, maxBodyBytes);
    } catch (cause) {
      return jsonError(
        cause instanceof Error && cause.message.includes("too large") ? 413 : 400,
        "invalid_body",
        cause instanceof Error ? cause.message : "Request body is invalid",
        headers,
      );
    }

    if (action === "response") {
      let input: ParsedResponseRequest;
      try { input = parseResponseRequest(body); } catch (cause) {
        return jsonError(400, "invalid_request", cause instanceof Error ? cause.message : "Request is invalid", headers);
      }
      const requestId = `video-chat-${Date.now()}-${requestSequence += 1}`;
      const openingChannel = createOpeningChannel(input.opening
        ? { line: input.opening, keyword: "" }
        : undefined);
      const preparations = createPreparationChannel();
      const cancellation = new AbortController();
      const forwardedHeaders = new Headers(request.headers);
      forwardedHeaders.delete("content-length");
      const videoRequest = new Request(request.url, {
        method: "POST",
        headers: forwardedHeaders,
        signal: AbortSignal.any([request.signal, cancellation.signal]),
        body: JSON.stringify({
          protocolVersion: VIDEO_PROTOCOL_VERSION,
          requestId,
          input: {
            input: conversationInput(input.prompt, input.conversation, input.opening),
            knowledgeMode: "general",
            opening: false,
            orientation: input.orientation,
            maxDurationSec: 40,
            style: {
              density: "airy",
              motion: "calm",
              textArchetype: "cinematic",
              ...input.style,
            },
          },
        }),
      });
      const response = await responseHandler(
        requestId,
        input.opening != null,
        openingChannel,
        input.opening,
        input.mode,
        preparations,
      )(videoRequest);
      return streamVideoChatOpening(response, openingChannel.ready, preparations, () => cancellation.abort());
    }

    try {
      if (action === "opening-media") {
        const value = record(body, "request");
        allowedKeys(value, ["keyword", "fallbackKeyword", "orientation"], "request");
        const keyword = boundedString(value.keyword, "request.keyword", 80);
        const fallbackQuery = value.fallbackKeyword == null ? undefined : boundedString(value.fallbackKeyword, "request.fallbackKeyword", 80);
        const orientation = value.orientation ?? "landscape";
        if (orientation !== "portrait" && orientation !== "landscape") {
          throw new Error("request.orientation must be portrait or landscape");
        }
        if (!searchMedia) return Response.json({ media: null }, { headers });
        try {
          const raw = await withDeadline((signal) => searchMedia(keyword, {
            purpose: "response",
            ...(fallbackQuery ? { fallbackQuery } : {}),
            orientation,
            signal,
          }), 3_000, request.signal);
          return Response.json({ media: sanitizeVideoChatMedia(raw) }, { headers });
        } catch (cause) {
          if (!request.signal.aborted) reportError(cause);
          return Response.json({ media: null }, { headers });
        }
      }
      if (action === "narration") {
        const value = record(body, "request");
        allowedKeys(value, ["prompt", "scene", "earlier"], "request");
        const prompt = boundedString(value.prompt, "request.prompt");
        const scene = record(value.scene, "request.scene") as unknown as VideoScene;
        if (typeof scene.templateId !== "string" || !scene.variables || typeof scene.variables !== "object") {
          throw new Error("request.scene is invalid");
        }
        const earlier = Array.isArray(value.earlier)
          ? value.earlier.slice(-4).map((line, index) => boundedString(line, `request.earlier[${index}]`, 2_000))
          : [];
        const line = await callText(
          "narration",
          VIDEO_CHAT_NARRATION_PROMPT,
          createNarrationUserPrompt(prompt, scene, earlier),
          256,
          request.signal,
        );
        return Response.json({ line }, { headers });
      }
      if (action === "suggestions") {
        const value = record(body, "request");
        allowedKeys(value, ["prompt", "lines"], "request");
        const prompt = boundedString(value.prompt, "request.prompt");
        const lines = Array.isArray(value.lines)
          ? value.lines.slice(-8).map((line, index) => boundedString(line, `request.lines[${index}]`, 2_000))
          : [];
        try {
          const text = await withDeadline((signal) => callText(
            "suggestions",
            VIDEO_CHAT_SUGGESTIONS_PROMPT,
            `USER PROMPT: ${prompt}\n\nVIDEO RESPONSE:\n${lines.join("\n")}`,
            512,
            signal,
          ), 3_000, request.signal);
          const subjects = readSuggestionSubjects(text);
          const mediaResolver = searchMedia;
          const media = await Promise.all(subjects.map(async (subject) => {
            if (!mediaResolver || !subject.keyword) return null;
            try {
              const raw = await withDeadline((signal) => mediaResolver(subject.keyword, {
                purpose: "suggestion",
                orientation: "landscape",
                signal,
              }), 3_000, request.signal);
              return sanitizeVideoChatMedia(raw);
            } catch (cause) {
              if (!request.signal.aborted) reportError(cause);
              return null;
            }
          }));
          return Response.json({
            suggestions: subjects.map((subject, index) => ({
              prompt: subject.prompt,
              media: media[index] ?? null,
            })),
          }, { headers });
        } catch (cause) {
          if (!(cause instanceof VideoChatProviderError)) reportError(cause);
          return Response.json({ suggestions: [] }, { headers });
        }
      }
      if (action === "speech") {
        if (!generateSpeech) return new Response(null, { status: 204, headers });
        const value = record(body, "request");
        allowedKeys(value, ["text"], "request");
        const text = boundedString(value.text, "request.text", 4_000);
        try {
          const result = await withDeadline((signal) => generateSpeech({ text, signal }), 3_000, request.signal);
          return new Response(audioBody(result.audio), {
            headers: {
              ...Object.fromEntries(headers),
              "content-type": result.mediaType || "audio/mpeg",
              "cache-control": "no-store",
            },
          });
        } catch (cause) {
          reportError(cause);
          return jsonError(502, "speech_failed", "Speech could not be generated", headers);
        }
      }
    } catch (cause) {
      if (cause instanceof VideoChatProviderError) {
        return jsonError(502, "text_generation_failed", "Text could not be generated", headers);
      }
      return jsonError(400, "invalid_request", cause instanceof Error ? cause.message : "Request is invalid", headers);
    }

    return jsonError(404, "unknown_action", "Video chat action was not found", headers);
  };
}
