// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SceneVideoBackdrop } from "../src/visual-system/scene-templates/scene-video-backdrop";
it("holds a finished clip, resumes a paused clip, and resets a deliberate replay", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const props = { mediaUrl: "/shot.mp4", progress: 0, isPlaying: true, playbackId: "run1" };
  const view = render(<SceneVideoBackdrop {...props} />);
  const video = view.container.querySelector("video")!;
  expect(video.loop).toBe(false);
  video.currentTime = 3;
  view.rerender(<SceneVideoBackdrop {...props} isPlaying={false} />);
  view.rerender(<SceneVideoBackdrop {...props} />);
  expect(video.currentTime).toBe(3);
  Object.defineProperty(video, "ended", { configurable: true, value: true });
  const calls = play.mock.calls.length;
  view.rerender(<SceneVideoBackdrop {...props} isPlaying={false} />);
  view.rerender(<SceneVideoBackdrop {...props} />);
  expect(play).toHaveBeenCalledTimes(calls);
  view.rerender(<SceneVideoBackdrop {...props} playbackId="run2" />);
  expect(video.currentTime).toBe(0);
  view.unmount();
  vi.restoreAllMocks();
});
