import type { ReactNode } from "react";

/** Small inline icons keep the chat interface self-contained. */
const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...stroke}>{children}</svg>;
}

export const Sessions = () => <Glyph><path d="M5 3h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8l-5 3V5a2 2 0 0 1 2-2Z" /><path d="M17 8h2a2 2 0 0 1 2 2v11l-4-3h-6a2 2 0 0 1-2-2v-2" /></Glyph>;
export const Plus = () => <Glyph><path d="M12 5v14M5 12h14" /></Glyph>;
export const Gear = () => <Glyph>
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
</Glyph>;
export const Sound = () => <Glyph>
  <path d="M11 5 6 9H2v6h4l5 4z" />
  <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
</Glyph>;
export const Muted = () => <Glyph>
  <path d="M11 5 6 9H2v6h4l5 4z" />
  <path d="m22 9-6 6M16 9l6 6" />
</Glyph>;
export const Mic = () => <Glyph>
  <rect x="9" y="2" width="6" height="12" rx="3" />
  <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
</Glyph>;
export const Send = () => <Glyph><path d="M12 19V5M5 12l7-7 7 7" /></Glyph>;
/**
 * Pause, not stop.
 *
 * A square says the response ends and starts again from the top; two bars say it
 * waits where it is - which is what actually happens, since continue resumes
 * the sentence from the word it was cut off at. The glyph was also the one
 * control in the composer nobody could read at 18px.
 */
export const Stop = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><rect x="7" y="5" width="3.4" height="14" rx="1.4" /><rect x="13.6" y="5" width="3.4" height="14" rx="1.4" /></svg>;
export const Play = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>;
export const Replay = () => <Glyph><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Glyph>;
export const ChevronUp = () => <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" {...stroke}><path d="m6 15 6-6 6 6" /></svg>;
export const Close = () => <Glyph><path d="M6 6l12 12M18 6 6 18" /></Glyph>;
export const Warning = () => <Glyph>
  <circle cx="12" cy="12" r="9" />
  <path d="M12 8v5M12 16.2v.1" />
</Glyph>;
