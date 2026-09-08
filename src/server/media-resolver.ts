import type { VideoInput, VideoScene } from "../protocol/types.js";

export interface ResolvedMedia {
  url: string;
  type: "image" | "video";
  posterUrl?: string;
}

export interface MediaResolverContext {
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
