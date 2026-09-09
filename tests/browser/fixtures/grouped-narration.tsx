import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayer } from "../../../src/player/video-player";
import { useNarration } from "../../../src/player/use-narration";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import { getIosAudioContext } from "../../../src/player/ios-audio-output";
import type { Video } from "../../../src/protocol/types";
import audioUrl from "./media-transition/paragraph.wav?url";
import waterfallPoster from "./media-transition/waterfall.jpg?url";
import tramPoster from "./media-transition/tram.jpg?url";
import flowersPoster from "./media-transition/sunflowers.jpg?url";
import waterfall from "./media-transition/waterfall.mp4?url";
import tram from "./media-transition/tram.mp4?url";
import flowers from "./media-transition/sunflowers.mp4?url";
import waterfallWebm from "./media-transition/waterfall-hold.webm?url";
import tramWebm from "./media-transition/tram.webm?url";
import flowersWebm from "./media-transition/sunflowers.webm?url";
const media = new URLSearchParams(location.search).has("webm") ? [waterfallWebm, tramWebm, flowersWebm] : [waterfall, tram, flowers];
const probe: Array<Record<string, unknown>> = [];
Object.assign(window, { narrationProbe: probe });
const nativeVideoFrame = HTMLVideoElement.prototype.requestVideoFrameCallback;
if (nativeVideoFrame) HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
  return nativeVideoFrame.call(this, (now, metadata) => {
    if (probe.length < 500) probe.push({kind:"video-frame",source:new URL(this.currentSrc, location.href).pathname.split("/").at(-1),at:performance.now()});
    callback(now, metadata);
  });
};
const text = "First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light.";
const delayedOnset = new URLSearchParams(location.search).has("delayedOnset");
let firstAudioPlay = true;
const NativeAudio = window.Audio;
window.Audio = function (src?: string) {
  const audio = new NativeAudio(src);
  if (delayedOnset) {
    const playNow = audio.play.bind(audio);
    audio.play = async () => {
      probe.push({ kind: "play-source", source: audio.src.split(":")[0], firstAudioPlay, at: performance.now() });
      // The silent data cue only grants playback permission. Delay the first
      // actual narration blob, so the fault cannot span a source replacement.
      if (firstAudioPlay && audio.src.startsWith("blob:")) {
        firstAudioPlay = false;
        // Simulate decoder priming followed by a cold output stall.
        probe.push({ kind: "cold-output-stall", source: "blob", at: performance.now() });
        Object.defineProperty(audio, "currentTime", { configurable: true, get: () => 0.05 });
        audio.dispatchEvent(new Event("playing"));
        await new Promise((resolve) => setTimeout(resolve, 1500));
        Reflect.deleteProperty(audio, "currentTime");
        probe.push({ kind: "cold-output-release", at: performance.now() });
      }
      return playNow();
    };
  }
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
if (iosOutput && delayedOnset) {
  const resume = iosOutput.resume.bind(iosOutput);
  let gate: Promise<void> | undefined;
  let delayed = false;
  iosOutput.resume = () => {
    if (gate) return gate;
    if (delayed) return resume();
    delayed = true;
    // Unlock inside the Start gesture, then hold the actual shared output.
    // Every resume request joins this gate until the injected stall releases.
    gate = resume().then(() => iosOutput.suspend()).then(async () => {
      probe.push({ kind: "cold-output-stall", source: "buffer", at: performance.now() });
      await new Promise(resolve => setTimeout(resolve, 1500));
      await resume();
      probe.push({ kind: "cold-output-release", at: performance.now() });
    }).finally(() => { gate = undefined; });
    return gate;
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
    const segment = prepared.seconds / 3;
    setVideo({ schemaVersion: "0.2", orientation: "portrait", style: {}, scenes: media.map((mediaUrl, index) => ({
      id: String(index), templateId: "cinemaMedia", variables: { mediaUrl, mediaType: "video", mediaPoster: [waterfallPoster, tramPoster, flowersPoster][index] }, timing: { fixedDuration: segment },
      narration: ["First we see the water flowing.", "Then the tram moves through the city.", "Finally the flowers turn toward the light."][index],
      narrationGroup: { id: "paragraph", text, offsetSeconds: index * segment, durationSeconds: segment, totalSeconds: prepared.seconds },
    })) });
    setRun((value) => value + 1);
  };
  return <><button onClick={() => void start().catch(error => probe.push({ kind: "prepare-error", message: String(error) }))}>Play prerecorded paragraph</button><button onClick={() => narration.interrupt()}>Interrupt</button>
    <div style={{ width: 360 }}>{video && <VideoPlayer key={run} video={video} autoPlay controls={false}
      onError={(error) => { narration.interrupt(); probe.push({ kind: "player-error", message: String(error) }); }}
      onPlaybackMetric={metric => probe.push({ kind: "media-metric", ...metric, at: performance.now() })}
      narrationReady={narration.isReady}
      narrationTime={narration.getTime}
      onStallChange={(stalled, reason) => stalled && reason !== "speech" ? voice.pause() : voice.resume()}
      onSceneChange={(scene, index) => { probe.push({ kind: "cut", index, audioTime: voice.getCurrentTime?.() ?? 0, at:performance.now() }); narration.onSceneChange(scene, index); }}
    />}</div></>;
}
createRoot(document.getElementById("root")!).render(<App />);
