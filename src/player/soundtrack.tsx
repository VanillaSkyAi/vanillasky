import { claimSoundtrackGesture } from "./soundtrack-gesture.js";
import { useEffect, useRef, useState } from 'react';
import type { VideoAudio } from '../protocol/types.js';
import { audioVolume } from './audio-volume.js';

const CROSSFADE_MS = 800;
interface Track {
  audio: VideoAudio;
  element: HTMLAudioElement | null;
  envelope: number;
}
interface SoundtrackProps {
  audio?: VideoAudio;
  audioRef: { current: HTMLAudioElement | null };
  playing: boolean;
  muted: boolean;
  volume?: number;
  ducked: boolean;
  waiting: boolean;
  time: number;
  duration: number;
  terminal: boolean;
}

/** The sole soundtrack gain owner. Music failure never owns the narration clock. */
export function Soundtrack(props: SoundtrackProps) {
  const [selection, setSelection] = useState(props.audio?.audioUrl);
  const [tracks, setTracks] = useState<Track[]>(() => props.audio ? [{ audio: props.audio, element: null, envelope: 0 }] : []);
  if (selection !== props.audio?.audioUrl) {
    setSelection(props.audio?.audioUrl);
    // Keep only the immediately previous selection during a rapid shuffle.
    const previous = tracks.find(track => track.audio.audioUrl === selection);
    setTracks([...(previous ? [previous] : []), ...(props.audio ? [{ audio: props.audio, element: null, envelope: 0 }] : [])]);
  }
  const latest = useRef({ props, tracks });
  latest.current = { props, tracks };
  const mix = useRef(audioVolume(props.volume ?? props.audio?.volume) * (props.waiting ? .2 : props.ducked ? .35 : 1));

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const { props: current, tracks: layers } = latest.current;
      const elapsed = Math.max(0, now - previous);
      previous = now;
      const target = audioVolume(current.volume ?? current.audio?.volume) * (current.waiting ? .2 : current.ducked ? .35 : 1);
      const speed = target < mix.current ? 90 : 300;
      mix.current += (target - mix.current) * (1 - Math.exp(-elapsed / speed));
      if (Math.abs(mix.current - target) < .0001) mix.current = target;
      const fadingOut = new Set<Track>();
      for (const track of layers) {
        const active = track.audio.audioUrl === current.audio?.audioUrl;
        if (current.playing) track.envelope = Math.max(0, Math.min(1, track.envelope + (active ? 1 : -1) * elapsed / CROSSFADE_MS));
        const fadeSeconds = Math.max(0, ((active ? current.audio : track.audio)?.fadeOutMs ?? 3000) / 1000);
        const ending = current.terminal && fadeSeconds > 0 ? Math.min(1, Math.max(0, current.duration - current.time) / fadeSeconds) : 1;
        if (track.element) {
          const volume = mix.current * track.envelope * ending;
          try { track.element.volume = volume; }
          catch { /* Native output remains usable until a gesture unlocks the Safari gain adapter. */ }
          track.element.dataset.v = String(volume);
          track.element.muted = current.muted || (volume < 1 && track.element.volume > volume + .01);
        }
        if (!active && track.envelope <= 0) fadingOut.add(track);
      }
      if (fadingOut.size) setTracks(existing => existing.filter(track => !fadingOut.has(track)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return tracks.map(track => <SoundtrackElement key={track.audio.audioUrl} track={track} active={track.audio.audioUrl === selection} audioRef={props.audioRef} playing={props.playing} muted={props.muted} />);
}

function SoundtrackElement({ track, active, audioRef, playing, muted }: {
  track: Track; active: boolean; audioRef: SoundtrackProps['audioRef']; playing: boolean; muted: boolean;
}) {
  const element = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = element.current!;
    track.element = audio;
    try { audio.volume = 0; } catch { /* A fixed native sink waits silently for its gain graph. */ }
    if (audio.volume > .01) audio.muted = true;
    return () => {
      audio.pause();
      track.element = null;
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [audioRef, track]);
  useEffect(() => {
    if (active) audioRef.current = element.current;
  }, [active, audioRef]);
  useEffect(() => {
    const audio = element.current!;
    audio.muted = muted || audio.volume > Number(audio.dataset.v ?? 0) + .01;
  }, [muted]);
  useEffect(() => {
    const audio = element.current!;
    if (playing) {
      void claimSoundtrackGesture().then(async context => {
        if (!context) return;
        try { (await import('./control-visibility.js')).default(audio, context); }
        catch { void context.close(); }
      });
    }
    if (playing) {
      try { void audio.play().catch(() => undefined); }
      catch { /* Optional background music cannot block the answer. */ }
    } else audio.pause();
  }, [playing]);
  return <audio ref={element} src={track.audio.audioUrl} data-v="0" data-soundtrack={active ? 'active' : 'outgoing'} muted={muted} preload="auto" loop />;
}
