export type VideoChatMode = "cinematic" | "pexels";

export interface VideoChatConversationTurn {
  prompt: string;
  response?: string;
}

export interface VideoChatCapabilities {
  templates: true;
  generatedSpeech: boolean;
  generatedVideo: boolean;
  /** The configured video provider can return ambient/action audio. */
  generatedVideoAudio?: boolean;
  stockMedia: boolean;
  transcription: boolean;
  modes: VideoChatMode[];
}

export interface VideoChatMedia {
  url: string;
  type: "image" | "video";
  posterUrl?: string;
  /** Actual media duration, not a narration estimate. */
  durationSec?: number;
  /** Set only by providers instructed to supply natural scene sound. */
  audio?: "ambient";
}

export interface VideoChatSuggestion {
  prompt: string;
  /** Optional short hook that can start speaking the moment this suggestion is selected. */
  opening?: string;
  media: VideoChatMedia | null;
}

export interface VideoChatAskOptions {
  /** Reuse already-loaded suggestion footage while the answer is prepared. */
  openingMedia?: VideoChatMedia | null;
  /** A prewritten 6-9 word hook that can start immediately while the response streams. */
  opening?: string;
}

export interface VideoChatWelcome {
  hero: VideoChatMedia | null;
  cards: VideoChatSuggestion[];
}

export interface VideoChatWelcomePrompt {
  prompt: string;
  /** A prewritten 6-9 word hook for an instant suggested-prompt response. */
  opening?: string;
  mediaQuery?: string;
}

export interface VideoChatWelcomeOptions {
  heroQuery?: string;
  prompts?: readonly VideoChatWelcomePrompt[];
}
