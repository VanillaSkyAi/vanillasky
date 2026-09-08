import { sceneReadinessKey } from "./mounted-scene-readiness.js";
import { useEffect } from "react";
import type { VideoScene } from "../protocol/types.js";
import type { VideoState } from "../protocol/state.js";
import { getVideoDuration, resolveVideoTimeline } from "../protocol/timeline.js";
import { CLIP_NARRATION_TAIL_SEC } from "../protocol/clip-budget.js";
import type { PlaybackWaitReason } from "./video-player-types.js";

interface PlaybackClockOptions {
  isPlaying: boolean;
  stateRef: { current: VideoState };
  timeRef: { current: number };
  audioRef: { current: HTMLAudioElement | null };
  loopRef: { current: boolean };
  sceneIndexRef: { current: number };
  visualReadyRef?: { current: string | undefined };
  callbacksRef: {
    current: {
      narrationReady?: () => boolean;
      narrationTime?: (scene: VideoScene) => number | undefined;
      narrationActive?: (scene: VideoScene) => boolean;
      onError?: (error: Error, state: VideoState) => void;
      onStallChange?: (stalled: boolean, reason?: PlaybackWaitReason) => unknown;
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
  callbacksRef,
  setCurrentTime,
  setIsPlaying,
}: PlaybackClockOptions): void {
  useEffect(() => {
    if (!isPlaying) return;
    let stalled = false;
    let stallReason: PlaybackWaitReason | undefined;
    let onsetWaitSeconds = 0;
    let clockWaitSeconds = 0;
    let lastNarrationTime: number | undefined;
    let completionHold: { sceneId: string; wait: number; tail: number } | undefined;
    let committedTime = timeRef.current;
    let groupHandoff: { key: string; startedAt: number } | undefined;
    let requestId = stateRef.current.requestId;
    let runId = stateRef.current.runId;
    const failNarration = (error: Error, state: VideoState) => {
      setIsPlaying(false);
      try { void Promise.resolve(callbacksRef.current.onError?.(error, state)).catch(() => undefined); }
      catch { /* Observer failures cannot escape the playback loop. */ }
    };
    const reportStall = (next: boolean, reason?: PlaybackWaitReason) => {
      if (stalled === next && (!next || stallReason === reason)) return;
      if (stalled && next) {
        try { void Promise.resolve(callbacksRef.current.onStallChange?.(false, stallReason)).catch(() => undefined); } catch { /* Observer only. */ }
      }
      stalled = next;
      stallReason = reason;
      try { void Promise.resolve(callbacksRef.current.onStallChange?.(next, reason)).catch(() => undefined); } catch { /* Observers cannot stop playback. */ }
    };
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const current = stateRef.current;
      const config = current.config;
      const externallySeeked = timeRef.current !== committedTime;
      const replaced = current.requestId !== requestId || current.runId !== runId;
      requestId = current.requestId; runId = current.runId;
      if (externallySeeked || replaced) { groupHandoff = undefined; completionHold = undefined; }
      let deferGroupStall = false;
      let completionBlocked = false;
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
        const audioMovedBackwards = narrationTime !== undefined && lastNarrationTime !== undefined && narrationTime < lastNarrationTime;
        lastNarrationTime = narrationTime;
        if (clockWaitSeconds >= 8) {
          failNarration(new Error("Narration audio clock did not advance within eight seconds"), current);
          return;
        }
        let raw = narrationTime !== undefined && cued
          ? cued.start - (cued.scene.narrationGroup?.offsetSeconds ?? 0) + narrationTime
          : timeRef.current + delta;
        // The decoded visual can lead the first reported audio time slightly.
        // Adopt a forward audio clock by holding until it catches up, not by
        // seeking the decoder backward. Real audio/playhead resets still act.
        if (narrationTime !== undefined && !audioMovedBackwards && !externallySeeked && !replaced) {
          raw = Math.max(timeRef.current, raw);
        }
        // Browser/custom voices may have no audio clock. Their completion
        // promise, not an estimate, owns the final cut. Waiting is bounded in
        // active playback time and leaves the same media element mounted.
        if (cued && !cued.scene.narrationGroup && narrationTime === undefined) {
          let speaking = false;
          try { speaking = callbacksRef.current.narrationActive?.(cued.scene) === true; }
          catch (cause) {
            failNarration(cause instanceof Error ? cause : new Error("Narration completion failed"), current);
            return;
          }
          if (completionHold?.sceneId !== cued.scene.id) completionHold = undefined;
          if (raw >= cued.end - CLIP_NARRATION_TAIL_SEC && speaking) {
            completionHold ??= { sceneId: cued.scene.id, wait: 0, tail: 0 };
            if (raw >= cued.end) completionHold.wait += elapsed;
            if (completionHold.wait >= 8) {
              failNarration(new Error("Narration did not finish within eight seconds of its scene budget"), current);
              return;
            }
            if (raw >= cued.end) { raw = Math.max(cued.start, cued.end - .01); completionBlocked = true; }
          } else if (completionHold && !speaking) {
            completionHold.tail += elapsed;
            if (completionHold.tail < CLIP_NARRATION_TAIL_SEC && raw >= cued.end) { raw = Math.max(cued.start, cued.end - .01); completionBlocked = true; }
            else if (completionHold.tail >= CLIP_NARRATION_TAIL_SEC) completionHold = undefined;
          }
        }
        let nextTime: number;
        if (looping && duration > 0 && raw >= duration) {
          nextTime = raw % duration;
          wrapped = true;
        } else {
          nextTime = Math.min(raw, duration);
        }
        const target = ranges.find(range => nextTime >= range.start && nextTime < range.end) ?? ranges.at(-1);
        const waitingForVisual = Boolean(target && visualReadyRef && visualReadyRef.current !== sceneReadinessKey(target.scene));
        if (waitingForVisual && target) {
          nextTime = target.start;
          const fromGroup = cued?.scene.narrationGroup;
          const toGroup = target.scene.narrationGroup;
          const continuesParagraph = !externallySeeked && !replaced && !audioMovedBackwards && narrationReady
            && narrationTime !== undefined && fromGroup && toGroup
            && fromGroup.id === toGroup.id && fromGroup.text === toGroup.text
            && target === ranges[sceneIndexRef.current + 1]
            && narrationTime > fromGroup.offsetSeconds + .04;
          if (continuesParagraph) {
            const key = `${sceneReadinessKey(cued!.scene)}\0${sceneReadinessKey(target.scene)}\0${fromGroup!.id}\0${fromGroup!.text}`;
            if (groupHandoff?.key !== key) groupHandoff = {key, startedAt:now};
            // Real decoded-frame handoffs measured up to 148ms on WebKit.
            // Keep an already-speaking paragraph continuous during that short
            // commit; the visual clock and new scene cue still wait for a frame.
            deferGroupStall = !stalled && now - groupHandoff.startedAt < 200;
          } else groupHandoff = undefined;
        } else groupHandoff = undefined;
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
      const reason: PlaybackWaitReason | undefined = !narrationReady || completionBlocked ? "speech"
        : active && visualReadyRef && visualReadyRef.current !== sceneReadinessKey(active.scene) && !deferGroupStall ? "media-decoding"
        : !settled && Boolean(current.config?.scenes.length) && duration > 0 && timeRef.current >= duration ? "scene-generation" : undefined;
      reportStall(Boolean(reason), reason);
      committedTime = timeRef.current;
      if (!settled || looping || timeRef.current < duration) frame = requestAnimationFrame(tick);
      else setIsPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); reportStall(false); };
  }, [isPlaying]);
}
