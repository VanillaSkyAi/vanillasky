import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CaptionProgress } from "./caption-progress.js";
import { captionWordAt, splitCaptionPhrases } from "./caption-phrases.js";
import { estimateNarrationSeconds } from "../protocol/clip-budget.js";

export function CaptionWords({ text, getProgress, paused = false, silent = false, muted = false }: {
  text: string; getProgress: () => CaptionProgress | undefined; paused?: boolean; silent?: boolean; muted?: boolean;
}) {
  const getter = useRef(getProgress);
  getter.current = getProgress;
  const playback = useRef({ paused, silent, muted });
  playback.current = { paused, silent, muted };
  const lastProgress = useRef<{ caption: string; progress: CaptionProgress } | undefined>(undefined);
  const fallback = useRef({ source: text, elapsed: 0, updatedAt: performance.now(), active: false });
  const read = (progress: CaptionProgress | undefined) => {
    const source = progress?.text ?? text;
    return { source, timing: progress?.timing, ...captionWordAt(source.match(/\S+/gu) ?? [], progress) };
  };
  const [current, setCurrent] = useState(() => read(text ? getProgress() : undefined));
  const phrases = useMemo(() => splitCaptionPhrases(current.source), [current.source]);
  const phrase = phrases.find(item => current.index >= item.start && current.index < item.start + item.words.length);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const observed = text ? getter.current() : undefined;
      if (observed) lastProgress.current = { caption: text, progress: observed };
      const previous = lastProgress.current?.caption === text ? lastProgress.current.progress : undefined;
      const source = observed?.text ?? previous?.text ?? text;
      const now = performance.now();
      const clock = fallback.current;
      if (clock.source !== source) { clock.source = source; clock.elapsed = 0; clock.updatedAt = now; clock.active = false; }
      if (observed) { clock.elapsed = observed.elapsedSeconds; clock.active = false; }
      else if (playback.current.muted || (playback.current.silent && !previous)) clock.active = true;
      // Muting cancels native speech. Continue reading after unmute until a real
      // clock returns or this cue changes; ordinary completed speech stays held.
      const estimate = !observed && clock.active;
      if (estimate && !playback.current.paused) clock.elapsed += Math.max(0, now - clock.updatedAt) / 1000;
      clock.updatedAt = now;
      // Gaps keep the last phrase. Muted/unavailable voices use the same word
      // treatment with estimated reading time, never a full-caption replacement.
      const progress: CaptionProgress | undefined = observed ?? (estimate ? {
        text: source, elapsedSeconds: clock.elapsed, durationSeconds: previous?.durationSeconds ?? Math.max(1, estimateNarrationSeconds(source)), timing: "estimated", alignment: "estimated",
      } : previous);
      const words = source.match(/\S+/gu) ?? [];
      const word = captionWordAt(words, progress);
      if (!observed && !estimate) word.active = false;
      const next = { source, timing: progress?.timing, ...word };
      setCurrent(previous => {
        // A real clock may seek; losing or muting that clock must never rewind.
        const nextIndex = !observed && previous.source === next.source ? Math.max(previous.index, next.index) : next.index;
        return previous.source === next.source && previous.index === nextIndex && previous.active === next.active
          && previous.alignment === next.alignment && previous.timing === next.timing ? previous : { ...next, index: nextIndex };
      });
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [text]);

  return <p className="line word-captions" aria-live="off" dir="auto" data-caption-timing={current.timing}
    data-caption-alignment={current.alignment} data-caption-phrase={phrase?.start ?? 0}>
    {phrase?.words.map((word, index) => <Fragment key={`${current.source}:${phrase.start + index}`}>
      {index > 0 ? " " : null}<span className="caption-word" data-active={current.active && phrase.start + index === current.index}>{word}</span>
    </Fragment>)}
  </p>;
}
