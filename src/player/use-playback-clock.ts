import { sceneReadinessKey } from "./mounted-scene-readiness.js";
import { useEffect } from "react";
import type { VideoScene } from "../protocol/types.js";
import type { VideoState } from "../protocol/state.js";
import { getVideoDuration, resolveVideoTimeline } from "../protocol/timeline.js";

interface PlaybackClockOptions {
  isPlaying: boolean;
  stateRef: { current: VideoState };
  timeRef: { current: number };
  audioRef: { current: HTMLAudioElement | null };
  loopRef: { current: boolean };
  sceneIndexRef: { current: number };
  visualReadyRef?: { current: string | undefined };
  posterBridgeKeysRef?: { current: Set<string> };
  callbacksRef: {
    current: {
      narrationReady?: () => boolean;
      narrationTime?: (scene: VideoScene) => number | undefined;
      onError?: (error: Error, state: VideoState) => void;
      onStallChange?: (stalled: boolean) => unknown;
      onSceneChange?: (scene: VideoScene, index: number) => void;
    };
  };
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
}

export function usePlaybackClock({
  isPlaying,
  stateRef,
  timeRef,
  audioRef,
  loopRef,
  sceneIndexRef,
  visualReadyRef,
  posterBridgeKeysRef,
  callbacksRef,
  setCurrentTime,
  setIsPlaying,
}: PlaybackClockOptions): void {
  useEffect(() => {
    if (!isPlaying) return;
    let stalled = false;
    let onsetWaitSeconds = 0;
    let clockWaitSeconds = 0;
    let lastNarrationTime: number | undefined;
    const failNarration = (error: Error, state: VideoState) => {
      setIsPlaying(false);
      try { void Promise.resolve(callbacksRef.current.onError?.(error, state)).catch(() => undefined); }
      catch { /* Observer failures cannot escape the playback loop. */ }
    };
    const reportStall = (next: boolean) => {
      if (stalled === next) return;
      stalled = next;
      try { void Promise.resolve(callbacksRef.current.onStallChange?.(next)).catch(() => undefined); } catch { /* Observers cannot stop playback. */ }
    };
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const current = stateRef.current;
      const config = current.config;
      const elapsed = Math.max(0, (now - previous) / 1000);
      let narrationReady = true;
      try { narrationReady = callbacksRef.current.narrationReady?.() !== false; }
      catch (cause) {
        failNarration(cause instanceof Error ? cause : new Error("Narration readiness failed"), current);
        return;
      }
      onsetWaitSeconds = narrationReady ? 0 : onsetWaitSeconds + elapsed;
      if (onsetWaitSeconds >= 8) {
        failNarration(new Error("Narration did not report audio onset within eight seconds"), current);
        return;
      }
      const delta = narrationReady ? elapsed : 0;
      previous = now;
      const settled = current.status === "complete" || current.status === "error" || current.status === "aborted";
      const looping = loopRef.current && settled;
      let wrapped = false;
      if (config?.scenes.length) {
        const duration = getVideoDuration(config);
        const ranges = resolveVideoTimeline(config);
        const cued = ranges[sceneIndexRef.current];
        let narrationTime: number | undefined;
        try { narrationTime = cued ? callbacksRef.current.narrationTime?.(cued.scene) : undefined; }
        catch (cause) {
          failNarration(cause instanceof Error ? cause : new Error("Narration clock failed"), current);
          return;
        }
        if (narrationTime !== undefined && (!Number.isFinite(narrationTime) || narrationTime < 0)) {
          failNarration(new Error("Narration clock must return finite nonnegative seconds"), current);
          return;
        }
        clockWaitSeconds = narrationTime !== undefined && narrationTime === lastNarrationTime && narrationReady && !stalled ? clockWaitSeconds + elapsed : 0;
        lastNarrationTime = narrationTime;
        if (clockWaitSeconds >= 8) {
          failNarration(new Error("Narration audio clock did not advance within eight seconds"), current);
          return;
        }
        const raw = narrationTime !== undefined && cued
          ? cued.start - (cued.scene.narrationGroup?.offsetSeconds ?? 0) + narrationTime
          : timeRef.current + delta;
        let nextTime: number;
        if (looping && duration > 0 && raw >= duration) {
          nextTime = raw % duration;
          wrapped = true;
        } else {
          nextTime = Math.min(raw, duration);
        }
        const target = ranges.find(range => nextTime >= range.start && nextTime < range.end) ?? ranges.at(-1);
        const waitingForVisual = Boolean(target && visualReadyRef && visualReadyRef.current !== sceneReadinessKey(target.scene) && !posterBridgeKeysRef?.current.has(sceneReadinessKey(target.scene)));
        if (waitingForVisual && target) nextTime = target.start;
        if (nextTime !== timeRef.current) {
          timeRef.current = nextTime;
          setCurrentTime(nextTime);
        }
        const audio = audioRef.current;
        if (audio && (current.status === "complete" || current.status === "error")) {
          if (wrapped) {
            audio.currentTime = 0;
            if (audio.paused) void audio.play().catch(Boolean);
          }
          const fadeSeconds = Math.max(0, (config.audio?.fadeOutMs ?? 3000) / 1000);
          const remaining = Math.max(0, duration - nextTime);
          const baseVolume = config.audio?.volume ?? 1;
          audio.volume = fadeSeconds > 0
            ? baseVolume * Math.min(1, remaining / fadeSeconds)
            : baseVolume;
          if (remaining <= 0 && !looping) audio.pause();
        }
        const notify = callbacksRef.current.onSceneChange;
        if (notify && !waitingForVisual) {
          if (wrapped) sceneIndexRef.current = -1;
          const ranges = resolveVideoTimeline(config);
          const index = ranges.findIndex((range) => nextTime >= range.start && nextTime < range.end);
          const resolved = index === -1 && nextTime >= duration ? ranges.length - 1 : index;
          if (resolved !== -1 && resolved !== sceneIndexRef.current) {
            sceneIndexRef.current = resolved;
            notify(ranges[resolved].scene, resolved);
          }
        }
      }
      const duration = current.config ? getVideoDuration(current.config) : 0;
      const active = current.config ? resolveVideoTimeline(current.config).find(range => timeRef.current >= range.start && timeRef.current < range.end) : undefined;
      reportStall(Boolean(active && visualReadyRef && visualReadyRef.current !== sceneReadinessKey(active.scene) && !posterBridgeKeysRef?.current.has(sceneReadinessKey(active.scene))) || (!settled && Boolean(current.config?.scenes.length) && duration > 0 && timeRef.current >= duration));
      if (!settled || looping || timeRef.current < duration) frame = requestAnimationFrame(tick);
      else setIsPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); reportStall(false); };
  }, [isPlaying]);
}
