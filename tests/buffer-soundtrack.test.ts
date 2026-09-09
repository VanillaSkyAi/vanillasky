import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBufferedSoundtrack } from '../src/player/buffer-soundtrack';

const output = vi.hoisted(() => ({ get: vi.fn(), resume: vi.fn() }));
vi.mock('../src/player/ios-audio-output', () => ({ getIosAudioContext: output.get, resumeIosAudioContext: output.resume }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function context() {
  const sources: ReturnType<typeof source>[] = [];
  const gains: ReturnType<typeof gain>[] = [];
  function source() { return { buffer: null as unknown, loop: false, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; }
  function gain() { return { gain: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; }
  return {
    currentTime: 0, destination: {}, sources, gains,
    decodeAudioData: vi.fn(async () => ({ duration: 10, length: 441_000, numberOfChannels: 2 })),
    createBufferSource: vi.fn(() => { const node = source(); sources.push(node); return node; }),
    createGain: vi.fn(() => { const node = gain(); gains.push(node); return node; }),
    createMediaElementSource: vi.fn(), close: vi.fn(), suspend: vi.fn(),
  };
}

let ctx: ReturnType<typeof context>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const handles: ReturnType<typeof createBufferedSoundtrack>[] = [];
function create() { const handle = createBufferedSoundtrack('/audio-library/florist.mp3', fetcher); handles.push(handle); return handle; }

beforeEach(() => {
  ctx = context();
  output.get.mockReturnValue(ctx);
  output.resume.mockImplementation(async () => ctx);
  fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('Audio', vi.fn(() => { throw new Error('Music must not create native media'); }));
});
afterEach(() => {
  handles.splice(0).forEach(handle => handle.dispose());
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

describe('buffered iOS soundtrack', () => {
  it('loads and decodes once before play, then loops through its own gain without a native media sink', async () => {
    const track = create();
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledOnce());
    expect(output.resume).not.toHaveBeenCalled();
    expect(track.paused).toBe(true);
    const playing = track.play();
    expect(output.resume).toHaveBeenCalledOnce();
    await playing;
    expect(track.paused).toBe(false);
    expect(ctx.sources[0].loop).toBe(true);
    expect(ctx.sources[0].start).toHaveBeenCalledWith(0, 0);
    expect(ctx.sources[0].connect).toHaveBeenCalledWith(ctx.gains[0]);
    expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
    expect(globalThis.Audio).not.toHaveBeenCalled();
    expect(ctx.createMediaElementSource).not.toHaveBeenCalled();
    ctx.currentTime = 12.5;
    expect(track.currentTime).toBe(2.5);
    await track.play();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.decodeAudioData).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('pauses at the exact loop offset and resumes a new source from that position', async () => {
    const track = create(); await track.play();
    ctx.currentTime = 13.25; track.pause();
    expect(track.paused).toBe(true);
    expect(track.currentTime).toBe(3.25);
    expect(ctx.sources[0].stop).toHaveBeenCalledOnce();
    expect(ctx.sources[0].disconnect).toHaveBeenCalledOnce();
    ctx.currentTime = 50;
    expect(track.currentTime).toBe(3.25);
    await track.play();
    expect(ctx.sources[1].start).toHaveBeenCalledWith(0, 3.25);
    ctx.currentTime = 52;
    expect(track.currentTime).toBe(5.25);
    expect(ctx.close).not.toHaveBeenCalled();
    expect(ctx.suspend).not.toHaveBeenCalled();
  });

  it('seeks intentionally during playback and preserves a paused seek for resume', async () => {
    const track = create(); await track.play();
    ctx.currentTime = 3; track.currentTime = 18;
    expect(ctx.sources[0].stop).toHaveBeenCalledOnce();
    expect(ctx.sources[1].start).toHaveBeenCalledWith(0, 8);
    ctx.currentTime = 4;
    expect(track.currentTime).toBe(9);
    track.pause(); track.currentTime = 6;
    expect(ctx.sources).toHaveLength(2);
    await track.play();
    expect(ctx.sources[2].start).toHaveBeenCalledWith(0, 6);
  });

  it('changes volume and mute through gain without stopping or resetting its clock', async () => {
    const track = create(); track.volume = .2; await track.play();
    expect(ctx.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(.2, 0);
    ctx.currentTime = 2; track.volume = 0;
    expect(track.volume).toBe(0);
    expect(ctx.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    track.volume = .6; track.muted = true;
    expect(track.muted).toBe(true);
    expect(ctx.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    ctx.currentTime = 4; track.muted = false;
    expect(ctx.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(.6, 4);
    expect(track.currentTime).toBe(4);
    expect(track.paused).toBe(false);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].stop).not.toHaveBeenCalled();
  });

  it('does not let a pending decode revive playback after pause, but can resume later', async () => {
    const decoded = deferred<{ duration: number; length: number; numberOfChannels: number }>();
    ctx.decodeAudioData.mockReturnValue(decoded.promise);
    const track = create(); const playing = track.play();
    track.pause();
    decoded.resolve({ duration: 10, length: 441_000, numberOfChannels: 2 });
    await playing;
    expect(ctx.sources).toHaveLength(0);
    expect(track.paused).toBe(true);
    await track.play();
    expect(ctx.sources).toHaveLength(1);
  });

  it('does not let a stale resume race start a second source after pause and play', async () => {
    const resumed = deferred<typeof ctx>();
    output.resume.mockReturnValueOnce(resumed.promise);
    const track = create(); const stale = track.play();
    track.pause();
    await track.play();
    ctx.currentTime = 2;
    resumed.resolve(ctx); await stale;
    expect(ctx.sources).toHaveLength(1);
    expect(track.currentTime).toBe(2);
  });

  it('shares one load and source across overlapping play requests', async () => {
    const track = create(); await Promise.all([track.play(), track.play(), track.play()]);
    expect(ctx.sources).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('makes a fresh gesture resume without waiting for an earlier blocked play request', async () => {
    const blocked = deferred<typeof ctx>();
    output.resume.mockReturnValueOnce(blocked.promise);
    const track = create();
    const first = track.play();
    expect(output.resume).toHaveBeenCalledOnce();

    const second = track.play();
    expect(output.resume).toHaveBeenCalledTimes(2);
    await second;
    expect(ctx.sources).toHaveLength(1);
    expect(track.paused).toBe(false);
    ctx.currentTime = 2;

    blocked.reject(new Error('Earlier gesture was blocked'));
    await first;
    expect(track.paused).toBe(false);
    expect(track.currentTime).toBe(2);
    expect(ctx.sources[0].stop).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(ctx.decodeAudioData).toHaveBeenCalledOnce();
  });

  it('disposes only its own nodes and leaves another track using the context alive', async () => {
    const first = create(), second = create();
    await Promise.all([first.play(), second.play()]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2);
    first.dispose(); first.dispose();
    expect(ctx.sources[0].stop).toHaveBeenCalledOnce();
    expect(ctx.sources[0].buffer).toBeNull();
    expect(ctx.gains[0].disconnect).toHaveBeenCalledOnce();
    expect(ctx.sources[1].stop).not.toHaveBeenCalled();
    ctx.currentTime = 3; expect(second.currentTime).toBe(3);
    expect(ctx.close).not.toHaveBeenCalled();
    await expect(first.play()).rejects.toThrow();
  });

  it('aborts a loading fetch on dispose and never starts after late decode completion', async () => {
    const decoded = deferred<{ duration: number; length: number; numberOfChannels: number }>();
    ctx.decodeAudioData.mockReturnValue(decoded.promise);
    const track = create(); const playing = track.play();
    await vi.waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledOnce());
    const signal = fetcher.mock.calls[0][1]?.signal;
    track.dispose();
    expect(signal?.aborted).toBe(true);
    decoded.resolve({ duration: 10, length: 441_000, numberOfChannels: 2 });
    await playing;
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('contains an eager load failure until play awaits it', async () => {
    fetcher.mockRejectedValue(new Error('Unavailable track'));
    const track = create();
    await new Promise(resolve => setTimeout(resolve, 0));
    await expect(track.play()).rejects.toThrow('Unavailable track');
    expect(track.paused).toBe(true);
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('fails optional playback if the shared context cannot resume', async () => {
    output.resume.mockResolvedValue(undefined);
    const track = create();
    await expect(track.play()).rejects.toThrow();
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.close).not.toHaveBeenCalled();
  });
});

describe('bounded music loading', () => {
  it('accepts the maximum download size and a complete long catalog track', async () => {
    fetcher.mockResolvedValue(new Response(new Uint8Array(8 * 1024 * 1024)));
    ctx.decodeAudioData.mockResolvedValue({ duration: 246.7, length: 11_841_600, numberOfChannels: 2 });
    const track = create(); await track.play();
    ctx.currentTime = 249.2;
    expect(track.currentTime).toBeCloseTo(2.5);
    expect(ctx.sources).toHaveLength(1);
  });

  it('rejects an oversized declared body without decoding it', async () => {
    const cancel = vi.fn();
    fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }));
    await expect(create().play()).rejects.toThrow(/large|limit|bound/i);
    expect(cancel).toHaveBeenCalledOnce();
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });

  it.each([undefined, '1'])('bounds streamed bytes even with missing or misleading content-length %s', async length => {
    let reads = 0;
    const cancel = vi.fn();
    fetcher.mockResolvedValue(new Response(new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel,
    }), { headers: length ? { 'content-length': length } : undefined }));
    await expect(create().play()).rejects.toThrow(/large|limit|bound/i);
    expect(reads).toBeLessThanOrEqual(10);
    expect(cancel).toHaveBeenCalledOnce();
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });

  it('cancels a stalled response reader when disposed', async () => {
    const cancel = vi.fn();
    fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const track = create(); const playing = track.play();
    await Promise.resolve(); track.dispose(); await playing;
    expect(cancel).toHaveBeenCalledOnce();
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });

  it.each([
    { duration: 301, length: 441_000, numberOfChannels: 2 },
    { duration: 10, length: 17 * 1024 * 1024, numberOfChannels: 2 },
    { duration: Number.NaN, length: 441_000, numberOfChannels: 2 },
    { duration: 0, length: 0, numberOfChannels: 2 },
  ])('rejects invalid or excessive decoded audio %j', async decoded => {
    ctx.decodeAudioData.mockResolvedValue(decoded);
    await expect(create().play()).rejects.toThrow();
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.close).not.toHaveBeenCalled();
  });
});
