// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { VideoPlayer } from "../src/player/video-player";
import { usePlaybackClock } from "../src/player/use-playback-clock";
import { createVideoState } from "../src/protocol/state";
import { preloadBuiltinTemplate } from "../src/visual-system/catalog/builtin-player";
beforeAll(async () => { await preloadBuiltinTemplate("chapterTitle"); });
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";
import type { Video } from "../src/protocol/types";

const video: Video = { schemaVersion: "0.2", orientation: "landscape", style: TEST_VIDEO_STYLE,
  scenes: [{ id: "first", templateId: "chapterTitle", variables: { title: "Actual scene" }, timing: { fixedDuration: 1 } }] };
function clock() {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => pending.delete(key));
  return (time: number) => act(() => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((callback) => callback(time)); });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reports a committed scene after a frame, excluding the idle poster", async () => {
  await import("../src/player/control-visibility");
  const tick = clock();
  const onFramePresented = vi.fn();
  const view = render(createElement(VideoPlayer, { video, autoPlay: false, onFramePresented }));
  tick(100);
  expect(onFramePresented).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: /play video/i }));
  expect(view.getByText("Actual scene")).toBeDefined();
  expect(onFramePresented).not.toHaveBeenCalled();
  tick(116);
  expect(onFramePresented).toHaveBeenCalledOnce();
  tick(132);
  expect(onFramePresented).toHaveBeenCalledOnce();
});

it("tracks stream starvation, recovery and pause without counting initial wait or saved replay", () => {
  const tick = clock();
  const stateRef = { current: createVideoState() };
  const onStallChange = vi.fn();
  const timeRef = { current: 0 };
  const props = { isPlaying: true, stateRef, timeRef, audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: -1 }, callbacksRef: { current: { onStallChange } }, setCurrentTime: vi.fn(), setIsPlaying: vi.fn() };
  const view = renderHook((value) => usePlaybackClock(value), { initialProps: props });
  tick(performance.now() + 100);
  expect(onStallChange).not.toHaveBeenCalled();
  stateRef.current = { ...stateRef.current, config: video, status: "streaming" };
  timeRef.current = 1;
  tick(performance.now() + 200);
  expect(onStallChange).toHaveBeenLastCalledWith(true, "scene-generation");
  stateRef.current = { ...stateRef.current, config: { ...video, scenes: [...video.scenes, { ...video.scenes[0], id: "second" }] } };
  tick(performance.now() + 250);
  expect(onStallChange).toHaveBeenLastCalledWith(false, undefined);
  timeRef.current = 2;
  tick(performance.now() + 300);
  expect(onStallChange).toHaveBeenLastCalledWith(true, "scene-generation");
  view.rerender({ ...props, isPlaying: false });
  expect(onStallChange).toHaveBeenLastCalledWith(false, undefined);
  stateRef.current = { ...stateRef.current, status: "complete" };
  view.rerender(props);
  tick(performance.now() + 400);
  expect(onStallChange.mock.calls).toEqual([[true, "scene-generation"], [false, undefined], [true, "scene-generation"], [false, undefined]]);
});


it("cancels an unpresented scene frame on unmount", async () => {
  const tick = clock();
  const onFramePresented = vi.fn();
  const view = render(createElement(VideoPlayer, { video, controls: false, onFramePresented }));
  expect(view.getByText("Actual scene")).toBeDefined();
  expect(onFramePresented).not.toHaveBeenCalled();
  view.unmount();
  tick(16);
  expect(onFramePresented).not.toHaveBeenCalled();
});

it("isolates rejected frame observers and reports once for replacement video", async () => {
  const tick = clock();
  const onFramePresented = vi.fn(() => Promise.reject(new Error("observer failure")));
  const view = render(createElement(VideoPlayer, { video, controls: false, onFramePresented }));
  tick(0);
  await act(async () => {});
  expect(onFramePresented).toHaveBeenCalledOnce();
  view.rerender(createElement(VideoPlayer, { video: { ...video, scenes: [{ ...video.scenes[0], id: "replacement" }] }, controls: false, onFramePresented }));
  tick(16);
  await act(async () => {});
  expect(onFramePresented).toHaveBeenCalledTimes(2);
});
