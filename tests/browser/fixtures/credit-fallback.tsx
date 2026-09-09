import React from "react";
import { createRoot } from "react-dom/client";
import { VideoChat, type VideoChatVoice } from "../../../src/react";
import { checksumVideo } from "../../../src/protocol/checksum";
import type { VideoScene } from "../../../src/protocol/types";
import { TEST_VIDEO_STYLE } from "../../helpers/video-style";
import "../../../styles/video-chat.css";
import footageMp4 from "./media-transition/waterfall.mp4?url";
import footageWebm from "./media-transition/waterfall-hold.webm?url";

const params = new URLSearchParams(location.search);
const footage = params.has("footage");

const scene: VideoScene = {
  id: "pexels-fallback",
  templateId: footage ? "cinemaMedia" as const : "chapterTitle" as const,
  variables: footage ? { mediaUrl: params.has("webm") ? footageWebm : footageMp4, mediaType: "video", fallbackText: "Pexels keeps your answer moving" } : { title: "Pexels keeps your answer moving" },
  narration: "When AI video credits run out, VanillaSky continues with relevant Pexels footage.",
  timing: { fixedDuration: 8 },
};
const snapshot = { schemaVersion: "0.2" as const, orientation: "landscape" as const, scenes: [scene], style: TEST_VIDEO_STYLE };
const events = [
  { type: "response.start", data: { requestId: "fallback", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle", "cinemaMedia"] } } },
  { type: "scene.add", data: { scene, position: 0 } },
  { type: "response.complete", data: { finishReason: "stop", snapshot, checksum: checksumVideo(snapshot) } },
];
const voice: VideoChatVoice = { prepare: async () => ({ seconds: 8 }), speak: async () => {}, pause() {}, resume() {}, setMuted() {} };
const fetcher: typeof fetch = async (input) => {
  const action = new URL(String(input), location.href).searchParams.get("action");
  if (action === "capabilities") return Response.json({ templates: true, generatedSpeech: false, generatedVideo: true, stockMedia: true, transcription: false, modes: ["cinematic", "pexels"] });
  if (action === "welcome") return Response.json({ hero: null, cards: [{ prompt: "Show the fallback banner", media: null }] });
  if (action === "opening-media") return Response.json({ media: null });
  return new Response(events.map((part, sequence) => `data: ${JSON.stringify({ protocolVersion: "0.6", eventId: `fallback:${sequence}`, runId: "fallback", sequence, ...part })}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream", "x-vanillasky-video-stream": "0.6", "x-vanillasky-resolved-video-mode": "pexels", "x-vanillasky-video-fallback": "credits" },
  });
};

createRoot(document.getElementById("root")!).render(<VideoChat options={{ fetcher, mode: "cinematic", voice, audio: { musicMood: "off" } }} />);
