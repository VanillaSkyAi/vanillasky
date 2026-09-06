// @vitest-environment jsdom
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SceneVideoBackdrop } from "../src/visual-system/scene-templates/scene-video-backdrop";
it("resumes paused footage, recovers its end once, and resets a deliberate replay", () => {
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
  expect(play).toHaveBeenCalledTimes(calls + 1);
  view.rerender(<SceneVideoBackdrop {...props} playbackId="run2" />);
  expect(video.currentTime).toBe(0);
  view.unmount();
  vi.restoreAllMocks();
});

it("fits muted footage to narration, permits one continuity replay, then replaces the frozen frame", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const props = { mediaUrl: "/shot.mp4", progress: .3, isPlaying: true, sceneDuration: 6, muted: true };
  const view = render(<SceneVideoBackdrop {...props} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 5 });
  fireEvent.loadedMetadata(video);
  expect(video.playbackRate).toBeCloseTo(5 / 6.2);
  video.currentTime = 5;
  fireEvent.ended(video);
  expect(video.currentTime).toBe(0);
  expect(play).toHaveBeenCalledTimes(2);
  fireEvent.ended(video);
  expect(view.getByRole("status").textContent).toBe("Visual unavailable");
  expect(video.style.visibility).toBe("hidden");
  expect(play).toHaveBeenCalledTimes(2);
  view.unmount(); vi.restoreAllMocks();
});
it("does not slow audible footage or restart it while the viewer pauses", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const view = render(<SceneVideoBackdrop mediaUrl="/shot.mp4" progress={.5} isPlaying={false} muted={false} sceneDuration={20} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 5 });
  fireEvent.loadedMetadata(video); fireEvent.ended(video);
  expect(video.playbackRate).toBe(1);
  expect(play).not.toHaveBeenCalled();
  view.unmount(); vi.restoreAllMocks();
});

it("fits an audible slight overrun only when native pitch preservation is enabled", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const view = render(<SceneVideoBackdrop mediaUrl="/shot.mp4" progress={0} isPlaying muted={false} sceneDuration={5.4} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 5 });
  Object.defineProperty(video, "preservesPitch", { configurable: true, value: true });
  fireEvent.loadedMetadata(video);
  expect(video.playbackRate).toBeCloseTo(5 / 5.6);
  view.unmount(); vi.restoreAllMocks();
});
