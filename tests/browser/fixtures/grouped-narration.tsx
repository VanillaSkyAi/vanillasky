import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayer } from "../../../src/player/video-player";
import { useNarration } from "../../../src/player/use-narration";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import type { Video } from "../../../src/protocol/types";
import audioUrl from "./media-transition/paragraph.wav?url";
import waterfall from "./media-transition/waterfall.mp4?url";
import tram from "./media-transition/tram.mp4?url";
import flowers from "./media-transition/sunflowers.mp4?url";
const probe: Array<Record<string, unknown>> = [];
Object.assign(window, { narrationProbe: probe });
const text = "First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light.";
const NativeAudio = window.Audio;
let playingAudio: HTMLAudioElement | undefined;
window.Audio = function (src?: string) {
  const audio = new NativeAudio(src);
  playingAudio = audio;
  for (const kind of ["playing", "pause", "ended", "seeking"]) audio.addEventListener(kind, () => probe.push({ kind, audioTime: audio.currentTime, at: performance.now() }));
  probe.push({ kind: "audio-created" });
  return audio;
} as typeof Audio;
const voice = createVideoChatVoice({ fetcher: () => fetch(audioUrl) });
function App() {
  const [video, setVideo] = useState<Video>();
  const [run, setRun] = useState(0);
  const narration = useNarration({ voice });
  const start = async () => {
    narration.interrupt();
    const prepared = await voice.prepare(text);
    const segment = prepared.seconds / 3;
    setVideo({ schemaVersion: "0.2", orientation: "portrait", style: {}, scenes: [waterfall, tram, flowers].map((mediaUrl, index) => ({
      id: String(index), templateId: "cinemaMedia", variables: { mediaUrl, mediaType: "video" }, timing: { fixedDuration: segment },
      narration: ["First we see the water flowing.", "Then the tram moves through the city.", "Finally the flowers turn toward the light."][index],
      narrationGroup: { id: "paragraph", text, offsetSeconds: index * segment, durationSeconds: segment, totalSeconds: prepared.seconds },
    })) });
    setRun((value) => value + 1);
  };
  return <><button onClick={() => void start()}>Play prerecorded paragraph</button><button onClick={() => narration.interrupt()}>Interrupt</button>
    <div style={{ width: 360 }}>{video && <VideoPlayer key={run} video={video} autoPlay controls={false}
      onStallChange={(stalled) => stalled ? voice.pause() : voice.resume()}
      onSceneChange={(scene, index) => { probe.push({ kind: "cut", index, audioTime: playingAudio?.currentTime ?? 0 }); narration.onSceneChange(scene, index); }}
    />}</div></>;
}
createRoot(document.getElementById("root")!).render(<App />);
