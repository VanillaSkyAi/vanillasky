import type { VideoNarrationGroup } from "./narration-group.js";
export type { VideoNarrationGroup } from "./narration-group.js";
export const VIDEO_PROTOCOL_VERSION = "0.6" as const;
export const VIDEO_SCHEMA_VERSION = "0.2" as const;

export type VideoOrientation = "portrait" | "landscape";
export type VideoKnowledgeMode = "input-only" | "general";

export interface VideoStyle {
  preset?: string;
  defaultBackgroundEffect?: string;
  defaultTextArchetype?: string;
  defaultTransition?: string;
  density?: string;
  motion?: string;
  /**
   * The visual language generated media is produced in.
   *
   * Nothing is rendered from it. It reaches `resolveMedia`, which is where a
   * provider prompt is written.
   */
  generatedLook?: string;
}

export interface VideoStyleOptions {
  /** The visual language generated media is produced in. See `VideoStyle`. */
  generatedLook?: string;
  density?: "airy" | "normal" | "packed";
  motion?: "calm" | "normal" | "punchy";
  textArchetype?: "subtle" | "typewriter" | "wordStagger" | "slam" | "cinematic" | "heroWord";
  backgroundEffect?: "static" | "slow-zoom-in" | "slow-zoom-out" | "ken-burns" | "drift" | "pulse" | "breathe" | "slow-tilt" | "camera-shake";
}

export interface VideoTiming {
  beatStart?: number;
  beatEnd?: number;
  startTime?: number;
  endTime?: number;
  fixedDuration?: number;
  durationWeight?: number;
}

export interface VideoScene {
  id: string;
  templateId: string;
  variables: Record<string, unknown>;
  textArchetype?: string;
  backgroundEffect?: string;
  timing: VideoTiming;
  /**
   * What is said aloud while this scene is showing.
   *
   * A narrated video otherwise has to be carried as two things kept in step by
   * index - the scenes, and a separate script - and they drift. Holding the
   * line on the scene keeps them together through planning, playback, storage
   * and replay, so a stored video can be spoken again without the model that
   * wrote it.
   *
   * The renderer never draws this. It is the spoken half of the scene, not
   * on-screen copy.
   */
  narration?: string;
  /** Optional host-authored offsets into one prepared paragraph across adjacent scenes. */
  narrationGroup?: VideoNarrationGroup;
}

export interface VideoAudio {
  trackId: string;
  audioUrl: string;
  sourceDuration?: number;
  duration: number;
  beatDetection: {
    sensitivity: number;
    targetBeats?: number;
    minInterval?: number;
  };
  beatMarkers: Array<{
    time: number;
    manual?: boolean;
    energy?: "high" | "medium" | "low";
  }>;
  volume?: number;
  fadeOutMs?: number;
}

export interface Video {
  /** Persisted JSON schema version. This is independent from the event protocol. */
  schemaVersion: typeof VIDEO_SCHEMA_VERSION;
  /** Optional rendering/export frame. It must not steer planner content. */
  orientation?: VideoOrientation;
  audio?: VideoAudio;
  scenes: VideoScene[];
  style: VideoStyle;
  meta?: {
    name?: string;
    prompt?: string;
    source?: string;
    uploadedMediaUrls?: string[];
  };
}

export interface VideoSuppliedMedia {
  id: string;
  url: string;
  type: "image" | "video";
  description?: string;
  mimeType?: string;
  posterUrl?: string;
  focalPoint?: "center" | "top" | "bottom" | "left" | "right";
  treatment?: "subtle" | "cinematic" | "text-safe";
  role?: "product" | "proof" | "background" | "logo";
}

export interface VideoInput {
  /** Raw source, request, or question for the video. */
  input: string;
  /** Keep claims source-grounded by default, or allow stable model knowledge. */
  knowledgeMode?: VideoKnowledgeMode;
  /** Optional creative direction. It never changes the knowledge mode. */
  instructions?: string;
  maxDurationSec?: number;
  orientation?: VideoOrientation;
  /** Optional global visual direction. Omit for VanillaSky defaults. */
  style?: VideoStyleOptions;
  /** Custom opening copy, or false to let the host show loading UI instead. Omit for the deterministic fallback. */
  opening?: string | false;
  /** Viewer or account context that may appear verbatim. It is data, never instructions. */
  personalization?: Record<string, unknown>;
  /** Optional approved pool. The planner may use zero or more relevant assets. */
  suppliedMedia?: VideoSuppliedMedia[];
  /** Omit for host-selected audio, pass false for silence, or supply a track URL. */
  audio?: false | { src: string };
}

