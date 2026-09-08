import { createVideoRequest, type CreateVideoOptions, type VideoInput } from "../protocol/types.js";
import { getCloserReserve } from "../protocol/pacing.js";
import {
  buildInitialComposition,
  normalizeVideoInput,
  validateVideoInput,
} from "./composition-input.js";

export function prepareComposition(
  rawInput: VideoInput,
  options: CreateVideoOptions,
  requestId: string,
) {
  validateVideoInput(rawInput);
  const requiresGeneratedScene = rawInput.opening == null || rawInput.opening === false;
  const input = normalizeVideoInput(rawInput);
  const request = createVideoRequest(input, {
    requestId,
    capabilities: options.capabilities,
  });
  const initialAudio = input.audio === false
    ? undefined
    : input.audio
      ? {
          trackId: "soundtrack",
          audioUrl: input.audio.src,
          duration: input.maxDurationSec ?? 30,
          beatDetection: { sensitivity: 0.5 },
          beatMarkers: [],
          volume: 1,
          fadeOutMs: 3000,
        }
      : options.selectAudio?.(input);
  const closerReserveSec = getCloserReserve(
    options.capabilities?.templates,
    options.getTemplatePacing,
  );
  const initial = buildInitialComposition(
    input,
    initialAudio,
    options.snapshotRetention,
    closerReserveSec,
    options.getTemplatePacing,
  );
  const initialConfig = initial.config;
  for (let position = 0; position < initialConfig.scenes.length; position += 1) {
    options.validateScene?.(initialConfig.scenes[position], {
      input,
      previousScenes: initialConfig.scenes.slice(0, position),
    });
  }

  return {
    requiresGeneratedScene,
    input,
    request,
    initial,
    initialConfig,
    closerReserveSec,
  };
}
