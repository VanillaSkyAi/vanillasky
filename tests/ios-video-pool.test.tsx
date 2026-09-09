// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createIosVideoPool, IosVideoPoolContext } from '../src/player/ios-video-pool';
import { SceneVideoBackdrop } from '../src/visual-system/scene-templates/scene-video-backdrop';

const pools: ReturnType<typeof createIosVideoPool>[] = [];
const createPool = () => { const pool = createIosVideoPool(); pools.push(pool); return pool; };
beforeEach(() => {
  vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone' });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'currentSrc', 'get').mockImplementation(function(this: HTMLMediaElement) { return this.src; });
});
afterEach(() => { cleanup(); pools.splice(0).forEach(pool => pool.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const scene = (url: string, props: Partial<React.ComponentProps<typeof SceneVideoBackdrop>> = {}) => <SceneVideoBackdrop mediaUrl={url} playbackId={url} progress={0} isPlaying {...props} />;

it('loads exactly two source-free videos synchronously and never reloads a primed lease', () => {
  const created = vi.spyOn(document, 'createElement');
  const loaded: HTMLMediaElement[] = [];
  vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(function(this: HTMLMediaElement) {
    expect(this.getAttribute('src')).toBeNull(); loaded.push(this);
  });
  const pool = createPool();
  expect(pool.acquire()).toBeUndefined();
  pool.prime();
  expect(loaded).toHaveLength(2);
  expect(created.mock.calls.filter(([tag]) => tag === 'video')).toHaveLength(2);
  const first = pool.acquire()!;
  const second = pool.acquire()!;
  expect(first).toBe(loaded[0]); expect(second).toBe(loaded[1]);
  expect(pool.acquire()).toBeUndefined();
  first.src = '/active.mp4';
  pool.prime();
  expect(loaded).toHaveLength(2);
  expect(first.getAttribute('src')).toBe('/active.mp4');
});

it('releases and reacquires an original node instead of allocating a third video', () => {
  const pool = createPool(); pool.prime();
  const first = pool.acquire()!, second = pool.acquire()!;
  first.src = '/first.mp4';
  pool.release(first);
  expect(first.getAttribute('src')).toBeNull();
  expect(pool.acquire()).toBe(first);
  expect(pool.acquire()).toBeUndefined();
  pool.release(second); pool.release(second);
  expect(pool.acquire()).toBe(second);
  expect(pool.acquire()).toBeUndefined();
});

it('waits for real activation before treating source-free nodes as primed', () => {
  const userActivation = { isActive: false };
  vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone', userActivation });
  const pool = createPool();
  pool.prime();
  expect(pool.acquire()).toBeUndefined();
  expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  userActivation.isActive = true;
  pool.prime();
  expect(pool.acquire()).toBeInstanceOf(HTMLVideoElement);
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2);
});

it('can prime after a Strict Mode disposal rehearsal and keeps the two-node bound', () => {
  const pool = createPool(); pool.dispose(); pool.prime();
  const first = pool.acquire()!;
  expect(first).toBeInstanceOf(HTMLVideoElement);
  pool.dispose();
  expect(first.isConnected).toBe(false);
  expect(pool.acquire()).toBeUndefined();
  pool.prime();
  const next = pool.acquire()!;
  expect(next).not.toBe(first);
  expect(pool.acquire()).toBeInstanceOf(HTMLVideoElement);
  expect(pool.acquire()).toBeUndefined();
});

it('mounts the primed node with native events, current styles, gain and source identity', () => {
  const pool = createPool(); pool.prime();
  const original = pool.acquire()!; pool.release(original);
  const onReady = vi.fn();
  const view = render(<IosVideoPoolContext.Provider value={pool}>{scene('/first.mp4', { mediaPoster: '/poster.jpg', mediaPosition: 'top', volume: .6, muted: false, onReady })}</IosVideoPoolContext.Provider>);
  const video = view.container.querySelector('video')!;
  expect(video).toBe(original);
  expect(video.getAttribute('src')).toBe('/first.mp4');
  expect(video.poster).toContain('/poster.jpg');
  expect(video.style.position).toBe('absolute');
  expect(video.style.objectFit).toBe('cover');
  expect(video.style.objectPosition).toBe('center top');
  expect(video.dataset.videoBackdrop).toBe('scene');
  expect(video.volume).toBe(.6); expect(video.muted).toBe(false);
  expect(video.playsInline).toBe(true); expect(video.loop).toBe(false);
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  fireEvent.loadedData(video);
  expect(onReady).toHaveBeenCalledOnce();
  view.rerender(<IosVideoPoolContext.Provider value={pool}>{scene('/second.mp4', { muted: true, mediaPosition: 'center' })}</IosVideoPoolContext.Provider>);
  expect(view.container.querySelector('video')).toBe(original);
  expect(video.getAttribute('src')).toBe('/second.mp4');
  expect(video.hasAttribute('poster')).toBe(false);
  expect(video.muted).toBe(true);
});

it('reuses a released active node for the next scene without late old cleanup clearing its source', () => {
  const pool = createPool(); pool.prime();
  const view = render(<IosVideoPoolContext.Provider value={pool}><div key="one">{scene('/one.mp4')}</div><div key="two">{scene('/two.mp4', { isPlaying: false })}</div></IosVideoPoolContext.Provider>);
  const [first, second] = [...view.container.querySelectorAll('video')];
  view.rerender(<IosVideoPoolContext.Provider value={pool}><div key="two">{scene('/two.mp4')}</div><div key="three">{scene('/three.mp4', { isPlaying: false })}</div></IosVideoPoolContext.Provider>);
  const [active, incoming] = [...view.container.querySelectorAll('video')];
  expect(active).toBe(second); expect(incoming).toBe(first);
  expect(active.getAttribute('src')).toBe('/two.mp4');
  expect(incoming.getAttribute('src')).toBe('/three.mp4');
});

it('keeps the current requested pause on pooled native events and cancels stale playback failure', async () => {
  const pool = createPool(); pool.prime();
  let reject!: (error: Error) => void;
  vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const onError = vi.fn();
  const view = render(<IosVideoPoolContext.Provider value={pool}>{scene('/pause.mp4', { onError })}</IosVideoPoolContext.Provider>);
  const video = view.container.querySelector('video')!;
  view.rerender(<IosVideoPoolContext.Provider value={pool}>{scene('/pause.mp4', { onError, isPlaying: false, preparingNarration: true })}</IosVideoPoolContext.Provider>);
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear(); video.currentTime = .2;
  fireEvent.playing(video);
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
  expect(video.currentTime).toBe(0);
  view.unmount();
  await act(async () => { reject(new Error('Old load replaced')); });
  expect(onError).not.toHaveBeenCalled();
});

it('does not allocate an unprimed third element when both pool nodes are leased', () => {
  const pool = createPool(); pool.prime(); pool.acquire(); pool.acquire();
  const created = vi.spyOn(document, 'createElement');
  const onError = vi.fn();
  const view = render(<IosVideoPoolContext.Provider value={pool}>{scene('/third.mp4', { onError })}</IosVideoPoolContext.Provider>);
  expect(view.container.querySelector('video')).toBeNull();
  expect(created.mock.calls.filter(([tag]) => tag === 'video')).toHaveLength(0);
  expect(onError).toHaveBeenCalledOnce();
});

it('keeps an unattenuable reused video muted before its next play request', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'volume', 'get').mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, 'volume', 'set').mockImplementation(() => {});
  const pool = createPool(); pool.prime();
  const first = render(<IosVideoPoolContext.Provider value={pool}>{scene('/one.mp4', { muted: false, volume: .6 })}</IosVideoPoolContext.Provider>);
  const video = first.container.querySelector('video')!;
  first.unmount();
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function(this: HTMLMediaElement) {
    expect(this.muted).toBe(true); return Promise.resolve();
  });
  const next = render(<IosVideoPoolContext.Provider value={pool}>{scene('/next.mp4', { muted: false, volume: .6 })}</IosVideoPoolContext.Provider>);
  expect(next.container.querySelector('video')).toBe(video);
  expect(video.muted).toBe(true);
});

it('restores pooled source and event ownership after Strict Mode effect cleanup', () => {
  const pool = createPool(); pool.prime();
  const view = render(<React.StrictMode><IosVideoPoolContext.Provider value={pool}>{scene('/strict.mp4')}</IosVideoPoolContext.Provider></React.StrictMode>);
  const video = view.container.querySelector('video')!;
  expect(video.getAttribute('src')).toBe('/strict.mp4');
  expect(pool.acquire()).toBeInstanceOf(HTMLVideoElement);
  expect(pool.acquire()).toBeUndefined();
});
