// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SceneVideoBackdrop } from '../src/visual-system/scene-templates/scene-video-backdrop';
import { VideoFrame } from '../src/player/video-frame';
import { preloadBuiltinTemplate } from '../src/visual-system/catalog/builtin-player';
import { TEST_VIDEO_STYLE } from './helpers/video-style';
import type { Video } from '../src/protocol/types';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mocks = () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
};
it('keeps optional remote clip audio silent when native volume cannot be reduced, including master unmute', () => {
  mocks();
  vi.spyOn(HTMLMediaElement.prototype, 'volume', 'get').mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, 'volume', 'set').mockImplementation(() => {});
  const props = { mediaUrl: 'https://remote.test/ambient.mp4', progress: 0, isPlaying: true, volume: .15, muted: false };
  const view = render(createElement(SceneVideoBackdrop, props));
  const video = view.container.querySelector('video')!;
  expect(video.muted).toBe(true);
  view.rerender(createElement(SceneVideoBackdrop, { ...props, muted: true }));
  view.rerender(createElement(SceneVideoBackdrop, props));
  expect(video.muted).toBe(true);
});
it('enables only marked ambience while retaining existing standalone native-audio behavior', async () => {
  mocks();
  await preloadBuiltinTemplate('cinemaMedia');
  const video: Video = { schemaVersion: '0.2', orientation: 'portrait', style: TEST_VIDEO_STYLE, scenes: [{ id: 'clip', templateId: 'cinemaMedia', variables: { mediaUrl: '/clip.mp4', mediaType: 'video' }, timing: { fixedDuration: 5 } }] };
  const props = { config: video, time: 1, width: 240, height: 426, playing: true, mediaAudioMuted: false, mediaAudioVolume: .15, mediaAudioAmbientOnly: true };
  const view = render(createElement(VideoFrame, props));
  await waitFor(() => expect(view.container.querySelector('video')).toBeTruthy());
  expect(view.container.querySelector('video')!.muted).toBe(true);
  view.rerender(createElement(VideoFrame, { ...props, config: { ...video, scenes: [{ ...video.scenes[0]!, variables: { ...video.scenes[0]!.variables, mediaAudio: 'ambient' } }] } }));
  expect(view.container.querySelector('video')!.muted).toBe(false);
  view.rerender(createElement(VideoFrame, { ...props, mediaAudioAmbientOnly: false }));
  expect(view.container.querySelector('video')!.muted).toBe(false);
});
