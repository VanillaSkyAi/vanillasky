import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayer } from "../../../src/player/video-player";
import { useNarration } from "../../../src/player/use-narration";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import { getIosAudioContext } from "../../../src/player/ios-audio-output";
import type { Video } from "../../../src/protocol/types";
import audioUrl from "./media-transition/clip-narration.wav?url";
import { prepareNarratedScene } from "../../../src/player/scene-readiness";
import waterfallPoster from "./media-transition/waterfall.jpg?url";
import tramPoster from "./media-transition/tram.jpg?url";
import flowersPoster from "./media-transition/sunflowers.jpg?url";
import waterfall from "./media-transition/waterfall.mp4?url";
import tram from "./media-transition/tram.mp4?url";
import flowers from "./media-transition/sunflowers.mp4?url";
import waterfallWebm from "./media-transition/waterfall-hold.webm?url";
import tramWebm from "./media-transition/tram.webm?url";
import flowersWebm from "./media-transition/sunflowers.webm?url";
const footage = new URLSearchParams(location.search).has("webm")
  ? [waterfallWebm, tramWebm, flowersWebm] : [waterfall, tram, flowers];
const probe: Array<Record<string, unknown>> = [];
Object.assign(window, { narrationProbe: probe });
let nextId = 0;
const ids = new WeakMap<HTMLVideoElement, number>();
function observe() {
  const videos = [...document.querySelectorAll("video")];
  for (const video of videos) {
    if (ids.has(video)) continue;
    const id = ++nextId; ids.set(video, id);
    const recordState = (kind: string) => {
      if (probe.length < 5000) probe.push({ kind, id, at: performance.now(),
        scene: video.closest("[data-layer-scene-id]")?.getAttribute("data-layer-scene-id"),
        layer: video.closest("[data-scene-layer]")?.getAttribute("data-scene-layer"),
        mediaTime: video.currentTime, readyState: video.readyState, networkState: video.networkState,
        paused: video.paused, seeking: video.seeking, playbackRate: video.playbackRate });
    };
    for (const kind of ["play", "playing", "pause", "waiting", "seeking", "seeked", "ended", "canplay", "error"])
      video.addEventListener(kind, () => recordState(`video-${kind}`));
    const nativePlay = video.play.bind(video);
    const nativePause = video.pause.bind(video);
    video.play = () => { recordState("video-play-request"); return nativePlay(); };
    video.pause = () => { recordState("video-pause-request"); nativePause(); };

    const frame: VideoFrameRequestCallback = (_, metadata) => {
      if (probe.length < 5000) probe.push({ kind: "frame", id, source: video.currentSrc, scene: video.closest("[data-layer-scene-id]")?.getAttribute("data-layer-scene-id") ?? video.closest("[data-persistent-video-scene-id]")?.getAttribute("data-persistent-video-scene-id"), layer: video.closest("[data-scene-layer]")?.getAttribute("data-scene-layer") ?? "active", mediaTime: metadata.mediaTime, at: performance.now() });
      if (video.isConnected) video.requestVideoFrameCallback(frame);
    };
    video.requestVideoFrameCallback(frame);
    probe.push({kind:"connected",id,source:video.src,at:performance.now()});
  }
  if (probe.length < 5000) probe.push({kind:"surface", recovery: Boolean(document.querySelector('[data-scene-layer="active"] [data-template="title"]')), audioTime:voice.getCurrentTime?.() ?? 0, sources:videos.filter(v=>v.getAttribute("src")).length, active:document.querySelector('[data-scene-layer="active"]')?.getAttribute("data-layer-scene-id"), at:performance.now()});
  requestAnimationFrame(observe);
}
requestAnimationFrame(observe);
const nativeVideoFrame = HTMLVideoElement.prototype.requestVideoFrameCallback;
if (nativeVideoFrame) HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
  return nativeVideoFrame.call(this, (now, metadata) => {
    if (probe.length < 5000) probe.push({kind:"video-frame",source:new URL(this.currentSrc, location.href).pathname.split("/").at(-1),at:performance.now()});
    callback(now, metadata);
  });
};
const text = "Water keeps flowing through the forest.";
const NativeAudio = window.Audio;
window.Audio = function (src?: string) {
  const audio = new NativeAudio(src);
  const nativePlay = audio.play.bind(audio);
  audio.play = () => nativePlay().catch(error => {
    probe.push({ kind: "play-rejected", message: String(error), readyState: audio.readyState });
    throw error;
  });
  for (const kind of ["playing", "pause", "ended", "seeking", "error", "stalled", "waiting"]) audio.addEventListener(kind, () => probe.push({ kind: audio.src.startsWith("data:") ? `activation-${kind}` : kind, audioTime: audio.currentTime, readyState: audio.readyState, error: audio.error?.message, at: performance.now() }));
  probe.push({ kind: "audio-created" });
  return audio;
} as unknown as typeof Audio;
// Observe the real iOS source clock and distinguish a stopped source from
// natural completion. Pause/resume creates a new source over the same buffer.
const iosOutput = getIosAudioContext();
if (iosOutput) {
  const createSource = iosOutput.createBufferSource.bind(iosOutput);
  const bufferIds = new WeakMap<AudioBuffer, number>();
  let nextBufferId = 0;
  iosOutput.createBufferSource = () => {
    const source = createSource();
    const start = source.start.bind(source);
    const stop = source.stop.bind(source);
    let started = false, stopped = false, ended = false, since = 0, offset = 0;
    const time = () => Math.min(source.buffer?.duration ?? Infinity, offset + Math.max(0, iosOutput.currentTime - since));
    source.start = (when = 0, position = 0, duration?: number) => {
      start(when, position, duration);
      started = true; since = Math.max(when, iosOutput.currentTime); offset = position;
      if (source.buffer && !bufferIds.has(source.buffer)) bufferIds.set(source.buffer, ++nextBufferId);
      probe.push({ kind: "buffer-start", bufferId: source.buffer ? bufferIds.get(source.buffer) : undefined, audioTime: time(), at: performance.now() });
    };
    source.stop = (when = 0) => {
      if (started && !stopped && !ended) probe.push({ kind: "pause", audioTime: time(), at: performance.now(), output: "buffer" });
      stopped = true;
      stop(when);
    };
    source.addEventListener("ended", () => {
      if (!started || stopped) return;
      ended = true;
      probe.push({ kind: "ended", audioTime: time(), at: performance.now(), output: "buffer" });
    });
    probe.push({ kind: "buffer-source-created", at: performance.now() });
    return source;
  };
}
const voice = createVideoChatVoice({ fetcher: () => fetch(audioUrl) });
const speak = voice.speak.bind(voice);
voice.speak = (text, options) => speak(text, { ...options, onStart: source => {
  if (iosOutput) probe.push({ kind: "playing", audioTime: voice.getCurrentTime?.(), at: performance.now(), output: "buffer" });
  options.onStart?.(source);
} });
function App() {
  const [video, setVideo] = useState<Video>();
  const [run, setRun] = useState(0);
  const narration = useNarration({ voice });
  const start = async () => {
    narration.interrupt();
    voice.resume();
    const prepared = await voice.prepare(text);
    probe.push({ kind: "prepared", ...prepared });
    setVideo({ schemaVersion: "0.2", orientation: "portrait", style: {}, scenes: footage.map((mediaUrl, index) => prepareNarratedScene({
      id: String(index), templateId: "cinemaMedia", variables: { mediaUrl, mediaType: "video", fallbackText: ["Water keeps moving", "The tram crosses the city", "Flowers turn toward the light"][index], mediaPoster: [waterfallPoster, tramPoster, flowersPoster][index] }, timing: { fixedDuration: 5 },
      narration: text,
    }, prepared.seconds, prepared.supportsOffsets === true).scene) });
    setRun((value) => value + 1);
  };
  return <><button onClick={() => void start().catch(error => probe.push({ kind: "prepare-error", message: String(error) }))}>Play prerecorded paragraph</button><button onClick={() => narration.interrupt()}>Interrupt</button>
    <div style={{ width: 360 }}>{video && <VideoPlayer key={run} video={video} autoPlay controls={false}
      onError={(error) => { narration.interrupt(); probe.push({ kind: "player-error", message: String(error) }); }}
      narrationReady={narration.isReady}
      narrationTime={narration.getTime}
      narrationActive={narration.isSpeaking}
      onStallChange={(stalled, reason) => stalled && reason !== "speech" ? voice.pause() : voice.resume()}
      onSceneChange={(scene, index) => { probe.push({ kind: "cut", index, audioTime: voice.getCurrentTime?.() ?? 0, at:performance.now() }); narration.onSceneChange(scene, index); }}
    />}</div></>;
}
createRoot(document.getElementById("root")!).render(<App />);
