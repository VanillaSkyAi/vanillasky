// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExternalVideoBackdropProvider } from "../src/visual-system/scene-templates/external-video-backdrop";
import { SceneVideoBackdrop } from "../src/visual-system/scene-templates/scene-video-backdrop";
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "currentSrc", "get").mockImplementation(function (this: HTMLMediaElement) { return this.src; });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("rewinds the same decoder for an explicit replay but leaves ordinary pause intact", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const props = { mediaUrl: "/replay.mp4", sceneDuration: 3, isPlaying: true };
  const view = render(<SceneVideoBackdrop {...props} progress={0} />);
  const video = view.container.querySelector("video")!;
  video.currentTime = 3;
  view.rerender(<SceneVideoBackdrop {...props} progress={1} isPlaying={false} />);
  expect(video.currentTime).toBe(3);
  view.rerender(<SceneVideoBackdrop {...props} progress={0} />);
  expect(view.container.querySelector("video")).toBe(video);
  expect(video.currentTime).toBe(0);
  expect(video.loop).toBe(false);
});
it("resumes paused footage without looping its exhausted end, and resets deliberate replay", () => {
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

it("recovers a clip shorter than measured narration without slowing or looping it", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const view = render(<SceneVideoBackdrop mediaUrl="/short.mp4" progress={.3} isPlaying sceneDuration={6} muted onError={onError} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 5 });
  fireEvent.loadedMetadata(video);
  expect(video.playbackRate).toBe(1);
  expect(video.loop).toBe(false);
  expect(onError).toHaveBeenCalledOnce();
  video.currentTime = 5;
  fireEvent.ended(video);
  expect(video.currentTime).toBe(5);
  expect(play).toHaveBeenCalledTimes(1);
  expect(view.getByRole("status").textContent).toBe("Visual unavailable");
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

it("keeps audible footage at its native speed even when pitch preservation exists", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const view = render(<SceneVideoBackdrop mediaUrl="/shot.mp4" progress={0} isPlaying muted={false} sceneDuration={5.4} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 5 });
  Object.defineProperty(video, "preservesPitch", { configurable: true, value: true });
  fireEvent.loadedMetadata(video);
  expect(video.playbackRate).toBe(1);
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
it("recovers a changed oversized scene duration without resetting or replaying footage", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const props = { mediaUrl: "/shot.mp4", progress: .3, isPlaying: true, sceneDuration: 4, muted: true };
  const view = render(<SceneVideoBackdrop {...props} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 5 });
  fireEvent.loadedMetadata(video); video.currentTime = 2;
  view.rerender(<SceneVideoBackdrop {...props} sceneDuration={6} />);
  expect(video.playbackRate).toBe(1);
  expect(view.getByRole("status").textContent).toBe("Visual unavailable");
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

it("preserves decoded silent footage through narration and viewer pauses", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const shot = (playing: boolean, preparingNarration: boolean) => <ExternalVideoBackdropProvider mode={false} preparingNarration={preparingNarration}><SceneVideoBackdrop mediaUrl="/shot.mp4" progress={0} isPlaying={playing} /></ExternalVideoBackdropProvider>;
  const view = render(shot(true, false));
  const video = view.container.querySelector("video")!;
  video.currentTime = .2;
  view.rerender(shot(false, true));
  expect(video.currentTime).toBe(.2);
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
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  fireEvent.loadedData(video);
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
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  fireEvent.loadedData(video);
  fireEvent.waiting(video);
  view.rerender(<SceneVideoBackdrop {...props} isPlaying={false} />);
  await act(async () => vi.advanceTimersByTime(1100));
  expect(onError).not.toHaveBeenCalled();
  view.rerender(<SceneVideoBackdrop {...props} />);
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  fireEvent.loadedData(video);
  fireEvent.waiting(video);
  view.rerender(<SceneVideoBackdrop {...props} playbackId="next" />);
  await act(async () => vi.advanceTimersByTime(1100));
  expect(onError).not.toHaveBeenCalled();
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  fireEvent.loadedData(video);
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
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  fireEvent.loadedData(video);
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
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  fireEvent.loadedData(video);
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


it("allows cold startup before enforcing the presented source's stall deadline", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const view = render(<SceneVideoBackdrop mediaUrl="/cold.mp4" progress={0} isPlaying onError={onError} />);
  const video = view.container.querySelector("video")!;
  const { act } = await import("@testing-library/react");
  fireEvent.waiting(video);
  await act(async () => vi.advanceTimersByTime(1500));
  expect(onError).not.toHaveBeenCalled();
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  fireEvent.loadedData(video);
  await act(async () => vi.advanceTimersByTime(1100));
  expect(onError).toHaveBeenCalledOnce();
  view.unmount(); vi.useRealTimers();
});

it("lets a mounted decoder adopt its new source without tearing down the new load", () => {
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const view = render(<SceneVideoBackdrop mediaUrl="/first.mp4" playbackId="first" progress={0} isPlaying />);
  const video = view.container.querySelector("video")!;
  load.mockClear();
  view.rerender(<SceneVideoBackdrop mediaUrl="/second.mp4" playbackId="second" progress={0} isPlaying />);
  expect(view.container.querySelector("video")).toBe(video);
  expect(video.getAttribute("src")).toBe("/second.mp4");
  expect(load).not.toHaveBeenCalled();
  view.unmount();
  expect(video.getAttribute("src")).toBeNull();
  expect(load).toHaveBeenCalledOnce();
});

it("restores the source after Strict Mode rehearses decoder cleanup", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const view = render(<React.StrictMode><SceneVideoBackdrop mediaUrl="/strict.mp4" progress={0} isPlaying /></React.StrictMode>);
  expect(view.container.querySelector("video")?.getAttribute("src")).toBe("/strict.mp4");
});

it("keeps the short stall bound when a new scene reuses an already presented source", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const props = {mediaUrl: "/same.mp4", progress: 0, isPlaying: true, onError};
  const view = render(<SceneVideoBackdrop {...props} playbackId="one" />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  fireEvent.loadedData(video);
  view.rerender(<SceneVideoBackdrop {...props} playbackId="two" />);
  fireEvent.waiting(video);
  const { act } = await import("@testing-library/react");
  await act(async () => vi.advanceTimersByTime(1100));
  expect(onError).toHaveBeenCalledOnce();
});


it("observes an already loaded mounted frame without a new loadeddata event", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(HTMLMediaElement.HAVE_FUTURE_DATA);
  let present: VideoFrameRequestCallback | undefined;
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value: (callback: VideoFrameRequestCallback) => { present = callback; return 17; } });
  const cancel = vi.fn();
  Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", { configurable: true, value: cancel });
  const onReady = vi.fn(), onError = vi.fn();
  const { act } = await import("@testing-library/react");
  try {
    const view = render(<SceneVideoBackdrop mediaUrl="/cached.mp4" progress={0} isPlaying onReady={onReady} onError={onError} />);
    expect(present).toBeDefined();
    expect(onReady).not.toHaveBeenCalled();
    act(() => present?.(0, { mediaTime: .5 } as VideoFrameCallbackMetadata));
    expect(onReady).toHaveBeenCalledOnce();
    fireEvent.waiting(view.container.querySelector("video")!);
    await act(async () => vi.advanceTimersByTime(1100));
    expect(onError).toHaveBeenCalledOnce();
    view.unmount();
    const next = render(<SceneVideoBackdrop mediaUrl="/next.mp4" progress={0} isPlaying onReady={onReady} />);
    const stale = present;
    next.unmount();
    expect(cancel).toHaveBeenCalledWith(17);
    act(() => stale?.(0, {} as VideoFrameCallbackMetadata));
    expect(onReady).toHaveBeenCalledOnce();
  } finally {
    Reflect.deleteProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback");
    Reflect.deleteProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback");
  }
});

