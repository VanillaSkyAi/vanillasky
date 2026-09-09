import type { VideoInput, VideoScene } from "../protocol/types.js";

export interface ResolvedMedia {
  url: string;
  type: "image" | "video";
  posterUrl?: string;
  /** Actual footage duration when the provider or delivery pipeline knows it. */
  durationSec?: number;
  /** Provider-approved natural ambience/action audio, without speech or music. */
  audio?: "ambient";
}

interface MediaResolverContext {
  input: VideoInput;
  requestId: string;
  scene: Readonly<VideoScene>;
  templateId: string;
  preferredType: "image" | "video" | "any";
  /**
   * The visual language generated media must match, when the application set
   * one. Append it to a provider prompt; a shot that ignores it is the
   * mismatch this exists to prevent.
   */
  generatedLook?: string;
  signal: AbortSignal;
}

export type MediaResolver = (
  query: string,
  context: MediaResolverContext,
) => ResolvedMedia | null | Promise<ResolvedMedia | null>;
