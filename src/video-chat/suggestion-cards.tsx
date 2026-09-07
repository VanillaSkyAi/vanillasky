import { useEffect, useId, useRef, useState } from "react";
import type { VideoChatMedia, VideoChatSuggestion } from "./types.js";

/** Hero footage plays continuously; inactive cards with posters use images. */
export function Frame({ media, poster, playing, onReady, onError, revealWhenReady = false }: {
  media: VideoChatMedia | null; poster?: boolean; playing?: boolean;
  onReady?: () => void; onError?: () => void; revealWhenReady?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  useEffect(() => {
    const element = video.current;
    if (!element || playing === undefined) return;
    if (playing) void element.play().catch(() => undefined);
    else element.pause();
  }, [playing]);

  if (!media) return null;
  if (playing === false && media.type === "video" && media.posterUrl) {
    return <img className="frame-media frame-poster" src={media.posterUrl} alt="" onLoad={onReady} onError={onError} />;
  }
  const ready = () => { setPlayingUrl(media.url); onReady?.(); };
  const appearance = revealWhenReady ? { opacity: playingUrl === media.url ? 1 : 0, transition: "opacity 200ms ease" } : undefined;
  if (media.type === "image") return <img className="frame-media" src={media.url} alt="" style={appearance} onLoad={ready} onError={onError} />;
  return <><video
    ref={video}
    className="frame-media"
    src={media.url}
    poster={poster ? media.posterUrl : undefined}
    style={appearance}
    onPlaying={ready}
    onError={() => { setPlayingUrl(null); onError?.(); }}
    autoPlay={playing !== false}
    muted
    loop
    playsInline
    // The still is what a paused card shows, so it is worth having early.
    preload="metadata"
    // Decorative: it carries no information the words do not.
    aria-hidden="true"
  />
    {poster && media.posterUrl && playingUrl !== media.url && <img className="frame-media frame-poster" src={media.posterUrl} alt="" onLoad={onReady} />}
  </>;
}

/** Shared welcome and follow-up cards with user-controlled previews and browsing. */
export function SuggestionCards({ suggestions, label, onAsk, browse = false }: {
  suggestions: readonly VideoChatSuggestion[];
  /** Names the row for a screen reader; the cards themselves carry the words. */
  label: string;
  /** Welcome-only overflow controls; follow-up layout stays unchanged. */
  browse?: boolean;
  onAsk: (suggestion: VideoChatSuggestion) => void;
}) {
  const railRef = useRef<HTMLUListElement>(null);
  const railId = useId();
  const [at, setAt] = useState(0);
  const [overflow, setOverflow] = useState({before: false, after: false});
  useEffect(() => {
    const rail = railRef.current;
    if (!browse || !rail) return;
    const update = () => setOverflow({before: rail.scrollLeft > 2, after: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2});
    update();
    rail.addEventListener("scroll", update, {passive: true});
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(rail);
    return () => { rail.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [browse, suggestions.length]);
  const move = (direction: number) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({left: direction * rail.clientWidth, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  };

  if (suggestions.length === 0) return null;

  const cards = <>
    <ul className="cards" id={railId} ref={railRef} aria-label={label}>
      {suggestions.map((card, index) => <li key={card.prompt}>
        <button
          type="button"
          data-active={index === at ? "" : undefined}
          onFocus={() => setAt(index)}
          onPointerEnter={() => setAt(index)}
          onClick={() => onAsk(card)}
        >
          <Frame media={card.media} poster playing={index === at} />
          <span className="card-wash" aria-hidden="true" />
          <span className="card-prompt">{card.prompt}</span>
        </button>
      </li>)}
    </ul>

    {suggestions.length > 1 && <div className="card-dots" role="group" aria-label={`${label} navigation`}>
      {suggestions.map((card, index) => <button
        key={card.prompt}
        type="button"
        aria-pressed={index === at}
        aria-label={`Show suggestion ${index + 1}: ${card.prompt}`}
        className={index === at ? "on" : undefined}
        onClick={() => {
          setAt(index);
          const rail = railRef.current;
          const card = rail?.children[index] as HTMLElement | undefined;
          if (rail && card) rail.scrollTo({left: card.offsetLeft, behavior: "smooth"});
        }}
      />)}
    </div>}
  </>;
  return browse ? <div className="suggestion-rail">{cards}
    {(overflow.before || overflow.after) && <div className="rail-arrows">
      <button type="button" aria-label="Previous suggestions" aria-controls={railId} disabled={!overflow.before} onClick={() => move(-1)}>‹</button>
      <button type="button" aria-label="Next suggestions" aria-controls={railId} disabled={!overflow.after} onClick={() => move(1)}>›</button>
    </div>}
  </div> : cards;
}
