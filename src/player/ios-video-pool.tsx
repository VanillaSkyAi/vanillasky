import { createContext, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { isIosAudioOutput } from './ios-audio-output.js';

export interface IosVideoPool {
  prime(): void;
  acquire(): HTMLVideoElement | undefined;
  release(video: HTMLVideoElement): void;
  dispose(): void;
}

/** Safari's native playback permission belongs to each element, across sources. */
export function createIosVideoPool(): IosVideoPool {
  let videos: HTMLVideoElement[] = [];
  const leased = new Set<HTMLVideoElement>();
  const clear = (video: HTMLVideoElement) => {
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
    video.remove();
  };
  return {
    prime() {
      if (videos.length || !isIosAudioOutput() || globalThis.navigator?.userActivation?.isActive === false) return;
      // Call from Ask/Replay's gesture, without awaiting or loading a fake clip.
      // Later gestures must never reload a currently playing/primed element.
      videos = Array.from({ length: 2 }, () => {
        const video = document.createElement('video');
        video.playsInline = true;
        video.preload = 'auto';
        video.load();
        return video;
      });
    },
    acquire() {
      const video = videos.find(candidate => !leased.has(candidate));
      if (video) leased.add(video);
      return video;
    },
    release(video) {
      if (!leased.delete(video)) return;
      clear(video);
    },
    dispose() {
      leased.clear();
      for (const video of videos) clear(video);
      videos = [];
      // An explicit later gesture may prime again after Strict Mode's idle
      // cleanup rehearsal. No asynchronous task can recreate these nodes.
    },
  };
}

export const IosVideoPoolContext = createContext<IosVideoPool | undefined>(undefined);

interface IosVideoSurfaceProps {
  pool: IosVideoPool;
  videoRef: { current: HTMLVideoElement | null };
  src: string;
  poster?: string;
  muted: boolean;
  mediaPosition: string;
  style: CSSProperties;
  onLoadedMetadata(video: HTMLVideoElement): void;
  onEnded(): void;
  onPlay(video: HTMLVideoElement): void;
  onPlaying(video: HTMLVideoElement): void;
  onWaiting(): void;
  onError?: () => void;
  onUnavailable(): void;
}

/** A layout-neutral host for the actual gesture-primed native video element. */
export function IosVideoSurface(props: IosVideoSurfaceProps) {
  const host = useRef<HTMLSpanElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const { pool, videoRef } = props;
  useLayoutEffect(() => {
    const video = pool.acquire();
    if (!video) { latest.current.onUnavailable(); return; }
    videoRef.current = video;
    host.current!.append(video);
    const listeners: Array<[string, EventListener]> = [
      ['loadedmetadata', () => latest.current.onLoadedMetadata(video)],
      ['ended', () => latest.current.onEnded()],
      ['play', () => latest.current.onPlay(video)],
      ['playing', () => latest.current.onPlaying(video)],
      ['waiting', () => latest.current.onWaiting()],
      ['error', () => latest.current.onError?.()],
    ];
    for (const [type, listener] of listeners) video.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of listeners) video.removeEventListener(type, listener);
      if (videoRef.current === video) videoRef.current = null;
      pool.release(video);
    };
  }, [pool, videoRef]);
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const current = latest.current;
    video.muted = current.muted;
    video.loop = false;
    video.playsInline = true;
    video.preload = 'auto';
    if (current.poster) video.setAttribute('poster', current.poster);
    else video.removeAttribute('poster');
    video.dataset.mediaPosition = current.mediaPosition;
    video.dataset.videoBackdrop = 'scene';
    video.style.cssText = '';
    for (const [key, value] of Object.entries(current.style)) {
      if (value != null) Reflect.set(video.style, key, String(value));
    }
    // Setting src starts native loading, just as React's normal video path does.
    if (video.getAttribute('src') !== current.src) video.setAttribute('src', current.src);
  });
  return <span ref={host} style={{ display: 'contents' }} />;
}
