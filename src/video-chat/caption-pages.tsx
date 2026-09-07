import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { CaptionProgress } from "./caption-progress";

/** Page boundaries come from rendered text, not an arbitrary character limit. */
export function splitCaptionPages(text: string, fits: (text: string) => boolean): string[] {
  const pages: string[] = [];
  let rest = Array.from(text);
  while (rest.length) {
    let low = 1;
    let high = rest.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(rest.slice(0, middle).join(''))) low = middle;
      else high = middle - 1;
    }
    let end = low;
    if (end < rest.length) {
      const space = rest.slice(0, end + 1).lastIndexOf(' ');
      if (space > 0) end = space + 1;
    }
    pages.push(rest.slice(0, end).join(''));
    rest = rest.slice(end);
  }
  return pages;
}

/** Coarse text-weighted pages; this does not claim word-level alignment. */
export function captionPageAt(pages: readonly string[], elapsed: number, duration: number): number {
  const total = pages.reduce((sum, page) => sum + page.length, 0);
  const position = duration > 0 ? Math.max(0, elapsed / duration) * total : 0;
  let end = 0;
  for (let index = 0; index < pages.length - 1; index++) {
    end += pages[index]!.length;
    if (position < end) return index;
  }
  return Math.max(0, pages.length - 1);
}

export function CaptionPages({ text, getProgress }: { text: string; getProgress: () => CaptionProgress | undefined }) {
  const line = useRef<HTMLParagraphElement>(null);
  const lastProgress = useRef<{ caption: string; progress: CaptionProgress } | undefined>(undefined);
  const getter = useRef(getProgress);
  getter.current = getProgress;
  const [source, setSource] = useState(text);
  const [pages, setPages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [timing, setTiming] = useState<CaptionProgress['timing']>();

  useLayoutEffect(() => {
    const element = line.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (!width) { setPages([source]); return; }
      const style = getComputedStyle(element);
      const probe = element.cloneNode(false) as HTMLParagraphElement;
      probe.removeAttribute('aria-live');
      probe.setAttribute('aria-hidden', 'true');
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: `${width}px`, height: 'auto', maxHeight: 'none', inset: '0 auto auto 0', animation: 'none' });
      element.parentElement!.append(probe);
      const height = parseFloat(style.lineHeight) * 2;
      const next = splitCaptionPages(source, candidate => {
        probe.textContent = candidate;
        return probe.getBoundingClientRect().height <= height + .5;
      });
      probe.remove();
      setPages(next);
    };
    measure();
    let previousWidth = element.getBoundingClientRect().width;
    let previousFont = getComputedStyle(element).font;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      const width = element.getBoundingClientRect().width;
      const font = getComputedStyle(element).font;
      if (width !== previousWidth || font !== previousFont) { previousWidth = width; previousFont = font; measure(); }
    });
    observer?.observe(element);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => { observer?.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [source]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const observed = text ? getter.current() : undefined;
      if (observed) lastProgress.current = { caption: text, progress: observed };
      const progress = observed ?? (lastProgress.current?.caption === text ? lastProgress.current.progress : undefined);
      const nextSource = progress?.text ?? text;
      setSource(current => current === nextSource ? current : nextSource);
      setTiming(progress?.timing);
      setIndex(nextSource !== source ? 0 : captionPageAt(pages, progress?.elapsedSeconds ?? 0, progress?.durationSeconds ?? 0));
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [text, source, pages]);

  return <p ref={line} className="line" aria-live="polite" data-caption-timing={timing} data-caption-page={index}>{pages[index] ?? ''}</p>;
}
