import type { ReactNode } from "react";
import type { VideoChatSuggestion, VideoChatWelcome } from "./types.js";
import { Frame, SuggestionCards } from "./suggestion-cards";

/**
 * The screen before anything has been asked.
 *
 * It is the one moment the video chat has to say what it does before it has done
 * it, and a gradient does not say it. Real footage behind the invitation, and
 * a real frame on each suggested prompt, shows the response instead of
 * describing it - and shows it in the shape the response will arrive in.
 *
 * The default cloud film is curated; host-selected welcome queries and cards
 * resolve through the application. Media stays remote, and failed loads fall
 * back to the brand gradient.
 */
export function Welcome({ data, onAsk, title }: {
  data?: VideoChatWelcome;
  onAsk: (suggestion: VideoChatSuggestion) => void;
  title?: ReactNode;
}) {
  return <div className="welcome">
    <Frame media={data?.hero ?? null} poster />
    {/* The footage is a ground for type, so it is dimmed towards the corner
        the words sit in rather than evenly - an even scrim flattens the
        picture into a texture. */}
    <div className="welcome-wash" aria-hidden="true" />

    <div className="welcome-body">
      {/* The category first, the difference last. Someone who has used
          ChatGPT or Perplexity knows what this is by the end of line one, and
          the accent line carries the only part that is new. */}
      <h1 className="welcome-title">
        {title ?? <>An AI chat that responds<br /><em>in video, not text.</em></>}
      </h1>

      <SuggestionCards browse suggestions={data?.cards ?? []} label="Suggested prompts" onAsk={onAsk} />
    </div>
  </div>;
}
