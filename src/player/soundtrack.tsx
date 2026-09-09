import { claimSoundtrackGesture } from "./soundtrack-gesture.js";
import { useEffect, useRef, useState } from 'react';
import type { VideoAudio } from '../protocol/types.js';
import { audioVolume } from './audio-volume.js';
import { createBufferedSoundtrack, type SoundtrackPlayback } from './buffer-soundtrack.js';
import { isIosAudioOutput } from './ios-audio-output.js';

const CROSSFADE_MS = 800;
const BUFFER_START_TIMEOUT_MS = 10_000;
interface Track {
  audio: VideoAudio;
  element: SoundtrackPlayback | null;
  envelope: number;
  bufferedPlayback?: 'pending' | 'ready' | 'failed';
}
interface SoundtrackProps {
  audio?: VideoAudio;
  audioRef: { current: SoundtrackPlayback | null };
  playing: boolean;
  muted: boolean;
  volume?: number;
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

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const { props: current, tracks: layers } = latest.current;
      const elapsed = Math.max(0, now - previous);
      previous = now;
      const fadingOut = new Set<Track>();
      // A buffered replacement must finish downloading and actually start
      // before either side of its crossfade moves. Native streaming is unchanged.
      const incoming = layers.find(track => track.audio.audioUrl === current.audio?.audioUrl);
      const waitingForIncoming = incoming?.bufferedPlayback === 'pending';
      for (const track of layers) {
        const active = track.audio.audioUrl === current.audio?.audioUrl;
        const gain = audioVolume(current.volume ?? (active ? current.audio : track.audio)?.volume);
        if (current.playing && !waitingForIncoming && (!active || track.bufferedPlayback !== 'failed')) {
          track.envelope = Math.max(0, Math.min(1, track.envelope + (active ? 1 : -1) * elapsed / CROSSFADE_MS));
        }
        const fadeSeconds = Math.max(0, ((active ? current.audio : track.audio)?.fadeOutMs ?? 3000) / 1000);
        const ending = current.terminal && fadeSeconds > 0 ? Math.min(1, Math.max(0, current.duration - current.time) / fadeSeconds) : 1;
        if (track.element) {
          const volume = gain * track.envelope * ending;
          try { track.element.volume = volume; }
          catch { /* Native output remains usable until a gesture unlocks the Safari gain adapter. */ }
          if (track.element instanceof HTMLAudioElement) track.element.dataset.v = String(volume);
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

  const Element = isIosAudioOutput() ? BufferedSoundtrackElement : SoundtrackElement;
  return tracks.map(track => <Element key={track.audio.audioUrl} track={track} active={track.audio.audioUrl === selection} audioRef={props.audioRef} playing={props.playing} muted={props.muted} />);
}

interface ElementProps {
  track: Track; active: boolean; audioRef: SoundtrackProps['audioRef']; playing: boolean; muted: boolean;
}

function BufferedSoundtrackElement({ track, active, audioRef, playing, muted }: ElementProps) {
  const output = useRef<ReturnType<typeof createBufferedSoundtrack> | null>(null);
  useEffect(() => {
    const handle = createBufferedSoundtrack(track.audio.audioUrl);
    handle.volume = 0;
    handle.muted = muted;
    output.current = handle;
    track.element = handle;
    track.bufferedPlayback = 'pending';
    return () => {
      if (output.current === handle) { handle.dispose(); output.current = null; }
      track.element = null;
      if (audioRef.current === handle) audioRef.current = null;
    };
  }, [audioRef, track]);
  useEffect(() => {
    if (active) audioRef.current = output.current;
  }, [active, audioRef, track]);
  useEffect(() => {
    if (output.current) output.current.muted = muted;
  }, [muted, audioRef, track]);
  useEffect(() => {
    const handle = output.current;
    if (!handle) return;
    track.bufferedPlayback = 'pending';
    if (!playing) { handle.pause(); return; }
    let current = true;
    const fail = () => {
      if (!current || output.current !== handle) return;
      current = false;
      clearTimeout(timeout);
      track.bufferedPlayback = 'failed';
      handle.dispose();
      output.current = null;
      track.element = null;
      if (audioRef.current === handle) audioRef.current = null;
    };
    // Optional music must not retain an outgoing track forever if its fetch,
    // decode, or output resume never settles. Pause cancels this start attempt.
    const timeout = setTimeout(fail, BUFFER_START_TIMEOUT_MS);
    void handle.play().then(() => {
      if (!current || output.current !== handle) return;
      clearTimeout(timeout);
      if (handle.paused) { fail(); return; }
      track.bufferedPlayback = 'ready';
    }, fail);
    return () => { current = false; clearTimeout(timeout); handle.pause(); };
  }, [playing, audioRef, track]);
  return <span hidden data-soundtrack={active ? 'active' : 'outgoing'} data-audio-output="buffer" data-track-id={track.audio.trackId} />;
}

function SoundtrackElement({ track, active, audioRef, playing, muted }: ElementProps) {
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
