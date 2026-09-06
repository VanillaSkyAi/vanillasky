import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoChatMedia, VideoChatSuggestion } from "./types.js";

/**
 * A prompt offered as a card with real footage on it.
 *
 * Used twice, and deliberately the same both times: before the session starts,
 * where four cards are the whole invitation, and after a response finishes,
 * where the follow-ups take the same shape over the last frame. Offering a
 * suggestion as a pill in one place and as a card in the other made them look
 * like different kinds of thing when they are the same thing - a prompt the
 * video chat can respond to next.
 *
 * The footage is searched at run time rather than checked in, so the example
 * carries no media. A card whose search came back empty is still a card; it
 * just wears the ground colour, which is the state the rest of the video chat
 * already handles.
 */
/**
 * One frame of footage, playing only when it is being looked at.
 *
 * `playing` left undefined means always - the hero behind the invitation. A
 * card passes it, so only the prompt in hand moves: four clips looping at
 * once is four things competing for the eye on a screen whose whole argument is
 * that one video is worth more than a page of text. It is also four decoders
 * running for three pictures nobody is watching.
 */
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

export function SuggestionCards({ suggestions, label, onAsk }: {
  suggestions: readonly VideoChatSuggestion[];
  /** Names the row for a screen reader; the cards themselves carry the words. */
  label: string;
  onAsk: (suggestion: VideoChatSuggestion) => void;
}) {
  const railRef = useRef<HTMLUListElement>(null);
  /**
   * Which prompt is in hand.
   *
   * The dots move it and the ring shows it, so the highlight always names what
   * pressing Enter would ask. Pointing at a card or tabbing to it moves it too:
   * a marker that disagrees with what you are about to press is worse than no
   * marker.
   */
  const [at, setAt] = useState(0);
  /**
   * Set the moment the person takes over, and never unset.
   *
   * A row that keeps moving under someone's hand is the reason carousels are
   * disliked: they point at a card and it walks away. Pointing, tabbing, or
   * pressing a dot ends the tour for good.
   */
  const [taken, setTaken] = useState(false);

  const take = useCallback((index: number) => {
    setTaken(true);
    setAt(index);
  }, []);

  /**
   * Left to right, one card every five seconds, until it is taken over.
   *
   * The cards are the only thing on this screen that shows what a response looks
   * like, and three of the four sat still. Reduced motion turns it off
   * entirely - the ring still starts on the first card, so nothing is lost but
   * the movement.
   */
  useEffect(() => {
    if (taken || suggestions.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const tour = window.setInterval(() => setAt((index) => (index + 1) % suggestions.length), 5000);
    return () => window.clearInterval(tour);
  }, [taken, suggestions.length]);

  /**
   * Keep the card in hand in view.
   *
   * Wherever the row overflows - a phone - a ring on a card that is off the
   * edge tells nobody anything, and the tour walks off screen after the second
   * card. This follows every way the selection moves rather than only the dots.
   *
   * The rail is scrolled directly rather than through `scrollIntoView`, which
   * is also entitled to scroll the page to bring the row into view; there is
   * nothing to bring into view, and the page should not move.
   */
  useEffect(() => {
    const rail = railRef.current;
    const card = rail?.children[at] as HTMLElement | undefined;
    if (!rail || !card) return;
    if (rail.scrollWidth <= rail.clientWidth + 4) return;
    const centred = card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2;
    rail.scrollTo({ left: Math.max(0, centred), behavior: "smooth" });
  }, [at]);

  if (suggestions.length === 0) return null;

  return <>
    <ul className="cards" ref={railRef} aria-label={label}>
      {suggestions.map((card, index) => <li key={card.prompt}>
        <button
          type="button"
          data-active={index === at ? "" : undefined}
          onFocus={() => take(index)}
          onPointerEnter={() => take(index)}
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
        onClick={() => take(index)}
      />)}
    </div>}
  </>;
}
