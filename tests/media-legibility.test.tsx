// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SceneBackground } from "../src/visual-system/scene-templates/scene-background";
describe("SceneBackground decoded media", () => {
  it("replaces a video poster with its decoded frame before playback", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});

    try {
      await act(async () => {
        root.render(
          createElement(SceneBackground, {
            progress: 0,
            mediaUrl: "https://cdn.test/clip.mp4",
            mediaType: "video",
            mediaPoster: "https://cdn.test/poster.jpg",
            isPlaying: false,
          }),
        );
      });

      const video = container.querySelector("video") as HTMLVideoElement;
      expect(video.getAttribute("poster")).toBe("https://cdn.test/poster.jpg");

      // An event before the browser selects this source cannot remove its
      // poster. jsdom does not perform native media resource selection.
      await act(async () => {
        video.dispatchEvent(new Event("loadeddata", { bubbles: true }));
      });
      expect(video.hasAttribute("poster")).toBe(true);

      Object.defineProperties(video, {
        currentSrc: { configurable: true, value: video.src },
        readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      });
      await act(async () => {
        video.dispatchEvent(new Event("loadeddata", { bubbles: true }));
      });

      expect(video.hasAttribute("poster")).toBe(false);
    } finally {
      await act(async () => root.unmount());
      pause.mockRestore();
      load.mockRestore();
      container.remove();
    }
  });

  it("does not retain a second poster raster behind an iPhone video frame", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    );
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});

    try {
      await act(async () => {
        root.render(
          createElement(SceneBackground, {
            progress: 0,
            mediaUrl: "https://cdn.test/second.mp4",
            mediaType: "video",
            mediaPoster: "https://cdn.test/second.jpg",
            isPlaying: true,
          }),
        );
      });

      const video = container.querySelector("video") as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      let presentFrame: (() => void) | undefined;
      video.requestVideoFrameCallback = vi.fn((callback: () => void) => {
        presentFrame = callback;
        return 1;
      });

      expect(play).toHaveBeenCalledTimes(1);
      expect(video.getAttribute("poster")).toBe("https://cdn.test/second.jpg");

      // Model the native state accompanying loadeddata; a src attribute alone
      // does not mean the browser has selected and decoded that resource.
      Object.defineProperties(video, {
        currentSrc: { configurable: true, value: video.src },
        readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      });
      await act(async () => {
        video.dispatchEvent(new Event("loadeddata", { bubbles: true }));
      });

      // loadeddata means bytes decoded, not that Mobile Safari has presented
      // the frame. Removing the poster here exposes the brand gradient.
      expect(video.getAttribute("poster")).toBe("https://cdn.test/second.jpg");

      await act(async () => {
        presentFrame?.();
      });

      expect(video.hasAttribute("poster")).toBe(false);
      // The previous workaround pinned the poster as the replaced video's CSS
      // background. That duplicates the raster on every browser without
      // proving that Safari keeps the replaced layer composited.
      expect(video.style.backgroundImage).toBe("");
    } finally {
      await act(async () => root.unmount());
      userAgent.mockRestore();
      play.mockRestore();
      pause.mockRestore();
      load.mockRestore();
      container.remove();
    }
  });
});
