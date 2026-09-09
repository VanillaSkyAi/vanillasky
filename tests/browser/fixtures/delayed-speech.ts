import { createVideoChatVoice } from '../../../src/video-chat/voice';

type Event = { kind: string; at: number; id?: number; contextId?: number; name?: string; code?: number; source?: string; duration?: number; mediaTime?: number };
const events: Event[] = [];
Object.assign(window, { speechProbe: events });
let startedAt = 0;
const record = (event: Omit<Event, 'at'>) => events.push({ ...event, at: performance.now() - startedAt });
let nextContextId = 0, nextBufferId = 0;
const NativeAudioContext = window.AudioContext;
window.AudioContext = class extends NativeAudioContext {
  private readonly probeId: number;
  constructor(options?: AudioContextOptions) {
    super(options);
    this.probeId = ++nextContextId;
    record({ kind: 'context-created', contextId: this.probeId });
  }
  override createBufferSource() {
    const node = super.createBufferSource();
    const id = ++nextBufferId, contextId = this.probeId;
    const start = node.start.bind(node);
    let since = 0, offset = 0, duration = 0;
    node.start = (...args) => {
      offset = args[1] ?? 0;
      duration = node.buffer?.duration ?? 0;
      since = this.currentTime;
      start(...args);
      record({ kind: 'buffer-start', id, contextId, duration, mediaTime: offset });
    };
    node.addEventListener('ended', () => record({ kind: 'buffer-ended', id, contextId,
      duration, mediaTime: offset + this.currentTime - since }));
    return node;
  }
};
const identities = new WeakMap<HTMLMediaElement, number>();
let nextId = 0;
const nativePlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  if (!identities.has(this)) {
    identities.set(this, ++nextId);
    for (const kind of ['playing', 'ended', 'error']) this.addEventListener(kind, () => record({ kind, id: identities.get(this), code: this.error?.code, duration: Number.isFinite(this.duration) ? this.duration : undefined, mediaTime: this.currentTime }));
  }
  const pending = nativePlay.call(this);
  pending.catch((error: unknown) => record({ kind: 'rejected', id: identities.get(this), name: error instanceof DOMException ? error.name : 'Error' }));
  return pending;
};
const voice = createVideoChatVoice({
  // Existing prerecorded offline narration; no provider or external request.
  fetcher: async (_input, init) => fetch(JSON.parse(String(init?.body)).text === 'Opening narration' ? './media-transition/paragraph.wav' : './media-transition/paragraph.mp3'),
  onFallback: () => record({ kind: 'fallback' }),
});
document.querySelector<HTMLButtonElement>('#start')!.onclick = async () => {
  startedAt = performance.now();
  const freshSink = new URLSearchParams(location.search).has('freshSink');
  // resume must run synchronously inside the actual click, before any network
  // work or first utterance. The wait deliberately expires transient activation.
  voice.resume();
  const controller = new AbortController();
  const speak = async (name: 'opening' | 'body', text: string) => {
    const prepared = await voice.prepare(text);
    record({ kind: `${name}-prepared`, duration: prepared.seconds });
    const timer = setInterval(() => record({ kind: `${name}-clock`, mediaTime: voice.getCurrentTime?.() }), 200);
    try {
      await voice.speak(text, { signal: controller.signal, onStart: source => record({ kind: `${name}-start`, source }) });
      record({ kind: `${name}-complete` });
    } finally { clearInterval(timer); }
  };
  try {
    if (freshSink) await new Promise(resolve => setTimeout(resolve, 6000));
    await speak('opening', 'Opening narration');
    await new Promise(resolve => setTimeout(resolve, Math.max(5500, 7400 - (performance.now() - startedAt))));
    await speak('body', 'Delayed body narration');
    record({ kind: 'complete' });
  } catch (error) {
    record({ kind: 'failed', name: error instanceof Error ? error.name : 'Error' });
  } finally { voice.dispose?.(); }
};
