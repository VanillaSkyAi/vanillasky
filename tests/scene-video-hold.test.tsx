// @vitest-environment jsdom
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ExternalVideoBackdropProvider } from "../src/visual-system/scene-templates/external-video-backdrop";
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
it("replaces a decoded video whose play request is rejected", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("Playback denied"));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const view = render(<SceneVideoBackdrop mediaUrl="/shot.mp4" progress={0} isPlaying onError={onError} />);
  await import("@testing-library/react").then(({ waitFor }) => waitFor(() => expect(view.getByRole("status").textContent).toBe("Visual unavailable")));
  expect(view.container.querySelector("video")!.style.visibility).toBe("hidden");
  expect(onError).toHaveBeenCalledOnce();
  view.unmount(); vi.restoreAllMocks();
});
it("refits a changed speech duration without resetting or replaying current footage", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const props = { mediaUrl: "/shot.mp4", progress: .3, isPlaying: true, sceneDuration: 4, muted: true };
  const view = render(<SceneVideoBackdrop {...props} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 5 });
  fireEvent.loadedMetadata(video); video.currentTime = 2;
  view.rerender(<SceneVideoBackdrop {...props} sceneDuration={6} />);
  expect(video.playbackRate).toBeCloseTo(5 / 6.2);
  expect(video.currentTime).toBe(2); expect(play).toHaveBeenCalledTimes(1);
  view.unmount(); vi.restoreAllMocks();
});
it("ignores a rejected play from the previous presentation", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  let reject!: (error: Error) => void;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const view = render(<SceneVideoBackdrop mediaUrl="/old.mp4" progress={0} isPlaying />);
  view.rerender(<SceneVideoBackdrop mediaUrl="/new.mp4" progress={0} isPlaying />);
  await import("@testing-library/react").then(({ act }) => act(async () => { reject(new Error("Old request")); }));
  expect(view.queryByRole("status")).toBeNull();
  view.unmount(); vi.restoreAllMocks();
});
it("never repeats audible dialogue as a continuity bridge", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const view = render(<SceneVideoBackdrop mediaUrl="/dialogue.mp4" progress={.5} isPlaying muted={false} />);
  fireEvent.ended(view.container.querySelector("video")!);
  expect(play).toHaveBeenCalledTimes(1);
  expect(view.getByRole("status").textContent).toBe("Visual unavailable");
  view.unmount(); vi.restoreAllMocks();
});

it("rewinds decoder preroll for narration onset, while leaving user pauses untouched", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const shot = (playing: boolean, preparingNarration: boolean) => <ExternalVideoBackdropProvider mode={false} preparingNarration={preparingNarration}><SceneVideoBackdrop mediaUrl="/shot.mp4" progress={0} isPlaying={playing} /></ExternalVideoBackdropProvider>;
  const view = render(shot(true, false));
  const video = view.container.querySelector("video")!;
  video.currentTime = .2;
  view.rerender(shot(false, true));
  expect(video.currentTime).toBe(0);
  view.rerender(shot(true, false));
  video.currentTime = 3;
  view.rerender(shot(false, false));
  expect(video.currentTime).toBe(3);
  view.unmount(); vi.restoreAllMocks();
});
