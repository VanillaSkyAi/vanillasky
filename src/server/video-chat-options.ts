import type { VideoOrientation, VideoScene } from "../protocol/types.js";
import type { SpeechWordTiming } from "../protocol/speech-timing.js";
import type { VideoChatConversationTurn, VideoChatMode, VideoChatWelcomeOptions } from "../video-chat/types.js";
import type { VideoStreamHandlerOptions } from "./video-stream-handler.js";
import type { ResolvedMedia } from "./media-resolver.js";
import type { ChatPlannerText } from "./chat-shot-planner.js";

export type VideoChatTextTask =
  | "narration"
  | "narration-rewrite"
  | "suggestions";

interface VideoChatTextContext {
  task: VideoChatTextTask;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
}

type VideoChatTextGenerator = (
  context: VideoChatTextContext,
) => string | Promise<string>;

interface VideoChatSpeechContext {
  text: string;
  signal: AbortSignal;
}

interface VideoChatSpeechResult {
  audio: Uint8Array | ArrayBuffer;
  mediaType?: string;
  /** Actual word boundaries measured against this audio, in seconds. */
  wordTimings?: SpeechWordTiming[];
}

type VideoChatSpeechGenerator = (
  context: VideoChatSpeechContext,
) => VideoChatSpeechResult | Promise<VideoChatSpeechResult>;

interface VideoChatTranscriptionContext {
  audio: Uint8Array;
  mediaType: string;
  signal: AbortSignal;
}

type VideoChatTranscriber = (
  context: VideoChatTranscriptionContext,
) => string | Promise<string>;

interface VideoChatMediaContext {
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

type VideoChatMediaResolver = (
  query: string,
  context: VideoChatMediaContext,
) => ResolvedMedia | null | Promise<ResolvedMedia | null>;

export interface VideoChatVideoContext extends VideoChatMediaContext {
  purpose: "response";
  requestedDurationSec: number;
  shotDirection: string;
  /** Absolute epoch-millisecond deadline; never automatically resubmit a paid job. */
  deadlineAt: number;
}
export type VideoChatVideoGenerator = (
  query: string,
  context: VideoChatVideoContext,
) => ResolvedMedia | null | Promise<ResolvedMedia | null>;

export interface VideoChatHandlerOptions extends Pick<
  VideoStreamHandlerOptions,
  | "allowedOrigins" | "authorize" | "maxBodyBytes" | "heartbeatMs"
  | "onError" | "onWarning" | "onComplete" | "invalidPartBehavior"
  | "requireCloser" | "allowCredentials"
> {
  /** Use an existing assistant's completed answer as the sole factual source for the video. */
  resolveAnswer?: (context: {
    prompt: string;
    conversation: readonly VideoChatConversationTurn[];
    signal: AbortSignal;
  }) => string | Promise<string>;
  /** Application-owned text stream; accepts a native async iterable or an AI SDK-shaped result. */
  streamText: ChatPlannerText;
  /** Opt in to bounded provider metadata in the server-only completion callback. */
  includeRawProviderData?: boolean;
  /** Concurrent media jobs, bounded to 1–5. Results play in narrative order. */
  mediaConcurrency?: number;
  /** Generate the small non-streaming text tasks around the visual plan. */
  generateText: VideoChatTextGenerator;
  /** Optional generated speech. Browsers can speak locally when absent. */
  generateSpeech?: VideoChatSpeechGenerator;
  /** Optional server transcription used when browser recognition is unavailable. */
  transcribe?: VideoChatTranscriber;
  /** Optional stock or application-owned media search. */
  searchMedia?: VideoChatMediaResolver;
  /** Optional generated-video provider. Its presence enables paid visual modes. */
  generateVideo?: VideoChatVideoGenerator;
  /** Maximum generated-video attempts per response, including failures. Defaults to 5. */
  maxGeneratedVideos?: number;
  /** Generated media deadline in milliseconds, 1–600000. Defaults to 15000. Host providers must honor cancellation. */
  generateVideoTimeoutMs?: number;
  /** Provider-supported clip duration in seconds, 2–20. Defaults to 5; does not change provider billing configuration. */
  generatedClipDurationSec?: number;
  /** Safe host-only phase timings; never includes prompts, narration, media URLs or provider error text. */
  onDiagnostic?: (event: {
    requestId: string;
    mode: VideoChatMode;
    phase: "request-accepted" | "opening-authored" | "shot-authored" | "media-start" | "media-end" | "media-skipped" | "narration-fit" | "narration-rewrite";
    elapsedMs: number;
    sceneId?: string;
    durationMs?: number;
    estimatedSpeechSec?: number;
    clipDurationSec?: number;
    reason?: "ready" | "empty" | "provider-error" | "timeout" | "cancelled" | "allowance" | "deadline" | "not-configured" | "fit" | "rewritten" | "oversized";
  }) => unknown;
  /** Trusted application guidance appended to the general-purpose response brief. */
  instructions?: string;
  /** Application-owned prompts and visual searches shown before the first turn. */
  welcome?: VideoChatWelcomeOptions;
  /** Maximum accepted transcription body. Defaults to 8 MiB. */
  maxAudioBytes?: number;
}

export type VideoChatHandler = (request: Request) => Promise<Response>;
