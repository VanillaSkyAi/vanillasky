import React from 'react';
import { createRoot } from 'react-dom/client';
import { VideoPlayer } from '../../../src/player/video-player';
import type { Video } from '../../../src/internal';
import { TEST_VIDEO_STYLE } from '../../semantic-brand-fixture';

const mode = new URLSearchParams(location.search).get('fault') ?? 'missing-video';
const webm = new URLSearchParams(location.search).has('webm');
const source = mode === 'ready-image' ? new URL('./media-transition/sunflowers.jpg', location.href).href : mode === 'empty-video' ? '' : mode === 'stalled-video'
  ? new URL(`./media-transition/sunflowers.${webm ? 'webm' : 'mp4'}`, location.href).href
  : new URL(`./${mode}.${mode.includes('image') ? 'jpg' : 'mp4'}`, location.href).href;
const video: Video = { schemaVersion: '0.2', orientation: 'landscape', style: TEST_VIDEO_STYLE, scenes: [
  { id: 'opening', templateId: 'chapterTitle', variables: { title: 'Keep this useful introduction visible' }, timing: { fixedDuration: 1.5 } },
  { id: 'media', templateId: 'cinemaMedia', variables: { mediaType: mode.includes('image') ? 'photo' : 'video', mediaUrl: source, fallbackText: 'The authored answer stays available' }, timing: { fixedDuration: 3 } },
  { id: 'ending', templateId: 'chapterTitle', variables: { title: 'A complete useful ending' }, timing: { fixedDuration: 2 } },
] };
type Sample = { at: number; scene?: string; visible: boolean; fallback: boolean; videos: number; injected: boolean; frameTime?: number };
const samples: Sample[] = [];
Object.assign(window, { recoverySamples: samples });
const began = performance.now();
let injected = false;
const frames = new WeakMap<HTMLVideoElement, number>();
const seen = new WeakSet<HTMLVideoElement>();
function visible(element: Element) {
  if (!element.getBoundingClientRect().width) return false;
  for (let owner: Element | null = element; owner; owner = owner.parentElement) {
    const style = getComputedStyle(owner);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < .02) return false;
  }
  return true;
}
function sample() {
  const stage = document.querySelector('[data-video-frame]');
  const active = document.querySelector('[data-scene-layer="active"]');
  const videos = [...document.querySelectorAll('video')];
  for (const element of videos) if (!seen.has(element)) {
    seen.add(element);
    const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      frames.set(element, metadata.mediaTime);
      if (mode === 'stalled-video' && element.closest('[data-scene-layer="active"]') && metadata.mediaTime > .3 && !injected) {
        injected = true; element.pause(); element.dispatchEvent(new Event('waiting'));
      }
      if (element.isConnected) element.requestVideoFrameCallback(frame);
    };
    element.requestVideoFrameCallback(frame);
  }
  const text = [...(active?.querySelectorAll('h1,h2,h3,p,[data-title-composition]') ?? [])].some(element => element.textContent?.trim() && visible(element));
  const media = videos.some(element => active?.contains(element) && frames.has(element) && visible(element))
    || [...(active?.querySelectorAll('img') ?? [])].some(image => image.complete && image.naturalWidth > 0 && visible(image));
  if (samples.length < 1500) samples.push({ at: performance.now() - began, scene: stage?.getAttribute('data-scene-id') ?? undefined,
    visible: text || media, injected, fallback: Boolean(active?.matches('[data-scene-fallback="true"]')), videos: videos.length,
    frameTime: videos.find(element => active?.contains(element))?.currentTime });
  requestAnimationFrame(sample);
}
requestAnimationFrame(sample);
createRoot(document.getElementById('root')!).render(<VideoPlayer video={video} width={640} autoPlay startMuted />);
