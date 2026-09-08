// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Video } from "../src/protocol/types";
import { MountedReadinessContext } from "../src/player/mounted-scene-readiness";
import { VideoFrame } from "../src/player/video-frame";
import { preloadBuiltinTemplate } from "../src/visual-system/catalog/builtin-player";
import { SceneVideoBackdrop } from "../src/visual-system/scene-templates/scene-video-backdrop";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";

beforeAll(async () => { await preloadBuiltinTemplate("cinemaMedia"); await preloadBuiltinTemplate("chapterTitle"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("VideoFrame media handoff", () => {
  it.each(["video", "photo"])("continues on a mounted grounded fallback after resolved %s fails to decode", async (mediaType) => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    await Promise.all([preloadBuiltinTemplate("cinemaMedia"), preloadBuiltinTemplate("chapterTitle")]);
    const report = vi.fn();
    const scene = { id: "failed", templateId: "cinemaMedia", variables: {
      mediaUrl: "https://media.example/broken.mp4", mediaType, fallbackText: "A changing shoreline",
    }, narration: "As the water becomes shallower, the wave slows and grows steeper.", timing: { fixedDuration: 5 } };
    const config: Video = { schemaVersion: "0.2", orientation: "portrait", style: TEST_VIDEO_STYLE, scenes: [scene] };
    try {
      const view = render(createElement(MountedReadinessContext.Provider, { value: report },
        createElement(VideoFrame, { config, time: 1, width: 540, height: 960, playing: true })));
      const selector = mediaType === "video" ? "video" : "img[data-media-position]";
      await waitFor(() => expect(view.container.querySelector(selector)).not.toBeNull());
      fireEvent.error(view.container.querySelector(selector)!);
      await waitFor(() => expect(view.container.textContent).toContain("A changing shoreline"));
      await waitFor(() => expect(report).toHaveBeenCalledWith("failed\0https://media.example/broken.mp4", undefined, false));
      expect(view.container.textContent).not.toContain(scene.narration);
      expect(view.container.querySelectorAll("video")).toHaveLength(0);
      view.unmount();
    } finally { play.mockRestore(); pause.mockRestore(); load.mockRestore(); }
  });

  it("retains the active photo fallback when an incoming Safari video also fails", async () => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    );
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    await Promise.all([preloadBuiltinTemplate("cinemaMedia"), preloadBuiltinTemplate("chapterTitle")]);
    const config: Video = { schemaVersion: "0.2", orientation: "portrait", style: TEST_VIDEO_STYLE, scenes: [
      { id: "photo", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.example/broken.jpg", mediaType: "photo", fallbackText: "A changing shoreline" }, timing: { fixedDuration: 5 } },
      { id: "video", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.example/broken.mp4", mediaType: "video", fallbackText: "A new perspective" }, timing: { fixedDuration: 5 } },
    ] };
    const element = (time: number) => createElement(VideoFrame, { config, time, width: 540, height: 960, playing: true });
    try {
      const view = render(element(1));
      fireEvent.error(view.container.querySelector("img[data-media-position]")!);
      await waitFor(() => expect(view.container.textContent).toContain("A changing shoreline"));
      view.rerender(element(4));
      await waitFor(() => expect(view.container.querySelector("[data-layer-scene-id='video'] video")).not.toBeNull());
      fireEvent.error(view.container.querySelector("video")!);
      await waitFor(() => expect(view.container.querySelector("video")).toBeNull());
      expect(view.container.querySelector("[data-layer-scene-id='photo']")?.textContent).toContain("A changing shoreline");
      expect(view.container.querySelector("img[data-media-position]")).toBeNull();
      view.rerender(element(5.5));
      expect(view.container.querySelector("[data-layer-scene-id='video']")?.textContent).toContain("A new perspective");
      view.unmount();
    } finally { userAgent.mockRestore(); play.mockRestore(); pause.mockRestore(); load.mockRestore(); }
  });

  it("restores a video source after the Strict Mode effect rehearsal", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});

    try {
      const view = render(createElement(
        StrictMode,
        null,
        createElement(SceneVideoBackdrop, {
          mediaUrl: "https://media.example/generated.mp4",
          mediaPoster: "https://media.example/generated.jpg",
          progress: 0,
          isPlaying: true,
        }),
      ));

      expect(view.container.querySelector("video")?.getAttribute("src"))
        .toBe("https://media.example/generated.mp4");
      expect(play).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally {
      cleanup();
      play.mockRestore();
      pause.mockRestore();
      load.mockRestore();
    }
  });

  it("unmutes only the active scene while the next native-audio video prerolls", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        {
          id: "outgoing",
          templateId: "cinemaMedia",
          variables: { mediaUrl: "outgoing.mp4", mediaType: "video" },
          timing: { fixedDuration: 5 },
        },
        {
          id: "incoming",
          templateId: "cinemaMedia",
          variables: { mediaUrl: "incoming.mp4", mediaType: "video" },
          timing: { fixedDuration: 5 },
        },
      ],
    };

    try {
      const view = render(createElement(VideoFrame, {
        config,
        time: 4.85,
        width: 540,
        height: 960,
        playing: true,
        mediaAudioMuted: false,
        mediaAudioVolume: 0.35,
      }));
      await waitFor(() => expect(view.container.querySelectorAll("video")).toHaveLength(2));
      expect(view.container.querySelector<HTMLVideoElement>('[data-scene-layer="active"] video')?.muted)
        .toBe(false);
      expect(view.container.querySelector<HTMLVideoElement>('[data-scene-layer="incoming"] video')?.muted)
        .toBe(true);
      expect(Array.from(view.container.querySelectorAll("video"), (video) => video.volume))
        .toEqual([0.35, 0.35]);
    } finally {
      cleanup();
      play.mockRestore();
      pause.mockRestore();
      load.mockRestore();
    }
  });

  it("hydrates the desktop server snapshot before applying the iPhone decoder policy", async () => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
    );
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: TEST_VIDEO_STYLE,
      scenes: [{
        id: "hydrated-video",
        templateId: "cinemaMedia",
        variables: { mediaUrl: "first.mp4", mediaType: "video", mediaPoster: "first.jpg" },
        timing: { fixedDuration: 5 },
      }],
    };
    const element = createElement(VideoFrame, {
      config,
      time: 2,
      width: 540,
      height: 960,
      playing: true,
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    // Browsers initialize the current muted state from the server-rendered
    // attribute. jsdom only reflects it through defaultMuted, so align the
    // emulated media property before hydration.
    container.querySelectorAll("video").forEach((video) => {
      video.muted = true;
    });
    document.body.append(container);
    userAgent.mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    );
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    try {
      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
        await Promise.resolve();
      });

      expect(recoverableErrors).toEqual([]);
      await waitFor(() => {
        expect(container.querySelector('[data-video-backdrop="scene"]')).not.toBeNull();
      });
      expect(container.querySelectorAll("video")).toHaveLength(1);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      userAgent.mockRestore();
      play.mockRestore();
      pause.mockRestore();
      load.mockRestore();
    }
  });

  it("keeps the normal poster until the selected resource presents its frame", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const onReady = vi.fn();
    const view = render(createElement(SceneVideoBackdrop, {
      mediaUrl: "second.mp4", mediaPoster: "second.jpg", progress: 0, isPlaying: false, onReady,
    }));
    try {
      const video = view.container.querySelector("video")!;
      let presentFrame: (() => void) | undefined;
      video.requestVideoFrameCallback = vi.fn(callback => { presentFrame = () => callback(0, {} as VideoFrameCallbackMetadata); return 1; });
      Object.defineProperty(video, "currentSrc", { configurable: true, value: new URL("first.mp4", document.baseURI).href });
      act(() => video.dispatchEvent(new Event("loadeddata", { bubbles: true })));
      act(() => presentFrame?.());
      expect(onReady).not.toHaveBeenCalled();
      expect(video.getAttribute("poster")).toBe("second.jpg");
      Object.defineProperties(video, {
        currentSrc: { configurable: true, value: video.src },
        readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      });
      act(() => presentFrame?.());
      expect(onReady).toHaveBeenCalledOnce();
      expect(video.hasAttribute("poster")).toBe(false);
      expect(view.container.querySelectorAll("img")).toHaveLength(0);
    } finally { view.unmount(); pause.mockRestore(); load.mockRestore(); }
  });

  it("prepares at most the active and next known video on iPhone Safari", () => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    );
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "first-video", templateId: "cinemaMedia", variables: { mediaUrl: "first.mp4", mediaType: "video" }, timing: { fixedDuration: 5 } },
        { id: "second-video", templateId: "cinemaMedia", variables: { mediaUrl: "second.mp4", mediaType: "video" }, timing: { fixedDuration: 5 } },
      ],
    };

    let view: ReturnType<typeof render> | undefined;
    try {
      view = render(createElement(VideoFrame, { config, time: 4.2, width: 540, height: 960 }));
      expect(view.container.querySelectorAll("video")).toHaveLength(2);
      expect(view.container.querySelector('[data-scene-layer="incoming"]')).not.toBeNull();
      expect(view.container.querySelector("[data-media-treatment]")).toBeNull();

      const video = view.container.querySelector("video");
      let presentFrame: (() => void) | undefined;
      if (video) {
        Object.defineProperties(video, {
          currentSrc: { configurable: true, value: video.src },
          readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
        });
        video.requestVideoFrameCallback = vi.fn((callback: () => void) => {
          presentFrame = callback;
          return 1;
        });
      }
      act(() => video?.dispatchEvent(new Event("loadeddata", { bubbles: true })));
      expect(view.container.querySelector("[data-media-treatment]")).toBeNull();
      act(() => presentFrame?.());
      expect(view.container.querySelector("[data-media-treatment]")).toBeNull();

      view.rerender(createElement(VideoFrame, { config, time: 4.85, width: 540, height: 960 }));
      expect(view.container.querySelectorAll("video")).toHaveLength(2);
      expect(view.container.querySelector('[data-scene-layer="incoming"]')).not.toBeNull();

      view.rerender(createElement(VideoFrame, { config, time: 5, width: 540, height: 960 }));
      expect(view.container.querySelectorAll("video")).toHaveLength(1);
      expect(view.container.querySelector('[data-layer-scene-id="second-video"]')).not.toBeNull();
      const repeated: Video = { ...config, style: { ...config.style, defaultTransition: undefined }, scenes: config.scenes.map(scene => ({ ...scene, variables: { ...scene.variables, mediaUrl: "shared.mp4" } })) };
      view.rerender(createElement(VideoFrame, { config: repeated, time: 1, width: 540, height: 960 }));
      // Reusing a URL must still prepare the next keyed scene even without a
      // visual blend; the resource may be cached but the next element is new.
      expect(view.container.querySelectorAll("video")).toHaveLength(2);
    } finally {
      view?.unmount();
      userAgent.mockRestore();
      pause.mockRestore();
      load.mockRestore();
    }
  });

  it("promotes the prepared mobile node and releases resources on seek, pause and unmount", () => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    );
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        {
          id: "first-video",
          templateId: "cinemaMedia",
          variables: { mediaUrl: "first.mp4", mediaType: "video", mediaPoster: "first.jpg" },
          timing: { fixedDuration: 5 },
        },
        {
          id: "second-video",
          templateId: "cinemaMedia",
          variables: { mediaUrl: "second.mp4", mediaType: "video", mediaPoster: "second.jpg" },
          timing: { fixedDuration: 5 },
        },
      ],
    };

    let view: ReturnType<typeof render> | undefined;
    try {
      const element = (time: number, playing = true, scenes = config.scenes) => createElement(VideoFrame, {
        config: { ...config, scenes }, time, width: 540, height: 960, playing,
      });
      view = render(element(2, true, [config.scenes[0]]));
      const firstVideo = view.container.querySelector("video")!;
      // A streamed append retains the live node while creating only next.
      view.rerender(element(2));
      const prepared = view.container.querySelector<HTMLVideoElement>('[data-layer-scene-id="second-video"] video')!;
      expect(view.container.querySelector("video")).toBe(firstVideo);
      expect(prepared).not.toBeNull();
      expect(view.container.querySelectorAll("video")).toHaveLength(2);
      expect(play.mock.instances).toContain(prepared);
      view.rerender(element(2, false));
      expect(pause.mock.instances).toContain(firstVideo);
      expect(view.container.querySelector('[data-layer-scene-id="second-video"] video')).toBe(prepared);
      view.rerender(element(2));
      expect(play.mock.instances).toContain(firstVideo);
      Object.defineProperties(prepared, { currentSrc: { configurable: true, value: prepared.src }, readyState: { configurable: true, value: 3 } });
      act(() => prepared.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
      view.rerender(element(5));
      expect(view.container.querySelector("video")).toBe(prepared);
      expect(play.mock.instances).toContain(prepared);
      expect(firstVideo.isConnected).toBe(false);
      expect(firstVideo.hasAttribute("src")).toBe(false);
      expect(load.mock.instances).toContain(firstVideo);
      expect(view.container.querySelectorAll("video")).toHaveLength(1);

      // Seeking back creates just the missing prior node and retains the
      // already mounted next node; the now-incoming video is paused.
      view.rerender(element(1));
      const recreatedFirst = view.container.querySelector<HTMLVideoElement>('[data-layer-scene-id="first-video"] video')!;
      expect(recreatedFirst).not.toBe(firstVideo);
      expect(view.container.querySelector('[data-layer-scene-id="second-video"] video')).toBe(prepared);
      expect(pause.mock.instances).toContain(prepared);
      expect(view.container.querySelectorAll("video")).toHaveLength(2);
      Object.defineProperties(prepared, { currentSrc: { configurable: true, value: prepared.src }, readyState: { configurable: true, value: 3 } });
      act(() => prepared.dispatchEvent(new Event("vanillasky:video-frame-presented", { bubbles: true })));
      view.rerender(element(5));
      expect(view.container.querySelector("video")).toBe(prepared);
      expect(recreatedFirst.hasAttribute("src")).toBe(false);
      // Cancelling/removing the player releases every remaining source.
      view.unmount();
      expect(prepared.hasAttribute("src")).toBe(false);
      expect(load.mock.instances).toContain(prepared);
    } finally {
      view?.unmount();
      userAgent.mockRestore(); play.mockRestore(); pause.mockRestore(); load.mockRestore();
    }
  });

});
