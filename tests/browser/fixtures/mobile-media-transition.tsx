import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Video } from "../../../src/internal";
import { VideoPlayer } from "../../../src/player/video-player";
import { TEST_VIDEO_STYLE } from "../../semantic-brand-fixture";
import waterfallVideo from "./media-transition/waterfall.mp4?url";
import tramVideo from "./media-transition/tram.mp4?url";
import sunflowersVideo from "./media-transition/sunflowers.mp4?url";
import waterfallWebm from "./media-transition/waterfall-hold.webm?url";
import tramWebm from "./media-transition/tram.webm?url";
import sunflowersWebm from "./media-transition/sunflowers.webm?url";
import waterfallPoster from "./media-transition/waterfall.jpg?url";
import tramPoster from "./media-transition/tram.jpg?url";
import sunflowersPoster from "./media-transition/sunflowers.jpg?url";

// Short, same-origin derivatives of real vertical Pexels footage keep this a
// compositor/decoder probe instead of accidentally making it a CDN test.
// Sources:
// - https://www.pexels.com/video/serene-waterfall-flowing-through-forest-37625941/
// - https://www.pexels.com/video/urban-tram-moving-on-rainy-city-street-36365686/
// - https://www.pexels.com/video/close-up-of-yellow-sunflowers-10449364/
// Every source is normalized to 360×640 H.264, 30fps, five seconds, with a
// poster extracted from frame zero. New filenames also avoid an iPhone cache
// hit from the first physical-device test set.

type ProbeEntry = { at: number; kind: string; [key: string]: unknown };
type ProbeInput = { kind: string; [key: string]: unknown };

declare global {
  interface Window {
    __mobileMediaTransitionProbe?: ProbeEntry[];
  }
}

const webm = new URLSearchParams(location.search).has("webm");
document.body.dataset.fixtureCodec = webm ? "VP8" : "H264";
const probeVideo: Video = {
  schemaVersion: "0.2",
  orientation: "portrait",
  style: {
    ...TEST_VIDEO_STYLE,
    defaultBackgroundEffect: "static",
    defaultTransition: "crossfade",
  },
  scenes: [
    {
      id: "first-video",
      templateId: "cinemaMedia",
      variables: {
        mediaUrl: webm ? waterfallWebm : waterfallVideo,
        fallbackText: "Water keeps moving",
        mediaType: "video",
        mediaPoster: waterfallPoster,
      },
      timing: { fixedDuration: 4 },
    },
    {
      id: "second-video",
      templateId: "cinemaMedia",
      variables: {
        mediaUrl: webm ? tramWebm : tramVideo,
        fallbackText: "The tram crosses the city",
        mediaType: "video",
        mediaPoster: tramPoster,
      },
      timing: { fixedDuration: 4 },
    },
    {
      id: "third-video",
      templateId: "cinemaMedia",
      variables: {
        mediaUrl: webm ? sunflowersWebm : sunflowersVideo,
        fallbackText: "Flowers turn toward the light",
        mediaType: "video",
        mediaPoster: sunflowersPoster,
      },
      timing: { fixedDuration: 4 },
    },
  ],
};

if (new URLSearchParams(window.location.search).has("noPoster")) {
  for (const scene of probeVideo.scenes) delete scene.variables.mediaPoster;
}

const mediaEvents = [
  "loadstart", "loadedmetadata", "loadeddata", "canplay", "play", "playing",
  "waiting", "stalled", "suspend", "emptied", "abort", "error",
] as const;

