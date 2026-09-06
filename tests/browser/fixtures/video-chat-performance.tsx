import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useVideoChat, VideoPlayer, type VideoChatVoice } from "../../../src/react";
import type { Video, VideoScene } from "../../../src/index";
import { checksumVideo } from "../../../src/protocol/checksum";
import { TEST_VIDEO_STYLE } from "../../semantic-brand-fixture";

// The stream stays open until the test releases its second scene. All providers
// and speech are simulated; timings describe this controlled browser journey.
let releaseScene = () => {};
const scenes: VideoScene[] = [1, 2].map((value) => ({
  id: `scene-${value}`, templateId: "keyFigure",
  variables: { value: String(value), label: "A controlled response" },
  timing: { fixedDuration: 8 }, narration: "A short line.",
}));
const fetcher: typeof fetch = async (input) => {
  const action = new URL(String(input), location.origin).searchParams.get("action");
  if (action === "capabilities") return Response.json({ templates: true, generatedSpeech: false, generatedVideo: false, stockMedia: false, transcription: false, modes: ["cinematic"] });
  if (action === "welcome") return Response.json({ hero: null, cards: [] });
  if (action === "suggestions") return Response.json({ suggestions: [] });
  if (action === "media") return Response.json({ media: null });
  if (action !== "response") return new Response(null, { status: 204 });
  const snapshot: Video = { schemaVersion: "0.2", orientation: "landscape", style: TEST_VIDEO_STYLE, scenes };
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      let sequence = 0;
      const emit = (type: string, data: unknown) => {
        const event = { protocolVersion: "0.6", type, eventId: `controlled:${sequence}`, runId: "controlled", sequence: sequence++, data };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      emit("response.start", { requestId: "controlled", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["keyFigure"], extensions: ["data.video-chat-opening"] } });
      emit("data.video-chat-opening", { line: "An opening hook.", keyword: "" });
      emit("scene.add", { scene: scenes[0], position: 0 });
      releaseScene = () => {
        emit("scene.add", { scene: scenes[1], position: 1 });
        emit("response.complete", { finishReason: "stop", snapshot, checksum: checksumVideo(snapshot) });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        releaseScene = () => {};
      };
    },
  }), { headers: { "content-type": "text/event-stream", "x-vanillasky-video-stream": "0.6" } });
};
const voice: VideoChatVoice = {
  prepare: async () => ({ seconds: new URLSearchParams(location.search).has("shortBuffer") ? 0.1 : 7.2 }),
  speak: async (_text, options) => {
    if (!options.signal.aborted) options.onStart?.();
  },
  pause() {}, resume() {}, setMuted() {},
};
function App() {
  const [metrics, setMetrics] = useState<unknown[]>([]);
  const chat = useVideoChat({ fetcher, voice, createTurnId: () => "controlled-turn", onPlaybackMetric: (metric: unknown) => setMetrics((current) => [...current, metric]) });
  return <>
    <button onClick={() => { void chat.ask("private-prompt-canary https://private-provider.invalid"); }}>Ask</button>
    <button onClick={() => releaseScene()}>Release scene</button>
    <button onClick={chat.pause}>Pause</button><button onClick={chat.resume}>Resume</button>
    <output data-testid="status">{chat.status}</output>
    <pre data-testid="metrics">{JSON.stringify(metrics)}</pre>
    {chat.playerProps && <VideoPlayer key={chat.playerKey} {...chat.playerProps} width={480} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
