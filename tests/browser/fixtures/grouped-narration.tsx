import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayer } from "../../../src/player/video-player";
import { useNarration } from "../../../src/player/use-narration";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import type { Video } from "../../../src/protocol/types";
import audioUrl from "./media-transition/paragraph.wav?url";
import waterfallPoster from "./media-transition/waterfall.jpg?url";
import tramPoster from "./media-transition/tram.jpg?url";
import flowersPoster from "./media-transition/sunflowers.jpg?url";
import waterfall from "./media-transition/waterfall.mp4?url";
import tram from "./media-transition/tram.mp4?url";
import flowers from "./media-transition/sunflowers.mp4?url";
const probe: Array<Record<string, unknown>> = [];
Object.assign(window, { narrationProbe: probe });
const text = "First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light.";
const delayedOnset = new URLSearchParams(location.search).has("delayedOnset");
let firstAudioPlay = true;
const NativeAudio = window.Audio;
let playingAudio: HTMLAudioElement | undefined;
window.Audio = function (src?: string) {
  const audio = new NativeAudio(src);
  playingAudio = audio;
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
const voice = createVideoChatVoice({ fetcher: () => fetch(audioUrl) });
function App() {
  const [video, setVideo] = useState<Video>();
  const [run, setRun] = useState(0);
  const narration = useNarration({ voice });
  const start = async () => {
    narration.interrupt();
    const prepared = await voice.prepare(text);
    probe.push({ kind: "prepared", ...prepared });
    const segment = prepared.seconds / 3;
    setVideo({ schemaVersion: "0.2", orientation: "portrait", style: {}, scenes: [waterfall, tram, flowers].map((mediaUrl, index) => ({
      id: String(index), templateId: "cinemaMedia", variables: { mediaUrl, mediaType: "video", mediaPoster: [waterfallPoster, tramPoster, flowersPoster][index] }, timing: { fixedDuration: segment },
      narration: ["First we see the water flowing.", "Then the tram moves through the city.", "Finally the flowers turn toward the light."][index],
      narrationGroup: { id: "paragraph", text, offsetSeconds: index * segment, durationSeconds: segment, totalSeconds: prepared.seconds },
    })) });
    setRun((value) => value + 1);
  };
  return <><button onClick={() => void start().catch(error => probe.push({ kind: "prepare-error", message: String(error) }))}>Play prerecorded paragraph</button><button onClick={() => narration.interrupt()}>Interrupt</button>
    <div style={{ width: 360 }}>{video && <VideoPlayer key={run} video={video} autoPlay controls={false}
      onError={(error) => { narration.interrupt(); probe.push({ kind: "player-error", message: String(error) }); }}
      narrationReady={narration.isReady}
      narrationTime={narration.getTime}
      onStallChange={(stalled) => stalled ? voice.pause() : voice.resume()}
      onSceneChange={(scene, index) => { probe.push({ kind: "cut", index, audioTime: playingAudio?.currentTime ?? 0 }); narration.onSceneChange(scene, index); }}
    />}</div></>;
}
createRoot(document.getElementById("root")!).render(<App />);