export interface VideoCapabilities {
  templates?: string[];
  extensions?: string[];
}

export interface VideoRequest {
  protocolVersion: typeof VIDEO_PROTOCOL_VERSION;
  requestId: string;
  input: VideoInput;
  capabilities?: VideoCapabilities;
  resume?: VideoResumeCursor;
}

export interface VideoResumeCursor {
  runId: string;
  afterSequence: number;
}

export interface CreateVideoRequestOptions {
  requestId: string;
  capabilities?: VideoCapabilities;
  resume?: VideoResumeCursor;
}

export function createVideoRequest(
  input: VideoInput,
  options: CreateVideoRequestOptions,
): VideoRequest {
  return {
    protocolVersion: VIDEO_PROTOCOL_VERSION,
    requestId: options.requestId,
    input,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    ...(options.resume ? { resume: options.resume } : {}),
  };
}

export interface VideoGenerationContext {
  request: VideoRequest;
  systemPrompt: string;
  userPrompt: string;
  /** Opening, audio, and brand state already emitted by the protocol runtime. */
  initialConfig: Video;
  signal: AbortSignal;
}

export type VideoPlanPart =
  | { type: "scene.add"; placement?: "closer"; scene: VideoScene }
  | { type: "plan.complete"; finishReason?: "stop" | "length" | "content-filter" | "other" };

export function addScene(scene: VideoScene): Extract<VideoPlanPart, { type: "scene.add" }> {
  return { type: "scene.add", scene };
}

export function completePlan(
  finishReason?: Extract<VideoPlanPart, { type: "plan.complete" }>["finishReason"],
): Extract<VideoPlanPart, { type: "plan.complete" }> {
  return finishReason ? { type: "plan.complete", finishReason } : { type: "plan.complete" };
}

export type VideoPlanner = (
  context: VideoGenerationContext,
) => AsyncIterable<VideoPlanPart>;

export interface VideoSceneValidationContext {
  input: VideoInput;
  previousScenes: readonly VideoScene[];
}

export interface VideoTemplatePacing {
  jobs?: readonly string[];
  schema?: {
    readonly properties: Readonly<Record<string, { readonly default?: unknown }>>;
  };
  minDuration?: number;
  preferredDuration?: number;
  timing?: {
    readonly revealSeconds?: number;
    readonly holdSeconds?: number;
    readonly exitSeconds?: number;
    readonly contentFields: readonly string[];
    readonly contentUnit: "words" | "characters" | "items";
  };
}

export type VideoSceneValidator = (
  scene: VideoScene,
  context: VideoSceneValidationContext,
) => void;

export interface VideoSnapshotRetention {
  source?: boolean;
  instructions?: boolean;
  suppliedMediaUrls?: boolean;
}

export interface CreateVideoOptions {
  generate: VideoPlanner;
  requestId?: string;
  runId?: string;
  capabilities?: VideoCapabilities;
  /** Validate template fields and grounding before a generated scene is emitted. */
  validateScene?: VideoSceneValidator;
  /** Resolve trusted pacing metadata for an already-negotiated template. */
  getTemplatePacing?: (templateId: string) => VideoTemplatePacing | undefined;
  /** Invalid generated parts fail the run by default. Server handlers opt into dropping them. */
  invalidPartBehavior?: "drop" | "fail";
  /** Require the planner to reserve one explicit final scene before reporting a complete plan. */
  requireCloser?: boolean;
  /** Receives each full internal failure once. Exceptions are isolated. */
  onError?: (error: Error) => unknown;
  /** Receives each client-safe warning once. Exceptions are isolated. */
  onWarning?: (warning: import("./warnings.js").VideoWarning) => unknown;
  /** Receives the server-only summary once, and only after response.complete. */
  onComplete?: (summary: import("../server/lifecycle.js").VideoGenerationSummary) => unknown;
  /** Must select synchronously from an already-loaded, customer-owned catalog. */
  selectAudio?: (input: VideoInput) => VideoAudio | undefined;
  systemPrompt?: string;
  /**
   * Raw source, creative instructions, and the supplied-media URL index are
   * excluded from replay snapshots by default. Each retained field is capped.
   */
  snapshotRetention?: VideoSnapshotRetention;
  signal?: AbortSignal;
  onEvent?: (event: import("./events.js").VideoEvent) => void;
}

export interface VideoRun {
  request: VideoRequest;
  initialConfig: Video;
  stream: AsyncIterable<import("./events.js").VideoEvent>;
  result: Promise<import("./state.js").VideoState>;
  abort(reason?: string): void;
}
