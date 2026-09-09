import {describe,it,expect,vi} from "vitest";
import {createCaptionVoice} from "../src/video-chat/caption-progress";
import type {VideoChatVoice} from "../src/video-chat/voice";
function fixture(clock = true) {
  let time=0, now=0;
  const calls: {options:Parameters<VideoChatVoice["speak"]>[1]; end:() => void}[]=[];
  const source: VideoChatVoice = {prepare:vi.fn(async()=>({seconds:12})), speak:vi.fn((_text, options)=>new Promise<void>(end=>calls.push({options,end}))), pause:vi.fn(),resume:vi.fn(),setMuted:vi.fn(), ...(clock ? {getCurrentTime:()=>time} : {})};
  return {source,calls,adapter:createCaptionVoice(source,()=>now), audio:(value:number)=>{time=value;}, wall:(value:number)=>{now=value;}};
}
describe("private caption progress",()=>{
 it("carries prepared word times with the audio clock and drops them for browser fallback",async()=>{
  const f=fixture(), text="Hello bright world.";
  const wordTimings=[{text:"Hello",start:0.2,end:0.6},{text:"bright",start:0.8,end:1.2},{text:"world.",start:1.4,end:2}];
  vi.mocked(f.source.prepare).mockResolvedValue({seconds:2.2,wordTimings});
  await f.adapter.voice.prepare(text);
  const task=f.adapter.voice.speak(text,{signal:new AbortController().signal});
  f.calls[0]!.options.onStart?.("generated"); f.audio(1);
  expect(f.adapter.getCaptionProgress()).toMatchObject({wordTimings,alignment:"provider",elapsedSeconds:1});
  f.calls[0]!.end(); await task;
  const replay=f.adapter.voice.speak(text,{signal:new AbortController().signal});
  f.calls[1]!.options.onStart?.("browser");
  expect(f.adapter.getCaptionProgress()?.wordTimings).toBeUndefined();
  f.calls[1]!.options.onBoundary?.(6);
  expect(f.adapter.getCaptionProgress()).toMatchObject({wordIndex:1,alignment:"browser"});
  f.adapter.voice.pause(); f.calls[1]!.options.onBoundary?.(13);
  expect(f.adapter.getCaptionProgress()?.wordIndex).toBe(1);
  f.adapter.voice.resume(); f.calls[1]!.options.onBoundary?.(13);
  expect(f.adapter.getCaptionProgress()?.wordIndex).toBe(2);
  f.calls[1]!.end(); await replay;
 });
 it("waits for actual onset, follows audio rather than wall time, and freezes through pause/stall",async()=>{
  const f=fixture(); await f.adapter.voice.prepare("A complete spoken paragraph.");
  const task=f.adapter.voice.speak("A complete spoken paragraph.",{signal:new AbortController().signal});
  f.audio(2); f.wall(9000); expect(f.adapter.getCaptionProgress()).toBeUndefined();
  f.calls[0]!.options.onStart?.("generated");
  expect(f.adapter.getCaptionProgress()).toMatchObject({elapsedSeconds:2,durationSeconds:12,timing:"audio"});
  f.adapter.voice.pause(); f.audio(4); f.wall(30000);
  expect(f.adapter.getCaptionProgress()?.elapsedSeconds).toBe(2);
  f.adapter.voice.resume(); expect(f.adapter.getCaptionProgress()?.elapsedSeconds).toBe(4);
  f.calls[0]!.end(); await task; expect(f.adapter.getCaptionProgress()).toBeUndefined();
  expect(f.source.prepare).toHaveBeenCalledTimes(1); expect(f.source.speak).toHaveBeenCalledTimes(1);
 });
 it("estimates only active browser speech time and holds repeated pauses",async()=>{
  const f=fixture(false); await f.adapter.voice.prepare("Browser speech remains complete.");
  const task=f.adapter.voice.speak("Browser speech remains complete.",{signal:new AbortController().signal});
  f.wall(5000); f.calls[0]!.options.onStart?.("browser"); f.wall(7000);
  expect(f.adapter.getCaptionProgress()).toMatchObject({elapsedSeconds:2,timing:"estimated"});
  f.adapter.voice.pause(); f.wall(17000); f.adapter.voice.pause();
  expect(f.adapter.getCaptionProgress()?.elapsedSeconds).toBe(2);
  f.adapter.voice.resume(); f.wall(18000); expect(f.adapter.getCaptionProgress()?.elapsedSeconds).toBe(3);
  f.calls[0]!.end(); await task;
 });
 it("resets on cancellation and ignores completion/onset from a replaced utterance",async()=>{
  const f=fixture(), first=new AbortController();
  const old=f.adapter.voice.speak("First line",{signal:first.signal});
  f.calls[0]!.options.onStart?.("generated"); first.abort(); expect(f.adapter.getCaptionProgress()).toBeUndefined();
  f.audio(0); const replay=f.adapter.voice.speak("Replayed whole line",{signal:new AbortController().signal});
  f.calls[0]!.options.onStart?.("generated"); expect(f.adapter.getCaptionProgress()).toBeUndefined();
  f.calls[1]!.options.onStart?.("generated"); f.calls[0]!.end(); await old;
  expect(f.adapter.getCaptionProgress()).toMatchObject({text:"Replayed whole line",elapsedSeconds:0});
  f.adapter.reset(); expect(f.adapter.getCaptionProgress()).toBeUndefined(); f.calls[1]!.end(); await replay;
 });
 it("preserves a grouped seek offset and exposes full utterance without modifying speech",async()=>{
  const f=fixture(); await f.adapter.voice.prepare("One complete group.");
  const task=f.adapter.voice.speak("One complete group.",{signal:new AbortController().signal,offsetSeconds:5});
  f.audio(5); f.calls[0]!.options.onStart?.("generated");
  expect(f.adapter.getCaptionProgress()).toMatchObject({text:"One complete group.",elapsedSeconds:5,durationSeconds:12});
  expect(f.calls[0]!.options.offsetSeconds).toBe(5);
  f.calls[0]!.end(); await task;
 });
});
