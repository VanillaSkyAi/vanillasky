// @vitest-environment jsdom

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, lazy, StrictMode, useEffect } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Video } from "../src/internal";
import { MountedReadinessContext } from "../src/player/mounted-scene-readiness";
import { VideoFrame } from "../src/player/video-frame";
import {
  createRenderTemplateRegistry,
  defineTemplate,
} from "../src/visual-system/catalog/internal";
import { markExternalVideoBackdropTemplate } from "../src/visual-system/catalog/video-backdrop-capability";
import {
  SceneBackground,
  SceneVideoBackdrop,
} from "../src/visual-system/scene-templates/scene-background";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";

describe("VideoFrame transition ownership", () => {
  it.each(["video", "photo"])("continues on a mounted grounded fallback after resolved %s fails to decode", async (mediaType) => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const { BUILTIN_PLAYER_KIT, preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await Promise.all([preloadBuiltinTemplate("cinemaMedia"), preloadBuiltinTemplate("chapterTitle")]);
    const report = vi.fn();
    const scene = { id: "failed", templateId: "cinemaMedia", variables: {
      mediaUrl: "https://media.example/broken.mp4", mediaType, fallbackText: "A changing shoreline",
    }, narration: "As the water becomes shallower, the wave slows and grows steeper.", timing: { fixedDuration: 5 } };
    const config: Video = { schemaVersion: "0.2", orientation: "portrait", style: TEST_VIDEO_STYLE, scenes: [scene] };
    try {
      const view = render(createElement(MountedReadinessContext.Provider, { value: report },
        createElement(VideoFrame, { kit: BUILTIN_PLAYER_KIT, config, time: 1, width: 540, height: 960, playing: true })));
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
    const { BUILTIN_PLAYER_KIT, preloadBuiltinTemplate } = await import("../src/visual-system/catalog/builtin-player");
    await Promise.all([preloadBuiltinTemplate("cinemaMedia"), preloadBuiltinTemplate("chapterTitle")]);
    const config: Video = { schemaVersion: "0.2", orientation: "portrait", style: TEST_VIDEO_STYLE, scenes: [
      { id: "photo", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.example/broken.jpg", mediaType: "photo", fallbackText: "A changing shoreline" }, timing: { fixedDuration: 5 } },
      { id: "video", templateId: "cinemaMedia", variables: { mediaUrl: "https://media.example/broken.mp4", mediaType: "video", fallbackText: "A new perspective" }, timing: { fixedDuration: 5 } },
    ] };
    const element = (time: number) => createElement(VideoFrame, { kit: BUILTIN_PLAYER_KIT, config, time, width: 540, height: 960, playing: true });
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
      play.mockRestore();
      pause.mockRestore();
      load.mockRestore();
    }
  });

  it("unmutes only the active scene while the next native-audio video prerolls", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const media = defineTemplate({
      id: "native-audio-media",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: {
        type: "object",
        properties: {
          mediaUrl: { type: "string" },
          mediaType: { type: "string", enum: ["video"] },
        },
        required: ["mediaUrl", "mediaType"],
        additionalProperties: false,
      },
      component: ({ variables, style, progress, width, height, isPlaying }) => createElement(
        SceneBackground,
        {
          style,
          progress,
          width,
          height,
          mediaUrl: String(variables.mediaUrl),
          mediaType: "video",
          backgroundEffect: "static",
          isPlaying,
        },
      ),
    });
    const kit = createRenderTemplateRegistry({ templates: [media] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        {
          id: "outgoing",
          templateId: media.id,
          variables: { mediaUrl: "outgoing.mp4", mediaType: "video" },
          timing: { fixedDuration: 5 },
        },
        {
          id: "incoming",
          templateId: media.id,
          variables: { mediaUrl: "incoming.mp4", mediaType: "video" },
          timing: { fixedDuration: 5 },
        },
      ],
    };

    try {
      const view = render(createElement(VideoFrame, {
        kit,
        config,
        time: 4.85,
        width: 540,
        height: 960,
        playing: true,
        mediaAudioMuted: false,
        mediaAudioVolume: 0.35,
      }));
      await waitFor(() => expect(view.container.querySelectorAll("video")).toHaveLength(2));
      expect(view.container.querySelector<HTMLVideoElement>('[data-scene-layer="outgoing"] video')?.muted)
        .toBe(false);
      expect(view.container.querySelector<HTMLVideoElement>('[data-scene-layer="incoming"] video')?.muted)
        .toBe(true);
      expect(Array.from(view.container.querySelectorAll("video"), (video) => video.volume))
        .toEqual([0.35, 0.35]);
    } finally {
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
    const media = markExternalVideoBackdropTemplate(defineTemplate({
      id: "hydrated-media",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: {
        type: "object",
        properties: {
          mediaUrl: { type: "string" },
          mediaType: { type: "string", enum: ["video"] },
          mediaPoster: { type: "string" },
        },
        required: ["mediaUrl", "mediaType", "mediaPoster"],
        additionalProperties: false,
      },
      component: ({ variables, style, progress, width, height, isPlaying }) => createElement(
        SceneBackground,
        {
          style,
          progress,
          width,
          height,
          mediaUrl: String(variables.mediaUrl),
          mediaType: "video",
          mediaPoster: String(variables.mediaPoster),
          backgroundEffect: "static",
          isPlaying,
        },
      ),
    }));
    const kit = createRenderTemplateRegistry({ templates: [media] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: TEST_VIDEO_STYLE,
      scenes: [{
        id: "hydrated-video",
        templateId: media.id,
        variables: { mediaUrl: "first.mp4", mediaType: "video", mediaPoster: "first.jpg" },
        timing: { fixedDuration: 5 },
      }],
    };
    const element = createElement(VideoFrame, {
      kit,
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

  it("holds the final scene's readable poster pose instead of playing an exit and snapping back", () => {
    const final = defineTemplate({
      id: "terminal-poster",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: ({ progress, motionProgress }) => createElement("div", {
        "data-progress": progress.toFixed(3),
        "data-motion-progress": motionProgress?.toFixed(3),
      }),
    });
    const kit = createRenderTemplateRegistry({ templates: [final] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: TEST_VIDEO_STYLE,
      scenes: [{
        id: "final-scene",
        templateId: final.id,
        variables: {},
        timing: { fixedDuration: 5 },
      }],
    };
    const props = { kit, config, width: 540, height: 960 };
    const view = render(createElement(VideoFrame, { ...props, time: 4.99 }));
    expect(view.container.querySelector("[data-progress]")?.getAttribute("data-progress")).toBe("0.998");
    expect(view.container.querySelector("[data-motion-progress]")?.getAttribute("data-motion-progress")).toBe("0.700");

    view.rerender(createElement(VideoFrame, { ...props, time: 5 }));
    expect(view.container.querySelector("[data-progress]")?.getAttribute("data-progress")).toBe("1.000");
    expect(view.container.querySelector("[data-motion-progress]")?.getAttribute("data-motion-progress")).toBe("0.700");
  });

  it("keeps the incoming component mounted and makes only the dominant layer interactive", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const opening = defineTemplate({
      id: "opening",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: () => createElement("button", null, "Opening action"),
    });
    const incoming = defineTemplate({
      id: "incoming",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: () => {
        useEffect(() => {
          mounted();
          return unmounted;
        }, []);
        return createElement("button", null, "Incoming action");
      },
    });
    const kit = createRenderTemplateRegistry({ templates: [opening, incoming] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "opening-scene", templateId: "opening", variables: { mediaUrl: "opening.jpg" }, timing: { fixedDuration: 5 } },
        { id: "incoming-scene", templateId: "incoming", variables: { mediaUrl: "incoming.jpg" }, timing: { fixedDuration: 6 } },
      ],
    };
    const props = { kit, config, width: 540, height: 960 };
    const view = render(createElement(VideoFrame, { ...props, time: 0 }));
    expect(view.container.querySelector('[data-scene-layer="active"]')?.getAttribute("data-layer-scene-id")).toBe("opening-scene");
    view.rerender(createElement(VideoFrame, { ...props, time: 4.85 }));
    const outgoing = view.container.querySelector<HTMLElement>('[data-scene-layer="outgoing"]')!;
    const entering = view.container.querySelector<HTMLElement>('[data-scene-layer="incoming"]')!;
    expect({ zIndex: outgoing.style.zIndex, pointerEvents: outgoing.style.pointerEvents }).toEqual({
      zIndex: "1",
      pointerEvents: "auto",
    });
    expect(outgoing.hasAttribute("aria-hidden")).toBe(false);
    expect({ zIndex: entering.style.zIndex, pointerEvents: entering.style.pointerEvents }).toEqual({
      zIndex: "2",
      pointerEvents: "none",
    });
    expect(entering.getAttribute("aria-hidden")).toBe("true");
    expect(entering.hasAttribute("inert")).toBe(true);
    expect(mounted).toHaveBeenCalledTimes(1);

    view.rerender(createElement(VideoFrame, { ...props, time: 4.99 }));
    expect(view.container.querySelector('[data-scene-layer="outgoing"]')?.hasAttribute("aria-hidden")).toBe(false);
    expect(view.container.querySelector('[data-scene-layer="incoming"]')?.getAttribute("aria-hidden")).toBe("true");

    view.rerender(createElement(VideoFrame, { ...props, time: 5 }));
    expect(view.container.querySelector('[data-scene-layer="active"]')?.getAttribute("data-layer-scene-id")).toBe("incoming-scene");
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();

    // Scrub back out of the window entirely. It opens at the preroll, 1.2s
    // before the cut, not at the 0.3s blend.
    view.rerender(createElement(VideoFrame, { ...props, time: 3 }));
    expect(view.container.querySelector('[data-scene-layer="active"]')?.getAttribute("data-layer-scene-id")).toBe("opening-scene");
    expect(unmounted).toHaveBeenCalledTimes(1);

    view.rerender(createElement(VideoFrame, { ...props, time: 12 }));
    expect(view.container.querySelector('[data-scene-layer="active"]')?.getAttribute("data-layer-scene-id")).toBe("incoming-scene");
    expect(mounted).toHaveBeenCalledTimes(2);
  });

  it("mounts a backdrop scene early and invisibly so its media can decode before the cut", () => {
    const opening = defineTemplate({
      id: "opening",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: () => createElement("div", null, "Opening"),
    });
    const incoming = defineTemplate({
      id: "incoming",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: () => createElement("video", { src: "incoming.mp4" }),
    });
    const kit = createRenderTemplateRegistry({ templates: [opening, incoming] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "opening-scene", templateId: "opening", variables: { mediaUrl: "opening.jpg" }, timing: { fixedDuration: 5 } },
        { id: "incoming-scene", templateId: "incoming", variables: { mediaUrl: "incoming.mp4" }, timing: { fixedDuration: 6 } },
      ],
    };
    const props = { kit, config, width: 540, height: 960 };
    const view = render(createElement(VideoFrame, { ...props, time: 3 }));
    expect(view.container.querySelector('[data-scene-layer="incoming"]')).toBeNull();

    // Inside the preroll, outside the blend: the element exists and can start
    // decoding, while the frame on screen is untouched.
    view.rerender(createElement(VideoFrame, { ...props, time: 4.2 }));
    const early = view.container.querySelector<HTMLElement>('[data-scene-layer="incoming"]');
    expect(early).not.toBeNull();
    expect(early?.querySelector("video")).not.toBeNull();
    expect(early?.style.opacity).toBe("0");
    // The scene on screen is still the active one, not a fading outgoing one.
    const showing = view.container.querySelector<HTMLElement>('[data-scene-layer="active"]');
    expect(showing?.getAttribute("data-layer-scene-id")).toBe("opening-scene");
    expect(showing?.style.opacity).toBe("1");
    expect(showing?.style.pointerEvents).toBe("auto");

    // Once the blend opens the pair behaves exactly as before.
    view.rerender(createElement(VideoFrame, { ...props, time: 4.85 }));
    expect(view.container.querySelector('[data-scene-layer="outgoing"]')).not.toBeNull();
    expect(Number(view.container.querySelector<HTMLElement>('[data-scene-layer="incoming"]')?.style.opacity)).toBeGreaterThan(0);
  });

  it("prepares at most the active and next known video on iPhone Safari", () => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    );
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const media = markExternalVideoBackdropTemplate(defineTemplate({
      id: "mobile-video",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: {
        type: "object",
        properties: {
          mediaUrl: { type: "string" },
        },
        required: ["mediaUrl"],
        additionalProperties: false,
      },
      component: ({ variables, style, progress, width, height, isPlaying }) => createElement(
        SceneBackground,
        {
          style,
          progress,
          width,
          height,
          mediaUrl: String(variables.mediaUrl),
          mediaType: "video",
          backgroundEffect: "static",
          isPlaying,
        },
      ),
    }));
    const kit = createRenderTemplateRegistry({ templates: [media] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "first-video", templateId: media.id, variables: { mediaUrl: "first.mp4", mediaType: "video" }, timing: { fixedDuration: 5 } },
        { id: "second-video", templateId: media.id, variables: { mediaUrl: "second.mp4", mediaType: "video" }, timing: { fixedDuration: 5 } },
      ],
    };

    let view: ReturnType<typeof render> | undefined;
    try {
      view = render(createElement(VideoFrame, { kit, config, time: 4.2, width: 540, height: 960 }));
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
      expect(view.container.querySelector("[data-media-treatment]")).not.toBeNull();

      view.rerender(createElement(VideoFrame, { kit, config, time: 4.85, width: 540, height: 960 }));
      expect(view.container.querySelectorAll("video")).toHaveLength(2);
      expect(view.container.querySelector('[data-scene-layer="incoming"]')).not.toBeNull();

      view.rerender(createElement(VideoFrame, { kit, config, time: 5, width: 540, height: 960 }));
      expect(view.container.querySelectorAll("video")).toHaveLength(1);
      expect(view.container.querySelector('[data-layer-scene-id="second-video"]')).not.toBeNull();
      const repeated: Video = { ...config, style: { ...config.style, defaultTransition: undefined }, scenes: config.scenes.map(scene => ({ ...scene, variables: { ...scene.variables, mediaUrl: "shared.mp4" } })) };
      view.rerender(createElement(VideoFrame, { kit, config: repeated, time: 1, width: 540, height: 960 }));
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
    const scene = (id: string) => markExternalVideoBackdropTemplate(defineTemplate({
      id,
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: {
        type: "object",
        properties: {
          mediaUrl: { type: "string" },
          mediaType: { type: "string", enum: ["video"] },
          mediaPoster: { type: "string" },
        },
        required: ["mediaUrl", "mediaType", "mediaPoster"],
        additionalProperties: false,
      },
      component: ({ variables, style, progress, width, height, isPlaying }) => createElement(
        "div",
        {
          "data-template-surface": id,
          style: {
            width,
            height,
            position: "relative",
            backgroundColor: "var(--vanillasky-template-surface, #000)",
          },
        },
        createElement(SceneBackground, {
          style,
          progress,
          width,
          height,
          mediaUrl: String(variables.mediaUrl),
          mediaType: "video",
          mediaPoster: String(variables.mediaPoster),
          backgroundEffect: "static",
          isPlaying,
        }),
      ),
    }));
    const first = scene("first-template");
    const second = scene("second-template");
    const kit = createRenderTemplateRegistry({ templates: [first, second] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        {
          id: "first-video",
          templateId: first.id,
          variables: { mediaUrl: "first.mp4", mediaType: "video", mediaPoster: "first.jpg" },
          timing: { fixedDuration: 5 },
        },
        {
          id: "second-video",
          templateId: second.id,
          variables: { mediaUrl: "second.mp4", mediaType: "video", mediaPoster: "second.jpg" },
          timing: { fixedDuration: 5 },
        },
      ],
    };

    let view: ReturnType<typeof render> | undefined;
    try {
      const element = (time: number, playing = true, scenes = config.scenes) => createElement(VideoFrame, {
        kit, config: { ...config, scenes }, time, width: 540, height: 960, playing,
      });
      view = render(element(2, true, [config.scenes[0]]));
      const firstVideo = view.container.querySelector("video")!;
      // A streamed append retains the live node while creating only next.
      view.rerender(element(2));
      const prepared = view.container.querySelector<HTMLVideoElement>('[data-layer-scene-id="second-video"] video')!;
      expect(view.container.querySelector("video")).toBe(firstVideo);
      expect(prepared).not.toBeNull();
      expect(view.container.querySelectorAll("video")).toHaveLength(2);
      expect(play.mock.instances).not.toContain(prepared);
      view.rerender(element(2, false));
      expect(pause.mock.instances).toContain(firstVideo);
      expect(view.container.querySelector('[data-layer-scene-id="second-video"] video')).toBe(prepared);
      view.rerender(element(2));
      expect(play.mock.instances).toContain(firstVideo);
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

  it("does not add a player-owned decoder when a custom video template lacks the backdrop contract", () => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    );
    const rawVideo = defineTemplate({
      id: "raw-customer-video",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: {
        type: "object",
        properties: {
          mediaUrl: { type: "string" },
          mediaType: { type: "string", enum: ["video"] },
        },
        required: ["mediaUrl", "mediaType"],
        additionalProperties: false,
      },
      component: ({ variables }) => createElement("video", { src: String(variables.mediaUrl) }),
    });
    const kit = createRenderTemplateRegistry({ templates: [rawVideo] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: TEST_VIDEO_STYLE,
      scenes: [
        { id: "raw-one", templateId: rawVideo.id, variables: { mediaUrl: "one.mp4" }, timing: { fixedDuration: 5 } },
        { id: "raw-two", templateId: rawVideo.id, variables: { mediaUrl: "two.mp4" }, timing: { fixedDuration: 5 } },
      ],
    };

    try {
      const view = render(createElement(VideoFrame, { kit, config, time: 4.99, width: 540, height: 960 }));
      expect(view.container.querySelectorAll("video")).toHaveLength(1);
      expect(view.container.querySelector('[data-video-backdrop="persistent"]')).toBeNull();
    } finally {
      userAgent.mockRestore();
    }
  });

  it("prerolls an incoming backdrop even when either scene owns its own transition", () => {
    const selfTransitioning = defineTemplate({
      id: "self-transitioning",
      usesGlobalTransition: false,
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: () => createElement("div", null, "Self-transitioning scene"),
    });
    const media = defineTemplate({
      id: "incoming-media",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: () => createElement("video", { src: "incoming.mp4" }),
    });
    const kit = createRenderTemplateRegistry({ templates: [selfTransitioning, media] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "self-transitioning-scene", templateId: selfTransitioning.id, variables: {}, timing: { fixedDuration: 5 } },
        { id: "media-scene", templateId: media.id, variables: { mediaUrl: "incoming.mp4", mediaType: "video" }, timing: { fixedDuration: 5 } },
      ],
    };
    const props = { kit, config, width: 540, height: 960 };
    const view = render(createElement(VideoFrame, { ...props, time: 4.2 }));

    const active = view.container.querySelector<HTMLElement>('[data-scene-layer="active"]');
    const incoming = view.container.querySelector<HTMLElement>('[data-scene-layer="incoming"]');
    expect(active?.getAttribute("data-layer-scene-id")).toBe("self-transitioning-scene");
    expect(active?.style.opacity).toBe("1");
    expect(incoming?.getAttribute("data-layer-scene-id")).toBe("media-scene");
    expect(incoming?.querySelector("video")).not.toBeNull();
    expect(incoming?.style.opacity).toBe("0");
  });

  it("preserves a suspense-resolved media node from incoming transition through settlement", async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const opening = defineTemplate({
      id: "opening-media-probe",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: () => createElement("div", null, "Opening"),
    });
    const LazyMedia = lazy(async () => ({
      default: () => {
        useEffect(() => {
          mounted();
          return unmounted;
        }, []);
        return createElement("video", { "data-testid": "transition-media", muted: true });
      },
    }));
    const media = defineTemplate({
      id: "incoming-media-probe",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: () => createElement(LazyMedia),
    });
    const kit = createRenderTemplateRegistry({ templates: [opening, media] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "opening", templateId: opening.id, variables: { mediaUrl: "opening.jpg" }, timing: { fixedDuration: 5 } },
        { id: "media", templateId: media.id, variables: { mediaUrl: "incoming.mp4", mediaType: "video" }, timing: { fixedDuration: 5 } },
      ],
    };
    const props = { kit, config, width: 540, height: 960 };
    const view = render(createElement(VideoFrame, { ...props, time: 4.85 }));
    const transitioningNode = await view.findByTestId("transition-media");
    await waitFor(() => expect(mounted).toHaveBeenCalledTimes(1));

    view.rerender(createElement(VideoFrame, { ...props, time: 5 }));
    expect(view.getByTestId("transition-media")).toBe(transitioningNode);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();

    view.rerender(createElement(VideoFrame, { ...props, time: 3 }));
    expect(unmounted).toHaveBeenCalledTimes(1);
  });
});
