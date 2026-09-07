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
const nativeAudio = window.Audio;
window.Audio = function (src?: string) {
  const audio = new nativeAudio(src);
  audio.addEventListener('ended', () => { if (audio.src.startsWith('blob:')) document.body.dataset.audioEnded = 'true'; });
  return audio;
} as unknown as typeof Audio;
const engine = createVideoChatVoice({ fetcher: () => fetch(audioUrl) });
const observed = createCaptionVoice(engine);
const play = async () => {
  observed.voice.resume();
  await observed.voice.prepare(text);
  await observed.voice.speak(text, { signal: new AbortController().signal });
};
const simulated = () => ({ text, elapsedSeconds: elapsed, durationSeconds: 12, timing: 'audio' as const });
const progress = recorded ? observed.getCaptionProgress : simulated;
Object.assign(window, { captionAudioTime: () => engine.getCurrentTime?.() });
createRoot(document.getElementById('root')!).render(<div className="vanillasky-video-chat">
  <div className="panel"><div className="panel-inner"><div className="line-row"><CaptionPages text={text} getProgress={progress} /></div></div></div>
  <button onClick={() => void play()}>Play recording</button>
  <button onClick={() => observed.voice.pause()}>Pause recording</button>
  <button onClick={() => observed.voice.resume()}>Resume recording</button>
  <button onClick={() => { elapsed = 6; }}>Middle</button>
  <button onClick={() => { elapsed = 11.9; }}>Last</button>
  <button onClick={() => { elapsed = 0; }}>Replay</button>
</div>);
