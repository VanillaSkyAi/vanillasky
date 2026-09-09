import { describe, expect, it } from "vitest";
import type { Video, VideoPlanPart, VideoTemplatePacing } from "../src/protocol/types";
import {
  advanceComposition,
  createCompositionSession,
  rejectCompositionScene,
  recoverComposition,
  type CompositionAction,
  type CompositionSessionOptions,
} from "../src/server/composition-session";
import { TEST_VIDEO_STYLE } from "./helpers/video-style";

const emptyVideo = (): Video => ({
  schemaVersion: "0.2",
  orientation: "portrait",
  scenes: [],
  style: TEST_VIDEO_STYLE,
});

const scene = (id: string, templateId = "body", fixedDuration = 4): VideoPlanPart => ({
  type: "scene.add",
  scene: { id, templateId, variables: {}, timing: { fixedDuration } },
});

function applyActions(video: Video, actions: readonly CompositionAction[]): Video {
  return actions.reduce<Video>((current, action) => action.type === "scene.add"
    ? { ...current, scenes: [...current.scenes, action.scene] }
    : current, video);
}

const options = {
  maxDurationSec: 30,
  closerReserveSec: 3,
  requireCloser: false,
  getTemplatePacing: (templateId: string): VideoTemplatePacing => ({
    jobs: templateId === "close" ? ["ask"] : ["claim"],
    minDuration: 2,
    preferredDuration: 4,
  }),
} satisfies CompositionSessionOptions;

