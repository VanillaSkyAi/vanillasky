// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MountedReadinessContext, MountedSceneReadiness } from "../src/player/mounted-scene-readiness";
import type { VideoScene } from "../src/protocol/types";
const scene: VideoScene = {id: "first", templateId: "cinemaMedia", variables: {mediaType: "video", mediaUrl: "https://example.com/first.mp4"}, timing: {fixedDuration: 4}};
afterEach(() => {cleanup(); vi.useRealTimers();});
function fixture(report: (key: string, error?: Error) => void, current = scene, playing = true) {
  return <MountedReadinessContext.Provider value={report}><div data-video-frame="ready">
    <MountedSceneReadiness scene={current} playing={playing} />
    <div data-scene-layer="active" data-layer-scene-id={current.id}><video src={String(current.variables.mediaUrl)} /></div>
  </div></MountedReadinessContext.Provider>;
}
describe("actual mounted media readiness", () => {
  it("no-poster first video waits for a presented frame, with only its mounted decoder", async () => {
    vi.useFakeTimers(); const report = vi.fn(); const view = render(fixture(report));
    const video = view.container.querySelector("video")!;
    Object.defineProperty(video, "currentSrc", {value: scene.variables.mediaUrl, configurable: true});
    let presented: VideoFrameRequestCallback | undefined;
    video.requestVideoFrameCallback = vi.fn(callback => {presented = callback; return 1;});
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(report).not.toHaveBeenCalled();
    Object.defineProperty(video, "readyState", {value: 3, configurable: true});
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(report).not.toHaveBeenCalled();
    act(() => presented?.(0, {} as VideoFrameCallbackMetadata));
    expect(report).toHaveBeenCalledWith("first\0https://example.com/first.mp4", undefined, true, video);
    expect(view.container.querySelectorAll("video")).toHaveLength(1);
  });
  it("consumes the backdrop's first frame without waiting for a second callback", async () => {
    vi.useFakeTimers(); const report = vi.fn(); const view = render(fixture(report));
    const video = view.container.querySelector("video")!;
    Object.defineProperties(video, {
      currentSrc: { value: video.src, configurable: true },
      readyState: { value: 3, configurable: true },
    });
    video.requestVideoFrameCallback = vi.fn(() => 1);
    video.cancelVideoFrameCallback = vi.fn();
    await act(() => vi.advanceTimersByTimeAsync(32));
    expect(report).not.toHaveBeenCalled();
    act(() => video.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
    expect(report).toHaveBeenCalledWith("first\0https://example.com/first.mp4", undefined, true, video);
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(report).toHaveBeenCalledOnce();
  });
  it("retains first-frame proof while waiting for the active template, and rejects stale sources", async () => {
    vi.useFakeTimers(); const report = vi.fn(); const view = render(fixture(report));
    const video = view.container.querySelector("video")!;
    Object.defineProperties(video, {
      currentSrc: { value: "https://example.com/old.mp4", configurable: true },
      readyState: { value: 3, configurable: true },
    });
    video.requestVideoFrameCallback = vi.fn(() => 1);
    const loading = document.createElement("div"); loading.setAttribute("data-template-loading", "");
    view.container.querySelector('[data-scene-layer="active"]')!.append(loading);
    act(() => video.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
    Object.defineProperty(video, "currentSrc", { value: video.src, configurable: true });
    loading.remove();
    await act(() => vi.advanceTimersByTimeAsync(32));
    expect(report).not.toHaveBeenCalled();
    view.container.querySelector('[data-scene-layer="active"]')!.append(loading);
    act(() => video.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
    expect(report).not.toHaveBeenCalled();
    loading.remove();
    await act(() => vi.advanceTimersByTimeAsync(32));
    expect(report).toHaveBeenCalledWith("first\0https://example.com/first.mp4", undefined, true, video);
  });
  it("a next-scene source handoff does not inherit readiness or allocate another decoder", async () => {
    vi.useFakeTimers(); const report = vi.fn(); const view = render(fixture(report));
    const video = view.container.querySelector("video")!;
    Object.defineProperty(video, "currentSrc", {value: scene.variables.mediaUrl, configurable: true});
    Object.defineProperty(video, "readyState", {value: 3, configurable: true});
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(report).toHaveBeenCalledTimes(1);
    // React updates src before the native element resets readyState/currentSrc.
    view.rerender(fixture(report, {...scene, id: "second", variables: {...scene.variables, mediaUrl: "https://example.com/second.mp4"}}));
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(report).toHaveBeenCalledTimes(1);
    expect(view.container.querySelectorAll("video")).toHaveLength(1);
    Object.defineProperty(video, "readyState", {value: 3, configurable: true});
    Object.defineProperty(video, "currentSrc", {value: "https://example.com/second.mp4", configurable: true});
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(report).toHaveBeenCalledTimes(2);
  });
  it("paused preparation cannot time out and interruption discards stale frame callbacks", async () => {
    vi.useFakeTimers(); const report = vi.fn(); const view = render(fixture(report, scene, false));
    await act(() => vi.advanceTimersByTimeAsync(9000)); expect(report).not.toHaveBeenCalled();
    view.rerender(fixture(report));
    view.unmount(); await act(() => vi.advanceTimersByTimeAsync(9000)); expect(report).not.toHaveBeenCalled();
  });
  it("requests recovery after a timeout without claiming a frame has appeared", async () => {
    vi.useFakeTimers(); const report = vi.fn(); const recover = vi.fn();
    render(<MountedReadinessContext.Provider value={report}><div data-video-frame="ready">
      <MountedSceneReadiness scene={scene} playing onFailure={recover} />
      <div data-scene-layer="active" />
    </div></MountedReadinessContext.Provider>);
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(recover).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });
  it("recovers malformed custom media without throwing during source comparison", async () => {
    vi.useFakeTimers(); const report = vi.fn();
    render(fixture(report, { ...scene, variables: { ...scene.variables, mediaUrl: "https://[invalid" } }));
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(report).toHaveBeenCalledWith(expect.any(String), expect.any(Error), false, undefined);
  });
  it("reports a bounded decode failure rather than starting narration over black", async () => {
    vi.useFakeTimers(); const report = vi.fn(); render(fixture(report));
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(report).toHaveBeenCalledWith(expect.any(String), expect.any(Error), false, undefined);
  });
});

it("retains a decoded first frame without cueing until future video data is available", async () => {
  vi.useFakeTimers(); const report = vi.fn(); const view = render(fixture(report));
  const video = view.container.querySelector("video")!;
  Object.defineProperties(video, { currentSrc: {value: video.src}, readyState: {value: 2, configurable: true} });
  act(() => video.dispatchEvent(new Event("vanillasky:video-frame-presented", {bubbles: true})));
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(report).not.toHaveBeenCalled();
  Object.defineProperty(video, "readyState", {value: 3, configurable: true});
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(report).toHaveBeenCalledWith("first\0https://example.com/first.mp4", undefined, true, video);
});

it("accepts sustained native frames while sampled readiness remains HAVE_CURRENT_DATA", async () => {
  vi.useFakeTimers();
  const report = vi.fn();
  const view = render(fixture(report));
  const video = view.container.querySelector("video")!;
  Object.defineProperties(video, {
    currentSrc: { value: video.src }, readyState: { value: 2 }, paused: { value: false },
  });
  let present: VideoFrameRequestCallback | undefined;
  video.requestVideoFrameCallback = callback => { present = callback; return 1; };
  video.cancelVideoFrameCallback = vi.fn();
  await act(() => vi.advanceTimersByTimeAsync(32));
  act(() => present?.(0, { mediaTime: 0 } as VideoFrameCallbackMetadata));
  expect(report).not.toHaveBeenCalled();
  act(() => present?.(40, { mediaTime: .04 } as VideoFrameCallbackMetadata));
  expect(report).not.toHaveBeenCalled();
  act(() => present?.(80, { mediaTime: .08 } as VideoFrameCallbackMetadata));
  expect(report).toHaveBeenCalledWith("first\0https://example.com/first.mp4", undefined, true, video);
});

it.each(["pause", "waiting", "seeking"])("requires new forward frames after %s interrupts readiness evidence", async event => {
  vi.useFakeTimers();
  const report = vi.fn();
  const view = render(fixture(report));
  const video = view.container.querySelector("video")!;
  Object.defineProperties(video, {
    currentSrc: { value: video.src }, readyState: { value: 2 }, paused: { value: false },
  });
  let present: VideoFrameRequestCallback | undefined;
  video.requestVideoFrameCallback = callback => { present = callback; return 1; };
  video.cancelVideoFrameCallback = vi.fn();
  await act(() => vi.advanceTimersByTimeAsync(32));
  const frame = (time: number) => act(() => present?.(time * 1000, { mediaTime: time } as VideoFrameCallbackMetadata));
  frame(0); frame(.04);
  act(() => video.dispatchEvent(new Event(event)));
  frame(.08); frame(.12);
  expect(report).not.toHaveBeenCalled();
  frame(.16);
  expect(report).toHaveBeenCalledOnce();
});

it.each([0, .04])("a backwards or repeated frame at %s does not count as continuing motion", async reset => {
  vi.useFakeTimers();
  const report = vi.fn();
  const view = render(fixture(report));
  const video = view.container.querySelector("video")!;
  Object.defineProperties(video, {
    currentSrc: { value: video.src }, readyState: { value: 2 }, paused: { value: false },
  });
  let present: VideoFrameRequestCallback | undefined;
  video.requestVideoFrameCallback = callback => { present = callback; return 1; };
  video.cancelVideoFrameCallback = vi.fn();
  await act(() => vi.advanceTimersByTimeAsync(32));
  const frame = (time: number) => act(() => present?.(time * 1000, { mediaTime: time } as VideoFrameCallbackMetadata));
  frame(0); frame(.04); frame(reset); frame(reset + .04);
  expect(report).not.toHaveBeenCalled();
  frame(reset + .08);
  expect(report).toHaveBeenCalledOnce();
});


it.each(["none", "forward", "pause", "waiting", "seeking", "rewind", "source", "replacement", "expired", "jump"])("transfers same-node preparation proof once and rejects %s invalidation", async fault => {
  vi.useFakeTimers();
  const prepared = vi.fn();
  const view = render(<div data-video-frame="ready">
    <MountedSceneReadiness scene={scene} playing observeIncoming onReady={prepared} />
    <div data-scene-layer="incoming" data-layer-scene-id={scene.id}><video src={String(scene.variables.mediaUrl)} /></div>
  </div>);
  const video = view.container.querySelector("video")!;
  Object.defineProperties(video, {
    currentSrc: { configurable: true, value: video.src },
    readyState: { configurable: true, value: 2 },
    paused: { configurable: true, value: false },
  });
  let present: VideoFrameRequestCallback | undefined;
  video.requestVideoFrameCallback = callback => { present = callback; return 1; };
  video.cancelVideoFrameCallback = vi.fn();
  await act(() => vi.advanceTimersByTimeAsync(32));
  for (const time of [0, .04, .08]) {
    video.currentTime = time;
    act(() => present?.(time * 1000, { mediaTime: time } as VideoFrameCallbackMetadata));
  }
  expect(prepared).toHaveBeenCalledOnce();
  const proof = prepared.mock.calls[0][0];
  expect(proof).toBeDefined();
  if (["pause", "waiting", "seeking"].includes(fault)) video.dispatchEvent(new Event(fault));
  if (fault === "forward") video.currentTime += .04;
  if (fault === "expired") await act(() => vi.advanceTimersByTimeAsync(201));
  if (fault === "jump") video.currentTime += 2;
  if (fault === "rewind") video.currentTime = 0;
  if (fault === "source") Object.defineProperty(video, "currentSrc", { value: "https://example.com/replaced.mp4" });
  expect(proof.consume(fault === "replacement" ? document.createElement("video") : video)).toBe(fault === "none" || fault === "forward");
  expect(proof.consume(video)).toBe(false);
});

it("invalidates shared first-frame preparation proof when that node waits before promotion", async () => {
  vi.useFakeTimers();
  const prepared = vi.fn();
  const view = render(<div data-video-frame="ready">
    <MountedSceneReadiness scene={scene} playing observeIncoming onReady={prepared} />
    <div data-scene-layer="incoming" data-layer-scene-id={scene.id}><video src={String(scene.variables.mediaUrl)} /></div>
  </div>);
  const video = view.container.querySelector("video")!;
  Object.defineProperties(video, {
    currentSrc: { configurable: true, value: video.src },
    readyState: { configurable: true, value: 3 },
    paused: { configurable: true, value: false },
  });
  act(() => video.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
  expect(prepared).toHaveBeenCalledOnce();
  const proof = prepared.mock.calls[0][0];
  video.dispatchEvent(new Event("waiting"));
  Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
  expect(proof.consume(video)).toBe(false);
});
