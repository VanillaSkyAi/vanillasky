// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoValidationError } from "../src/protocol/persistence";
import { type Video } from "../src/protocol/types";
import { createVideo } from "../src/server/compose-video";
import { createVideoEventFactory } from "../src/protocol/events";
import { SCENE_DEFINITIONS } from "../src/visual-system/catalog/builtin-metadata";
import { preloadBuiltinTemplate } from "../src/visual-system/catalog/builtin-player";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";

describe("VideoPlayer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports actual clip duration and decoded buffered playback without URLs", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    await preloadBuiltinTemplate("cinemaMedia");
    const { VideoPlayer } = await import("../src/player/video-player");
    const metrics = vi.fn();
    const video: Video = { schemaVersion: "0.2", orientation: "portrait", style: TEST_VIDEO_STYLE,
      scenes: [{ id: "native-metric", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.example/clip.mp4", mediaType: "video" }, timing: { fixedDuration: 4 } }] };
    const view = render(createElement(VideoPlayer, { video, autoPlay: false, onPlaybackMetric: metrics }));
    const clip = view.container.querySelector("video")!;
    Object.defineProperties(clip, { duration: { value: 5 }, readyState: { value: 3 },
      buffered: { value: { length: 1, start: () => 0, end: () => 5 } } });
    await waitFor(() => expect(metrics).toHaveBeenCalledWith({ type: "media-playback", clipDurationSec: 5, sceneDurationSec: 4, repeatCount: 0 }));
    expect(metrics).toHaveBeenCalledWith({ type: "buffer", bufferedSeconds: 4 });
    expect(JSON.stringify(metrics.mock.calls)).not.toContain("media.example");
  });

  it("renders nothing before a stream starts", async () => {
    const { VideoPlayer } = await import("../src/player/video-player");
    const view = render(createElement(VideoPlayer, {
    }));

    expect(view.container.innerHTML).toBe("");
  });

  it("plays a saved video without requiring stream player props", async () => {
    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      scenes: [{
        id: "saved",
        templateId: "chapterTitle",
        variables: { title: "saved result" },
        timing: { fixedDuration: 4 },
      }],
      style: TEST_VIDEO_STYLE,
    };

    const view = render(createElement(VideoPlayer, { video, autoPlay: false }));
    const player = view.getByTestId("video-player");

    expect(player.getAttribute("data-status")).toBe("complete");
    expect(player.getAttribute("data-scenes")).toBe("1");
    await waitFor(() => expect(view.getByText("saved result")).toBeDefined(), { timeout: 3_000 });
    expect(view.container.querySelector('[data-template-id="chapterTitle"]')).not.toBeNull();
  });

  it("keeps scene content available when a saved renderer is unavailable", async () => {
    const { VideoPlayer } = await import("../src/player/video-player");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const video: Video = { schemaVersion: "0.2", orientation: "landscape", style: TEST_VIDEO_STYLE,
      scenes: [{ id: "safe", templateId: "broken", variables: {}, narration: "The response remains available.", timing: { fixedDuration: 4 } }],
    };
    const view = render(createElement(VideoPlayer, { video, autoPlay: false }));
    expect(view.getByText("The response remains available.")).toBeDefined();
    expect(view.container.textContent).not.toMatch(/private|Unsupported template/);
    consoleError.mockRestore();
  });

  it("exposes an opt-in sound control for native scene video audio", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      scenes: [{
        id: "native-audio",
        templateId: "cinemaMedia",
        variables: {
          texts: "A storm answers.",
          mediaUrl: "https://media.example.test/h3-with-audio.mp4",
          mediaType: "video",
        },
        timing: { fixedDuration: 5 },
      }],
      style: TEST_VIDEO_STYLE,
    };

    const view = render(createElement(VideoPlayer, {
      video,
      autoPlay: true,
      startMuted: true,
      nativeMediaAudio: { volume: 0.35 },
    }));

    const sceneVideo = await waitFor(() => {
      const element = view.container.querySelector("video");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(sceneVideo.muted).toBe(true);
    await waitFor(() => expect(sceneVideo.volume).toBe(0.35));
    fireEvent.click(view.getByRole("button", { name: "Unmute video response" }));
    await waitFor(() => expect(sceneVideo.muted).toBe(false));
  });

  it("loops a saved video instead of ending, and reports scene changes", async () => {
    const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await preloadBuiltinTemplate("chapterTitle");
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const nextFrame = (time: number) => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queuedFrames.delete(id));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      audio: {
        trackId: "short-soundtrack",
        audioUrl: "data:audio/wav;base64,UklGRg==",
        duration: 2,
        volume: 0.2,
        fadeOutMs: 0,
        beatDetection: { sensitivity: 0.5 },
        beatMarkers: [],
      },
      scenes: [
        { id: "one", templateId: "chapterTitle", variables: { title: "first" }, timing: { fixedDuration: 2 } },
        { id: "two", templateId: "chapterTitle", variables: { title: "second" }, timing: { fixedDuration: 2 } },
      ],
      style: TEST_VIDEO_STYLE,
    };

    const seen: Array<[string, number]> = [];
    const view = render(createElement(VideoPlayer, {
      video,
      loop: true,
      autoPlay: true,
      onSceneChange: (scene, index) => { seen.push([scene.id, index]); },
    }));

    let clock = performance.now();
    const advance = (seconds: number) => {
      clock += seconds * 1_000;
      act(() => nextFrame?.(clock));
    };

    // Settle on the first scene.
    advance(0.1);
    // Cross into the second scene.
    advance(1.2);
    // Run past the 4s duration so a non-looping player would end.
    advance(1.4);
    advance(1.4);
    advance(1.4);
    advance(0.1);

    expect(seen.map(([id]) => id)).toEqual(["one", "two", "one"]);
    expect(seen.map(([, index]) => index)).toEqual([0, 1, 0]);

    const player = view.getByTestId("video-player");
    expect(player.getAttribute("data-ended")).toBe("false");
    expect(view.container.querySelector("audio")?.loop).toBe(true);
    expect(view.queryByTestId("video-ended-scrim")).toBeNull();
    expect(view.queryByTestId("video-replay-button")).toBeNull();
  });

  it("still ends a saved video when loop is not set", async () => {
    const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await preloadBuiltinTemplate("chapterTitle");
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const nextFrame = (time: number) => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queuedFrames.delete(id));

    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      scenes: [{ id: "only", templateId: "chapterTitle", variables: { title: "only" }, timing: { fixedDuration: 2 } }],
      style: TEST_VIDEO_STYLE,
    };

    const onPlaybackEnd = vi.fn();
    const view = render(createElement(VideoPlayer, { video, autoPlay: true, onPlaybackEnd }));
    expect(onPlaybackEnd).not.toHaveBeenCalled();
    act(() => nextFrame?.(performance.now() + 2_500));
    act(() => nextFrame?.(performance.now() + 5_000));

    await waitFor(() => expect(view.getByTestId("video-player").getAttribute("data-ended")).toBe("true"));
    expect(onPlaybackEnd).toHaveBeenCalledOnce();
    expect(onPlaybackEnd).toHaveBeenCalledWith(video);
    expect(view.queryByTestId("video-replay-button")).not.toBeNull();

    view.rerender(createElement(VideoPlayer, { video, autoPlay: true, loop: true, onPlaybackEnd }));
    view.rerender(createElement(VideoPlayer, { video, autoPlay: true, loop: false, onPlaybackEnd }));
    expect(onPlaybackEnd).toHaveBeenCalledOnce();
  });

  it("reports playback end again for replacement content", async () => {
    const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await preloadBuiltinTemplate("chapterTitle");
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const nextFrame = (time: number) => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queuedFrames.delete(id));
    const { VideoPlayer } = await import("../src/player/video-player");
    const makeVideo = (id: string): Video => ({
      schemaVersion: "0.2",
      orientation: "portrait",
      scenes: [{ id, templateId: "chapterTitle", variables: { title: id }, timing: { fixedDuration: 1 } }],
      style: TEST_VIDEO_STYLE,
    });
    const first = makeVideo("first");
    const second = makeVideo("second");
    const onPlaybackEnd = vi.fn();
    const view = render(createElement(VideoPlayer, { video: first, autoPlay: true, onPlaybackEnd }));

    act(() => nextFrame?.(performance.now() + 2_000));
    await waitFor(() => expect(onPlaybackEnd).toHaveBeenCalledWith(first));
    view.rerender(createElement(VideoPlayer, { video: second, autoPlay: true, onPlaybackEnd }));
    act(() => nextFrame?.(performance.now() + 4_000));
    // The boundary mounts and acknowledges the next scene before its clock advances.
    act(() => nextFrame?.(performance.now() + 8_000));
    act(() => nextFrame?.(performance.now() + 10_000));

    await waitFor(() => expect(onPlaybackEnd).toHaveBeenCalledWith(second));
    expect(onPlaybackEnd).toHaveBeenCalledTimes(2);
  });

  it("renders no controls and no replay when controls are off", async () => {
    const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await preloadBuiltinTemplate("chapterTitle");
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const nextFrame = (time: number) => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queuedFrames.delete(id));

    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      scenes: [{ id: "only", templateId: "chapterTitle", variables: { title: "only" }, timing: { fixedDuration: 2 } }],
      style: TEST_VIDEO_STYLE,
    };

    const view = render(createElement(VideoPlayer, { video, autoPlay: true, controls: false }));
    expect(view.queryByTestId("video-controls")).toBeNull();

    // The replay goes with them. A host driving playback itself would other-
    // wise have the answer covered by a scrim the moment it finished.
    act(() => nextFrame?.(performance.now() + 2_500));
    act(() => nextFrame?.(performance.now() + 5_000));
    await waitFor(() => expect(view.getByTestId("video-player").getAttribute("data-ended")).toBe("true"));
    expect(view.queryByTestId("video-replay-button")).toBeNull();
    expect(view.queryByTestId("video-ended-scrim")).toBeNull();
  });

  it("rejects an unsupported saved schema before invoking a renderer", async () => {
    const future = {
      schemaVersion: "99.0",
      scenes: [{
        id: "future",
        templateId: "futureTemplate",
        variables: {},
        timing: { fixedDuration: 2 },
      }],
      style: TEST_VIDEO_STYLE,
    } as unknown as Video;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { VideoPlayer } = await import("../src/player/video-player");

    expect(() => render(createElement(VideoPlayer, {
      video: future,
      autoPlay: false,
    }))).toThrow(VideoValidationError);
  });

  it("replays every built-in saved template without a generation request", async () => {
    const generationRequests: Array<RequestInfo | URL> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      generationRequests.push(input);
      throw new Error(`Unexpected generation request: ${String(input)}`);
    }));
    const { VideoPlayer } = await import("../src/player/video-player");

    const view = render(createElement("main", null, SCENE_DEFINITIONS.map((template) => {
      const variables = { ...template.defaults };
      const video: Video = {
        schemaVersion: "0.2",
        orientation: "portrait",
        scenes: [{
          id: `saved-${template.id}`,
          templateId: template.id,
          variables,
          timing: { fixedDuration: 2 },
        }],
        style: TEST_VIDEO_STYLE,
      };
      return createElement(VideoPlayer, {
        key: template.id,
        video,
        autoPlay: false,
        width: 180,
      });
    })));

    await waitFor(() => {
      for (const { id } of SCENE_DEFINITIONS) {
        expect(view.container.querySelector(`[data-template-id="${id}"]`), id).not.toBeNull();
      }
    }, { timeout: 10_000 });
    expect(generationRequests).toEqual([]);
  });

  it("shows a monochrome generation cover until the first validated scene arrives", async () => {
    let releasePlanner!: () => void;
    const plannerGate = new Promise<void>((resolve) => { releasePlanner = resolve; });
    const { VideoPlayer } = await import("../src/player/video-player");
    const events = createVideoEventFactory({ runId: "run-generation-cover" });
    const style = TEST_VIDEO_STYLE;
    const stream = (async function* () {
        yield events.create("response.start", {
          requestId: "request-generation-cover",
          format: { orientation: "portrait" },
          style,
          meta: { name: "Video response" },
        });
        await plannerGate;
        yield events.create("scene.add", {
          scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 1, startTime: 0, endTime: 1 } },
          position: 0,
        });
    })();
    const view = render(createElement(VideoPlayer, {
      stream,
      width: 360,
      playbackMode: "manual",
    }));

    const cover = await view.findByTestId("video-generation-cover");
    expect(cover.textContent).toContain("Creating your video…");
    expect(cover.textContent).toContain("Choosing the best scenes for your content.");
    expect(cover.style.background).toBe("rgb(0, 0, 0)");
    expect(cover.style.fontFamily).toContain("-apple-system");
    const coverStart = view.getByRole("button", { name: "Play video response" });
    expect(coverStart.style.top).toBe("50%");

    releasePlanner();
    await waitFor(() => expect(view.getByTestId("video-player").getAttribute("data-scenes")).toBe("1"));
    expect(view.getByTestId("video-generation-cover")).toBe(cover);
    expect(view.getByRole("button", { name: "Play video response" })).toBe(coverStart);
  });

  it("shows the chapter's readable hold pose in the static start poster", async () => {
    const { VideoPlayer } = await import("../src/player/video-player");
    await preloadBuiltinTemplate("chapterTitle");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      scenes: [{
        id: "intro",
        templateId: "chapterTitle",
        variables: {},
        timing: { fixedDuration: 4 },
      }],
      style: TEST_VIDEO_STYLE,
    };

    const view = render(createElement(VideoPlayer, { video, autoPlay: false }));
    const poster = view.container.querySelector<HTMLElement>("[data-title-composition]")!;
    expect(poster.textContent).toBe("A different perspective");
    expect(Number(poster.style.opacity)).toBe(1);
  });

  it("starts the default opening with sound before the planner body arrives", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let releaseFirstScene!: () => void;
    const firstSceneGate = new Promise<void>((resolve) => { releaseFirstScene = resolve; });
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({
      input: "Activation improved from 41% to 58%.",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () {
        await firstSceneGate;
        yield {
          type: "scene.add" as const,
          scene: {
            id: "first",
            templateId: "chapterTitle",
            variables: { texts: "Activation", value: 58, label: "percent" },
            timing: { fixedDuration: 3 },
          },
        };
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      playbackMode: "autoplay-after-interaction",
    }));
    const player = view.getByTestId("video-player");

    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    await waitFor(() => expect(player.getAttribute("data-scenes")).toBe("1"));
    expect(view.queryByTestId("video-generation-cover")).toBeNull();
    expect(view.container.querySelector('[data-template-id="chapterTitle"]')).not.toBeNull();
    await waitFor(() => expect(view.container.textContent).toContain("Creating your video..."));
    fireEvent.click(view.getByRole("button", { name: "Play video with sound" }));
    expect(play).toHaveBeenCalled();
    expect(player.getAttribute("data-playing")).toBe("true");
    expect(player.getAttribute("data-generation-intro-complete")).toBe("true");
    expect(player.getAttribute("data-intro-playing")).toBe("false");

    releaseFirstScene();
    await waitFor(() => expect(player.getAttribute("data-scenes")).toBe("2"));
  });

  it("keeps the default opening visible while later body scenes stream", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let releasePlanner!: () => void;
    const plannerGate = new Promise<void>((resolve) => { releasePlanner = resolve; });
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({
      input: "Activation improved from 41% to 58%.",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: {
            id: "first",
            templateId: "chapterTitle",
            variables: { texts: "Activation", value: 58, label: "percent" },
            timing: { fixedDuration: 3 },
          },
        };
        await plannerGate;
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      playbackMode: "manual",
    }));
    const player = view.getByTestId("video-player");

    await waitFor(() => expect(player.getAttribute("data-scenes")).toBe("2"));
    expect(player.getAttribute("data-status")).toBe("streaming");
    expect(player.getAttribute("data-current-time")).toBe("0.000");
    expect(player.getAttribute("data-playing")).toBe("false");
    expect(view.queryByTestId("video-generation-cover")).toBeNull();
    expect(view.container.querySelector('[data-template-id="chapterTitle"]')).not.toBeNull();
    await waitFor(() => expect(view.container.textContent).toContain("Creating your video..."));
    expect(view.container.querySelector("audio")?.muted).toBe(false);
    expect(view.getAllByRole("button", { name: "Play video with sound" })).toHaveLength(1);

    fireEvent.click(view.getByRole("button", { name: "Play video with sound" }));
    expect(play).toHaveBeenCalled();
    await waitFor(() => expect(player.getAttribute("data-playing")).toBe("true"));
    expect(player.getAttribute("data-intro-playing")).toBe("false");
    expect(view.queryByTestId("video-generation-cover")).toBeNull();
    releasePlanner();
  });

  it("uses the default chapter opening as the poster and starts it with sound", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let releasePlanner!: () => void;
    const plannerGate = new Promise<void>((resolve) => { releasePlanner = resolve; });
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({
      input: "Activation improved from 41% to 58%.",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () {
        await plannerGate;
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      playbackMode: "manual",
    }));

    const player = view.getByTestId("video-player");
    await waitFor(() => expect(player.getAttribute("data-scenes")).toBe("1"));
    expect(view.queryByTestId("video-generation-cover")).toBeNull();
    expect(view.container.querySelector('[data-template-id="chapterTitle"]')).not.toBeNull();
    await waitFor(() => expect(view.container.textContent).toContain("Creating your video..."));
    expect(player.getAttribute("data-current-time")).toBe("0.000");
    expect(player.getAttribute("data-start-poster")).toBe("true");
    const start = view.getByRole("button", { name: "Play video with sound" });
    expect(start.style.top).toBe("50%");
    fireEvent.click(start);
    expect(play).toHaveBeenCalled();
    expect(player.getAttribute("data-generation-intro-complete")).toBe("true");
    expect(player.getAttribute("data-intro-playing")).toBe("false");
    expect(player.getAttribute("data-playing")).toBe("true");
    expect(player.getAttribute("data-start-poster")).toBe("false");
    releasePlanner();
  });

  it("autoplays later streams with sound after the viewer starts the first one", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { VideoPlayer } = await import("../src/player/video-player");
    const first = createVideo({
      input: "First",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () {
        yield { type: "scene.add" as const, scene: { id: "first", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 3 } } };
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: first.stream,
      playbackMode: "autoplay-after-interaction",
    }));
    const player = view.getByTestId("video-player");

    await waitFor(() => expect(player.getAttribute("data-status")).toBe("complete"));
    expect(player.getAttribute("data-playing")).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Play video with sound" }));
    await waitFor(() => expect(player.getAttribute("data-audio-unlocked")).toBe("true"));

    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const second = createVideo({
      input: "Second",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () {
        await secondGate;
        yield { type: "scene.add" as const, scene: { id: "second", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 3 } } };
        yield { type: "plan.complete" as const };
      },
    });
    view.rerender(createElement(VideoPlayer, {
      stream: second.stream,
      playbackMode: "autoplay-after-interaction",
    }));

    expect(player.getAttribute("data-status")).toBe("streaming");
    expect(player.getAttribute("data-playing")).toBe("true");
    expect(view.getByTestId("video-generation-cover")).toBeDefined();
    releaseSecond();
  });

  it("starts each replacement stream as a fresh autoplay session with an immediate cover", async () => {
    const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await preloadBuiltinTemplate("chapterTitle");
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const nextFrame = (time: number) => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queuedFrames.delete(id));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    const { VideoPlayer } = await import("../src/player/video-player");
    const first = createVideo({ input: "First" }, {
      generate: async function* () {
        yield { type: "scene.add" as const, scene: { id: "first", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 1 } } };
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, { stream: first.stream, autoPlay: true }));
    const player = view.getByTestId("video-player");
    await waitFor(() => expect(player.getAttribute("data-status")).toBe("complete"));
    act(() => nextFrame?.(performance.now() + 4_000));
    // The boundary mounts and acknowledges the next scene before its clock advances.
    act(() => nextFrame?.(performance.now() + 8_000));
    await waitFor(() => expect(player.getAttribute("data-playing")).toBe("false"));

    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const second = createVideo({ input: "Second" }, {
      generate: async function* () {
        await secondGate;
        yield { type: "scene.add" as const, scene: { id: "second", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 1 } } };
        yield { type: "plan.complete" as const };
      },
    });
    view.rerender(createElement(VideoPlayer, { stream: second.stream, autoPlay: true }));

    expect(player.getAttribute("data-status")).toBe("streaming");
    expect(player.getAttribute("data-current-time")).toBe("0.000");
    expect(player.getAttribute("data-playing")).toBe("true");
    expect(view.getByTestId("video-generation-cover")).toBeDefined();
    releaseSecond();
  });

  it("completes a one-shot stream under React Strict Mode", async () => {
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({ input: "Update" }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 1 } },
        };
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(StrictMode, null, createElement(VideoPlayer, {
      stream: response.stream,
    })));

    await waitFor(() => expect(view.getByTestId("video-player").getAttribute("data-status")).toBe("complete"));
  });

  it("exposes partial length completion in player run state", async () => {
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({ input: "Update" }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 1 } },
        };
        yield { type: "plan.complete" as const, finishReason: "length" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
    }));
    const player = view.getByTestId("video-player");

    await waitFor(() => expect(player.getAttribute("data-status")).toBe("complete"));
    expect(player.getAttribute("data-finish-reason")).toBe("length");
  });

  it("switches an auto-oriented player between landscape and portrait at its container breakpoint", async () => {
    let containerWidth = 800;
    let notifyResize: (() => void) | undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() { notifyResize?.(); }
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => containerWidth);
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({ input: "Update", orientation: "portrait", opening: "Ready" }, {
      generate: async function* () { yield { type: "plan.complete" as const }; },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      orientation: "auto",
    }));
    const player = view.getByTestId("video-player");
    await waitFor(() => expect(player.getAttribute("data-orientation")).toBe("landscape"));

    containerWidth = 360;
    act(() => notifyResize?.());
    await waitFor(() => expect(player.getAttribute("data-orientation")).toBe("portrait"));
  });

  it("keeps an explicit player orientation fixed across container widths", async () => {
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({ input: "Update", orientation: "landscape", opening: "Ready" }, {
      generate: async function* () { yield { type: "plan.complete" as const }; },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      orientation: "portrait",
      width: 800,
    }));
    const player = view.getByTestId("video-player");
    await waitFor(() => expect(player.getAttribute("data-status")).toBe("complete"));
    expect(player.getAttribute("data-orientation")).toBe("portrait");
  });

  it("enters an ended state and restarts from zero", async () => {
    const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await preloadBuiltinTemplate("chapterTitle");
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const nextFrame = (time: number) => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queuedFrames.delete(id));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({ input: "Update" }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 1 } },
        };
        yield { type: "plan.complete" as const };
      },
    });
    const onComplete = vi.fn();
    const onPlaybackEnd = vi.fn();
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      onComplete,
      onPlaybackEnd,
    }));
    const player = view.getByTestId("video-player");
    await waitFor(() => expect(player.getAttribute("data-status")).toBe("complete"));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onPlaybackEnd).not.toHaveBeenCalled();
    act(() => nextFrame?.(performance.now() + 4_000));
    // The boundary mounts and acknowledges the next scene before its clock advances.
    act(() => nextFrame?.(performance.now() + 8_000));
    await waitFor(() => {
      expect(player.getAttribute("data-playing")).toBe("false");
      expect(player.getAttribute("data-ended")).toBe("true");
      expect(player.getAttribute("data-current-time")).toBe("4.000");
      expect(onPlaybackEnd).toHaveBeenCalledOnce();
    });

    expect(view.getByTestId("video-ended-scrim")).toBeDefined();
    const replay = view.getByRole("button", { name: "Replay video response" });
    expect(replay.getAttribute("data-testid")).toBe("video-replay-button");
    expect(replay.querySelector("svg")).not.toBeNull();
    expect(replay.textContent).toContain("Replay");
    expect(view.getByRole("button", { name: "Play video response from beginning" }).querySelector("svg")).not.toBeNull();
    fireEvent.click(replay);
    expect(player.getAttribute("data-playing")).toBe("true");
    expect(player.getAttribute("data-ended")).toBe("false");
    expect(player.getAttribute("data-current-time")).toBe("0.000");
    act(() => nextFrame?.(performance.now() + 8_000));
    act(() => nextFrame?.(performance.now() + 12_000));
    await waitFor(() => expect(onPlaybackEnd).toHaveBeenCalledTimes(2));
  });

  it("presents idle, playing, and paused controls as distinct player states", async () => {
    const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await preloadBuiltinTemplate("chapterTitle");
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const nextFrame = (time: number) => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queuedFrames.delete(id));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({
      input: "What makes product onboarding feel effortless?",
      opening: "Three ways to make product onboarding feel effortless.",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () { yield { type: "plan.complete" as const }; },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      width: 360,
      playbackMode: "manual",
    }));

    await waitFor(() => expect(view.getByTestId("video-player").getAttribute("data-status")).toBe("complete"));
    const player = view.getByTestId("video-player");
    const start = view.getByRole("button", { name: "Play video with sound" });
    expect(start.querySelector("svg")).not.toBeNull();
    expect(start.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(start.style.color).toBe("rgb(9, 7, 18)");
    expect(start.style.whiteSpace).toBe("nowrap");
    expect(view.queryByTestId("video-controls")).toBeNull();

    fireEvent.click(start);
    const controls = view.getByTestId("video-controls");
    expect(controls).toBeDefined();
    const pause = view.getByRole("button", { name: "Pause video response" });
    expect(player.getAttribute("data-touch-controls")).toBe("false");

    fireEvent.pointerEnter(player);
    expect(view.getByTestId("video-primary-controls").style.pointerEvents).toBe("auto");
    expect(pause.querySelector("svg")).not.toBeNull();
    expect(pause.style.width).toBe("52px");
    expect(pause.style.height).toBe("52px");
    expect(pause.style.borderRadius).toBe("999px");
    expect(view.getByTestId("video-primary-controls").contains(pause)).toBe(true);
    expect(view.getByTestId("video-secondary-controls").contains(view.getByRole("button", { name: "Mute video response" }))).toBe(true);

    fireEvent.pointerLeave(player);
    act(() => pause.focus());
    expect(document.activeElement).toBe(pause);
    act(() => pause.blur());

    fireEvent.touchStart(player);
    expect(player.getAttribute("data-touch-controls")).toBe("true");

    await waitFor(() => expect(nextFrame).toBeDefined());
    act(() => nextFrame?.(performance.now() + 1_000));
    await waitFor(() => expect(view.getByTestId("video-player").getAttribute("data-current-time")).not.toBe("0.000"));
    fireEvent.click(pause);
    expect(view.getByRole("button", { name: "Play video response" }).querySelector("svg")).not.toBeNull();
    fireEvent.pointerLeave(player);
    expect(player.getAttribute("data-playing")).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Play video response" }));
    expect(player.getAttribute("data-playing")).toBe("true");
    expect(player.getAttribute("data-touch-controls")).toBe("false");

    fireEvent.pointerLeave(player);
    fireEvent.keyDown(player, { key: "Tab" });
    fireEvent.click(view.getByRole("button", { name: "Pause video response" }));
    const keyboardResume = view.getByRole("button", { name: "Play video response" });
    act(() => keyboardResume.focus());
    fireEvent.click(keyboardResume);
    expect(player.getAttribute("data-playing")).toBe("true");
    expect(document.activeElement).toBe(keyboardResume);
  });
  it("provides named keyboard playback controls and respects reduced motion", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({ input: "Update", opening: "Opening" }, {
      generate: async function* () { yield { type: "plan.complete" as const }; },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      width: 360,
      ariaLabel: "Quarterly recap",
    }));
    const player = view.getByTestId("video-player");

    expect(player.getAttribute("role")).toBe("region");
    expect(player.getAttribute("aria-label")).toBe("Quarterly recap");
    expect(player.getAttribute("tabindex")).toBe("0");
    await waitFor(() => expect(player.getAttribute("data-scenes")).toBe("1"));
    expect(player.getAttribute("data-playing")).toBe("false");
    fireEvent.keyDown(player, { key: " " });
    expect(player.getAttribute("data-playing")).toBe("true");
    const control = view.getByRole("button", { name: "Pause video response" });
    expect(control.style.backgroundColor).toBe("rgba(255, 255, 255, 0.16)");
    expect(control.style.color).toBe("rgb(255, 255, 255)");
    expect(control.style.minWidth).toBe("52px");
    expect(control.style.minHeight).toBe("52px");
    fireEvent.keyDown(control, { key: " " });
    expect(player.getAttribute("data-playing")).toBe("true");
    fireEvent.click(control);
    expect(player.getAttribute("data-playing")).toBe("false");
  });

  it("pauses when the system enables reduced motion at runtime", async () => {
    let onChange: ((event: MediaQueryListEvent) => void) | undefined;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { onChange = listener; },
        removeEventListener: () => undefined,
      }),
    });
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({ input: "Update" }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 3 } },
        };
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, { stream: response.stream }));
    const player = view.getByTestId("video-player");
    expect(player.getAttribute("data-playing")).toBe("true");
    onChange?.({ matches: true } as MediaQueryListEvent);
    await waitFor(() => expect(player.getAttribute("data-playing")).toBe("false"));
  });

  it("pauses soundtrack audio with the playback control", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({
      input: "Update",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 3 } },
        };
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
    }));
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Pause video response" }));
    await waitFor(() => expect(pause).toHaveBeenCalled());
  });

  it("applies the configured soundtrack volume while scenes are still streaming", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let releasePlanner!: () => void;
    const plannerGate = new Promise<void>((resolve) => { releasePlanner = resolve; });
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({
      input: "Update",
    }, {
      selectAudio: () => ({
        trackId: "soundtrack",
        audioUrl: "data:audio/wav;base64,UklGRg==",
        duration: 6,
        volume: 0.2,
        beatDetection: { sensitivity: 0.5 },
        beatMarkers: [],
      }),
      generate: async function* () {
        yield { type: "scene.add" as const, scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 3 } } };
        await plannerGate;
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
    }));

    const audio = await waitFor(() => {
      const element = view.container.querySelector("audio");
      expect(element).not.toBeNull();
      return element!;
    });
    await waitFor(() => expect(view.getByTestId("video-player").getAttribute("data-status")).toBe("streaming"));
    expect(audio.volume).toBe(0.2);
    releasePlanner();
  });

  it("fades soundtrack audio through Web Audio when iPhone Safari locks element volume", async () => {
    const { preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await preloadBuiltinTemplate("chapterTitle");
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const nextFrame = (time: number) => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queuedFrames.delete(id));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "volume", "get").mockReturnValue(1);
    vi.spyOn(HTMLMediaElement.prototype, "volume", "set").mockImplementation(() => undefined);

    const gain = { value: 1 };
    const sourceConnect = vi.fn();
    const gainConnect = vi.fn();
    const disconnect = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const createMediaElementSource = vi.fn(() => ({ connect: sourceConnect, disconnect }));
    const createGain = vi.fn(() => ({ gain, connect: gainConnect, disconnect }));
    // A real context starts suspended and reports "running" once resume()
    // settles. The player refuses to route audio through one that never gets
    // there, because that silences the element instead of fading it.
    const resume = vi.fn();
    class FakeAudioContext {
      readonly destination = {};
      state = "suspended";
      readonly createMediaElementSource = createMediaElementSource;
      readonly createGain = createGain;
      readonly close = close;
      readonly resume = async (): Promise<void> => {
        resume();
        this.state = "running";
      };
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      audio: {
        trackId: "soundtrack",
        audioUrl: "data:audio/wav;base64,UklGRg==",
        duration: 4,
        volume: 0.2,
        fadeOutMs: 2_000,
        beatDetection: { sensitivity: 0.5 },
        beatMarkers: [],
      },
      scenes: [{
        id: "saved",
        templateId: "chapterTitle",
        variables: { title: "update" },
        timing: { fixedDuration: 4 },
      }],
      style: TEST_VIDEO_STYLE,
    };
    const view = render(createElement(VideoPlayer, {
      video,
      playbackMode: "autoplay-after-interaction",
    }));

    fireEvent.click(view.getByRole("button", { name: "Play video with sound" }));
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createMediaElementSource).toHaveBeenCalledWith(view.container.querySelector("audio")));
    expect(sourceConnect).toHaveBeenCalledTimes(1);
    expect(gainConnect).toHaveBeenCalledTimes(1);
    expect(gain.value).toBe(0.2);

    act(() => nextFrame?.(performance.now() + 3_000));
    expect(gain.value).toBeCloseTo(0.1, 1);

    act(() => nextFrame?.(performance.now() + 4_000));
    expect(gain.value).toBe(0);
    expect(pause).toHaveBeenCalled();

    view.rerender(createElement(VideoPlayer, {
      video: {
        ...video,
        audio: { ...video.audio!, audioUrl: "data:audio/wav;base64,VklGRg==", volume: 0.4 },
      },
      playbackMode: "autoplay-after-interaction",
    }));
    await waitFor(() => expect(createMediaElementSource).toHaveBeenCalledTimes(2));
    expect(gain.value).toBe(0.4);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();

    view.unmount();
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(4));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes a primed audio context when the soundtrack disappears before lazy attachment", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "volume", "get").mockReturnValue(1);
    vi.spyOn(HTMLMediaElement.prototype, "volume", "set").mockImplementation(() => undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createMediaElementSource = vi.fn();
    const audio = document.createElement("audio");
    audio.src = "data:audio/wav;base64,UklGRg==";
    const output = await import("../src/player/control-visibility");

    output.default(audio, {
      close,
      createMediaElementSource,
    } as unknown as AudioContext);

    expect(createMediaElementSource).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("leaves audio on the element when the audio context never starts running", async () => {
    // iOS unlocks Web Audio only from a user gesture. Routing an element into
    // a context that stayed suspended does not fade it — it silences it, and
    // silence is a worse failure than an unfaded soundtrack.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "volume", "get").mockReturnValue(1);
    vi.spyOn(HTMLMediaElement.prototype, "volume", "set").mockImplementation(() => undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
    class StuckAudioContext {
      readonly destination = {};
      readonly state = "suspended";
      readonly close = close;
      readonly createMediaElementSource = createMediaElementSource;
      readonly createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }));
      readonly resume = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal("AudioContext", StuckAudioContext);

    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      audio: {
        trackId: "soundtrack",
        audioUrl: "data:audio/wav;base64,UklGRg==",
        duration: 4,
        volume: 0.2,
        fadeOutMs: 1_000,
        beatDetection: { sensitivity: 0.5 },
        beatMarkers: [],
      },
      style: TEST_VIDEO_STYLE,
      scenes: [{ id: "a", templateId: "brandMessage", variables: { texts: "Hi" }, timing: { fixedDuration: 2 } }],
    };
    const view = render(createElement(VideoPlayer, { video, autoPlay: false, startMuted: false }));
    await waitFor(() => expect(document.getElementById("vanillasky-player-control-visibility")).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Play video with sound" }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    // Never rewired, so the element keeps playing straight to the speakers.
    expect(createMediaElementSource).not.toHaveBeenCalled();
  });

  it("keeps cross-origin soundtracks on the media element when volume control is unavailable", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "volume", "get").mockReturnValue(1);
    vi.spyOn(HTMLMediaElement.prototype, "volume", "set").mockImplementation(() => undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const gain = { value: 1 };
    const createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
    class FakeAudioContext {
      readonly destination = {};
      state = "suspended";
      readonly close = close;
      readonly createMediaElementSource = createMediaElementSource;
      readonly createGain = vi.fn(() => ({ gain, connect: vi.fn(), disconnect: vi.fn() }));
      readonly resume = async (): Promise<void> => {
        this.state = "running";
      };
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      audio: {
        trackId: "soundtrack",
        audioUrl: "https://media.example.test/soundtrack.mp3",
        duration: 4,
        volume: 0.6,
        fadeOutMs: 2_000,
        beatDetection: { sensitivity: 0.5 },
        beatMarkers: [],
      },
      scenes: [{
        id: "saved",
        templateId: "chapterTitle",
        variables: { title: "update" },
        timing: { fixedDuration: 4 },
      }],
      style: TEST_VIDEO_STYLE,
    };
    const view = render(createElement(VideoPlayer, {
      video,
      autoPlay: false,
      startMuted: false,
    }));

    await waitFor(() => expect(document.getElementById("vanillasky-player-control-visibility")).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Play video with sound" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(createMediaElementSource).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(view.getByTestId("video-player").getAttribute("data-playing")).toBe("true");

    view.rerender(createElement(VideoPlayer, {
      video: {
        ...video,
        audio: { ...video.audio!, audioUrl: "data:audio/wav;base64,UklGRg==" },
      },
      autoPlay: false,
      startMuted: false,
    }));
    await waitFor(() => expect(createMediaElementSource).toHaveBeenCalledTimes(1));
    expect(gain.value).toBe(0.6);
    expect(close).not.toHaveBeenCalled();
  });

  it("pauses the player when the browser blocks audible autoplay", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("Autoplay blocked", "NotAllowedError"));
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({
      input: "Update",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () {
        yield { type: "scene.add" as const, scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 3 } } };
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      playbackMode: "autoplay-with-sound",
    }));

    await waitFor(() => expect(view.getByTestId("video-player").getAttribute("data-playing")).toBe("false"));
    expect(view.getByTestId("video-player").getAttribute("data-current-time")).toBe("0.000");
    expect(view.getByRole("button", { name: "Play video with sound" })).toBeDefined();
  });

  it("exposes soundtrack and fullscreen controls like a video player", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    const { VideoPlayer } = await import("../src/player/video-player");
    const response = createVideo({
      input: "Update",
      audio: { src: "data:audio/wav;base64,UklGRg==" },
    }, {
      generate: async function* () {
        yield {
          type: "scene.add" as const,
          scene: { id: "one", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 3 } },
        };
        yield { type: "plan.complete" as const };
      },
    });
    const view = render(createElement(VideoPlayer, {
      stream: response.stream,
      autoPlay: false,
      startMuted: true,
    }));

    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    expect(view.queryByText(/\d+:\d{2}\s*\/\s*\d+:\d{2}/)).toBeNull();
    expect(view.queryByRole("slider", { name: "Video response progress" })).toBeNull();
    const audio = view.container.querySelector("audio")!;
    expect(audio.muted).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Play video response" }));
    fireEvent.click(view.getByRole("button", { name: "Unmute video response" }));
    expect(audio.muted).toBe(false);
    expect(view.getByRole("button", { name: "Mute video response" })).toBeDefined();

    fireEvent.click(view.getByRole("button", { name: "Enter fullscreen" }));
    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));
  });

  it("uses prefixed fullscreen when the standard API is unavailable", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const webkitRequestFullscreen = vi.fn().mockResolvedValue(undefined);
    const webkitExitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
      configurable: true,
      value: webkitRequestFullscreen,
    });
    Object.defineProperty(document, "webkitFullscreenElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    Object.defineProperty(document, "webkitExitFullscreen", {
      configurable: true,
      value: webkitExitFullscreen,
    });
    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      scenes: [{ id: "saved", templateId: "chapterTitle", variables: { title: "update" }, timing: { fixedDuration: 3 } }],
      style: TEST_VIDEO_STYLE,
    };
    const view = render(createElement(VideoPlayer, { video, autoPlay: false }));

    fireEvent.click(view.getByRole("button", { name: "Play video response" }));
    fireEvent.click(view.getByRole("button", { name: "Enter fullscreen" }));

    await waitFor(() => expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1));
    Object.assign(document, { webkitFullscreenElement: view.getByTestId("video-player") });
    fireEvent(document, new Event("webkitfullscreenchange"));
    expect(view.getByTestId("video-player").getAttribute("data-fullscreen")).toBe("native");
    fireEvent.click(view.getByRole("button", { name: "Exit fullscreen" }));
    await waitFor(() => expect(webkitExitFullscreen).toHaveBeenCalledTimes(1));

    Object.assign(document, { webkitFullscreenElement: null });
    fireEvent(document, new Event("webkitfullscreenchange"));
    expect(view.getByTestId("video-player").getAttribute("data-fullscreen")).toBe("none");
    expect(view.getByRole("button", { name: "Enter fullscreen" })).toBeDefined();
  });

  it("falls back to a fixed mobile viewport and exits with the button or Escape", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException("Unavailable", "NotAllowedError")),
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
      configurable: true,
      value: undefined,
    });
    const { VideoPlayer } = await import("../src/player/video-player");
    const video: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      scenes: [{ id: "saved", templateId: "chapterTitle", variables: { title: "update" }, timing: { fixedDuration: 3 } }],
      style: TEST_VIDEO_STYLE,
    };
    const view = render(createElement(VideoPlayer, { video, autoPlay: false }));
    const player = view.getByTestId("video-player");
    fireEvent.click(view.getByRole("button", { name: "Play video response" }));

    fireEvent.click(view.getByRole("button", { name: "Enter fullscreen" }));
    await waitFor(() => expect(player.getAttribute("data-fullscreen")).toBe("fallback"));
    expect(document.body.style.overflow).toBe("hidden");
    const fullscreenStyles = document.getElementById("vanillasky-fullscreen")?.textContent;
    expect(fullscreenStyles).toContain("position: fixed");
    expect(fullscreenStyles).toContain("safe-area-inset-left");
    expect(fullscreenStyles).toContain("safe-area-inset-bottom");
    expect(fullscreenStyles).toContain("safe-area-inset-right");

    fireEvent.click(view.getByRole("button", { name: "Exit fullscreen" }));
    await waitFor(() => expect(player.getAttribute("data-fullscreen")).toBe("none"));
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(view.getByRole("button", { name: "Enter fullscreen" }));
    await waitFor(() => expect(player.getAttribute("data-fullscreen")).toBe("fallback"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(player.getAttribute("data-fullscreen")).toBe("none"));
    expect(document.body.style.overflow).toBe("");
  });

  it("reduces a canonical event stream into a responsive playable composition", async () => {
    let api: typeof import("../src/player/video-player") | undefined;
    try {
      api = await import("../src/player/video-player");
    } catch {
      // The assertion below is the expected red phase before the player exists.
    }
    expect(api?.VideoPlayer, "the streaming React player should exist").toBeDefined();
    if (!api?.VideoPlayer) return;

    const response = createVideo(
      {
        input: "Activation increased from 41% to 58%.",
        opening: "Your activation update is ready.",
      },
      {
        requestId: "request-player",
        runId: "run-player",
        generate: async function* () {
          yield {
            type: "scene.add" as const,
            scene: {
              id: "metric",
              templateId: "chapterTitle",
              variables: { title: "Activation reached 58%" },
              timing: { fixedDuration: 4 },
            },
          };
          yield { type: "plan.complete" as const, finishReason: "stop" as const };
        },
      },
    );

    const view = render(createElement(api.VideoPlayer, {
      stream: response.stream,
      autoPlay: false,
      width: 360,
    }));

    await waitFor(() => {
      expect(view.getByTestId("video-player").getAttribute("data-status")).toBe("complete");
    });

    const player = view.getByTestId("video-player");
    expect(player.getAttribute("data-scenes")).toBe("2");
    expect(player.style.width).toBe("360px");
    expect(player.style.height).toBe("640px");
    expect(player.querySelector('[data-template-id="chapterTitle"]')).not.toBeNull();
    expect(player.textContent).toContain("Your activation update is ready.");
    expect(view.queryByText("Video response could not finish")).toBeNull();
  });
});
