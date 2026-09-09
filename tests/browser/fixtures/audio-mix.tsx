import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoPlayerRuntime } from '../../../src/player/video-player';
import { createVideoChatVoice } from '../../../src/video-chat/voice';
import { TEST_VIDEO_STYLE } from '../../helpers/video-style';
import type { Video, VideoAudio } from '../../../src/protocol/types';
const events: string[] = [];
Object.assign(window, { audioMixEvents: events });
const webm = /Linux/.test(navigator.platform) && /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
const fixture = (file: string) => `/tests/browser/fixtures/media-transition/${file}`;
const video: Video = { schemaVersion: '0.2', orientation: 'portrait', style: TEST_VIDEO_STYLE, scenes: [0, 1, 2].map(index => ({ id: `scene-${index}`, templateId: 'cinemaMedia', variables: {
  mediaUrl: fixture(webm ? 'waterfall-audio.webm' : 'waterfall-audio.mp4'), mediaType: 'video', mediaAudio: 'ambient',
}, timing: { fixedDuration: 5 } })) };
const track = (id: number): VideoAudio => ({ trackId: `music-${id}`, audioUrl: `${fixture('music.mp3')}?track=${id}`, duration: 4, volume: .2, fadeOutMs: 1000, beatDetection: { sensitivity: .5 }, beatMarkers: [] });
function App() {
  const [started, setStarted] = useState(false), [paused, setPaused] = useState(false), [muted, setMuted] = useState(false);
  const [waiting, setWaiting] = useState(false), [music, setMusic] = useState(0), [voiceVolume, setVoiceVolume] = useState(1);
  const voice = useRef<ReturnType<typeof createVideoChatVoice> | undefined>(undefined);
  const start = () => {
    voice.current ??= createVideoChatVoice({ fetcher: () => fetch(fixture('paragraph.mp3')), onFallback: () => events.push('fallback') });
    voice.current.resume();
    setStarted(true);
    void Promise.resolve(voice.current.speak('The complete recorded paragraph.', { signal: new AbortController().signal, onStart: () => events.push('speech-start') })).then(() => events.push('speech-end'));
  };
  return <>
    <button onClick={start}>Start mix</button>
    <button onClick={() => { setPaused(!paused); if (!paused) voice.current?.pause(); else voice.current?.resume(); }}>Pause/resume</button>
    <button onClick={() => { setMuted(!muted); voice.current?.setMuted(!muted); }}>Mute/unmute</button>
    <button onClick={() => { const next = voiceVolume ? 0 : 1; setVoiceVolume(next); voice.current?.setVolume?.(next); }}>Voice zero/full</button>
    <button onClick={() => setMusic(value => value + 1)}>Another track</button>
    <button onClick={() => setWaiting(!waiting)}>Waiting</button>
    {started && <VideoPlayerRuntime video={video} controls={false} width={240} startMuted={false} muted={muted} paused={paused} soundtrack={track(music)} soundtrackVolume={.2} narrationReady={() => !waiting} nativeMediaAudio={{ volume: .6, ambientOnly: true }} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
