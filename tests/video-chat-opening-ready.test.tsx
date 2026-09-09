// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { UseVideoChatResult } from "../src/video-chat/use-video-chat";
import type { CaptionProgress } from "../src/video-chat/caption-progress";
import type { VideoPlayerProps } from "../src/player/video-player";
import { DEFAULT_AUDIO_PREFERENCES } from "../src/video-chat/audio-preferences";
const fixture = vi.hoisted(() => ({chat: {} as UseVideoChatResult, player: undefined as VideoPlayerProps | undefined, progress: undefined as CaptionProgress | undefined, captionKey: 0}));
vi.mock("../src/video-chat/use-video-chat", () => ({useVideoChatSession: () => ({chat: fixture.chat, restoreSession: vi.fn(), getCaptionProgress: () => fixture.progress, captionKey: fixture.captionKey})}));
vi.mock("../src/player/video-player", () => ({VideoPlayer: (props: VideoPlayerProps) => { fixture.player = props; return <div data-test-player />; }}));
import { VideoChat } from "../src/video-chat/video-chat";
const scene = {id:"body", templateId:"chapterTitle", variables:{title:"Useful answer"}, narration:"A useful answer", timing:{fixedDuration:4}};
function setup() {
  fixture.progress = undefined;
  fixture.captionKey = 0;
  const turn = {id:"turn", prompt:"A topic", opening:"An authored opening", mode:"pexels", createdAt:0};
  fixture.chat = {turns:[turn], shownTurn:turn, status:"composing", playerKey:0, availableModes:["pexels"], warnings:[], suggestions:[], transcript:[], ask:vi.fn(), reset:vi.fn(), pause:vi.fn(), resume:vi.fn(), cancel:vi.fn(), setMuted:vi.fn(), audioPreferences:DEFAULT_AUDIO_PREFERENCES} as unknown as UseVideoChatResult;
  return render(<VideoChat />);
}
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
it.each([false,true])("keeps the same opening while one player prepares, including chapter recovery (delayed voice=%s)", async delayed => {
  const view = setup();
  const opening = view.container.querySelector("[data-opening-chapter]");
  let ready = !delayed;
  const cue = vi.fn();
  fixture.chat = {...fixture.chat, status:"playing", playerKey:1, playerProps:{onSceneChange:cue, narrationReady:()=>ready}};
  view.rerender(<VideoChat />);
  expect(view.container.querySelector("[data-opening-chapter]")).toBe(opening);
  expect(view.container.querySelectorAll("[data-test-player]")).toHaveLength(1);
  await act(async () => {fixture.player!.onFramePresented?.(); fixture.player!.onMediaFramePresented?.();});
  expect(view.container.querySelector("[data-opening-chapter]")).toBe(opening);
  await act(async () => {fixture.player!.onSceneChange?.(scene,0);});
  expect(cue).toHaveBeenCalledOnce();
  if(delayed) {
    expect(view.container.querySelector("[data-opening-chapter]")).toBe(opening);
    ready=true;
    await act(async () => {await new Promise(resolve=>setTimeout(resolve,40));});
  }
  expect(view.container.querySelector("[data-opening-chapter]")).toBeNull();
  await act(async () => {fixture.player!.onSceneChange?.({...scene,id:"later"},1);});
  expect(cue).toHaveBeenCalledTimes(2);
});
it.each(["error","cancelled"])("stops a waiting handoff on %s and ignores an old player cue", async status => {
  const view=setup();
  fixture.chat={...fixture.chat,status:"playing",playerKey:1,playerProps:{narrationReady:()=>false}};
  view.rerender(<VideoChat />);
  const old=fixture.player!;
  fixture.chat={...fixture.chat,status:status as UseVideoChatResult["status"],playerProps:undefined,...(status==="error"?{error:{message:"Try again"} as UseVideoChatResult["error"]}:{})};
  view.rerender(<VideoChat />);
  await act(async()=>{old.onSceneChange?.(scene,0);});
  expect(view.container.querySelector("[data-opening-chapter]")).toBeNull();
});

it("invalidates a pending observer on replacement and unmount", async () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence=0;
  vi.stubGlobal("requestAnimationFrame", (callback:FrameRequestCallback) => {callbacks.set(++sequence,callback);return sequence;});
  const cancelled=vi.fn((id:number)=>callbacks.delete(id));
  vi.stubGlobal("cancelAnimationFrame",cancelled);
  const view=setup();
  let ready=false;
  const oldCue=vi.fn();
  fixture.chat={...fixture.chat,status:"playing",playerKey:1,playerProps:{onSceneChange:oldCue,narrationReady:()=>ready}};
  view.rerender(<VideoChat />);
  await act(async()=>{fixture.player!.onSceneChange?.({...scene,templateId:"cinemaMedia"},0);});
  const stalePlayer=fixture.player!;
  const stale=callbacks.get(sequence)!;
  const oldId=sequence;
  fixture.chat={...fixture.chat,playerKey:2};
  view.rerender(<VideoChat />);
  expect(cancelled).toHaveBeenCalledWith(oldId);
  ready=true;
  oldCue.mockClear();
  await act(async()=>{stale(20); stalePlayer.onSceneChange?.(scene,1);});
  expect(oldCue).not.toHaveBeenCalled();
  expect(view.container.querySelector("[data-opening-chapter]")).not.toBeNull();
  ready=false;
  await act(async()=>{fixture.player!.onSceneChange?.(scene,0);});
  const activeId=sequence;
  view.unmount();
  expect(cancelled).toHaveBeenCalledWith(activeId);
});


it.each(["audio", "estimated"] as const)("holds the completed opening phrase when cold body playback mounts (%s clock)", async timing => {
  const view = setup();
  const opening = "Water keeps flowing through the forest and into the valley.";
  fixture.progress = { text: opening, elapsedSeconds: 2.9, durationSeconds: 3, timing,
    ...(timing === "estimated" ? { wordIndex: 10, alignment: "browser" as const } : {}) };
  fixture.chat = { ...fixture.chat, caption: opening, speaking: true, status: "playing" };
  view.rerender(<VideoChat />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  const finalPhrase = view.container.querySelector(".word-captions")!.textContent;
  expect(finalPhrase).toContain("valley.");

  fixture.progress = undefined;
  fixture.chat = { ...fixture.chat, speaking: false, status: "composing" };
  view.rerender(<VideoChat />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(view.container.querySelector(".word-captions")!.textContent).toBe(finalPhrase);

  // The first prepared scene creates a player before its real decoder/voice
  // readiness gate releases the opening. That is not a new caption cue.
  fixture.chat = { ...fixture.chat, playerKey: 1, status: "playing", playerProps: { narrationReady: () => false } };
  view.rerender(<VideoChat />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(view.container.querySelector(".word-captions")!.textContent).toBe(finalPhrase);
  expect(view.container.querySelector('.caption-word[data-active="true"]')).toBeNull();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });
  expect(view.container.querySelector(".word-captions")!.textContent).toBe(finalPhrase);

  // An intentional same-turn replay must still restart estimated subtitles
  // when the voice is muted and cannot provide a fresh playback clock.
  fixture.chat = { ...fixture.chat, muted: true, playerKey: 2 };
  fixture.captionKey++;
  view.rerender(<VideoChat />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(view.container.querySelector(".word-captions")!.textContent).toBe("Water keeps flowing");
});
