import { checksumVideo } from "../protocol/checksum.js";
import { createVideoEventFactory, type VideoEvent } from "../protocol/events.js";
import {
  applyVideoEvent,
  createVideoState,
  type VideoState,
} from "../protocol/state.js";
import {
  type CreateVideoOptions,
  type VideoInput,
  type VideoRun,
  type VideoAudio,
} from "../protocol/types.js";
import { parseVideo } from "../protocol/persistence.js";
import { parseVideoPlanPart } from "../protocol/validation.js";
import { createReplayableStream } from "../replayable-stream.js";
import { resolveSuppliedMediaPlanPart } from "./supplied-media.js";
import { safePublicDiagnostic } from "../protocol/warnings.js";
import type { VideoGenerationSummary } from "./lifecycle.js";
import { attachGenerationLifecycleSink } from "./lifecycle.js";
import { resolveStreamCapabilities } from "./composition-input.js";
import { prepareComposition } from "./composition-setup.js";
import { cloneWarning, createIncompletePlanWarning } from "./composition-warnings.js";
import {
  advanceComposition,
  createCompositionSession,
  rejectCompositionScene,
  recoverComposition,
  type CompositionAction,
} from "./composition-session.js";
import {
  createId,
  createProviderLifecycle,
  invokeIsolated,
  monotonicNow,
  safeAbortReason,
} from "./composition-runtime.js";

