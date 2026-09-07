import { useLayoutEffect, useRef, useState } from "react";
import { TitleSceneTemplate } from "../visual-system/scene-templates/chapter-title.js";

/** A live opening holds the canonical chapter's readable frame until the film arrives. */
export function OpeningChapter({ title, preparing = false }: { title: string; preparing?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1080, height: 1080 });
  const [titleBottom, setTitleBottom] = useState(0);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
      const title = element.querySelector('[data-title-composition="centered"]');
      if (title) setTitleBottom(title.getBoundingClientRect().bottom - element.getBoundingClientRect().top);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const title = element.querySelector('[data-title-composition="centered"]');
    if (title) observer.observe(title);
    return () => observer.disconnect();
  }, [title]);
  return <div ref={root} data-opening-chapter className="opening-chapter">
    <TitleSceneTemplate variables={{title}} style={{}} width={size.width} height={size.height}
      progress={0.3} beatIntensity={0} safeZone={{top:0,right:0,bottom:0,left:0}} />
    {preparing && <div className="video-preparation" style={{top: titleBottom + 24}} role="status" aria-label="Video preparation">
      <span className="video-preparation-spinner" aria-hidden="true" />
      <span className="video-preparation-text">Preparing your video…</span>
    </div>}
  </div>;
}
