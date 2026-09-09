import type { VideoEvent, VideoFinishReason } from "./events.js";
import { VIDEO_SCHEMA_VERSION, type VideoCapabilities, type Video } from "./types.js";
import { checksumVideo } from "./checksum.js";
import { stableJson } from "./stable-json.js";
import { parseVideoEvent } from "./validation.js";
import type { VideoWarning } from "./warnings.js";

type VideoStatus = "idle" | "streaming" | "complete" | "error" | "aborted";

export interface VideoState {
  status: VideoStatus;
  runId?: string;
  requestId?: string;
  capabilities?: VideoCapabilities;
  lastSequence: number;
  lastEventId?: string;
  config?: Video;
  appliedEvents: Record<string, string>;
  extensions: VideoEvent[];
  finishReason?: VideoFinishReason;
  checksum?: string;
  errors: Array<{ code: string; message: string; recoverable: boolean }>;
  warnings: VideoWarning[];
  abortReason?: string;
}

export function createVideoState(): VideoState {
  return {
    status: "idle",
    lastSequence: -1,
    appliedEvents: {},
    extensions: [],
    errors: [],
    warnings: [],
  };
}

export function applyVideoEvent(
  state: VideoState,
  untrustedEvent: unknown,
): VideoState {
  const event = parseVideoEvent(untrustedEvent);
  const signature = stableJson(event);
  const priorSignature = state.appliedEvents[event.eventId];
  if (priorSignature) {
    if (priorSignature !== signature) throw new Error(`Event ${event.eventId} has a conflicting replay`);
    return state;
  }
  if (event.sequence !== state.lastSequence + 1) {
    throw new Error(`Video response expected sequence ${state.lastSequence + 1}, received ${event.sequence}`);
  }
  if (state.runId && event.runId !== state.runId) {
    throw new Error(`Video response run changed from ${state.runId} to ${event.runId}`);
  }
  if (["complete", "error", "aborted"].includes(state.status)) {
    throw new Error(`Cannot apply ${event.type} after ${state.status}`);
  }

  const base: VideoState = {
    ...state,
    runId: event.runId,
    lastSequence: event.sequence,
    lastEventId: event.eventId,
    appliedEvents: { ...state.appliedEvents, [event.eventId]: signature },
  };

  if (event.type === "response.start") {
    if (state.status !== "idle" || event.sequence !== 0) {
      throw new Error("response.start must be the first event");
    }
    return {
      ...base,
      status: "streaming",
      requestId: event.data.requestId,
      capabilities: event.data.capabilities,
      config: {
        schemaVersion: VIDEO_SCHEMA_VERSION,
        orientation: event.data.format.orientation,
        scenes: [],
        style: event.data.style,
        ...(event.data.meta ? { meta: event.data.meta } : {}),
      },
    };
  }

  if (state.status === "idle" || !state.config) throw new Error("response.start is required first");

  if (event.type === "audio.set") {
    if (state.config.scenes.length > 0) throw new Error("audio.set must arrive before the first scene");
    if (state.config.audio) throw new Error("audio.set can only be applied once");
    return { ...base, config: { ...state.config, audio: event.data.audio } };
  }

  if (event.type === "scene.add") {
    if (state.capabilities?.templates != null &&
      !state.capabilities.templates.includes(event.data.scene.templateId)) {
      throw new Error(`Scene template ${event.data.scene.templateId} was not negotiated`);
    }
    if (event.data.position !== state.config.scenes.length) {
      throw new Error(`scene.add position must be ${state.config.scenes.length}`);
    }
    if (state.config.scenes.some(({ id }) => id === event.data.scene.id)) {
      throw new Error(`Scene ${event.data.scene.id} already exists`);
    }
    return {
      ...base,
      config: { ...state.config, scenes: [...state.config.scenes, event.data.scene] },
    };
  }

  if (event.type === "response.complete") {
    const expectedChecksum = checksumVideo(event.data.snapshot);
    if (event.data.checksum !== expectedChecksum) {
      throw new Error(`response.complete checksum mismatch: expected ${expectedChecksum}`);
    }
    if (stableJson(event.data.snapshot) !== stableJson(state.config)) {
      throw new Error("response.complete snapshot does not match the reduced event stream");
    }
    return {
      ...base,
      status: "complete",
      config: event.data.snapshot,
      finishReason: event.data.finishReason,
      checksum: event.data.checksum,
    };
  }

  if (event.type === "response.error") {
    if (event.data.snapshot && stableJson(event.data.snapshot) !== stableJson(state.config)) {
      throw new Error("response.error snapshot does not match the reduced event stream");
    }
    return {
      ...base,
      status: event.data.terminal ? "error" : "streaming",
      ...(event.data.snapshot ? { config: event.data.snapshot } : {}),
      errors: [...state.errors, event.data.error],
    };
  }

  if (event.type === "response.warning") {
    return { ...base, warnings: [...state.warnings, event.data.warning] };
  }

  if (event.type === "response.abort") {
    if (event.data.snapshot && stableJson(event.data.snapshot) !== stableJson(state.config)) {
      throw new Error("response.abort snapshot does not match the reduced event stream");
    }
    return {
      ...base,
      status: "aborted",
      ...(event.data.snapshot ? { config: event.data.snapshot } : {}),
      abortReason: event.data.reason,
    };
  }

  if (event.type.startsWith("data.")) {
    if (!state.capabilities?.extensions?.includes(event.type)) {
      throw new Error(`Extension ${event.type} was not negotiated`);
    }
    return { ...base, extensions: [...state.extensions, event] };
  }

  throw new Error(`Reducer does not yet support ${event.type}`);
}
