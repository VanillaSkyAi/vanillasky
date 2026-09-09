import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CaptionWords } from "../../../src/video-chat/caption-words";
import { CaptionPages } from "../../../src/video-chat/caption-pages";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import { createCaptionVoice } from "../../../src/video-chat/caption-progress";
import "../../../styles/video-chat.css";
import audioUrl from "./media-transition/paragraph.mp3?url";
import videoUrl from "./media-transition/waterfall.mp4?url";

const recorded = new URLSearchParams(location.search).has("recorded");
const text = "First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light.";
// Controlled word intervals exercise the presentation boundary. This fixture
// uses existing offline speech and makes no claim about live provider alignment.
const wordTimings = text.split(" ").map((text, index) => ({ text, start: .12 + index * .27, end: .35 + index * .27 }));
let elapsed: number | undefined = .2;
let audio: HTMLAudioElement | undefined;
let controller: AbortController | undefined;
let audioEnded = false;
let presentedFrames = 0;
const nativeAudio = window.Audio;
window.Audio = function (src?: string) {
  const element = new nativeAudio(src);
  element.addEventListener("playing", () => { if (element.src.startsWith("blob:")) audio = element; });
  element.addEventListener("ended", () => { if (element.src.startsWith("blob:")) audioEnded = true; });
  return element;
} as unknown as typeof Audio;
const engine = createVideoChatVoice({ fetcher: async () => {
  const recording = await fetch(audioUrl);
  const bytes = new Uint8Array(await recording.arrayBuffer());
  return Response.json({ audio: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")), mediaType: "audio/mpeg", wordTimings });
} });
const observed = createCaptionVoice(engine);
const progress = recorded ? observed.getCaptionProgress : () => elapsed === undefined ? undefined : ({ text, elapsedSeconds: elapsed, durationSeconds: 6.42, timing: "audio" as const, alignment: "provider" as const, wordTimings });
Object.assign(window, {
  captionSetTime: (time: number | undefined) => { elapsed = time; },
  captionMediaState: () => ({ time: audio?.currentTime ?? 0, ended: audioEnded, videoTime: document.querySelector("video")?.currentTime ?? 0,
    frames: presentedFrames }),
});

function Fixture() {
  const [style, setStyle] = useState("words");
  const play = () => {
    controller?.abort();
    controller = new AbortController();
    audioEnded = false;
    observed.voice.resume();
    const video = document.querySelector("video")!;
    void video.play();
    void observed.voice.prepare(text).then(() => observed.voice.speak(text, { signal: controller!.signal }));
  };
  return <div className="vanillasky-video-chat">
    <div className="stage"><video ref={element => {
      if (!element) return;
      let handle = 0;
      const presented = () => { presentedFrames++; handle = element.requestVideoFrameCallback(presented); };
      handle = element.requestVideoFrameCallback(presented);
      return () => element.cancelVideoFrameCallback(handle);
    }} muted playsInline loop src={videoUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
    <div style={{ position: "absolute", top: 20, left: 20, zIndex: 40, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: "90%" }}>
      <button onClick={play}>Play recording</button>
      <button onClick={() => observed.voice.pause()}>Pause recording</button>
      <button onClick={() => observed.voice.resume()}>Resume recording</button>
      <button onClick={() => setStyle(style === "words" ? "classic" : "words")}>Switch style</button>
    </div>
    <div className="panel"><div className="panel-inner"><div className="caption-slot" data-captions="true"><div className="caption-clip">
      <div className="line-row" data-caption-style={style} data-expanded="false">
        {style === "words" ? <CaptionWords text={text} getProgress={progress} /> : <CaptionPages text={text} getProgress={progress} />}
      </div>
    </div></div></div></div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
