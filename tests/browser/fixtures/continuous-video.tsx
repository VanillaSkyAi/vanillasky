import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayer } from "../../../src/player/video-player";
import { useNarration } from "../../../src/player/use-narration";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import type { Video } from "../../../src/protocol/types";
import cueUrl from "./media-transition/activation-cue.wav?url";
import audioUrl from "./media-transition/paragraph.wav?url";
import fittingAudioUrl from "./media-transition/clip-narration.wav?url";
import { prepareNarratedScene } from "../../../src/player/scene-readiness";
import fullWebm from "./media-transition/waterfall-hold.webm?url";
import shortWebm from "./media-transition/waterfall-short.webm?url";
import audibleWebm from "./media-transition/waterfall-audio.webm?url";
import full from "./media-transition/waterfall.mp4?url";
import audible from "./media-transition/waterfall-audio.mp4?url";
import short from "./media-transition/waterfall-short.mp4?url";
const params = new URLSearchParams(location.search);
const text = params.has("oversized") ? "First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light." : "Water keeps flowing through the forest.";
const clips = params.has("webm") ? { full: fullWebm, short: shortWebm, audible: audibleWebm } : { full, short, audible };
const samples: Array<Record<string, number | string | boolean | null>> = [];
const events: string[] = [];
const phases: Array<Record<string, number | string | boolean>> = [];
Object.assign(window, { continuityProof: { samples, events, phases } });
const nativePlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  phases.push({kind:this instanceof HTMLAudioElement ? "audio-play-call" : "video-play-call",at:performance.now(),time:this.currentTime});
  if (this instanceof HTMLAudioElement && !this.dataset.observed) {
    this.dataset.observed = "true";
    this.addEventListener("ended", () => { events.push("audio-ended"); });
    this.addEventListener("playing", () => events.push("audio-playing"));
    this.addEventListener("error", () => events.push("audio-error"));
  }
  if (this instanceof HTMLVideoElement && !this.dataset.observed) {
    this.dataset.observed = "true";
    for (const kind of ["play", "waiting", "playing", "pause", "seeking", "seeked", "ended"]) this.addEventListener(kind, () => {
      events.push(`video:${kind}:${this.currentTime.toFixed(3)}:${this.paused}:${getComputedStyle(this).visibility}`);
    });
  }
  return nativePlay.call(this);
};
let latePlayInjected = false;
const nativePause = HTMLMediaElement.prototype.pause;
HTMLMediaElement.prototype.pause = function () {
  phases.push({kind:this instanceof HTMLAudioElement ? "audio-pause-call" : "video-pause-call",at:performance.now(),time:this.currentTime});
  const result = nativePause.call(this);
  if (params.has("latePlay") && this instanceof HTMLVideoElement && !latePlayInjected) {
    latePlayInjected = true;
    // Reproduce a native start arriving after the narrator requested a hold.
    setTimeout(() => {
      if (!this.isConnected) return;
      phases.push({kind:"late-native-start",at:performance.now(),time:this.currentTime});
      // Linux WebKit can advance after play/waiting without emitting playing.
      // Exercise that event sequence on every engine, including local macOS.
      const suppressPlaying = (event: Event) => event.stopImmediatePropagation();
      this.addEventListener("playing", suppressPlaying, {capture:true});
      void nativePlay.call(this)
        .catch(() => phases.push({kind:"late-start-cancelled",at:performance.now()}))
        .finally(() => this.removeEventListener("playing", suppressPlaying, {capture:true}));
    }, 100);
  }
  return result;
};
const voice = createVideoChatVoice({ fetcher: (_url, init) => fetch(JSON.parse(String(init?.body)).text === "Opening cue" ? cueUrl : params.has("oversized") ? audioUrl : fittingAudioUrl) });
const playbackVoice = { ...voice, speak: async (line: string, options: Parameters<typeof voice.speak>[1]) => {
  if (params.has("delayed")) {
    phases.push({kind:"speech-delay-start",at:performance.now()});
    const deadline = performance.now() + 1000;
    // Browser timer delivery can precede its nominal delay by a clock tick.
    // Establish the measured fault duration rather than assuming one timer did.
    while (performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.max(1, deadline - performance.now())));
    }
    phases.push({kind:"speech-delay-end",at:performance.now()});
  }
  return voice.speak(line, options);
} };
function App() {
  const [video, setVideo] = useState<Video>();
  const narration = useNarration({ voice: playbackVoice, onSpeechStart: () => phases.push({kind:"speech-onset",at:performance.now()}) });
  async function start() {
    // Match chat: an immediate opening activates the reused audio element.
    await voice.prepare("Opening cue");
    await voice.speak("Opening cue", { signal: new AbortController().signal });
    const prepared = await voice.prepare(text);
    setVideo({ schemaVersion: "0.2", orientation: "portrait", style: {}, scenes: (params.has("same-url") ? ["one", "two", "three"] : ["one"]).map(id => prepareNarratedScene({
      id, templateId: "cinemaMedia", variables: { mediaUrl: params.has("missing") ? "" : params.has("unusable") ? "data:video/mp4;base64,aW52YWxpZA==" : params.has("short") ? clips.short : params.has("audible") ? clips.audible : clips.full, mediaType: "video", fallbackText: "Water keeps moving" },
      timing: { fixedDuration: 5 }, narration: text,
    }, prepared.seconds).scene) });
    // Sample actual decoded pixels from this same-origin moving fixture. Native
    // WebKit may pin currentTime at clip duration while native looping moves.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const pixels = canvas.getContext("2d", {willReadFrequently:true})!;
    const fingerprint = (clip: HTMLVideoElement | null): number | null => {
      if (!clip || clip.readyState < 2 || !clip.videoWidth) return null;
      pixels.drawImage(clip, 0, 0, 16, 16);
      const data = pixels.getImageData(0, 0, 16, 16).data;
      let hash = 2166136261;
      for (let index = 0; index < data.length; index++) hash = Math.imul(hash ^ data[index]!, 16777619);
      return hash >>> 0;
    };
    let presentedMediaTime: number | null = null;
    let presentedFrames = 0;
    let observedClip: HTMLVideoElement | null = null;
    const observeFrames = (clip: HTMLVideoElement) => {
      const presented: VideoFrameRequestCallback = (_now, metadata) => {
        if (clip !== observedClip || !clip.isConnected) return;
        presentedMediaTime = metadata.mediaTime;
        presentedFrames = metadata.presentedFrames;
        if (document.body.dataset.proofComplete !== "true") clip.requestVideoFrameCallback(presented);
      };
      clip.requestVideoFrameCallback(presented);
    };
    const sample = () => {
      const clip = document.querySelector<HTMLVideoElement>('[data-scene-layer="active"] video');
      if (clip !== observedClip) {
        observedClip = clip;
        presentedMediaTime = null;
        presentedFrames = 0;
        if (clip && typeof clip.requestVideoFrameCallback === "function") observeFrames(clip);
      }
      const player = document.querySelector('[data-testid="video-player"]');
      samples.push({ presentedMediaTime, presentedFrames, frameFingerprint:fingerprint(clip), mediaDuration:Number.isFinite(clip?.duration) ? clip!.duration : 0, narrationReady:narration.isReady(), audioTime:voice.getCurrentTime?.() ?? -1, scene: document.querySelector("[data-video-frame]")?.getAttribute("data-scene-id") ?? "", at: performance.now(), time: clip?.currentTime ?? -1, muted: clip?.muted ?? true, paused: clip?.paused ?? true, rate: clip?.playbackRate ?? 1, ended: clip?.ended ?? false, hidden: !clip || getComputedStyle(clip).visibility === "hidden", status: document.querySelector('[data-media-continuity], [data-media-unavailable]')?.textContent ?? "", chapter: document.querySelector('[data-template="title"]')?.textContent ?? "", playerEnded: player?.getAttribute("data-ended") === "true" });
      if (player?.getAttribute("data-ended") === "true") {
        document.body.dataset.proofComplete = "true";
      } else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }
  return <><button onClick={() => void start()}>Play exact recorded narration</button>
    <div style={{ width: 360 }}>{video && <VideoPlayer video={video} autoPlay controls={false} startMuted={false} nativeMediaAudio={params.has("audible") ? { volume: .2 } : undefined}
      narrationReady={narration.isReady} narrationTime={narration.getTime} narrationActive={narration.isSpeaking}
      onStallChange={(stalled, reason) => stalled && reason !== "speech" ? voice.pause() : voice.resume()}
      onSceneChange={narration.onSceneChange}
      onError={() => events.push("player-error")}
    />}</div></>;
}
createRoot(document.getElementById("root")!).render(<App />);
