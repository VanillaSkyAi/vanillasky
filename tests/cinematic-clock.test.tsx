// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlaybackClock } from "../src/player/use-playback-clock";
import { createVideoState } from "../src/protocol/state";
import { sceneReadinessKey } from "../src/player/mounted-scene-readiness";
import type { Video } from "../src/protocol/types";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";
afterEach(() => {cleanup(); vi.useRealTimers();});
it("holds first-frame and cut narration until the mounted scene is ready, then resumes without accumulating wall time", async () => {
  vi.useFakeTimers();
  const video: Video = {schemaVersion: "0.1", orientation: "landscape", style: TEST_VIDEO_STYLE, scenes: [0,1].map(index => ({id: `scene-${index}`, templateId: "media", variables: {mediaUrl: `https://example.com/${index}.mp4`, mediaType: "video"}, timing: {fixedDuration: 1}}))};
  const timeRef = {current: 0}; const visualReadyRef: {current: string | undefined} = {current: undefined};
  const change = vi.fn(); const stall = vi.fn(); const playing = vi.fn();
  const options = {stateRef: {current: {...createVideoState(), status: "complete" as const, config: video}}, timeRef, visualReadyRef, audioRef: {current: null}, loopRef: {current: false}, sceneIndexRef: {current: -1}, callbacksRef: {current: {onSceneChange: change, onStallChange: stall}}, setCurrentTime: vi.fn(), setIsPlaying: playing};
  const hook = renderHook(({isPlaying}) => usePlaybackClock({...options, isPlaying}), {initialProps: {isPlaying: true}});
  await act(() => vi.advanceTimersByTimeAsync(300)); expect(timeRef.current).toBe(0); expect(change).not.toHaveBeenCalled();
  visualReadyRef.current = sceneReadinessKey(video.scenes[0]);
  await act(() => vi.advanceTimersByTimeAsync(100)); expect(timeRef.current).toBeLessThan(0.12); expect(change).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1200)); expect(timeRef.current).toBe(1); expect(change).toHaveBeenCalledTimes(1);
  hook.rerender({isPlaying: false}); await act(() => vi.advanceTimersByTimeAsync(1000)); expect(timeRef.current).toBe(1);
  visualReadyRef.current = sceneReadinessKey(video.scenes[1]); hook.rerender({isPlaying: true});
  await act(() => vi.advanceTimersByTimeAsync(100)); expect(timeRef.current).toBeLessThan(1.12); expect(change).toHaveBeenCalledTimes(2);
  expect(stall).toHaveBeenCalledWith(true); expect(stall).toHaveBeenCalledWith(false);
});
