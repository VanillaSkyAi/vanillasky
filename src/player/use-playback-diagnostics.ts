import { useEffect, useRef, type RefObject } from "react";
import type { Video } from "../protocol/types.js";
import { resolveVideoTimeline } from "../protocol/timeline.js";
import type { MediaPlaybackMetric } from "./video-player-types.js";

/** Opt-in observations of the mounted active/next decoders; never warms media. */
export function usePlaybackDiagnostics(root: RefObject<HTMLDivElement | null>, config: Video | undefined,
  report: ((metric: MediaPlaybackMetric) => unknown) | undefined): void {
  const current = useRef({ config, report });
  current.current = { config, report };
  const enabled = Boolean(report);
  useEffect(() => {
    if (!enabled) return;
    const observed = new WeakMap<HTMLVideoElement, { time: number; repeats: number; sceneId: string }>();
    let lastBuffer = -1;
    const emit = (metric: MediaPlaybackMetric) => {
      try { void Promise.resolve(current.current.report?.(metric)).catch(() => undefined); } catch { /* Observer only. */ }
    };
    const sample = () => {
      const video = current.current.config;
      if (!root.current || !video) return;
      const ranges = resolveVideoTimeline(video);
      let bufferedSeconds = 0;
      for (const media of root.current.querySelectorAll("video")) {
        const layer = media.closest("[data-layer-scene-id]");
        const sceneId = layer?.getAttribute("data-layer-scene-id");
        const range = ranges.find(value => value.scene.id === sceneId);
        if (!range || !Number.isFinite(media.duration) || media.duration <= 0) continue;
        const active = layer?.getAttribute("data-scene-layer") === "active";
        const previous = observed.get(media);
        const same = previous?.sceneId === sceneId;
        const repeated = same && previous && !media.paused && !media.seeking && media.currentTime < previous.time - .5;
        const repeats = (same && previous ? previous.repeats : 0) + (repeated ? 1 : 0);
        if (active && (!same || repeated)) emit({ type: "media-playback", clipDurationSec: media.duration,
          sceneDurationSec: range.end - range.start, repeatCount: repeats });
        if (active) observed.set(media, { time: media.currentTime, repeats, sceneId: sceneId! });
        if (media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) continue;
        for (let index = 0; index < media.buffered.length; index++) {
          if (media.buffered.start(index) <= media.currentTime && media.buffered.end(index) >= media.currentTime) {
            bufferedSeconds += Math.max(0, Math.min(media.buffered.end(index), range.end - range.start) - media.currentTime);
            break;
          }
        }
      }
      bufferedSeconds = Math.round(bufferedSeconds * 10) / 10;
      if (bufferedSeconds !== lastBuffer) { lastBuffer = bufferedSeconds; emit({ type: "buffer", bufferedSeconds }); }
    };
    sample();
    const timer = setInterval(sample, 500);
    return () => clearInterval(timer);
  }, [enabled, root]);
}
