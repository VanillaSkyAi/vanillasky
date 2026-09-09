import {
  VIDEO_PROTOCOL_VERSION,
  type VideoAudio,
  type VideoCapabilities,
  type Video,
  type VideoOrientation,
  type VideoScene,
  type VideoStyle,
} from "./types.js";
import type { VideoWarning } from "./warnings.js";

export type VideoFinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "error"
  | "other";

interface VideoEventDataMap {
  "response.start": {
    requestId: string;
    format: { orientation: VideoOrientation };
    style: VideoStyle;
    meta?: Video["meta"];
    capabilities?: VideoCapabilities;
  };
  "audio.set": { audio: VideoAudio };
  "scene.add": { scene: VideoScene; position: number };
  "response.warning": { warning: VideoWarning };
  "response.complete": {
    finishReason: VideoFinishReason;
    snapshot: Video;
    checksum: string;
  };
  "response.error": {
    error: { code: string; message: string; recoverable: boolean };
    terminal: boolean;
    snapshot?: Video;
  };
  "response.abort": {
    reason: string;
    snapshot?: Video;
  };
}

export type VideoCoreEventType = keyof VideoEventDataMap;
type VideoExtensionEventType = `data.${string}`;

interface VideoEventEnvelope<TType extends string, TData> {
  protocolVersion: typeof VIDEO_PROTOCOL_VERSION;
  runId: string;
  sequence: number;
  eventId: string;
  type: TType;
  data: TData;
}

type VideoCoreEvent = {
  [TType in VideoCoreEventType]: VideoEventEnvelope<
    TType,
    VideoEventDataMap[TType]
  >;
}[VideoCoreEventType];

type VideoExtensionEvent<TData = unknown> = VideoEventEnvelope<
  VideoExtensionEventType,
  TData
>;

export type VideoEvent = VideoCoreEvent | VideoExtensionEvent;

export interface VideoEventFactory {
  create<TType extends VideoCoreEventType>(
    type: TType,
    data: VideoEventDataMap[TType],
  ): VideoEventEnvelope<TType, VideoEventDataMap[TType]>;
  create<TData>(
    type: VideoExtensionEventType,
    data: TData,
  ): VideoExtensionEvent<TData>;
}

export function createVideoEventFactory(options: {
  runId: string;
  initialSequence?: number;
}): VideoEventFactory {
  let sequence = options.initialSequence ?? 0;
  return {
    create(type: string, data: unknown) {
      const currentSequence = sequence;
      sequence += 1;
      return {
        protocolVersion: VIDEO_PROTOCOL_VERSION,
        runId: options.runId,
        sequence: currentSequence,
        eventId: `${options.runId}:${currentSequence}`,
        type,
        data,
      };
    },
  } as VideoEventFactory;
}