export function createVideo(
  rawInput: VideoInput,
  options: CreateVideoOptions,
): VideoRun {
  const requestId = options.requestId ?? createId("request");
  const runId = options.runId ?? createId("run");
  const {
    requiresGeneratedScene,
    input,
    request,
    initial,
    initialConfig,
    closerReserveSec,
  } = prepareComposition(rawInput, options, requestId);
  const events = createVideoEventFactory({ runId });
  const controller = new AbortController();
  let abortReason = "Request aborted";
  const forwardAbort = () => {
    abortReason = safeAbortReason(options.signal?.reason);
    controller.abort(options.signal?.reason);
  };
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });

  let resolveResult!: (state: VideoState) => void;
  let rejectResult!: (cause: unknown) => void;
  let settled = false;
  const result = new Promise<VideoState>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const startedAt = monotonicNow();
  let timeToFirstSceneMs: number | undefined;
  const { sink: lifecycle, settle: settleProviderLifecycle } = createProviderLifecycle();
  const reportedErrors = new WeakSet<Error>();
  const reportError = (error: Error) => {
    if (reportedErrors.has(error)) return;
    reportedErrors.add(error);
    invokeIsolated(options.onError, error);
  };

  const eventSource = (async function* (): AsyncGenerator<VideoEvent> {
    let state = createVideoState();
    let composition = createCompositionSession();
    let plannedAudio: VideoAudio | undefined;
    let audioSelected = false;
    lifecycle.setPlannedAudio = (audio) => {
      // Explicit input audio wins, and duplicate/late planner metadata cannot
      // replace a soundtrack already committed to the replayable response.
      if (audioSelected || input.audio === false || state.config?.audio || state.config?.scenes.length) return;
      audioSelected = true;
      plannedAudio = audio;
    };
    lifecycle.recoverGeneratedParts = options.invalidPartBehavior === "drop";
    lifecycle.rejectPart = (error) => {
      reportError(error);
      if (options.invalidPartBehavior !== "drop") return false;
      composition = rejectCompositionScene(composition);
      lifecycle.reportWarning?.({ code: "provider_warning", category: "provider", message: "Some generated content was skipped.", recoverable: true });
      return true;
    };
    const compositionOptions = {
      maxDurationSec: input.maxDurationSec ?? 30,
      closerReserveSec,
      requireCloser: options.requireCloser ?? false,
      getTemplatePacing: options.getTemplatePacing,
    };
    const emit = (event: VideoEvent): VideoEvent => {
      state = applyVideoEvent(state, event);
      if (event.type === "response.warning") {
        invokeIsolated(options.onWarning, cloneWarning(event.data.warning));
      }
      options.onEvent?.(event);
      return event;
    };
    const emitCompositionAction = (action: CompositionAction): VideoEvent => {
      if (action.type === "response.warning") {
        return emit(events.create("response.warning", { warning: action.warning }));
      }
      const event = emit(events.create("scene.add", {
        scene: action.scene,
        position: state.config?.scenes.length ?? 0,
      }));
      timeToFirstSceneMs ??= Math.max(0, monotonicNow() - startedAt);
      return event;
    };
    const finish = (finalState: VideoState) => {
      if (!settled) {
        settled = true;
        resolveResult(finalState);
      }
    };

    try {
      yield emit(events.create("response.start", {
        requestId,
        format: { orientation: initialConfig.orientation ?? "portrait" },
        style: initialConfig.style,
        meta: initialConfig.meta,
        capabilities: resolveStreamCapabilities(options.capabilities, initialConfig.scenes.length > 0),
      }));
      if (initialConfig.audio) yield emit(events.create("audio.set", { audio: initialConfig.audio }));
      for (const warning of initial.warnings) {
        yield emit(events.create("response.warning", { warning }));
      }
      for (let position = 0; position < initialConfig.scenes.length; position += 1) {
        yield emit(events.create("scene.add", {
          scene: initialConfig.scenes[position],
          position,
        }));
      }

      // Response policy belongs to the chat planner. Deterministic test runs need no prompt.
      const systemPrompt = options.systemPrompt ?? "";
      const context = { request, systemPrompt, initialConfig, signal: controller.signal };
      attachGenerationLifecycleSink(context, lifecycle);
      for await (const untrustedPart of options.generate(context)) {
        if (plannedAudio) {
          yield emit(events.create("audio.set", { audio: plannedAudio }));
          plannedAudio = undefined;
        }
        let attemptedScene = false;
        try {
          const part = resolveSuppliedMediaPlanPart(parseVideoPlanPart(untrustedPart), input);
          attemptedScene = part.type === "scene.add";
          if (controller.signal.aborted) throw controller.signal.reason ?? new Error(abortReason);
          if (composition.planCompleted) {
            throw new Error(part.type === "plan.complete"
              ? "The planner emitted plan.complete more than once"
              : "The planner emitted content after plan.complete");
          }
          if (part.type === "scene.add") {
            if (options.capabilities?.templates != null &&
              !options.capabilities.templates.includes(part.scene.templateId)) {
              throw new Error(`Scene template ${part.scene.templateId} was not negotiated`);
            }
            options.validateScene?.(part.scene, {
              input,
              previousScenes: state.config?.scenes ?? [],
            });
          }
          if (!state.config) throw new Error("response.start did not initialize composition state");
          const transition = advanceComposition(composition, part, state.config, compositionOptions);
          for (const action of transition.actions) yield emitCompositionAction(action);
          composition = transition.session;
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (attemptedScene || (
            untrustedPart != null &&
            typeof untrustedPart === "object" &&
            (untrustedPart as { type?: unknown }).type === "scene.add"
          )) {
            composition = rejectCompositionScene(composition);
          }
          reportError(error);
          if ((options.invalidPartBehavior ?? "fail") === "fail") throw error;
          yield emit(events.create("response.warning", {
            warning: { code: "provider_warning", category: "provider", message: "Some generated content was skipped.", recoverable: true },
          }));
        }
      }

      if (controller.signal.aborted) {
        throw controller.signal.reason ?? new Error(abortReason);
      }
      const provider = await settleProviderLifecycle();
      for (const warning of provider.warnings) {
        yield emit(events.create("response.warning", { warning }));
      }

      if (!composition.planCompleted) throw new Error("The planner stream ended before plan.complete");
      // A planner-reported length means generation itself was truncated. The
      // runtime's own duration ceiling is different: the deterministic opening
      // may already be the complete playable response allowed by the host.
      if (composition.plannerReportedLength && composition.acceptedSceneCount === 0) {
        throw new Error("The planner was truncated before adding a generated scene");
      }
      if (composition.plannerReportedLength) {
        yield emit(events.create("response.warning", {
          warning: createIncompletePlanWarning(),
        }));
      }
      if (composition.acceptedSceneCount === 0 && requiresGeneratedScene) {
        throw new Error("The planner completed without adding a scene");
      }
      // The documented persistence boundary must accept every completed value.
      // Validate and detach the terminal snapshot before it reaches SSE.
      const snapshot = parseVideo(state.config);
      const completeEvent = emit(events.create("response.complete", {
        finishReason: composition.finishReason,
        snapshot,
        checksum: checksumVideo(snapshot),
      }));
      finish(state);
      const summary: VideoGenerationSummary = {
        finishReason: composition.finishReason,
        ...(provider.usage ? { usage: provider.usage } : {}),
        ...(provider.providerMetadata !== undefined ? { providerMetadata: provider.providerMetadata } : {}),
        ...(provider.requestedModelId ? { requestedModelId: provider.requestedModelId } : {}),
        ...(provider.resolvedModelId ? { resolvedModelId: provider.resolvedModelId } : {}),
        ...(timeToFirstSceneMs != null ? { timeToFirstSceneMs } : {}),
        totalDurationMs: Math.max(0, monotonicNow() - startedAt),
        acceptedSceneCount: composition.acceptedSceneCount,
        rejectedSceneCount: composition.rejectedSceneCount,
        videoDurationSec: snapshot.scenes.at(-1)?.timing.endTime ?? 0,
        warnings: state.warnings.map(cloneWarning),
      };
      invokeIsolated(options.onComplete, summary);
      yield completeEvent;
    } catch (cause) {
      if (controller.signal.aborted) {
        const abortEvent = emit(events.create("response.abort", {
          reason: abortReason,
          ...(state.config ? { snapshot: state.config } : {}),
        }));
        finish(state);
        yield abortEvent;
        return;
      }
      try {
        if (state.config) {
          const recovery = options.invalidPartBehavior === "drop" && !composition.planCompleted
            ? advanceComposition(composition, { type: "plan.complete", finishReason: "other" }, state.config, compositionOptions)
            : recoverComposition(composition, state.config, compositionOptions);
          for (const action of recovery.actions) yield emitCompositionAction(action);
          composition = recovery.session;
        }
        const provider = await settleProviderLifecycle();
        for (const warning of provider.warnings) {
          if (!state.warnings.some((existing) =>
            existing.code === warning.code && existing.message === warning.message
          )) {
            yield emit(events.create("response.warning", { warning }));
          }
        }
        const error = cause instanceof Error ? cause : new Error(String(cause));
        reportError(error);
        if (options.invalidPartBehavior === "drop" && state.config?.scenes.length &&
          (composition.acceptedSceneCount > 0 || !requiresGeneratedScene)) {
          const snapshot = parseVideo(state.config);
          yield emit(events.create("response.warning", {
            warning: { code: "plan_incomplete", category: "provider", message: "The response is ready; some content could not be completed.", recoverable: true },
          }));
          const completeEvent = emit(events.create("response.complete", {
            finishReason: "other", snapshot, checksum: checksumVideo(snapshot),
          }));
          finish(state);
          invokeIsolated(options.onComplete, {
            finishReason: "other",
            ...(provider.usage ? { usage: provider.usage } : {}),
            ...(provider.providerMetadata !== undefined ? { providerMetadata: provider.providerMetadata } : {}),
            ...(provider.requestedModelId ? { requestedModelId: provider.requestedModelId } : {}),
            ...(provider.resolvedModelId ? { resolvedModelId: provider.resolvedModelId } : {}),
            ...(timeToFirstSceneMs != null ? { timeToFirstSceneMs } : {}),
            totalDurationMs: Math.max(0, monotonicNow() - startedAt),
            acceptedSceneCount: composition.acceptedSceneCount,
            rejectedSceneCount: composition.rejectedSceneCount,
            videoDurationSec: snapshot.scenes.at(-1)?.timing.endTime ?? 0,
            warnings: state.warnings.map(cloneWarning),
          });
          yield completeEvent;
          return;
        }
        const emptyResult = error.message === "The planner completed without adding a scene";
        const errorEvent = emit(events.create("response.error", {
          error: {
            code: "generation_failed",
            message: emptyResult
              ? "No valid scenes were generated; inspect recoverable errors and warnings, then retry with a more capable model."
              : "Video response generation failed",
            recoverable: false,
          },
          terminal: true,
          ...(state.config ? { snapshot: state.config } : {}),
        }));
        finish(state);
        yield errorEvent;
      } catch (terminalCause) {
        if (!settled) {
          settled = true;
          rejectResult(terminalCause);
        }
        throw terminalCause;
      }
    } finally {
      options.signal?.removeEventListener("abort", forwardAbort);
    }
  })();

  const stream = createReplayableStream(eventSource, (cause) => {
    if (!settled) {
      settled = true;
      rejectResult(cause);
    }
  });

  return {
    request,
    initialConfig,
    stream,
    result,
    abort(reason = "user cancelled") {
      abortReason = safePublicDiagnostic(reason, "User cancelled");
      controller.abort(new Error(reason));
    },
  };
}