describe("composition session", () => {
  it("accepts a body scene through one paced commit transition", () => {
    const transition = advanceComposition(
      createCompositionSession(),
      scene("body-1"),
      emptyVideo(),
      options,
    );

    expect(transition.actions).toEqual([{
      type: "scene.add",
      scene: {
        id: "body-1",
        templateId: "body",
        variables: {},
        timing: { fixedDuration: 4, startTime: 0, endTime: 4 },
      },
    }]);
    expect(transition.session).toMatchObject({
      acceptedSceneCount: 1,
      rejectedSceneCount: 0,
      planCompleted: false,
    });
  });

  it("reserves one closer and finalizes deferred body scenes without reordering", () => {
    const constrained = { ...options, maxDurationSec: 10 };
    let session = createCompositionSession();
    let video = emptyVideo();

    const first = advanceComposition(session, scene("body-1", "body", 7), video, constrained);
    session = first.session;
    video = applyActions(video, first.actions);

    const deferred = advanceComposition(session, scene("body-2", "body", 2), video, constrained);
    expect(deferred.actions).toEqual([]);
    session = deferred.session;

    const reserved = advanceComposition(session, scene("close-1", "close", 3), video, constrained);
    expect(reserved.actions).toEqual([]);
    session = reserved.session;

    const late = advanceComposition(session, scene("body-late", "body", 2), video, constrained);
    expect(late.actions).toEqual([]);
    session = late.session;

    const completed = advanceComposition(session, { type: "plan.complete" }, video, constrained);

    expect(completed.actions).toMatchObject([
      { type: "response.warning", warning: { code: "scene_omitted_for_closer", sceneId: "body-2" } },
      { type: "response.warning", warning: { code: "scene_omitted_for_closer", sceneId: "body-late" } },
      { type: "scene.add", scene: { id: "close-1", timing: { startTime: 7, endTime: 10 } } },
    ]);
    expect(completed.session).toMatchObject({
      acceptedSceneCount: 2,
      rejectedSceneCount: 2,
      planCompleted: true,
      runtimeDurationLimited: true,
      closerCommitted: true,
      finishReason: "length",
    });
  });

  it("recovers deferred scenes in planner order when no closer arrives", () => {
    const constrained = { ...options, maxDurationSec: 10 };
    let session = createCompositionSession();
    let video = emptyVideo();

    const first = advanceComposition(session, scene("body-1", "body", 7), video, constrained);
    session = first.session;
    video = applyActions(video, first.actions);
    const deferred = advanceComposition(session, scene("body-2", "body", 2), video, constrained);

    const completed = advanceComposition(
      deferred.session,
      { type: "plan.complete" },
      video,
      constrained,
    );

    expect(completed.actions).toMatchObject([
      { type: "scene.add", scene: { id: "body-2", timing: { startTime: 7, endTime: 9 } } },
    ]);
    expect(completed.actions.some((action) =>
      action.type === "response.warning" && action.warning.code === "scene_omitted_for_closer"
    )).toBe(false);
    expect(completed.session).toMatchObject({
      acceptedSceneCount: 2,
      rejectedSceneCount: 0,
      deferredForCloser: [],
      planCompleted: true,
      runtimeDurationLimited: false,
      finishReason: "stop",
    });
  });

  it("keeps the first closer and rejects later closer candidates", () => {
    const first = advanceComposition(
      createCompositionSession(),
      scene("close-1", "close", 3),
      emptyVideo(),
      options,
    );

    const duplicate = advanceComposition(
      first.session,
      scene("close-2", "close", 3),
      emptyVideo(),
      options,
    );

    expect(duplicate.actions).toMatchObject([
      { type: "response.warning", warning: { code: "scene_omitted_for_closer" } },
    ]);
    expect(duplicate.session).toMatchObject({
      pendingCloser: { id: "close-1" },
      acceptedSceneCount: 0,
      rejectedSceneCount: 1,
    });
  });

  it("rejects an unreadable scene while preserving its pacing warning", () => {
    const rejected = advanceComposition(
      createCompositionSession(),
      scene("too-short", "body", 4),
      emptyVideo(),
      { ...options, maxDurationSec: 1, closerReserveSec: 0 },
    );

    expect(rejected.actions).toMatchObject([
      {
        type: "response.warning",
        warning: { code: "scene_omitted_unreadable", sceneId: "too-short" },
      },
    ]);
    expect(rejected.session).toMatchObject({
      acceptedSceneCount: 0,
      rejectedSceneCount: 1,
      runtimeDurationLimited: true,
    });
  });

  it("marks a required but missing closer as a partial completion", () => {
    const body = advanceComposition(
      createCompositionSession(),
      scene("body-1"),
      emptyVideo(),
      options,
    );
    const video = applyActions(emptyVideo(), body.actions);

    const completed = advanceComposition(
      body.session,
      { type: "plan.complete" },
      video,
      { ...options, requireCloser: true },
    );

    expect(completed.actions).toMatchObject([
      { type: "response.warning", warning: { code: "plan_missing_closer" } },
    ]);
    expect(completed.session).toMatchObject({
      planCompleted: true,
      closerCommitted: false,
      finishReason: "other",
    });
  });

  it("rejects an unreadable reserved closer and reports the missing ending", () => {
    const constrained = { ...options, maxDurationSec: 1, requireCloser: true };
    const reserved = advanceComposition(
      createCompositionSession(),
      scene("close-1", "close", 3),
      emptyVideo(),
      constrained,
    );

    const completed = advanceComposition(
      reserved.session,
      { type: "plan.complete" },
      emptyVideo(),
      constrained,
    );

    expect(completed.actions).toMatchObject([
      { type: "response.warning", warning: { code: "scene_omitted_unreadable", sceneId: "close-1" } },
      { type: "response.warning", warning: { code: "plan_missing_closer" } },
    ]);
    expect(completed.session).toMatchObject({
      acceptedSceneCount: 0,
      rejectedSceneCount: 1,
      runtimeDurationLimited: true,
      closerCommitted: false,
      finishReason: "length",
    });
  });

  it("commits a reserved closer during terminal provider recovery", () => {
    const body = advanceComposition(
      createCompositionSession(),
      scene("body-1"),
      emptyVideo(),
      options,
    );
    const video = applyActions(emptyVideo(), body.actions);
    const reserved = advanceComposition(
      body.session,
      scene("close-1", "close", 3),
      video,
      options,
    );

    const recovered = recoverComposition(reserved.session, video, options);

    expect(recovered.actions).toMatchObject([
      { type: "scene.add", scene: { id: "close-1", timing: { startTime: 4, endTime: 7 } } },
    ]);
    expect(recovered.session).toMatchObject({
      acceptedSceneCount: 2,
      rejectedSceneCount: 0,
      planCompleted: false,
      closerCommitted: true,
    });
  });

  it("counts a scene rejected before trusted composition", () => {
    const rejected = rejectCompositionScene(createCompositionSession());

    expect(rejected).toMatchObject({
      acceptedSceneCount: 0,
      rejectedSceneCount: 1,
    });
  });
});