function Probe() {
  const diagnosticsEnabled = document.body.dataset.diagnostics !== "off" &&
    new URLSearchParams(window.location.search).get("diagnostics") !== "off";
  useEffect(() => {
    if (!diagnosticsEnabled) {
      delete window.__mobileMediaTransitionProbe;
      return;
    }
    const log: ProbeEntry[] = [];
    window.__mobileMediaTransitionProbe = log;
    const videoIds = new WeakMap<HTMLVideoElement, number>();
    const observed = new WeakSet<HTMLVideoElement>();
    let nextVideoId = 1;
    let frame = 0;
    let lastSnapshot = "";
    const output = document.querySelector("pre");

    const videoId = (video: HTMLVideoElement) => {
      let id = videoIds.get(video);
      if (!id) {
        id = nextVideoId;
        nextVideoId += 1;
        videoIds.set(video, id);
        video.dataset.probeVideoId = String(id);
      }
      return id;
    };
    const push = (entry: ProbeInput) => {
      log.push({ at: Math.round(performance.now() * 10) / 10, ...entry });
      if (log.length > 4_000) log.shift();
    };
    const describe = (video: HTMLVideoElement) => ({
      videoId: videoId(video),
      sceneId: video.closest<HTMLElement>("[data-layer-scene-id]")?.dataset.layerSceneId,
      layer: video.closest<HTMLElement>("[data-scene-layer]")?.dataset.sceneLayer,
      connectedVideos: document.querySelectorAll("video").length,
      connected: video.isConnected,
      src: video.getAttribute("src"),
      currentSrc: video.currentSrc,
      poster: video.getAttribute("poster"),
      readyState: video.readyState,
      networkState: video.networkState,
      mediaTime: Math.round(video.currentTime * 1_000) / 1_000,
      opacity: getComputedStyle(video.closest<HTMLElement>("[data-scene-layer]") ?? video).opacity,
      transform: getComputedStyle(video).transform,
      backgroundImage: getComputedStyle(video).backgroundImage,
      posterPlane: (() => {
        const poster = video.closest("[data-scene-layer]")?.querySelector<HTMLImageElement>("img");
        return poster ? {
          src: poster.getAttribute("src"),
          visible: poster.dataset.videoPosterVisible,
          opacity: getComputedStyle(poster).opacity,
        } : null;
      })(),
    });
    const observeVideo = (video: HTMLVideoElement) => {
      if (observed.has(video)) return;
      observed.add(video);
      push({ kind: "connected", ...describe(video) });
      for (const eventName of mediaEvents) {
        video.addEventListener(eventName, () => push({ kind: eventName, ...describe(video) }));
      }
      const presented = () => {
        if (!video.isConnected || !video.requestVideoFrameCallback) return;
        video.requestVideoFrameCallback((_now, metadata) => {
          push({
            kind: "presented-frame",
            ...describe(video),
            presentedFrames: metadata.presentedFrames,
            expectedDisplayTime: Math.round(metadata.expectedDisplayTime * 10) / 10,
          });
          presented();
        });
      };
      presented();
    };
    const scan = () => document.querySelectorAll("video").forEach(observeVideo);
    const mutation = new MutationObserver((records) => {
      for (const record of records) {
        for (const removed of record.removedNodes) {
          if (!(removed instanceof Element)) continue;
          const videos = removed.matches("video")
            ? [removed as HTMLVideoElement]
            : Array.from(removed.querySelectorAll("video"));
          for (const video of videos) push({ kind: "disconnected", ...describe(video) });
        }
      }
      scan();
    });
    mutation.observe(document.getElementById("root")!, { childList: true, subtree: true });
    scan();

    const sample = () => {
      frame = requestAnimationFrame(sample);
      scan();
      const player = document.querySelector<HTMLElement>('[data-testid="video-player"]');
      const scene = document.querySelector<HTMLElement>("[data-video-frame]");
      const videos = Array.from(document.querySelectorAll("video"));
      const signature = JSON.stringify({
        time: player?.dataset.currentTime?.slice(0, -1),
        scene: scene?.dataset.sceneId,
        videos: videos.map((video) => [videoId(video), video.getAttribute("src"), video.readyState, video.getAttribute("poster")]),
      });
      if (signature !== lastSnapshot) {
        lastSnapshot = signature;
        push({
          kind: "animation-frame",
          playerTime: player?.dataset.currentTime,
          sceneId: scene?.dataset.sceneId,
          connectedVideos: videos.length,
          videos: videos.map(describe),
        });
        if (output) output.textContent = JSON.stringify(log.slice(-18), null, 2);
      }
    };
    frame = requestAnimationFrame(sample);
    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
    };
  }, [diagnosticsEnabled]);

  return <main>
    <div data-probe-stage data-poster-background="none">
      <VideoPlayer video={probeVideo} width={366} autoPlay startMuted loop onSceneChange={(scene) => {
        const video = document.querySelector<HTMLVideoElement>(`[data-layer-scene-id="${scene.id}"] video`);
        window.__mobileMediaTransitionProbe?.push({at: performance.now(), kind: "scene-narration-cue", sceneId: scene.id, videoId: video?.dataset.probeVideoId, readyState: video?.readyState, currentSrc: video?.currentSrc});
      }} ariaLabel="Mobile media transition probe" />
    </div>
    {diagnosticsEnabled && <pre aria-label="Media transition event log" />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Probe />);
