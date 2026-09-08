import type { VideoWarning } from "../protocol/warnings.js";
import type {
  CreateVideoOptions,
  Video,
  VideoPlanPart,
  VideoScene,
} from "../protocol/types.js";
import type { VideoFinishReason } from "../protocol/events.js";
import { paceScene, type PaceSceneResult } from "../protocol/pacing.js";
import {
  createDuplicateCloserWarning,
  createMissingCloserWarning,
  createOmittedForCloserWarning,
  createSceneQualityWarnings,
  pendingCloserReserve,
} from "./composition-warnings.js";

export interface CompositionSession {
  readonly acceptedSceneCount: number;
  readonly rejectedSceneCount: number;
  readonly planCompleted: boolean;
  readonly runtimeDurationLimited: boolean;
  readonly deferredForCloser: readonly VideoScene[];
  readonly pendingCloser?: VideoScene;
  readonly closerCommitted: boolean;
  readonly plannerReportedLength: boolean;
  readonly finishReason: Exclude<VideoFinishReason, "error">;
}

export interface CompositionSessionOptions {
  readonly maxDurationSec: number;
  readonly closerReserveSec: number;
  readonly requireCloser: boolean;
  readonly getTemplatePacing?: CreateVideoOptions["getTemplatePacing"];
}

export type CompositionAction =
  | { readonly type: "scene.add"; readonly scene: VideoScene }
  | { readonly type: "response.warning"; readonly warning: VideoWarning };

export interface CompositionTransition {
  readonly session: CompositionSession;
  readonly actions: readonly CompositionAction[];
}

const warningActions = (warnings: readonly VideoWarning[]): CompositionAction[] =>
  warnings.map((warning) => ({ type: "response.warning", warning }));

export function createCompositionSession(): CompositionSession {
  return {
    acceptedSceneCount: 0,
    rejectedSceneCount: 0,
    planCompleted: false,
    runtimeDurationLimited: false,
    deferredForCloser: [],
    closerCommitted: false,
    plannerReportedLength: false,
    finishReason: "stop",
  };
}

function pace(
  scene: VideoScene,
  video: Video,
  options: CompositionSessionOptions,
  closerReserveSec: number,
): PaceSceneResult {
  return paceScene(scene, {
    previousScenes: video.scenes,
    audio: video.audio,
    maxDurationSec: options.maxDurationSec,
    closerReserveSec,
    getTemplatePacing: options.getTemplatePacing,
  });
}

function commitScene(
  session: CompositionSession,
  result: PaceSceneResult & { scene: VideoScene },
  includeQualityWarnings: boolean,
): CompositionTransition {
  return {
    session: {
      ...session,
      acceptedSceneCount: session.acceptedSceneCount + 1,
    },
    actions: [
      ...warningActions(result.warnings),
      ...(includeQualityWarnings
        ? warningActions(createSceneQualityWarnings(result.scene))
        : []),
      { type: "scene.add", scene: result.scene },
    ],
  };
}

function completePlan(
  session: CompositionSession,
  reportedFinishReason: CompositionSession["finishReason"] | undefined,
  requireCloser: boolean,
): CompositionTransition {
  const missingCloser = requireCloser && !session.closerCommitted;
  const finishReason = session.runtimeDurationLimited
    ? "length"
    : reportedFinishReason != null && reportedFinishReason !== "stop"
      ? reportedFinishReason
      : missingCloser
        ? "other"
        : "stop";
  return {
    session: {
      ...session,
      planCompleted: true,
      plannerReportedLength: reportedFinishReason === "length",
      finishReason,
    },
    actions: missingCloser
      ? [{ type: "response.warning", warning: createMissingCloserWarning() }]
      : [],
  };
}

