import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CaptionProgress } from "./caption-progress.js";
import { captionWordAt, splitCaptionPhrases } from "./caption-phrases.js";

export function CaptionWords({ text, getProgress }: { text: string; getProgress: () => CaptionProgress | undefined }) {
  const getter = useRef(getProgress);
  getter.current = getProgress;
  const lastProgress = useRef<{ caption: string; progress: CaptionProgress } | undefined>(undefined);
  const read = (progress: CaptionProgress | undefined) => {
    const source = progress?.text ?? text;
    return { source, staticCue: !progress, timing: progress?.timing, ...captionWordAt(source.match(/\S+/gu) ?? [], progress) };
  };
  const [current, setCurrent] = useState(() => read(text ? getProgress() : undefined));
  const phrases = useMemo(() => splitCaptionPhrases(current.source), [current.source]);
  const phrase = phrases.find(item => current.index >= item.start && current.index < item.start + item.words.length);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const observed = text ? getter.current() : undefined;
      if (observed) lastProgress.current = { caption: text, progress: observed };
      const progress = observed ?? (lastProgress.current?.caption === text ? lastProgress.current.progress : undefined);
      const source = progress?.text ?? text;
      const next = { source, staticCue: !observed, timing: progress?.timing, ...captionWordAt(source.match(/\S+/gu) ?? [], progress) };
      setCurrent(previous => previous.source === next.source && previous.index === next.index && previous.active === next.active
        && previous.staticCue === next.staticCue && previous.alignment === next.alignment && previous.timing === next.timing ? previous : next);
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [text]);

  return <p className="line word-captions" aria-live="off" dir="auto" data-caption-timing={current.timing} data-static={current.staticCue} tabIndex={current.staticCue ? 0 : undefined}
    data-caption-alignment={current.alignment} data-caption-phrase={phrase?.start ?? 0}>
    {current.staticCue ? current.source : phrase?.words.map((word, index) => <Fragment key={`${current.source}:${phrase.start + index}`}>
      {index > 0 ? " " : null}<span className="caption-word" data-active={current.active && phrase.start + index === current.index}>{word}</span>
    </Fragment>)}
  </p>;
}
