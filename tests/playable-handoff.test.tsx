// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { VideoFrame } from "../src/player/video-frame";
import { MountedReadinessContext } from "../src/player/mounted-scene-readiness";
import { preloadBuiltinTemplate } from "../src/visual-system/catalog/builtin-player";
import type { Video } from "../src/protocol/types";

beforeAll(async () => {
  await preloadBuiltinTemplate("cinemaMedia");
  await preloadBuiltinTemplate("chapterTitle");
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const config: Video = {
  schemaVersion: "0.2", orientation: "portrait", style: {},
  scenes: ["first", "second"].map(id => ({
    id, templateId: "cinemaMedia",
    variables: { mediaUrl: `https://example.com/${id}.mp4`, mediaType: "video", fallbackText: `${id} chapter` },
    timing: { fixedDuration: 4 },
  })),
};
function fixture(cut = true) {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
  });
  vi.spyOn(HTMLMediaElement.prototype, "currentSrc", "get").mockImplementation(function (this: HTMLMediaElement) { return this.src; });
  const report = vi.fn();
  const frame = (time: number, playing = true, preparingNarration = false) =>
    <MountedReadinessContext.Provider value={report}>
      <VideoFrame config={config} time={time} width={360} height={640} playing={playing} preparingNarration={preparingNarration} />
    </MountedReadinessContext.Provider>;
  const view = render(frame(3));
  const [outgoing, incoming] = view.container.querySelectorAll("video");
  expect(incoming).toBeDefined();
  Object.defineProperty(outgoing, "readyState", { configurable: true, value: 4 });
  Object.defineProperty(incoming, "readyState", { configurable: true, value: 2 });
  act(() => incoming.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
  if (cut) view.rerender(frame(4));
  const displayed = () => view.container.querySelector("[data-video-frame]")?.getAttribute("data-scene-id");
  return { view, frame, outgoing, incoming, report, displayed };
}

it.each([false, true])("keeps outgoing footage until partial incoming media is playable (timeout: %s)", async timeout => {
  const { view, outgoing, incoming, report, displayed } = fixture();
  await act(() => vi.advanceTimersByTimeAsync(2100));
  expect(displayed()).toBe("first");
  expect(outgoing.paused).toBe(false);
  expect(view.container.querySelectorAll("video")).toHaveLength(2);
  expect(report.mock.calls.some(([key]) => String(key).startsWith("second\0"))).toBe(false);
  if (timeout) {
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(view.container.textContent).toContain("second chapter");
  } else {
    Object.defineProperty(incoming, "readyState", { configurable: true, value: 3 });
    act(() => incoming.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
    await act(() => vi.advanceTimersByTimeAsync(32));
    expect(view.container.querySelector('[data-scene-layer="active"] video')).toBe(incoming);
  }
  expect(displayed()).toBe("second");
  expect(report.mock.calls.some(([key]) => String(key).startsWith("second\0"))).toBe(true);
});

it("keeps the pending visual moving during an audio hold, pauses both for the viewer, and releases on cancel", async () => {
  const { view, frame, outgoing, incoming, displayed, report } = fixture();
  view.rerender(frame(4, false, true));
  expect(outgoing.paused).toBe(false);
  expect(incoming.paused).toBe(false);
  view.rerender(frame(4, false));
  expect(outgoing.paused).toBe(true);
  expect(incoming.paused).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(9000));
  expect(displayed()).toBe("first");
  expect(view.container.querySelector('[data-scene-fallback="true"]')).toBeNull();
  view.rerender(frame(4));
  expect(outgoing.paused).toBe(false);
  view.unmount();
  expect(outgoing.hasAttribute("src")).toBe(false);
  expect(incoming.hasAttribute("src")).toBe(false);
  report.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(9000));
  expect(report).not.toHaveBeenCalled();
});

it("promotes after an already prepared source loses and regains future data at the cut", async () => {
  const { view, frame, incoming, displayed } = fixture(false);
  Object.defineProperty(incoming, "readyState", { configurable: true, value: 3 });
  act(() => incoming.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(incoming.paused).toBe(true);
  Object.defineProperty(incoming, "readyState", { configurable: true, value: 2 });
  view.rerender(frame(4));
  await act(() => vi.advanceTimersByTimeAsync(2100));
  expect(displayed()).toBe("first");
  Object.defineProperty(incoming, "readyState", { configurable: true, value: 3 });
  act(() => incoming.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(displayed()).toBe("second");
  expect(view.container.querySelector('[data-scene-layer="active"] video')).toBe(incoming);
});

it("retains a readable canonical chapter while the next video is still partial", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const chapterConfig: Video = { ...config, scenes: [
    { ...config.scenes[0], templateId: "chapterTitle", variables: { title: "A useful opening" } },
    config.scenes[1],
  ] };
  const frame = (time: number) => <VideoFrame config={chapterConfig} time={time} width={360} height={640} playing />;
  const view = render(frame(3.5));
  view.rerender(frame(4));
  await act(() => vi.advanceTimersByTimeAsync(2100));
  expect(view.container.querySelector("[data-video-frame]")?.getAttribute("data-scene-id")).toBe("first");
  expect(view.container.querySelector<HTMLElement>("[data-title-composition]")?.style.opacity).toBe("1");
  expect(view.container.textContent).toContain("A useful opening");
  expect(view.container.querySelectorAll("video")).toHaveLength(1);
});

it("promotes a pending clip proven by native frame advancement even when readiness stays at two", async () => {
  const { view, incoming, displayed, report } = fixture();
  let present: VideoFrameRequestCallback | undefined;
  incoming.requestVideoFrameCallback = callback => { present = callback; return 1; };
  incoming.cancelVideoFrameCallback = vi.fn();
  await act(() => vi.advanceTimersByTimeAsync(32));
  for (const time of [0, .04, .08]) {
    incoming.currentTime = time;
    act(() => present?.(time * 1000, { mediaTime: time } as VideoFrameCallbackMetadata));
  }
  expect(displayed()).toBe("second");
  expect(view.container.querySelector('[data-scene-layer="active"] video')).toBe(incoming);
  expect(report).toHaveBeenCalledWith("second\0https://example.com/second.mp4", undefined, true, incoming);
});
