import { createContext, useContext, useEffect, useRef } from "react";
import type { VideoScene } from "../protocol/types.js";

export const MountedReadinessContext = createContext<((key: string, error?: Error) => void) | undefined>(undefined);
export const sceneReadinessKey = (scene: VideoScene): string => `${scene.id}\0${String(scene.variables.mediaUrl || "")}`;

/** Observes the real mounted surface, never a detached decoder or speculative URL. */
export function MountedSceneReadiness({ scene, playing, fallback = false }: { scene: VideoScene; playing: boolean; fallback?: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);
  const report = useContext(MountedReadinessContext);
  const key = sceneReadinessKey(scene);
  useEffect(() => {
    if (!report || !playing) return;
    let stopped = false;
    let frame = 0;
    let callback: number | undefined;
    let observed: HTMLVideoElement | undefined;
    const start = performance.now();
    const finish = (error?: Error) => { if (!stopped) { stopped = true; report(key, error); } };
    const check = () => {
      if (stopped) return;
      const root = marker.current?.closest('[data-video-frame]');
      if (fallback && root?.querySelector("[data-scene-fallback]")) { finish(); return; }
      const layer = root?.querySelector('[data-scene-layer="active"]');
      const loading = layer?.querySelector('[data-template-loading]');
      const mediaUrl = String(scene.variables.mediaUrl || "");
      const isVideo = scene.variables.mediaType === "video" || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(mediaUrl);
      if (root && layer && !loading && document.fonts?.status !== "loading") {
        if (!mediaUrl || scene.variables.mediaType === "gradient") { finish(); return; }
        if (isVideo) {
          const persistent = root.querySelector('[data-persistent-video-scene-id]');
          const video = (persistent?.getAttribute('data-persistent-video-scene-id') === scene.id ? persistent : layer)?.querySelector('video');
          if (video && video.getAttribute('src') === mediaUrl && video.readyState >= 2) {
            observed = video;
            if (video.requestVideoFrameCallback) {
              callback = video.requestVideoFrameCallback(() => finish());
              return;
            }
            finish(); return;
          }
        } else {
          const image = [...(layer.querySelectorAll('img') ?? [])].find(element => element.getAttribute('src') === mediaUrl);
          if (image?.complete && image.naturalWidth > 0) { finish(); return; }
        }
      }
      if (performance.now() - start >= 8_000) { finish(new Error("Scene media did not become ready")); return; }
      frame = requestAnimationFrame(check);
    };
    check();
    const timeout = setTimeout(() => finish(new Error("Scene media did not become ready")), 8_000);
    return () => {
      stopped = true; clearTimeout(timeout); cancelAnimationFrame(frame);
      if (callback !== undefined) observed?.cancelVideoFrameCallback?.(callback);
    };
  }, [key, report, scene, playing, fallback]);
  return <span ref={marker} hidden />;
}
