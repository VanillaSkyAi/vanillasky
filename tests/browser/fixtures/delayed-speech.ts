import { createVideoChatVoice } from '../../../src/video-chat/voice';

type Event = { kind: string; at: number; id?: number; name?: string; code?: number; source?: string; duration?: number; mediaTime?: number };
const events: Event[] = [];
Object.assign(window, { speechProbe: events });
let startedAt = 0;
const record = (event: Omit<Event, 'at'>) => events.push({ ...event, at: performance.now() - startedAt });
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
  if (freshSink) voice.resume();
  const controller = new AbortController();
  try {
    if (freshSink) await new Promise(resolve => setTimeout(resolve, 6000));
    await voice.prepare('Opening narration');
    await voice.speak('Opening narration', { signal: controller.signal, onStart: source => record({ kind: 'opening-start', source }) });
    await new Promise(resolve => setTimeout(resolve, Math.max(5500, 7400 - (performance.now() - startedAt))));
    await voice.prepare('Delayed body narration');
    await voice.speak('Delayed body narration', { signal: controller.signal, onStart: source => record({ kind: 'body-start', source }) });
    record({ kind: 'complete' });
  } finally { voice.dispose?.(); }
};
