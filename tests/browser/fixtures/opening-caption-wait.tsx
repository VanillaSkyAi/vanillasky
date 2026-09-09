import React from "react";
import { createRoot } from "react-dom/client";
import { VideoChat } from "../../../src/video-chat/video-chat";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import { checksumVideo } from "../../../src/protocol/checksum";
import type { Video } from "../../../src/protocol/types";
import "../../../styles/video-chat.css";
import openingAudioUrl from "./media-transition/paragraph.mp3?url";
import bodyAudioUrl from "./media-transition/clip-narration.wav?url";
import mp4Url from "./media-transition/waterfall.mp4?url";
import webmUrl from "./media-transition/waterfall-hold.webm?url";

const opening = "First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light.";
const body = "Water keeps flowing through the forest.";
const proof = { ended: 0, speechStarts: 0, frames: 0, bodyDelivered: false,
  captions: [] as Array<{ text: string; active: boolean }> };
Object.assign(window, { openingCaptionProof: proof });
const nativeAudio = window.Audio;
window.Audio = function (src?: string) {
  const audio = new nativeAudio(src);
  audio.addEventListener("playing", () => { if (audio.src.startsWith("blob:")) proof.speechStarts++; });
  audio.addEventListener("ended", () => { if (audio.src.startsWith("blob:")) proof.ended++; });
  return audio;
} as unknown as typeof Audio;
const voice = createVideoChatVoice({ fetcher: async (_url, init) => {
  const text = JSON.parse(String(init?.body)).text as string;
  const recording = await fetch(text === opening ? openingAudioUrl : bodyAudioUrl);
  if (text !== opening) return recording;
  const bytes = new Uint8Array(await recording.arrayBuffer());
  // Fixed intervals test presentation against existing complete local speech.
  const wordTimings = opening.split(" ").map((text, index) => ({ text, start: .12 + index * .27, end: .35 + index * .27 }));
  return Response.json({ audio: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")), mediaType: "audio/mpeg", wordTimings });
} });
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
let sequence = 0;
function send(type: string, data: unknown) {
  stream!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ protocolVersion: "0.6", runId: "opening-wait", sequence, eventId: `opening-wait:${sequence++}`, type, data })}\n\n`));
}
const fetcher: typeof fetch = async (input) => {
  const action = new URL(String(input), location.origin).searchParams.get("action");
  if (action === "capabilities") return Response.json({ templates: true, generatedSpeech: true, generatedVideo: true, stockMedia: false, transcription: false, modes: ["cinematic"] });
  if (action !== "response") return Response.json({ hero: null, cards: [], suggestions: [] });
  return new Response(new ReadableStream({ start(controller) {
    stream = controller;
    send("response.start", { requestId: "opening-wait", format: { orientation: "portrait" }, style: {}, capabilities: { templates: ["cinemaMedia"], extensions: ["data.video-chat-opening"] } });
    send("data.video-chat-opening", { line: opening });
  } }), { headers: { "content-type": "text/event-stream" } });
};
function deliverBody() {
  if (!stream || proof.bodyDelivered) return;
  proof.bodyDelivered = true;
  const scene = { id: "water", templateId: "cinemaMedia", variables: {
    mediaUrl: new URL(new URLSearchParams(location.search).has("webm") ? webmUrl : mp4Url, location.href).href,
    mediaType: "video", fallbackText: "Water keeps moving",
  }, narration: body, timing: { fixedDuration: 5 } };
  const snapshot: Video = { schemaVersion: "0.2", orientation: "portrait", style: {}, scenes: [scene] };
  send("scene.add", { scene, position: 0 });
  send("response.complete", { snapshot, checksum: checksumVideo(snapshot), finishReason: "stop" });
  stream.close();
}
let observedVideo: HTMLVideoElement | null = null;
function sample() {
  if (proof.bodyDelivered && proof.speechStarts === 1) {
    const caption = document.querySelector(".word-captions");
    if (caption) proof.captions.push({ text: caption.textContent ?? "", active: Boolean(caption.querySelector('[data-active="true"]')) });
  }
  const video = document.querySelector<HTMLVideoElement>('[data-scene-layer="active"] video');
  if (video && video !== observedVideo) {
    observedVideo = video;
    const presented = () => { if (video.isConnected) { proof.frames++; video.requestVideoFrameCallback(presented); } };
    video.requestVideoFrameCallback(presented);
  }
  requestAnimationFrame(sample);
}
requestAnimationFrame(sample);
createRoot(document.getElementById("root")!).render(<>
  <button style={{ position: "fixed", top: 10, left: 10, zIndex: 100 }} onClick={deliverBody}>Deliver body</button>
  <VideoChat options={{ fetcher, voice, mode: "cinematic", orientation: "portrait", audio: { musicMood: "off" } }} />
</>);
