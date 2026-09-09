import { audioVolume } from './audio-volume.js';
import { getIosAudioContext, resumeIosAudioContext } from './ios-audio-output.js';

export interface SoundtrackPlayback {
  currentTime: number;
  volume: number;
  muted: boolean;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
}

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PCM_BYTES = 128 * 1024 * 1024;
const MAX_DURATION_SECONDS = 300;

async function readMusicBytes(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(response.ok ? 'Music download exceeds its size limit' : 'Music download failed');
  }
  if (!response.body) throw new Error('Music download is empty');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) { cancel(); throw new Error('Music loading cancelled'); }
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error('Music loading cancelled');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) {
        cancel();
        throw new Error('Music download exceeds its size limit');
      }
      chunks.push(value);
    }
    if (!size) throw new Error('Music download is empty');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** One decoded track on the shared iOS output; it never owns that context's lifetime. */
export function createBufferedSoundtrack(url: string, fetcher: typeof fetch = fetch): SoundtrackPlayback & { dispose(): void } {
  const context = getIosAudioContext();
  const controller = new AbortController();
  let buffer: AudioBuffer | undefined;
  let source: AudioBufferSourceNode | undefined;
  let gain: GainNode | undefined;
  let offset = 0, startedAt = 0, volume = 1, muted = false;
  let playing = false, disposed = false, generation = 0;
  let pendingPlay: Promise<void> | undefined;

  const loading = (async () => {
    if (!context) throw new Error('Music audio output is unavailable');
    const response = await fetcher(url, { signal: controller.signal });
    const bytes = await readMusicBytes(response, controller.signal);
    const decoded = await context.decodeAudioData(bytes);
    if (disposed) throw new Error('Music loading cancelled');
    const pcmBytes = decoded.length * decoded.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_DURATION_SECONDS
      || !Number.isSafeInteger(decoded.length) || decoded.length <= 0
      || !Number.isSafeInteger(decoded.numberOfChannels) || decoded.numberOfChannels <= 0
      || !Number.isSafeInteger(pcmBytes) || pcmBytes > MAX_PCM_BYTES) {
      throw new Error('Decoded music exceeds its playback bounds');
    }
    buffer = decoded;
    offset %= decoded.duration;
  })();
  // Loading starts before play. Its optional failure is reported to play's caller.
  void loading.catch(() => undefined);

  const position = () => {
    const elapsed = source && context ? Math.max(0, context.currentTime - startedAt) : 0;
    return buffer ? (offset + elapsed) % buffer.duration : offset;
  };
  const updateGain = () => {
    if (gain && context) gain.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
  };
  const stopSource = () => {
    if (!source) return;
    offset = position();
    try { source.stop(); } catch { /* It may not have started if the output failed. */ }
    source.disconnect();
    source.buffer = null;
    source = undefined;
  };
  const startSource = () => {
    if (!context || !buffer) throw new Error('Music audio output is unavailable');
    if (!gain) { gain = context.createGain(); gain.connect(context.destination); }
    updateGain();
    source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    startedAt = context.currentTime;
    try { source.start(0, offset); }
    catch (error) { stopSource(); throw error; }
  };

  const playback: SoundtrackPlayback & { dispose(): void } = {
    get currentTime() { return position(); },
    set currentTime(value) {
      if (disposed || !Number.isFinite(value) || value < 0) return;
      const restart = !!source;
      stopSource();
      offset = buffer ? value % buffer.duration : value;
      if (restart) startSource();
    },
    get volume() { return volume; },
    set volume(value) { volume = audioVolume(value, volume); updateGain(); },
    get muted() { return muted; },
    set muted(value) { muted = value; updateGain(); },
    get paused() { return !playing; },
    play() {
      if (disposed) return Promise.reject(new Error('Music playback is disposed'));
      if (pendingPlay) return pendingPlay;
      playing = true;
      const current = ++generation;
      // Request resume synchronously, while the caller may still have activation.
      const resumed = resumeIosAudioContext();
      const pending = (async () => {
        const [output] = await Promise.all([resumed, loading]);
        if (disposed || generation !== current || !playing) return;
        if (!output || output !== context) throw new Error('Music audio output could not resume');
        if (!source) startSource();
      })().catch(error => {
        if (disposed || generation !== current) return;
        playing = false;
        throw error;
      }).finally(() => { if (pendingPlay === pending) pendingPlay = undefined; });
      pendingPlay = pending;
      return pending;
    },
    pause() {
      generation++;
      playing = false;
      pendingPlay = undefined;
      stopSource();
    },
    dispose() {
      if (disposed) return;
      playback.pause();
      disposed = true;
      controller.abort();
      buffer = undefined;
      gain?.disconnect();
      gain = undefined;
    },
  };
  return playback;
}
