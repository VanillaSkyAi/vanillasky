// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  getMediaTreatmentLayers,
  SceneBackground,
} from "../src/visual-system/scene-templates/scene-background";
import { MediaSceneTemplate } from "../src/visual-system/scene-templates/cinema-media";
import { TEST_VIDEO_STYLE as style } from "./semantic-brand-fixture";

const TREATMENTS = ["subtle", "cinematic", "text-safe"];

function alphaStops(background: string): number[] {
  return [...background.matchAll(/rgba\(0,0,0,([\d.]+)\)/g)].map((m) =>
    Number(m[1]),
  );
}

function render(variables: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(MediaSceneTemplate, {
      variables,
      style,
      progress: 0.5,
      beatIntensity: 0,
      width: 1080,
      height: 1920,
      safeZone: { top: 100, right: 60, bottom: 100, left: 60 },
      sceneDuration: 4,
      isPlaying: false,
    }),
  );
}

describe("media scrims", () => {
  it("ramps every scrim off an eased curve rather than a two-stop linear fade", () => {
    for (const treatment of TREATMENTS) {
      for (const layer of getMediaTreatmentLayers(treatment)) {
        const stops = alphaStops(layer.background);
        // A linear fade is two stops. An eased ramp needs the intermediate
        // samples that keep the fade-out from ending on a visible band.
        expect(stops.length, `${treatment}/${layer.id}`).toBeGreaterThanOrEqual(6);

        // Smoothstep is flat at both ends: the steepest step sits in the
        // middle of the ramp, never at its start or end.
        const deltas = stops
          .slice(1)
          .map((value, index) => Math.abs(value - stops[index]));
        const steepest = deltas.indexOf(Math.max(...deltas));
        expect(steepest, `${treatment}/${layer.id}`).toBeGreaterThan(0);
        expect(steepest, `${treatment}/${layer.id}`).toBeLessThan(
          deltas.length - 1,
        );
      }
    }
  });

  it("shapes the scrim to the copy instead of washing the whole frame", () => {
    const centered = getMediaTreatmentLayers("text-safe", "center");
    expect(centered.map((layer) => layer.id)).toEqual([
      "vignette",
      "center-scrim",
    ]);

    const lower = getMediaTreatmentLayers("text-safe", "bottom");
    expect(lower.map((layer) => layer.id)).toEqual(["vignette", "bottom-scrim"]);

    // No recipe may darken the entire frame uniformly.
    for (const treatment of TREATMENTS) {
      for (const layer of getMediaTreatmentLayers(treatment)) {
        expect(layer.background).toMatch(/gradient\(/);
      }
    }
  });

  it("keeps full-bleed free of headlines and arbitrary darkening", () => {
    const markup = render({texts:"No headline",mediaUrl:"https://cdn.test/a.jpg",mediaType:"photo"});
    expect(markup).not.toContain("No headline");
    expect(markup).not.toContain('data-media-overlay=');
  });
});

interface StubProbe {
  succeed: () => void;
  fail: () => void;
}

/** Stand in for the photo probe: jsdom does not fetch, so tests drive it. */
function stubImageProbe(): StubProbe[] {
  const probes: StubProbe[] = [];
  class ProbeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = false;
    naturalWidth = 0;
    set src(_value: string) {
      probes.push({
        succeed: () => this.onload?.(),
        fail: () => this.onerror?.(),
      });
    }
  }
  globalThis.Image = ProbeImage as unknown as typeof Image;
  return probes;
}

function mountBgMedia(
  root: { render: (node: ReturnType<typeof createElement>) => void },
  variables: Record<string, unknown>,
): void {
  root.render(
    createElement(SceneBackground, {
      ...variables,
      style,
      progress: 0.5,
      beatIntensity: 0,
      width: 1080,
      height: 1920,
      sceneDuration: 4,
      isPlaying: false,
    }),
  );
}

describe("media that never paints", () => {
  // React requires this flag before act(...) drives a concurrent root.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  it("drops the scrim when the photo fails to load, leaving a clean gradient", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // jsdom does not fetch, so drive the probe's failure path directly.
    const probes = stubImageProbe();
    const RealImage = globalThis.Image;

    try {
      await act(async () => {
        root.render(
          createElement(MediaSceneTemplate, {
            variables: { texts: "Autumn", mediaUrl: "https://cdn.test/missing.jpg" },
            style,
            progress: 0.5,
            beatIntensity: 0,
            width: 1080,
            height: 1920,
            safeZone: { top: 100, right: 60, bottom: 100, left: 60 },
            sceneDuration: 4,
            isPlaying: false,
          }),
        );
      });

      await act(async () => {
        probes.forEach((probe) => probe.fail());
      });

      // No scrim, no media layer — just the brand gradient the scene falls
      // back to, identical to every other gradient-backed template.
      expect(container.querySelectorAll("[data-media-overlay]").length).toBe(0);
      expect(container.querySelectorAll("[data-media-position]").length).toBe(0);
    } finally {
      await act(async () => root.unmount());
      globalThis.Image = RealImage;
      container.remove();
    }
  });
});

describe("media still loading", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  it("holds the scrim back until the photo lands, then shows both together", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const probes = stubImageProbe();
    const RealImage = globalThis.Image;

    try {
      await act(async () => {
        mountBgMedia(root, {
          texts: "Autumn",
          mediaUrl: "https://cdn.test/slow.jpg",
        });
      });

      // Still loading: the brand gradient is on its own, exactly as it looks
      // in a scene that never asked for media at all.
      expect(container.querySelectorAll("[data-media-overlay]").length).toBe(0);

      await act(async () => {
        probes.forEach((probe) => probe.succeed());
      });

      // The picture arrives and the scrim arrives with it — one commit, so
      // there is no frame showing either one without the other.
      expect(
        container.querySelectorAll("[data-media-overlay]").length,
      ).toBeGreaterThan(0);
      expect(container.querySelectorAll("[data-media-position]").length).toBe(1);
    } finally {
      await act(async () => root.unmount());
      globalThis.Image = RealImage;
      container.remove();
    }
  });

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
            style,
            progress: 0,
            width: 1080,
            height: 1920,
            mediaUrl: "https://cdn.test/clip.mp4",
            mediaType: "video",
            mediaPoster: "https://cdn.test/poster.jpg",
            backgroundEffect: "static",
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
            style,
            progress: 0,
            width: 1080,
            height: 1920,
            mediaUrl: "https://cdn.test/second.mp4",
            mediaType: "video",
            mediaPoster: "https://cdn.test/second.jpg",
            backgroundEffect: "static",
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
