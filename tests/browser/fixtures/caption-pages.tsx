import React from 'react';
import { createRoot } from 'react-dom/client';
import { CaptionPages } from '../../../src/video-chat/caption-pages';
import '../../../styles/video-chat.css';
import { createVideoChatVoice } from '../../../src/video-chat/voice';
import { createCaptionVoice } from '../../../src/video-chat/caption-progress';
import audioUrl from './media-transition/paragraph.wav?url';

const recorded = new URLSearchParams(location.search).has('recorded');
const text = recorded ? 'First we see the water flowing. Then the tram moves through the city. Finally the flowers turn toward the light.' : 'Sunflowers turn toward the light as they grow. Their stems respond to changes throughout the day, following the sun across the sky. Mature flowers settle into an eastward position that warms them in the morning and welcomes early pollinators.';
// Explicit controlled audio-clock boundary fixture; it does not synthesize speech.
let elapsed = 0;
const captionDiagnostics: unknown[] = [];
let playingAudio: HTMLAudioElement | undefined;
let firstPageFraction = 1;
const nativeAudio = window.Audio;
window.Audio = function (src?: string) {
  const audio = new nativeAudio(src);
  playingAudio = audio;
  for (const kind of ['playing', 'pause', 'timeupdate', 'waiting', 'stalled', 'ended', 'error', 'loadedmetadata']) {
    audio.addEventListener(kind, () => {
      if (captionDiagnostics.length < 300) captionDiagnostics.push({ kind, at: performance.now(), time: audio.currentTime, duration: audio.duration, paused: audio.paused, readyState: audio.readyState, source: audio.src.startsWith('blob:') ? 'recording' : 'activation' });
    });
  }
  audio.addEventListener('ended', () => { if (audio.src.startsWith('blob:')) document.body.dataset.audioEnded = 'true'; });
  return audio;
} as unknown as typeof Audio;
const engine = createVideoChatVoice({ fetcher: () => fetch(audioUrl) });
const observed = createCaptionVoice(engine);
const play = async () => {
  firstPageFraction = (document.querySelector('[data-caption-page="0"]')?.textContent?.length ?? text.length) / text.length;
  observed.voice.resume();
  const prepared = await observed.voice.prepare(text);
  captionDiagnostics.push({ kind: 'prepared', ...prepared });
  await observed.voice.speak(text, { signal: new AbortController().signal });
};
const simulated = () => ({ text, elapsedSeconds: elapsed, durationSeconds: 12, timing: 'audio' as const });
const progress = recorded ? observed.getCaptionProgress : simulated;
Object.assign(window, { captionAudioTime: () => engine.getCurrentTime?.(), captionDiagnostics,
  captionNativeState: () => ({ time: playingAudio?.currentTime ?? 0, duration: playingAudio?.duration ?? NaN,
    boundary: (playingAudio?.duration ?? Infinity) * firstPageFraction }),
});
createRoot(document.getElementById('root')!).render(<div className="vanillasky-video-chat">
  <div className="panel"><div className="panel-inner"><div className="line-row"><CaptionPages text={text} getProgress={progress} /></div></div></div>
  <button onClick={() => void play()}>Play recording</button>
  <button onClick={() => observed.voice.pause()}>Pause recording</button>
  <button onClick={() => observed.voice.resume()}>Resume recording</button>
  <button onClick={() => { elapsed = 6; }}>Middle</button>
  <button onClick={() => { elapsed = 11.9; }}>Last</button>
  <button onClick={() => { elapsed = 0; }}>Replay</button>
</div>);
