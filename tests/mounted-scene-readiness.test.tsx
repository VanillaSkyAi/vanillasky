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
    <div data-persistent-video-scene-id={current.id}><video src={String(current.variables.mediaUrl)} /></div>
    <div data-scene-layer="active" />
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
    Object.defineProperty(video, "readyState", {value: 2, configurable: true});
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(report).not.toHaveBeenCalled();
    act(() => presented?.(0, {} as VideoFrameCallbackMetadata));
    expect(report).toHaveBeenCalledWith("first\0https://example.com/first.mp4", undefined, true);
    expect(view.container.querySelectorAll("video")).toHaveLength(1);
  });
  it("a next-scene source handoff does not inherit readiness or allocate another decoder", async () => {
    vi.useFakeTimers(); const report = vi.fn(); const view = render(fixture(report));
    const video = view.container.querySelector("video")!;
    Object.defineProperty(video, "currentSrc", {value: scene.variables.mediaUrl, configurable: true});
    Object.defineProperty(video, "readyState", {value: 2, configurable: true});
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(report).toHaveBeenCalledTimes(1);
    // React updates src before the native element resets readyState/currentSrc.
    view.rerender(fixture(report, {...scene, id: "second", variables: {...scene.variables, mediaUrl: "https://example.com/second.mp4"}}));
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(report).toHaveBeenCalledTimes(1);
    expect(view.container.querySelectorAll("video")).toHaveLength(1);
    Object.defineProperty(video, "readyState", {value: 2, configurable: true});
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
  it("reports a bounded decode failure rather than starting narration over black", async () => {
    vi.useFakeTimers(); const report = vi.fn(); render(fixture(report));
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(report).toHaveBeenCalledWith(expect.any(String), expect.any(Error), false);
  });
});
