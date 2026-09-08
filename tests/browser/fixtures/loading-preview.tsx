import React from 'react';
import { createRoot } from 'react-dom/client';
import { VideoChat, type VideoChatVoice } from '../../../src/react';
import type { Video, VideoScene } from "../../../src/protocol/types";
import { checksumVideo } from '../../../src/protocol/checksum';
import { TEST_VIDEO_STYLE } from '../../semantic-brand-fixture';
import '../../../styles/video-chat.css';

// Deliberately held offline stream for design review. No provider calls.
let release = () => {};
const transcriptPreview = new URLSearchParams(location.search).has('transcript');
const voice: VideoChatVoice = {
  prepare: async () => ({ seconds: 1 }),
  speak: async (_text, { onStart, signal }) => {
    onStart?.();
    document.body.dataset.previewVoice = 'speaking';
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2000);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    document.body.dataset.previewVoice = 'finished';
    document.body.dataset.previewVoiceEndedAt = String(performance.now());
  },
  pause() {}, resume() {}, setMuted() {},
};
const fetcher: typeof fetch = async input => {
  const action = new URL(String(input), location.origin).searchParams.get('action');
  if (action === 'capabilities') return Response.json({ templates: true, generatedSpeech: false, generatedVideo: true, stockMedia: false, transcription: false, modes: ['cinematic'] });
  if (action === 'welcome') return Response.json({ hero: null, cards: [{ prompt: 'How do sunflowers follow the light?', media: null }] });
  if (action === 'suggestions') return Response.json({ suggestions: transcriptPreview ? [{ prompt: 'Why do flowers face the sun?', media: null }] : [] });
  if (action !== 'response') return new Response(null, { status: 204 });
  const scene: VideoScene = { id: 'local-video', templateId: 'cinemaMedia', narration: transcriptPreview ? 'Sunflowers turn toward the light as they grow. Their stems respond to changes throughout the day, following the sun across the sky. Mature flowers settle into an eastward position that warms them in the morning and welcomes early pollinators.' : 'Sunflowers turn toward the light.',
    variables: { mediaType: 'video', mediaUrl: new URL('./media-transition/sunflowers.mp4', location.href).href, fallbackText: 'Sunflowers follow the light' }, timing: { fixedDuration: 4 } };
  const snapshot: Video = { schemaVersion: '0.2', orientation: 'landscape', style: TEST_VIDEO_STYLE, scenes: [scene] };
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    let sequence = 0;
    const emit = (type: string, data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ protocolVersion: '0.6', type, eventId: `preview:${sequence}`, runId: 'preview', sequence: sequence++, data })}\n\n`));
    emit('response.start', { requestId: 'preview', format: { orientation: 'landscape' }, style: TEST_VIDEO_STYLE, capabilities: { templates: ['cinemaMedia'], extensions: ['data.video-chat-opening'] } });
    emit('data.video-chat-opening', { line: 'Sunflowers follow a changing sky.', keyword: 'sunflowers' });
    release = () => {
      const mode = new URLSearchParams(location.search).get('mode');
      if (mode === 'error') { controller.error(new Error('Offline preview failure')); release = () => {}; return; }
      if (mode === 'fallback') { scene.templateId = 'chapterTitle'; scene.variables = { title: 'Sunflowers follow the light' }; }

      emit('scene.add', { scene, position: 0 });
      emit('response.complete', { finishReason: 'stop', snapshot, checksum: checksumVideo(snapshot) });
      controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); release = () => {};
    };
  } }), { headers: { 'content-type': 'text/event-stream' } });
};
createRoot(document.getElementById('root')!).render(<>
  <VideoChat options={{ fetcher, voice, mode: 'cinematic' }} />
  <button style={{position:'fixed',right:16,bottom:8,zIndex:20,fontSize:11}} onClick={() => release()}>Preview: release local video</button>
</>);
