// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlaybackClock } from "../src/player/use-playback-clock";
import { createVideoState } from "../src/protocol/state";
import { sceneReadinessKey } from "../src/player/mounted-scene-readiness";
import type { Video } from "../src/protocol/types";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";
afterEach(() => {cleanup(); vi.useRealTimers();});
it("adopts a late narration clock without rewinding footage, but preserves an actual audio rewind", async () => {
  vi.useFakeTimers();
  let audioTime: number | undefined;
  let ready = false;
  const video: Video = { schemaVersion: "0.2", style: {}, scenes: [{ id: "one", templateId: "cinemaMedia", variables: { mediaUrl: "/clip.mp4", mediaType: "video" }, narration: "A fitting recorded line.", timing: { fixedDuration: 3.024 } }] };
  // The first decoded frame arrives before the recorded voice reports onset.
  const timeRef = { current: .267 };
  const error = vi.fn();
  renderHook(() => usePlaybackClock({ isPlaying: true,
    stateRef: { current: { ...createVideoState(), status: "complete", config: video } }, timeRef,
    audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: 0 },
    callbacksRef: { current: { narrationReady: () => ready, narrationTime: () => audioTime, onError: error } },
    setCurrentTime: vi.fn(), setIsPlaying: vi.fn(),
  }));
  await act(() => vi.advanceTimersByTimeAsync(32));
  ready = true;
  for (const time of [.114, .2]) {
    audioTime = time;
    await act(() => vi.advanceTimersByTimeAsync(32));
    expect(timeRef.current).toBe(.267);
  }
  audioTime = .3;
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(timeRef.current).toBe(.3);
  audioTime = 0;
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(timeRef.current).toBe(0);
  expect(error).not.toHaveBeenCalled();
});
it.each([1800, 3000])("waits for actual speech completion at %dms and a short tail before cutting", async finishAt => {
  vi.useFakeTimers();
  let active = true;
  const video: Video = { schemaVersion: "0.2", style: {}, scenes: [0, 1].map(index => ({ id: String(index), templateId: "chapterTitle", variables: { title: "A thought" }, narration: "A thought.", timing: { fixedDuration: 2 } })) };
  const timeRef = { current: 0 }; const change = vi.fn();
  renderHook(() => usePlaybackClock({ isPlaying: true, stateRef: { current: { ...createVideoState(), status: "complete", config: video } }, timeRef,
    audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: -1 },
    callbacksRef: { current: { narrationActive: () => active, onSceneChange: change } }, setCurrentTime: vi.fn(), setIsPlaying: vi.fn() }));
  await act(() => vi.advanceTimersByTimeAsync(finishAt));
  expect(change).toHaveBeenCalledTimes(1);
  expect(timeRef.current).toBeLessThan(2);
  active = false;
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(change).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(change).toHaveBeenCalledTimes(2);
});
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
  expect(stall).toHaveBeenCalledWith(true, "media-decoding"); expect(stall).toHaveBeenCalledWith(false, undefined);
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
  expect(stall).not.toHaveBeenCalledWith(true, "media-decoding");
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

