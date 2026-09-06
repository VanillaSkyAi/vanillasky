import { useLayoutEffect, useRef, useState } from "react";
import { TitleSceneTemplate } from "../visual-system/scene-templates/chapter-title.js";

/** A live opening holds the canonical chapter's readable frame until the film arrives. */
export function OpeningChapter({ title }: { title: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1080, height: 1080 });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={root} data-opening-chapter className="opening-chapter">
    <TitleSceneTemplate variables={{title}} style={{}} width={size.width} height={size.height}
      progress={0.3} beatIntensity={0} safeZone={{top:0,right:0,bottom:0,left:0}} />
  </div>;
}
