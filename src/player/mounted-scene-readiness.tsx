import { createContext, useContext, useEffect, useRef } from "react";
import type { VideoScene } from "../protocol/types.js";

export const MountedReadinessContext = createContext<((key: string, error?: Error, actualVideoFrame?: boolean) => void) | undefined>(undefined);
export const sceneReadinessKey = (scene: VideoScene): string => `${scene.id}\0${String(scene.variables.mediaUrl || "")}`;

export interface MountedVideoProof { consume: (video: HTMLVideoElement) => boolean }

/** Observes the real mounted surface, never a detached decoder or speculative URL. */
export function MountedSceneReadiness({
  scene, playing, fallback = false, onFailure, onReady,
  observeIncoming = false, timeoutMs = 8000, preparedProof,
}: {
  scene: VideoScene;
  playing: boolean;
  fallback?: boolean;
  onFailure?: () => void;
  /** Preparation reports locally; only the promoted scene cues narration. */
  onReady?: (proof?: MountedVideoProof) => void;
  /** One-use proof from this same node immediately before promotion. */
  preparedProof?: MountedVideoProof;
  observeIncoming?: boolean;
  /** Early preparation has no scene deadline; the pending cut gets eight seconds. */
  timeoutMs?: number | null;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  const report = useContext(MountedReadinessContext);
  const key = sceneReadinessKey(scene);
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if ((!report && !onReadyRef.current) || !playing) return;
    let stopped = false;
    let frame = 0;
    let callback: number | undefined;
    let observed: HTMLVideoElement | undefined;
    let presented: HTMLVideoElement | undefined;
    let previousMediaTime: number | undefined;
    let forwardFrames = 0;
    let motionRevision = 0;
    const root = marker.current?.closest('[data-video-frame]');
    const start = performance.now();
    const finish = (error?: Error, actualVideoFrame = false) => {
      if (stopped) return;
      stopped = true;
      if (callback !== undefined) observed?.cancelVideoFrameCallback?.(callback);
      if (error && onFailureRef.current) onFailureRef.current();
      else if (onReadyRef.current && !error) {
        const video = presented;
        const mediaTime = video?.currentTime ?? 0;
        const confirmedAt = performance.now();
        const source = video?.currentSrc;
        const revision = motionRevision;
        let consumed = false;
        onReadyRef.current(actualVideoFrame && video ? { consume: candidate => {
          const valid = !consumed && candidate === video && video.isConnected
            && motionRevision === revision && !video.paused && !video.seeking
            && video.currentSrc === source && video.currentSrc === video.src
            && performance.now() - confirmedAt <= 200
            && video.currentTime >= mediaTime && video.currentTime - mediaTime <= .2;
          consumed = true;
          return valid;
        }} : undefined);
      } else report?.(key, error, actualVideoFrame);
    };
    const check = () => {
      if (stopped) return;
      if (fallback && root?.querySelector("[data-scene-fallback]") && !root.querySelector("[data-template-loading]") && document.fonts?.status !== "loading") { finish(); return; }
      const layer = observeIncoming
        ? [...(root?.querySelectorAll('[data-layer-scene-id]') ?? [])].find(node => node.getAttribute('data-layer-scene-id') === scene.id)
        : root?.querySelector('[data-scene-layer="active"]');
      const loading = layer?.querySelector('[data-template-loading]');
      const mediaUrl = String(scene.variables.mediaUrl || "");
      const isVideo = scene.variables.mediaType === "video" || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(mediaUrl);
      if (root && layer && !loading && document.fonts?.status !== "loading") {
        if (!mediaUrl || scene.variables.mediaType === "gradient") { finish(); return; }
        if (isVideo) {
          const video = layer.querySelector('video');
          if (video && video.getAttribute('src') === mediaUrl && video.currentSrc === video.src && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            if (preparedProof?.consume(video)) { finish(undefined, true); return; }
            if (observed !== video) { previousMediaTime = undefined; forwardFrames = 0; }
            // Some native decoders sample HAVE_CURRENT_DATA throughout moving
            // playback. Two actual forward frames also prove playable media.
            if (presented === video && (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || forwardFrames >= 2)) { finish(undefined, true); return; }
            observed = video;
            if (video.requestVideoFrameCallback) {
              callback = video.requestVideoFrameCallback((_now, metadata) => {
                callback = undefined;
                if (stopped) return;
                const sameSource = video.isConnected && video.getAttribute("src") === mediaUrl && video.currentSrc === video.src;
                const mediaTime = metadata.mediaTime;
                if (!sameSource || video.paused || video.seeking || !Number.isFinite(mediaTime)
                  || (previousMediaTime !== undefined && mediaTime <= previousMediaTime + .001)) forwardFrames = 0;
                else if (previousMediaTime !== undefined && mediaTime > previousMediaTime + .001) forwardFrames++;
                previousMediaTime = sameSource && !video.paused && !video.seeking ? mediaTime : undefined;
                if (sameSource) presented = video;
                check();
              });
              return;
            }
            if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) { finish(undefined, true); return; }
          }
        } else {
          const image = [...(layer.querySelectorAll('img') ?? [])].find(element => element.getAttribute('src') === mediaUrl);
          if (image?.complete && image.naturalWidth > 0) { finish(); return; }
        }
      }
      if (timeoutMs !== null && performance.now() - start >= timeoutMs) { finish(new Error("Scene media did not become ready")); return; }
      frame = requestAnimationFrame(check);
    };
    // Built-in backdrops already observe their first presented frame. Reuse
    // that proof instead of asking the decoder for a second frame at a cut.
    const onPresented = (event: Event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || stopped
        || video.getAttribute("src") !== String(scene.variables.mediaUrl || "")
        || video.currentSrc !== video.src) return;
      presented = video;
      cancelAnimationFrame(frame);
      if (callback !== undefined) observed?.cancelVideoFrameCallback?.(callback);
      callback = undefined;
      check();
    };
    const resetMotion = (event: Event) => {
      if (event.target === observed || event.target === presented) { motionRevision++; previousMediaTime = undefined; forwardFrames = 0; }
    };
    for (const type of ["pause", "waiting", "seeking"]) root?.addEventListener(type, resetMotion, true);
    root?.addEventListener("vanillasky:video-frame-presented", onPresented);
    check();
    const timeout = timeoutMs === null ? undefined : setTimeout(() => finish(new Error("Scene media did not become ready")), timeoutMs);
    return () => {
      root?.removeEventListener("vanillasky:video-frame-presented", onPresented);
      for (const type of ["pause", "waiting", "seeking"]) root?.removeEventListener(type, resetMotion, true);
      stopped = true; clearTimeout(timeout); cancelAnimationFrame(frame);
      if (callback !== undefined) observed?.cancelVideoFrameCallback?.(callback);
    };
  }, [key, report, scene, playing, fallback, observeIncoming, timeoutMs, preparedProof]);
  return <span ref={marker} hidden />;
}