export function advanceComposition(
  session: CompositionSession,
  part: VideoPlanPart,
  video: Video,
  options: CompositionSessionOptions,
): CompositionTransition {
  if (session.planCompleted) {
    throw new Error(part.type === "plan.complete"
      ? "The planner emitted plan.complete more than once"
      : "The planner emitted content after plan.complete");
  }
  if (part.type === "plan.complete") {
    if (!session.pendingCloser) {
      let next: CompositionSession = { ...session, deferredForCloser: [] };
      let currentVideo = video;
      const actions: CompositionAction[] = [];
      for (const deferred of session.deferredForCloser) {
        const recovered = pace(deferred, currentVideo, options, 0);
        if (!recovered.scene) {
          next = {
            ...next,
            rejectedSceneCount: next.rejectedSceneCount + 1,
            runtimeDurationLimited: true,
          };
          actions.push(...warningActions(recovered.warnings));
          continue;
        }
        const committed = commitScene(next, { ...recovered, scene: recovered.scene }, true);
        next = committed.session;
        actions.push(...committed.actions);
        currentVideo = { ...currentVideo, scenes: [...currentVideo.scenes, recovered.scene] };
      }
      const completed = completePlan(next, part.finishReason, options.requireCloser);
      return {
        session: completed.session,
        actions: [...actions, ...completed.actions],
      };
    }
    let next: CompositionSession = {
      ...session,
      rejectedSceneCount: session.rejectedSceneCount + session.deferredForCloser.length,
      runtimeDurationLimited: session.runtimeDurationLimited || session.deferredForCloser.length > 0,
      deferredForCloser: [],
    };
    const actions: CompositionAction[] = session.deferredForCloser.map((scene) => ({
      type: "response.warning",
      warning: createOmittedForCloserWarning(scene.id),
    }));
    const closer = pace(session.pendingCloser, video, options, 0);
    if (!closer.scene) {
      next = {
        ...next,
        rejectedSceneCount: next.rejectedSceneCount + 1,
        runtimeDurationLimited: true,
      };
      actions.push(...warningActions(closer.warnings));
      const completed = completePlan(next, part.finishReason, options.requireCloser);
      return {
        session: completed.session,
        actions: [...actions, ...completed.actions],
      };
    }
    const committed = commitScene(next, { ...closer, scene: closer.scene }, false);
    next = { ...committed.session, closerCommitted: true };
    const completed = completePlan(next, part.finishReason, options.requireCloser);
    return {
      session: completed.session,
      actions: [...actions, ...committed.actions, ...completed.actions],
    };
  }

  const metadata = options.getTemplatePacing?.(part.scene.templateId);
  const isAsk = metadata?.jobs?.includes("ask") === true;
  const isPayoff = metadata?.jobs?.includes("payoff") === true;
  if (part.placement === "closer" && metadata && !isAsk && !isPayoff) {
    throw new Error(`Scene template ${part.scene.templateId} cannot be used as a closer`);
  }
  if (part.placement === "closer" || isAsk) {
    if (session.pendingCloser) {
      return {
        session: {
          ...session,
          rejectedSceneCount: session.rejectedSceneCount + 1,
        },
        actions: [{
          type: "response.warning",
          warning: createDuplicateCloserWarning(),
        }],
      };
    }
    return { session: { ...session, pendingCloser: part.scene }, actions: [] };
  }
  if (session.deferredForCloser.length > 0) {
    return {
      session: { ...session, deferredForCloser: [...session.deferredForCloser, part.scene] },
      actions: [],
    };
  }
  const paced = pace(
    part.scene,
    video,
    options,
    session.pendingCloser
      ? pendingCloserReserve(session.pendingCloser, options.getTemplatePacing)
      : options.closerReserveSec,
  );
  if (!paced.scene) {
    if (paced.warnings.some(({ code }) => code === "scene_omitted_for_closer")) {
      return {
        session: { ...session, deferredForCloser: [...session.deferredForCloser, part.scene] },
        actions: [],
      };
    }
    return {
      session: {
        ...session,
        rejectedSceneCount: session.rejectedSceneCount + 1,
        runtimeDurationLimited: true,
      },
      actions: warningActions(paced.warnings),
    };
  }
  return commitScene(session, { ...paced, scene: paced.scene }, true);
}

export function rejectCompositionScene(session: CompositionSession): CompositionSession {
  return {
    ...session,
    rejectedSceneCount: session.rejectedSceneCount + 1,
  };
}

export function recoverComposition(
  session: CompositionSession,
  video: Video,
  options: CompositionSessionOptions,
): CompositionTransition {
  if (!session.pendingCloser || session.closerCommitted || video.scenes.length === 0) {
    return { session, actions: [] };
  }
  const closer = pace(session.pendingCloser, video, options, 0);
  if (!closer.scene) {
    return {
      session,
      actions: warningActions(closer.warnings),
    };
  }
  const committed = commitScene(session, { ...closer, scene: closer.scene }, false);
  return {
    session: { ...committed.session, closerCommitted: true },
    actions: committed.actions,
  };
}
