import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayer } from "../../../src/player/video-player";
import { useNarration } from "../../../src/player/use-narration";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import type { Video } from "../../../src/protocol/types";
import cueUrl from "./media-transition/activation-cue.wav?url";
import audioUrl from "./media-transition/paragraph.wav?url";
import fullWebm from "./media-transition/waterfall-hold.webm?url";
import shortWebm from "./media-transition/waterfall-short.webm?url";
import audibleWebm from "./media-transition/waterfall-audio.webm?url";
import full from "./media-transition/waterfall.mp4?url";
import audible from "./media-transition/waterfall-audio.mp4?url";
import short from "./media-transition/waterfall-short.mp4?url";
const text = "First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light.";
const params = new URLSearchParams(location.search);
const clips = params.has("webm") ? { full: fullWebm, short: shortWebm, audible: audibleWebm } : { full, short, audible };
const samples: Array<Record<string, number | string | boolean>> = [];
const events: string[] = [];
Object.assign(window, { continuityProof: { samples, events } });
const nativePlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  if (this instanceof HTMLAudioElement && !this.dataset.observed) {
    this.dataset.observed = "true";
    this.addEventListener("ended", () => { events.push("audio-ended"); });
    this.addEventListener("playing", () => events.push("audio-playing"));
    this.addEventListener("error", () => events.push("audio-error"));
  }
  return nativePlay.call(this);
};
const voice = createVideoChatVoice({ fetcher: (_url, init) => fetch(JSON.parse(String(init?.body)).text === "Opening cue" ? cueUrl : audioUrl) });
const playbackVoice = { ...voice, speak: async (line: string, options: Parameters<typeof voice.speak>[1]) => {
  if (params.has("delayed")) await new Promise(resolve => setTimeout(resolve, 1000));
  return voice.speak(line, options);
} };
function App() {
  const [video, setVideo] = useState<Video>();
  const narration = useNarration({ voice: playbackVoice });
  async function start() {
    // Match chat: an immediate opening activates the reused audio element.
    await voice.prepare("Opening cue");
    await voice.speak("Opening cue", { signal: new AbortController().signal });
    const prepared = await voice.prepare(text);
    setVideo({ schemaVersion: "0.2", orientation: "portrait", style: {}, scenes: [{
      id: "one", templateId: "cinemaMedia", variables: { mediaUrl: params.has("missing") ? "" : params.has("unusable") ? "data:video/mp4;base64,aW52YWxpZA==" : params.has("short") ? clips.short : params.has("audible") ? clips.audible : clips.full, mediaType: "video", fallbackText: "Water keeps moving" },
      timing: { fixedDuration: prepared.seconds }, narration: text,
    }] });
    const sample = () => {
      const clip = document.querySelector("video");
      const player = document.querySelector('[data-testid="video-player"]');
      samples.push({ at: performance.now(), time: clip?.currentTime ?? -1, muted: clip?.muted ?? true, paused: clip?.paused ?? true, rate: clip?.playbackRate ?? 1, ended: clip?.ended ?? false, hidden: !clip || getComputedStyle(clip).visibility === "hidden", status: document.querySelector('[data-media-continuity], [data-media-unavailable]')?.textContent ?? "", chapter: document.querySelector('[data-template="title"]')?.textContent ?? "", playerEnded: player?.getAttribute("data-ended") === "true" });
      if (player?.getAttribute("data-ended") === "true") {
        document.body.dataset.proofComplete = "true";
      } else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }
  return <><button onClick={() => void start()}>Play exact recorded narration</button>
    <div style={{ width: 360 }}>{video && <VideoPlayer video={video} autoPlay controls={false} startMuted={false} nativeMediaAudio={params.has("audible") ? { volume: .2 } : undefined}
      narrationReady={narration.isReady} narrationTime={narration.getTime}
      onStallChange={stalled => stalled ? voice.pause() : voice.resume()}
      onSceneChange={narration.onSceneChange}
      onError={() => events.push("player-error")}
    />}</div></>;
}
createRoot(document.getElementById("root")!).render(<App />);
