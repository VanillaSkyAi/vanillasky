import React from 'react';
import { createRoot } from 'react-dom/client';
import { VideoChat } from '../../../src/react';
import type { Video, VideoScene } from '../../../src/index';
import { checksumVideo } from '../../../src/protocol/checksum';
import { TEST_VIDEO_STYLE } from '../../semantic-brand-fixture';
import '../../../styles/video-chat.css';

type Sample = { at: number; opening: boolean; videos: number; frame: boolean; visibleFrame: boolean; moving: boolean };
type Probe = { started: number; samples: Sample[]; audio: { kind: string; at: number; time: number; duration: number | null }[] };
const probe: Probe = { started: 0, samples: [], audio: [] };
Object.assign(window, { posterProbe: probe });
const observed = new WeakSet<HTMLVideoElement>();
const frames = new WeakMap<HTMLVideoElement, number>();
const moving = new WeakSet<HTMLVideoElement>();
const at = () => performance.now() - probe.started;
function visible(video: HTMLVideoElement): boolean {
  if (video.getBoundingClientRect().width === 0) return false;
  for (let element: Element | null = video; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  }
  return true;
}
function observe() {
  if (probe.started && probe.samples.length < 1500) {
    const videos = [...document.querySelectorAll('video')];
    for (const video of videos) if (!observed.has(video)) {
      observed.add(video);
      const tick = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        const previous = frames.get(video);
        if (previous !== undefined && metadata.mediaTime > previous) moving.add(video);
        frames.set(video, metadata.mediaTime);
        if (video.isConnected) video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);
    }
    probe.samples.push({ at: at(), opening: Boolean(document.querySelector('[data-opening-chapter]')),
      videos: videos.length, frame: videos.some(video => frames.has(video)), visibleFrame: videos.some(video => frames.has(video) && visible(video)), moving: videos.some(video => moving.has(video)) });
  }
  requestAnimationFrame(observe);
}
requestAnimationFrame(observe);
const play = HTMLMediaElement.prototype.play;
const audioSeen = new WeakSet<HTMLMediaElement>();
HTMLMediaElement.prototype.play = function () {
  if (this instanceof HTMLAudioElement && !audioSeen.has(this)) {
    audioSeen.add(this);
    for (const kind of ['playing', 'ended', 'error']) this.addEventListener(kind, () => probe.audio.push({ kind, at: at(), time: this.currentTime, duration: Number.isFinite(this.duration) ? this.duration : null }));
  }
  return play.call(this);
};
const fetcher: typeof fetch = async input => {
  const action = new URL(String(input), location.origin).searchParams.get('action');
  if (action === 'capabilities') return Response.json({ templates: true, generatedSpeech: true, generatedVideo: true, stockMedia: false, transcription: false, modes: ['cinematic'] });
  if (action === 'welcome') return Response.json({ hero: null, cards: [] });
  if (action === 'suggestions') return Response.json({ suggestions: [] });
  if (action === 'speech') return fetch('./media-transition/paragraph.mp3');
  if (action !== 'response') return new Response(null, { status: 204 });
  probe.started = performance.now();
  const clip = new URLSearchParams(location.search).get('clip') ?? 'sunflowers.mp4';
  const scene: VideoScene = { id: 'poster-shot', templateId: 'cinemaMedia', narration: 'A complete prerecorded local narration.',
    variables: { mediaType: 'video', mediaUrl: new URL(`./media-transition/${clip}`, location.href).href,
      mediaPoster: new URL('./never-ready-poster.jpg', location.href).href, fallbackText: 'Sunflowers in motion' }, timing: { fixedDuration: 8 } };
  const snapshot: Video = { schemaVersion: '0.2', orientation: 'landscape', style: TEST_VIDEO_STYLE, scenes: [scene] };
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    let sequence = 0;
    const emit = (type: string, data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ protocolVersion: '0.6', type, eventId: `poster:${sequence}`, runId: 'poster', sequence: sequence++, data })}\n\n`));
    emit('response.start', { requestId: 'poster', format: { orientation: 'landscape' }, style: TEST_VIDEO_STYLE, capabilities: { templates: ['cinemaMedia'] } });
    emit('scene.add', { scene, position: 0 });
    emit('response.complete', { finishReason: 'stop', snapshot, checksum: checksumVideo(snapshot) });
    controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
};
createRoot(document.getElementById('root')!).render(<VideoChat options={{ fetcher, mode: 'cinematic' }} />);
