import { createRoot } from "react-dom/client";
import { VideoChat } from "../../../src/video-chat/video-chat";
import { createVideoChatVoice } from "../../../src/video-chat/voice";
import { checksumVideo } from "../../../src/protocol/checksum";
import { createMusicAudio, getMusicTrack } from "../../../src/music-catalog";
import type { Video, VideoAudio } from "../../../src/protocol/types";
import "../../../styles/video-chat.css";

const opening = "First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light.";
const body = "Water keeps flowing through the forest.";
const fixture = (file: string) => `/tests/browser/fixtures/media-transition/${file}`;
const proof = {
  speech: [] as Array<{ text: string; event: string; at: number }>,
  nativeAudio: 0, nativeInterruptions: 0, contexts: 0, frames: 0, videoPlayers: 0,
  mixedSamples: 0, musicStarts: 0, musicGains: [] as number[], fallback: 0,
  videoEvents: [] as Array<Record<string, unknown>>,
};
Object.assign(window, { iosAudioProof: proof });
document.addEventListener("vanillasky:media-recovery", event => proof.videoEvents.push({ kind: "recovery", reason: (event as CustomEvent).detail.reason, at: performance.now() }));

// Desktop WebKit does not reproduce iPhone's AVAudioSession. Inject its
// Audio/VideoAudio exclusion rule while retaining real decoding and clocks.
const nativeAudio = window.Audio;
const audios = new Set<HTMLAudioElement>();
window.Audio = function (src?: string) {
  proof.nativeAudio++;
  const audio = new nativeAudio(src);
  audios.add(audio);
  return audio;
} as unknown as typeof Audio;
const nativePlay = HTMLMediaElement.prototype.play;
const observed = new WeakSet<HTMLMediaElement>();
HTMLMediaElement.prototype.play = function () {
  if (this instanceof HTMLVideoElement && !observed.has(this)) {
    observed.add(this);
    proof.videoPlayers++;
    for (const kind of ["play", "playing", "pause", "waiting", "seeking", "seeked", "ended", "error"]) this.addEventListener(kind, () => proof.videoEvents.push({ kind, time: this.currentTime, muted: this.muted, paused: this.paused, at: performance.now() }));
  }
  if (this instanceof HTMLVideoElement && !this.muted) {
    for (const audio of [...audios, ...document.querySelectorAll("audio")]) {
      if (!audio.paused) { proof.nativeInterruptions++; audio.pause(); }
    }
  }
  const playing = nativePlay.call(this);
  if (this instanceof HTMLVideoElement) void playing.catch(error => proof.videoEvents.push({ kind: "rejected", name: error.name, time: this.currentTime, muted: this.muted, at: performance.now() }));
  return playing;
};

const outputs: Array<{ source: AudioBufferSourceNode; gain: GainNode; analyser: AnalyserNode; data: Float32Array<ArrayBuffer> }> = [];
const NativeContext = window.AudioContext;
window.AudioContext = class extends NativeContext {
  constructor(options?: AudioContextOptions) { super(options); proof.contexts++; }
  createBufferSource() {
    const source = super.createBufferSource();
    const connect = source.connect.bind(source);
    source.connect = ((destination: AudioNode) => {
      if (destination instanceof GainNode) {
        const analyser = this.createAnalyser();
        analyser.fftSize = 256;
        destination.connect(analyser);
        outputs.push({ source, gain: destination, analyser, data: new Float32Array(256) });
        if (source.loop) proof.musicStarts++;
      }
      return connect(destination);
    }) as typeof source.connect;
    return source;
  }
};
const voice = createVideoChatVoice({
  fetcher: async (_url, init) => fetch(fixture(JSON.parse(String(init?.body)).text === opening ? "paragraph.mp3" : "clip-narration.wav")),
  onFallback: () => { proof.fallback++; },
});
const speak = voice.speak.bind(voice);
voice.speak = async (text, options) => {
  await speak(text, { ...options, onStart: () => {
    proof.speech.push({ text, event: "start", at: performance.now() });
    options.onStart?.();
  } });
  proof.speech.push({ text, event: "end", at: performance.now() });
};
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
let sequence = 0;
let audio: VideoAudio;
function send(type: string, data: unknown) {
  stream!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ protocolVersion: "0.6", runId: "ios-mix", sequence, eventId: `ios-mix:${sequence++}`, type, data })}\n\n`));
}
const fetcher: typeof fetch = async (input, init) => {
  const action = new URL(String(input), location.origin).searchParams.get("action");
  if (action === "capabilities") return Response.json({ templates: true, generatedSpeech: true, generatedVideo: true, stockMedia: false, transcription: false, modes: ["cinematic"] });
  if (action !== "response") return Response.json({ hero: null, cards: [], suggestions: [] });
  audio = createMusicAudio(getMusicTrack(JSON.parse(String(init?.body)).initialTrackId)!);
  return new Response(new ReadableStream({ start(controller) {
    stream = controller;
    send("response.start", { requestId: "ios-mix", format: { orientation: "portrait" }, style: {}, capabilities: { templates: ["cinemaMedia"], extensions: ["data.video-chat-opening"] } });
    send("data.video-chat-opening", { line: opening });
    send("audio.set", { audio });
  } }), { headers: { "content-type": "text/event-stream" } });
};
let delivered = false;
function deliverBody() {
  if (!stream || delivered) return;
  delivered = true;
  const scenes = [0, 1, 2].map(index => ({ id: `water-${index}`, templateId: "cinemaMedia", variables: {
    mediaUrl: `${new URL(fixture(new URLSearchParams(location.search).has("webm") ? "waterfall-audio.webm" : "waterfall-audio.mp4"), location.href).href}?clip=${index}`,
    mediaType: "video", mediaAudio: "ambient", fallbackText: "Water keeps moving",
  }, narration: body, timing: { fixedDuration: 5 } }));
  const snapshot: Video = { schemaVersion: "0.2", orientation: "portrait", style: {}, audio, scenes };
  scenes.forEach((scene, position) => send("scene.add", { scene, position }));
  send("response.complete", { snapshot, checksum: checksumVideo(snapshot), finishReason: "stop" });
  stream.close();
}
let observedVideo: HTMLVideoElement | null = null;
function sample() {
  const video = document.querySelector<HTMLVideoElement>('[data-scene-layer="active"] video');
  if (video && video !== observedVideo) {
    observedVideo = video;
    const presented = () => { if (video.isConnected) { proof.frames++; video.requestVideoFrameCallback(presented); } };
    video.requestVideoFrameCallback(presented);
  }
  const sounding = outputs.filter(output => {
    output.analyser.getFloatTimeDomainData(output.data);
    return output.data.some(value => Math.abs(value) > .0001);
  });
  if (video && !video.paused && !video.muted && sounding.some(output => output.source.loop) && sounding.some(output => !output.source.loop)) {
    proof.mixedSamples++;
    proof.musicGains.push(sounding.find(output => output.source.loop)!.gain.gain.value);
  }
  requestAnimationFrame(sample);
}
requestAnimationFrame(sample);
createRoot(document.getElementById("root")!).render(<>
  <button style={{ position: "fixed", top: 10, left: 10, zIndex: 100 }} onClick={deliverBody}>Deliver body</button>
  <VideoChat options={{ fetcher, voice, mode: "cinematic", orientation: "portrait" }} />
</>);