for (const event of ["play", "playing"] as const) it.each([false, true])(`reasserts the latest pause after a late native ${event} event (narration hold: %s)`, (preparingNarration) => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const props = { mediaUrl: "/late.mp4", progress: 0, isPlaying: true };
  const view = render(<SceneVideoBackdrop {...props} />);
  const video = view.container.querySelector("video")!;
  view.rerender(<SceneVideoBackdrop {...props} isPlaying={false} preparingNarration={preparingNarration} />);
  pause.mockClear();
  // Native playback can start after the earlier pause command has returned.
  video.currentTime = .2;
  fireEvent[event](video);
  expect(pause).toHaveBeenCalledOnce();
  expect(video.currentTime).toBe(.2);
  view.rerender(<SceneVideoBackdrop {...props} />);
  pause.mockClear();
  fireEvent[event](video);
  expect(pause).not.toHaveBeenCalled();
});

it("keeps first-frame-only loading cold and bounded while play is pending", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise(() => {}));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const view = render(<SceneVideoBackdrop mediaUrl="/partial.mp4" progress={0} isPlaying onError={onError} />);
  const video = view.container.querySelector("video")!;
  const { act } = await import("@testing-library/react");
  fireEvent.waiting(video);
  Object.defineProperty(video, "readyState", {configurable: true, value: 2});
  fireEvent.loadedData(video);
  await act(async () => vi.advanceTimersByTime(1500));
  expect(onError).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(6500));
  expect(onError).toHaveBeenCalledOnce();
});

