/** A finite, safe user gain. Zero is a volume, never a playback command. */
export function audioVolume(value: number | undefined, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

const initializedMedia = new WeakSet<HTMLMediaElement>();

/** Use native volume for remote footage: a CORS-restricted Web Audio graph can silence it. */
export function rampMediaVolume(media: HTMLMediaElement, value: number, onUnavailable?: () => void): () => void {
  const target = audioVolume(value);
  if (!initializedMedia.has(media)) {
    initializedMedia.add(media);
    try { media.volume = target; } catch { /* The safety check below handles fixed native gain. */ }
    // Some iOS video outputs cannot be attenuated. Silence that optional layer
    // instead of allowing full-volume footage to overwhelm the narration.
    if (target < 1 && media.volume > target + .01) { media.muted = true; onUnavailable?.(); }
    return () => {};
  }
  const start = media.volume;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const since = performance.now();
  const tick = () => {
    if (cancelled) return;
    const progress = Math.min(1, (performance.now() - since) / 120);
    try { media.volume = start + (target - start) * progress; }
    catch { /* iOS may reject native volume; never interrupt the media clock. */ }
    if (target < 1 && progress === 1 && media.volume > target + .01) { media.muted = true; onUnavailable?.(); }
    if (progress < 1) timer = setTimeout(tick, 16);
  };
  tick();
  return () => { cancelled = true; clearTimeout(timer); };
}
