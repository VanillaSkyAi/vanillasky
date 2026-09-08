import type { VideoInput } from "../protocol/types.js";
import { cloneValue } from "./clone.js";
import { videoFixtures } from "./fixtures.js";
import { createMockVideoPlanner } from "./mock-video-planner.js";
import type { MockVideoStreamPart, SimulatedVideoEvent } from "./types.js";

const DEFAULT_REQUEST_ID = "test-request";
const DEFAULT_RUN_ID = "test-run";

export interface SimulatedVideoStreamOptions {
  /** Grounded input used by the in-process runtime. Defaults to the portrait fixture input. */
  input?: VideoInput;
  /** Stable request ID used in response.start. Defaults to `test-request`. */
  requestId?: string;
  /** Stable run ID used for event IDs. Defaults to `test-run`. */
  runId?: string;
  /** Abort the simulation and emit a partial response.abort event. */
  signal?: AbortSignal;
  /** Abort after this deterministic timer delay with the public `Request timed out` reason. */
  timeoutMs?: number;
  /** Drop invalid generated parts by default, or make them terminal. */
  invalidPartBehavior?: "drop" | "fail";
}

function timeoutError(): Error {
  const error = new Error("Simulation timeout detail");
  error.name = "TimeoutError";
  return error;
}

/** Run provider plan parts through the real protocol runtime without a server. */
export async function* simulateVideoStream(
  parts: readonly MockVideoStreamPart[],
  options: SimulatedVideoStreamOptions = {},
): AsyncGenerator<SimulatedVideoEvent> {
  const timeoutMs = options.timeoutMs;
  if (timeoutMs != null && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    throw new Error("Simulation timeoutMs must be a non-negative finite number");
  }

  const { createVideo } = await import("../server/compose-video.js");
  const { createTextDeltaVideoPlanner } = await import("../server/model/text-stream.js");
  const { SCENE_DEFINITIONS, getBuiltinSceneDefinition } = await import("../visual-system/catalog/builtin-metadata.js");
  const { validateBuiltinScene } = await import("../server/scene-validation.js");

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = timeoutMs == null
    ? undefined
    : setTimeout(() => controller.abort(timeoutError()), timeoutMs);

  const streamText = createMockVideoPlanner({ parts: cloneValue(parts) });
  const generate = createTextDeltaVideoPlanner({ streamText });
  const input = cloneValue(options.input ?? videoFixtures.portrait.input);
  const run = createVideo(input, {
    requestId: options.requestId ?? DEFAULT_REQUEST_ID,
    runId: options.runId ?? DEFAULT_RUN_ID,
    capabilities: { templates: SCENE_DEFINITIONS.map(scene => scene.id) },
    validateScene: validateBuiltinScene,
    getTemplatePacing: getBuiltinSceneDefinition,
    invalidPartBehavior: options.invalidPartBehavior ?? "drop",
    signal: controller.signal,
    generate,
  });

  try {
    for await (const event of run.stream) {
      yield cloneValue(event) as SimulatedVideoEvent;
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
    if (!controller.signal.aborted) run.abort("Simulation stopped");
  }
}
