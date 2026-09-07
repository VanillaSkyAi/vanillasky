import { createVideoChatVoice } from '../../../src/video-chat/voice';

type Entry = { kind: string; at: number; line: number; blob?: number; source?: string; name?: string; time?: number; duration?: number };
const events: Entry[] = [];
Object.assign(window, { voiceBlobProbe: events });
let line = -1, began = performance.now();
const ids = new Map<string, number>();
const record = (kind: string, detail: Partial<Entry> = {}) => {
  if (events.length < 500) events.push({ kind, at: performance.now() - began, line, ...detail });
};
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = value => { const url = create(value); ids.set(url, ids.size + 1); record('create', { blob: ids.get(url) }); return url; };
URL.revokeObjectURL = url => { record('revoke', { blob: ids.get(url) }); revoke(url); };
const nativePlay = HTMLMediaElement.prototype.play;
const seen = new WeakSet<HTMLMediaElement>();
const injected = new Set<number>();
HTMLMediaElement.prototype.play = function () {
  const blob = ids.get(this.src);
  if (!seen.has(this)) {
    seen.add(this);
    record('sink-created');
    for (const kind of ['playing', 'pause', 'ended', 'error']) this.addEventListener(kind, () => record(kind, {
      blob: ids.get(this.src), time: this.currentTime,
      duration: Number.isFinite(this.duration) ? this.duration : undefined,
    }));
  }
  record('play-request', { blob });
  const result = nativePlay.call(this);
  void result.then(() => record('play-resolved', { blob }), error => record('play-rejected', { blob, name: error instanceof DOMException ? error.name : 'Error' }));
  if (location.search.includes('pauseResume') && line > 0 && !injected.has(line)) {
    injected.add(line);
    queueMicrotask(() => { record('requested-pause'); voice.pause(); record('requested-resume'); voice.resume(); });
  }
  return result;
};
const voice = createVideoChatVoice({
  fetcher: () => fetch('./media-transition/paragraph.mp3'),
  onFallback: () => record('fallback'),
});
document.querySelector<HTMLButtonElement>('#start')!.onclick = async () => {
  began = performance.now();
  voice.resume();
  const signal = new AbortController().signal;
  try {
    await Promise.all([0, 1, 2, 3].map(index => voice.prepare(`Local line ${index}`)));
    for (line = 0; line < 4; line++) {
      try { await voice.speak(`Local line ${line}`, { signal, onStart: source => record('speech-start', { source }) }); }
      catch { record('speech-failed'); }
    }
    record('complete');
  } finally { record('dispose'); voice.dispose?.(); }
};
