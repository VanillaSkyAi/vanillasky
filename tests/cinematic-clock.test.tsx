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
  const video: Video = {schemaVersion: "0.2", orientation: "landscape", style: TEST_VIDEO_STYLE, scenes: [0,1].map(index => ({id: `scene-${index}`, templateId: "media", variables: {mediaUrl: `https://example.com/${index}.mp4`, mediaType: "video"}, timing: {fixedDuration: 1}}))};
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

it("cues the first scene before holding for actual narration onset, excludes pause time and bounds a missing onset", async () => {
  vi.useFakeTimers();
  let ready = true;
  const timeRef = { current: 0 };
  const change = vi.fn(() => { ready = false; });
  const error = vi.fn();
  const stall = vi.fn();
  const video: Video = { schemaVersion: "0.2", style: {}, scenes: [{ id: "group-start", templateId: "chapterTitle", variables: { title: "A beginning" }, timing: { fixedDuration: 20 } }] };
  const options = { stateRef: { current: { ...createVideoState(), status: "complete" as const, config: video } }, timeRef, audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: -1 }, callbacksRef: { current: { narrationReady: () => ready, onSceneChange: change, onError: error, onStallChange: stall } }, setCurrentTime: vi.fn(), setIsPlaying: vi.fn() };
  const hook = renderHook(({ isPlaying }) => usePlaybackClock({ ...options, isPlaying }), { initialProps: { isPlaying: true } });
  await act(() => vi.advanceTimersByTimeAsync(1600));
  expect(change).toHaveBeenCalledOnce();
  expect(timeRef.current).toBeLessThan(0.04);
  expect(stall).not.toHaveBeenCalledWith(true);
  hook.rerender({ isPlaying: false });
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(error).not.toHaveBeenCalled();
  ready = true;
  hook.rerender({ isPlaying: true });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(timeRef.current).toBeGreaterThan(0.08);
  expect(timeRef.current).toBeLessThan(0.15);
  ready = false;
  await act(() => vi.advanceTimersByTimeAsync(8100));
  expect(error).toHaveBeenCalledOnce();
  expect(options.setIsPlaying).toHaveBeenCalledWith(false);
});

it("stops on a throwing readiness getter and isolates error observers", async () => {
  vi.useFakeTimers();
  const stop = vi.fn();
  const error = vi.fn(() => { throw new Error("observer"); });
  const hook = renderHook(() => usePlaybackClock({ isPlaying: true, stateRef: { current: createVideoState() }, timeRef: { current: 0 }, audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: -1 }, callbacksRef: { current: { narrationReady: () => { throw new Error("readiness"); }, onError: error } }, setCurrentTime: vi.fn(), setIsPlaying: stop }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(stop).toHaveBeenCalledWith(false);
  expect(error).toHaveBeenCalledOnce();
  hook.unmount();
});
