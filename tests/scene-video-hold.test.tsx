// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExternalVideoBackdropProvider } from "../src/visual-system/scene-templates/external-video-backdrop";
import { SceneVideoBackdrop } from "../src/visual-system/scene-templates/scene-video-backdrop";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
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

it("fits muted footage to narration, keeps looping through a finite narration scene", () => {
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
  for (let loop = 0; loop < 3; loop++) {
    video.currentTime = 5;
    fireEvent.ended(video);
    expect(video.currentTime).toBe(0);
  }
  expect(view.queryByRole("status")).toBeNull();
  expect(video.style.visibility).not.toBe("hidden");
  expect(play).toHaveBeenCalledTimes(5);
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


it("keeps the decoder visible while waiting and recovers motion without a playing event", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const view = render(<SceneVideoBackdrop mediaUrl="/same.mp4" progress={.3} isPlaying onError={onError} />);
  const video = view.container.querySelector("video")!;
  video.currentTime = 1;
  fireEvent.waiting(video);
  expect(video.style.visibility).not.toBe("hidden");
  expect(view.queryByRole("status")).toBeNull();
  video.currentTime = 1.2;
  const { act } = await import("@testing-library/react");
  await act(async () => vi.advanceTimersByTime(60));
  video.currentTime = 1.4;
  await act(async () => vi.advanceTimersByTime(1040));
  expect(onError).not.toHaveBeenCalled();
  view.unmount(); vi.useRealTimers();
});

it("bounds a stalled decoder and cancels waiting recovery when paused or replaced", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const props = { mediaUrl: "/same.mp4", progress: .3, isPlaying: true, onError };
  const view = render(<SceneVideoBackdrop {...props} />);
  const video = view.container.querySelector("video")!;
  const { act } = await import("@testing-library/react");
  fireEvent.waiting(video);
  view.rerender(<SceneVideoBackdrop {...props} isPlaying={false} />);
  await act(async () => vi.advanceTimersByTime(1100));
  expect(onError).not.toHaveBeenCalled();
  view.rerender(<SceneVideoBackdrop {...props} />);
  fireEvent.waiting(video);
  view.rerender(<SceneVideoBackdrop {...props} playbackId="next" />);
  await act(async () => vi.advanceTimersByTime(1100));
  expect(onError).not.toHaveBeenCalled();
  fireEvent.waiting(video);
  await act(async () => vi.advanceTimersByTime(1100));
  expect(onError).toHaveBeenCalledOnce();
  view.unmount(); vi.useRealTimers();
});


it("cancels waiting frame callbacks from a replaced presentation", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const props = { mediaUrl: "/same.mp4", progress: .3, isPlaying: true, onError };
  const view = render(<SceneVideoBackdrop {...props} playbackId="first" />);
  const video = view.container.querySelector("video")!;
  let callback!: () => void;
  const cancel = vi.fn();
  Object.defineProperty(video, "requestVideoFrameCallback", { value: (next: () => void) => { callback = next; return 7; } });
  Object.defineProperty(video, "cancelVideoFrameCallback", { value: cancel });
  fireEvent.waiting(video);
  view.rerender(<SceneVideoBackdrop {...props} playbackId="second" />);
  expect(cancel).toHaveBeenCalledWith(7);
  const { act } = await import("@testing-library/react");
  await act(async () => { callback(); vi.advanceTimersByTime(1100); });
  expect(onError).not.toHaveBeenCalled();
  view.unmount(); vi.useRealTimers();
});


for (const resumed of [false, true]) it(`requires two forward presented frames after a backwards seek: ${resumed ? "resumed" : "stalled"}`, async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const view = render(<SceneVideoBackdrop mediaUrl="/same.mp4" progress={.5} isPlaying onError={onError} />);
  const video = view.container.querySelector("video")!;
  let callback!: (now: number, metadata: VideoFrameCallbackMetadata) => void;
  Object.defineProperty(video, "requestVideoFrameCallback", { value: (next: typeof callback) => { callback = next; return 1; } });
  Object.defineProperty(video, "cancelVideoFrameCallback", { value: vi.fn() });
  video.currentTime = 3;
  fireEvent.waiting(video);
  const { act } = await import("@testing-library/react");
  await act(async () => {
    video.currentTime = 0;
    callback(0, { mediaTime: 0 } as VideoFrameCallbackMetadata);
    video.currentTime = .04;
    callback(40, { mediaTime: .04 } as VideoFrameCallbackMetadata);
    if (resumed) callback(80, { mediaTime: .08 } as VideoFrameCallbackMetadata);
    vi.advanceTimersByTime(1100);
  });
  expect(onError).toHaveBeenCalledTimes(resumed ? 0 : 1);
  view.unmount(); vi.useRealTimers();
});