it("keeps the short stall bound after playable data falls back to a single frame", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const view = render(<SceneVideoBackdrop mediaUrl="/played.mp4" progress={0} isPlaying onError={onError} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "readyState", {configurable: true, value: 3});
  video.currentTime = .5;
  fireEvent.loadedData(video);
  fireEvent.playing(video);
  Object.defineProperty(video, "readyState", {configurable: true, value: 2});
  fireEvent.waiting(video);
  const { act } = await import("@testing-library/react");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(onError).toHaveBeenCalledOnce();
});

it("keeps the short stall bound after actual motion observed at readiness two", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const onError = vi.fn();
  const view = render(<SceneVideoBackdrop mediaUrl="/moving.mp4" progress={0} isPlaying onError={onError} />);
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
  fireEvent.loadedData(video);
  fireEvent.waiting(video);
  const { act } = await import("@testing-library/react");
  video.currentTime = .04;
  await act(async () => vi.advanceTimersByTime(50));
  video.currentTime = .08;
  await act(async () => vi.advanceTimersByTime(50));
  expect(onError).not.toHaveBeenCalled();
  fireEvent.waiting(video);
  await act(async () => vi.advanceTimersByTime(1100));
  expect(onError).toHaveBeenCalledOnce();
});

it("never enables native looping for a narrated scene", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const props = {mediaUrl:"/short.mp4", progress:.3, isPlaying:true, muted:true, sceneDuration:6};
  const view = render(<SceneVideoBackdrop {...props} />);
  const video = view.container.querySelector("video")!;
  expect(video.loop).toBe(false);
  view.rerender(<SceneVideoBackdrop {...props} isPlaying={false} />);
  expect(video.loop).toBe(false);
  expect(pause).toHaveBeenCalled();
  view.rerender(<SceneVideoBackdrop {...props} muted={false} />);
  expect(video.loop).toBe(false);
  view.rerender(<SceneVideoBackdrop {...props} sceneDuration={Infinity} />);
  expect(video.loop).toBe(false);
  view.rerender(<SceneVideoBackdrop {...props} />);
  expect(video.loop).toBe(false);
  view.unmount();
  expect(video.getAttribute("src")).toBeNull();
});


it("preserves audible preroll rewind while silent preparations retain their decoded position", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const props = { mediaUrl: "/dialogue.mp4", progress: 0, muted: false, preparingNarration: true };
  const view = render(<SceneVideoBackdrop {...props} isPlaying />);
  const video = view.container.querySelector("video")!;
  video.currentTime = .04;
  view.rerender(<SceneVideoBackdrop {...props} isPlaying={false} />);
  expect(video.currentTime).toBe(0);
});