it("uses actual narration time across cold output stalls, visual cuts, pause, and authored tails", async () => {
  vi.useFakeTimers();
  let audioTime: number | undefined = 0;
  const video: Video = { schemaVersion: "0.2", style: {}, scenes: [0, 1].map(index => ({ id: String(index), templateId: "chapterTitle", variables: { title: "A shot" }, timing: { fixedDuration: 3 }, narrationGroup: { id: "g", text: "One. Two.", offsetSeconds: index * 3, durationSeconds: 3, totalSeconds: 6 } })) };
  const timeRef = { current: 0 };
  const change = vi.fn(); const error = vi.fn(); const stall = vi.fn();
  const visualReadyRef = { current: sceneReadinessKey(video.scenes[0]) };
  const options = { stateRef: { current: { ...createVideoState(), status: "complete" as const, config: video } }, timeRef, visualReadyRef, audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: -1 }, callbacksRef: { current: { narrationTime: () => audioTime, onSceneChange: change, onError: error, onStallChange: stall } }, setCurrentTime: vi.fn(), setIsPlaying: vi.fn() };
  const hook = renderHook(({ isPlaying }) => usePlaybackClock({ ...options, isPlaying }), { initialProps: { isPlaying: true } });
  await act(() => vi.advanceTimersByTimeAsync(100));
  audioTime = 0.05;
  await act(() => vi.advanceTimersByTimeAsync(2500));
  expect(timeRef.current).toBe(0.05); expect(change).toHaveBeenCalledOnce();
  audioTime = 3.1;
  await act(() => vi.advanceTimersByTimeAsync(50));
  expect(timeRef.current).toBe(3); expect(change).toHaveBeenCalledOnce();
  expect(stall).not.toHaveBeenCalledWith(true, "media-decoding");
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(stall).toHaveBeenCalledWith(true, "media-decoding");
  await act(() => vi.advanceTimersByTimeAsync(1750)); expect(error).not.toHaveBeenCalled();
  visualReadyRef.current = sceneReadinessKey(video.scenes[1]);
  await act(() => vi.advanceTimersByTimeAsync(50));
  expect(timeRef.current).toBe(3.1); expect(change).toHaveBeenCalledTimes(2);
  expect(stall).toHaveBeenCalledWith(false, undefined);
  hook.rerender({ isPlaying: false });
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(error).not.toHaveBeenCalled();
  hook.rerender({ isPlaying: true });
  audioTime = 4;
  await act(() => vi.advanceTimersByTimeAsync(50)); expect(timeRef.current).toBe(4);
  audioTime = undefined;
  await act(() => vi.advanceTimersByTimeAsync(100)); expect(timeRef.current).toBeGreaterThan(4.08);
  audioTime = 4.2;
  await act(() => vi.advanceTimersByTimeAsync(8200)); expect(error).toHaveBeenCalledOnce();
});

it("keeps an ordinary narrated scene on its audio clock and runs its tail after speech", async () => {
  vi.useFakeTimers();
  let audioTime: number | undefined = 0.05;
  const video: Video = { schemaVersion: "0.2", style: {}, scenes: [{ id: "one", templateId: "chapterTitle", variables: { title: "A shot" }, narration: "A short thought.", timing: { fixedDuration: 6 } }] };
  const timeRef = { current: 0 };
  renderHook(() => usePlaybackClock({ isPlaying: true, stateRef: { current: { ...createVideoState(), status: "complete", config: video } }, timeRef, audioRef: { current: null }, loopRef: { current: false }, sceneIndexRef: { current: -1 }, callbacksRef: { current: { narrationTime: () => audioTime, onSceneChange: vi.fn() } }, setCurrentTime: vi.fn(), setIsPlaying: vi.fn() }));
  await act(() => vi.advanceTimersByTimeAsync(2500)); expect(timeRef.current).toBe(0.05);
  audioTime = 2; await act(() => vi.advanceTimersByTimeAsync(50)); expect(timeRef.current).toBe(2);
  audioTime = undefined; await act(() => vi.advanceTimersByTimeAsync(100));
  expect(timeRef.current).toBeGreaterThan(2.08); expect(timeRef.current).toBeLessThan(2.12);
});

