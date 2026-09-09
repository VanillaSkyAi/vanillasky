// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { resumeIosAudioContext } from '../src/player/ios-audio-output';
import { useVoiceInput } from '../src/video-chat/use-voice-input';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function browser() {
  let type = 'playback';
  const changes: string[] = [];
  const session = {
    get type() { return type; },
    set type(value: string) { type = value; changes.push(value); },
  };
  const getUserMedia = vi.fn<() => Promise<MediaStream>>();
  vi.stubGlobal('navigator', { platform: 'iPhone', audioSession: session, mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    resume = vi.fn(async () => {});
  });
  vi.stubGlobal('SpeechRecognition', undefined);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
  const recorders: Recorder[] = [];
  class Recorder {
    state = 'inactive'; mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start = vi.fn(() => { this.state = 'recording'; });
    stop = vi.fn(() => {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['recording']) });
        this.onstop?.();
      });
    });
    constructor() { recorders.push(this); }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const stream = () => {
    const track = { stop: vi.fn() };
    return { track, value: { getTracks: () => [track] } as unknown as MediaStream };
  };
  return { session, changes, getUserMedia, recorders, stream };
}

function recognition() {
  const instances: Recognition[] = [];
  class Recognition {
    lang = ''; continuous = false; interimResults = false;
    onresult: ((event: { resultIndex: number; results: { transcript: string }[][] }) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;
    start = vi.fn(); stop = vi.fn(); abort = vi.fn();
    constructor() { instances.push(this); }
  }
  vi.stubGlobal('SpeechRecognition', Recognition);
  return { instances, Recognition };
}

it('releases capture policy and tracks before waiting for server transcription', async () => {
  const state = browser();
  const stream = state.stream();
  state.getUserMedia.mockImplementation(async () => {
    expect(state.session.type).toBe('auto');
    return stream.value;
  });
  const response = deferred<Response>();
  const transcript = vi.fn();
  const fetcher = vi.fn(() => {
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(state.session.type).toBe('playback');
    return response.promise;
  });
  const view = renderHook(() => useVoiceInput(transcript, true, { fetcher }));
  await act(async () => { view.result.current.toggle(); });
  expect(view.result.current.listening).toBe(true);
  expect(state.session.type).toBe('auto');
  await act(async () => { await resumeIosAudioContext(); });
  expect(state.session.type).toBe('auto');
  await act(async () => { view.result.current.toggle(); });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(view.result.current.thinking).toBe(true);
  await act(async () => { response.resolve(Response.json({ text: 'A spoken prompt' })); });
  expect(transcript).toHaveBeenCalledWith('A spoken prompt');
  expect(view.result.current.thinking).toBe(false);
});

it('restores session policy when microphone permission rejects', async () => {
  const state = browser();
  state.getUserMedia.mockRejectedValue(new Error('Permission denied'));
  const view = renderHook(() => useVoiceInput(vi.fn(), true));
  await act(async () => { view.result.current.toggle(); });
  expect(state.changes).toEqual(['auto', 'playback']);
  expect(view.result.current.error).toContain('microphone is blocked');
  expect(state.recorders).toHaveLength(0);
});

it('aborts pending permission without allowing late cleanup to release a newer capture', async () => {
  const state = browser();
  const firstPermission = deferred<MediaStream>();
  const secondPermission = deferred<MediaStream>();
  state.getUserMedia.mockReturnValueOnce(firstPermission.promise).mockReturnValueOnce(secondPermission.promise);
  const fetcher = vi.fn();
  const view = renderHook(() => useVoiceInput(vi.fn(), true, { fetcher }));
  act(() => { view.result.current.toggle(); });
  expect(state.session.type).toBe('auto');
  act(() => { view.result.current.stop(); });
  expect(state.session.type).toBe('playback');
  act(() => { view.result.current.toggle(); });
  expect(state.session.type).toBe('auto');
  const oldStream = state.stream();
  await act(async () => { firstPermission.resolve(oldStream.value); });
  expect(oldStream.track.stop).toHaveBeenCalledOnce();
  expect(state.recorders).toHaveLength(0);
  expect(state.session.type).toBe('auto');
  const newStream = state.stream();
  await act(async () => { secondPermission.resolve(newStream.value); });
  expect(state.recorders).toHaveLength(1);
  await act(async () => { view.result.current.stop(); });
  expect(newStream.track.stop).toHaveBeenCalledOnce();
  expect(state.session.type).toBe('playback');
  expect(fetcher).not.toHaveBeenCalled();
});

it('releases pending permission on unmount and stops a late stream without recording', async () => {
  const state = browser();
  const permission = deferred<MediaStream>();
  state.getUserMedia.mockReturnValue(permission.promise);
  const view = renderHook(() => useVoiceInput(vi.fn(), true));
  act(() => { view.result.current.toggle(); });
  view.unmount();
  expect(state.session.type).toBe('playback');
  const stream = state.stream();
  await act(async () => { permission.resolve(stream.value); });
  expect(stream.track.stop).toHaveBeenCalledOnce();
  expect(state.recorders).toHaveLength(0);
});

it.each(['constructor', 'start'])('releases capture after a recorder %s failure', async (phase) => {
  const state = browser();
  const stream = state.stream();
  state.getUserMedia.mockResolvedValue(stream.value);
  vi.stubGlobal('MediaRecorder', class {
    constructor() { if (phase === 'constructor') throw new Error('Recorder unavailable'); }
    start() { throw new Error('Recorder unavailable'); }
  });
  const view = renderHook(() => useVoiceInput(vi.fn(), true));
  await act(async () => { view.result.current.toggle(); });
  expect(stream.track.stop).toHaveBeenCalledOnce();
  expect(state.session.type).toBe('playback');
  expect(view.result.current.error).toBe('Recorder unavailable');
});

it('holds recognition policy through stop until the microphone ends', async () => {
  const state = browser();
  const { instances } = recognition();
  const transcript = vi.fn();
  const view = renderHook(() => useVoiceInput(transcript));
  act(() => { view.result.current.toggle(); });
  expect(state.session.type).toBe('auto');
  const current = instances[0]!;
  act(() => { current.onresult?.({ resultIndex: 0, results: [[{ transcript: 'A question' }]] }); });
  expect(transcript).toHaveBeenCalledWith('A question');
  act(() => { view.result.current.toggle(); });
  expect(current.stop).toHaveBeenCalledOnce();
  expect(state.session.type).toBe('auto');
  act(() => { current.onend?.(); });
  expect(state.session.type).toBe('playback');
  expect(view.result.current.listening).toBe(false);
});

it('releases failed recognition before starting recorder fallback and ignores its later end', async () => {
  const state = browser();
  const { instances } = recognition();
  const permission = deferred<MediaStream>();
  state.getUserMedia.mockReturnValue(permission.promise);
  const view = renderHook(() => useVoiceInput(vi.fn(), true));
  act(() => { view.result.current.toggle(); });
  const first = instances[0]!;
  act(() => { first.onerror?.({ error: 'network' }); });
  expect(first.abort).toHaveBeenCalledOnce();
  expect(state.changes).toEqual(['auto', 'playback', 'auto']);
  expect(state.getUserMedia).toHaveBeenCalledOnce();
  act(() => { first.onend?.(); });
  expect(state.session.type).toBe('auto');
  expect(view.result.current.listening).toBe(true);
  view.unmount();
  expect(state.session.type).toBe('playback');
});

it('clears recognition ownership before abort callbacks and keeps newer recognition guarded', () => {
  const state = browser();
  const { instances } = recognition();
  const view = renderHook(() => useVoiceInput(vi.fn(), true));
  act(() => { view.result.current.toggle(); });
  const first = instances[0]!;
  first.abort.mockImplementation(() => { first.onerror?.({ error: 'network' }); });
  act(() => { view.result.current.stop(); });
  expect(state.getUserMedia).not.toHaveBeenCalled();
  expect(state.session.type).toBe('playback');
  act(() => { view.result.current.toggle(); });
  act(() => { first.onend?.(); first.onerror?.({ error: 'not-allowed' }); });
  expect(state.session.type).toBe('auto');
  expect(view.result.current.listening).toBe(true);
  view.unmount();
  expect(instances[1]!.abort).toHaveBeenCalledOnce();
  expect(state.session.type).toBe('playback');
});

it('releases recognition policy when start throws or permission is denied', async () => {
  const state = browser();
  const { Recognition, instances } = recognition();
  vi.stubGlobal('SpeechRecognition', class extends Recognition {
    start = vi.fn(() => { throw new Error('Cannot start'); });
  });
  const view = renderHook(() => useVoiceInput(vi.fn()));
  act(() => { view.result.current.toggle(); });
  expect(state.changes).toEqual(['auto', 'playback']);
  expect(view.result.current.error).toContain('could not be started');
  vi.stubGlobal('SpeechRecognition', Recognition);
  act(() => { view.result.current.toggle(); });
  act(() => { instances[1]!.onerror?.({ error: 'not-allowed' }); });
  await waitFor(() => expect(view.result.current.error).toContain('microphone is blocked'));
  expect(state.session.type).toBe('playback');
});
