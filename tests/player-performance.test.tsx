// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement, lazy } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { VideoPlayer } from "../src/react";
import { usePlaybackClock } from "../src/player/use-playback-clock";
import { createVideoState } from "../src/protocol/state";
import { createRenderTemplateRegistry, defineTemplate } from "../src/visual-system/catalog/internal";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";
import type { Video } from "../src/index";

const video: Video = { schemaVersion: "0.2", orientation: "landscape", style: TEST_VIDEO_STYLE,
  scenes: [{ id: "first", templateId: "test", variables: {}, timing: { fixedDuration: 1 } }] };
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
  const templates = createRenderTemplateRegistry({ templates: [defineTemplate({ id: "test", schema: { type: "object", properties: {} }, component: () => createElement("div", null, "Actual scene") })] });
  const view = render(createElement(VideoPlayer, { video, templates, autoPlay: false, onFramePresented }));
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
  expect(onStallChange).toHaveBeenLastCalledWith(true);
  stateRef.current = { ...stateRef.current, config: { ...video, scenes: [...video.scenes, { ...video.scenes[0], id: "second" }] } };
  tick(performance.now() + 250);
  expect(onStallChange).toHaveBeenLastCalledWith(false);
  timeRef.current = 2;
  tick(performance.now() + 300);
  expect(onStallChange).toHaveBeenLastCalledWith(true);
  view.rerender({ ...props, isPlaying: false });
  expect(onStallChange).toHaveBeenLastCalledWith(false);
  stateRef.current = { ...stateRef.current, status: "complete" };
  view.rerender(props);
  tick(performance.now() + 400);
  expect(onStallChange.mock.calls).toEqual([[true], [false], [true], [false]]);
});


it("waits for a lazy renderer commit and cancels an unpresented frame on unmount", async () => {
  const tick = clock();
  let resolveTemplate!: (value: { default: () => ReturnType<typeof createElement> }) => void;
  const component = lazy(() => new Promise<{ default: () => ReturnType<typeof createElement> }>((resolve) => { resolveTemplate = resolve; }));
  const templates = createRenderTemplateRegistry({ templates: [defineTemplate({ id: "test", schema: { type: "object", properties: {} }, component })] });
  const onFramePresented = vi.fn();
  const view = render(createElement(VideoPlayer, { video, templates, controls: false, onFramePresented }));
  tick(0);
  expect(view.container.querySelector("[data-template-loading]")).not.toBeNull();
  expect(onFramePresented).not.toHaveBeenCalled();
  await act(async () => resolveTemplate({ default: () => createElement("div", null, "Loaded scene") }));
  expect(view.getByText("Loaded scene")).toBeDefined();
  expect(onFramePresented).not.toHaveBeenCalled();
  view.unmount();
  tick(16);
  expect(onFramePresented).not.toHaveBeenCalled();
});

it("isolates rejected frame observers and reports once for replacement video", async () => {
  const tick = clock();
  const templates = createRenderTemplateRegistry({ templates: [defineTemplate({ id: "test", schema: { type: "object", properties: {} }, component: () => createElement("div", null, "Scene") })] });
  const onFramePresented = vi.fn(() => Promise.reject(new Error("observer failure")));
  const view = render(createElement(VideoPlayer, { video, templates, controls: false, onFramePresented }));
  tick(0);
  await act(async () => {});
  expect(onFramePresented).toHaveBeenCalledOnce();
  view.rerender(createElement(VideoPlayer, { video: { ...video, scenes: [{ ...video.scenes[0], id: "replacement" }] }, templates, controls: false, onFramePresented }));
  tick(16);
  await act(async () => {});
  expect(onFramePresented).toHaveBeenCalledTimes(2);
});