it.each([false, true])('keeps paragraph audio continuous only for a brief actual-frame handoff (cold: %s)', async (cold) => {
  vi.useFakeTimers();
  let audioTime = .1;
  const video: Video = {schemaVersion:'0.2',style:{},scenes:[0,1].map(index=>({id:String(index),templateId:'cinemaMedia',variables:{mediaUrl:`/${index}.mp4`,mediaType:'video'},timing:{fixedDuration:1},narrationGroup:{id:'paragraph',text:'One complete spoken paragraph.',offsetSeconds:index,durationSeconds:1,totalSeconds:2}}))};
  const visualReadyRef = {current:sceneReadinessKey(video.scenes[0])};
  const timeRef = {current:0}; const change=vi.fn(); const stall=vi.fn();
  const options = {stateRef:{current:{...createVideoState(),status:'complete' as const,config:video}},timeRef,visualReadyRef,audioRef:{current:null},loopRef:{current:false},sceneIndexRef:{current:-1},callbacksRef:{current:{narrationReady:()=>true,narrationTime:()=>audioTime,onSceneChange:change,onStallChange:stall}},setCurrentTime:vi.fn(),setIsPlaying:vi.fn()};
  renderHook(()=>usePlaybackClock({...options,isPlaying:true}));
  await act(()=>vi.advanceTimersByTimeAsync(32));
  audioTime=1.05;
  await act(()=>vi.advanceTimersByTimeAsync(160));
  expect(timeRef.current).toBe(1);
  expect(change).toHaveBeenCalledTimes(1);
  expect(stall).not.toHaveBeenCalledWith(true, "media-decoding");
  if(cold){
    // Streaming appends clone config/scenes; that must not renew the budget.
    options.stateRef.current={...options.stateRef.current,config:{...video,scenes:[...video.scenes]}};
    await act(()=>vi.advanceTimersByTimeAsync(100));
    expect(stall).toHaveBeenCalledWith(true, "media-decoding");
    expect(change).toHaveBeenCalledTimes(1);
  }
  visualReadyRef.current=sceneReadinessKey(video.scenes[1]);
  await act(()=>vi.advanceTimersByTimeAsync(32));
  expect(change).toHaveBeenCalledTimes(2);
  expect(timeRef.current).toBe(1.05);
  if(!cold)expect(stall).not.toHaveBeenCalledWith(true, "media-decoding");
  else expect(stall).toHaveBeenLastCalledWith(false, undefined);
});

it.each(['pause','seek','replacement','different group'] as const)('resets the paragraph handoff window on %s', async (changeKind) => {
  vi.useFakeTimers();
  let audioTime=.1;
  const video:Video={schemaVersion:'0.2',style:{},scenes:[0,1].map(index=>({id:String(index),templateId:'cinemaMedia',variables:{mediaUrl:`/${index}.mp4`,mediaType:'video'},timing:{fixedDuration:1},narrationGroup:{id:'paragraph',text:'One complete paragraph.',offsetSeconds:index,durationSeconds:1,totalSeconds:2}}))};
  const options={stateRef:{current:{...createVideoState(),requestId:'original',status:'complete' as const,config:video}},timeRef:{current:0},visualReadyRef:{current:sceneReadinessKey(video.scenes[0])},audioRef:{current:null},loopRef:{current:false},sceneIndexRef:{current:-1},callbacksRef:{current:{narrationReady:()=>true,narrationTime:()=>audioTime,onSceneChange:vi.fn(),onStallChange:vi.fn()}},setCurrentTime:vi.fn(),setIsPlaying:vi.fn()};
  const hook=renderHook(({isPlaying})=>usePlaybackClock({...options,isPlaying}),{initialProps:{isPlaying:true}});
  await act(()=>vi.advanceTimersByTimeAsync(32));
  audioTime=1.05;
  await act(()=>vi.advanceTimersByTimeAsync(160));
  expect(options.callbacksRef.current.onStallChange).not.toHaveBeenCalledWith(true, "media-decoding");
  if(changeKind==='pause'){
    hook.rerender({isPlaying:false});
    await act(()=>vi.advanceTimersByTimeAsync(1000));
    hook.rerender({isPlaying:true});
    await act(()=>vi.advanceTimersByTimeAsync(100));
    expect(options.callbacksRef.current.onStallChange).not.toHaveBeenCalledWith(true, "media-decoding");
    await act(()=>vi.advanceTimersByTimeAsync(140));
  }else{
    if(changeKind==='seek')options.timeRef.current=.99;
    if(changeKind==='replacement')options.stateRef.current={...options.stateRef.current,requestId:'replacement'};
    if(changeKind==='different group')options.stateRef.current={...options.stateRef.current,config:{...video,scenes:[video.scenes[0],{...video.scenes[1],narrationGroup:{...video.scenes[1].narrationGroup!,id:'different'}}]}};
    await act(()=>vi.advanceTimersByTimeAsync(32));
  }
  expect(options.callbacksRef.current.onStallChange).toHaveBeenCalledWith(true, "media-decoding");
});
