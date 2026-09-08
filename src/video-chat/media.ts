import { MAX_RETAINED_MEDIA_URL_LENGTH } from "../protocol/persistence.js";
import type { VideoChatMedia } from "./types.js";

/** Keep provider details and unsafe URLs out of the browser-owned chat state. */
export function sanitizeVideoChatMedia(value: unknown): VideoChatMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const media = value as Record<string, unknown>;
  if (media.type !== "image" && media.type !== "video") return null;
  if (typeof media.url !== "string") return null;
  const url = media.url.trim();
  if (!safeMediaUrl(url)) return null;
  if (media.posterUrl != null && typeof media.posterUrl !== "string") return null;
  const posterUrl = typeof media.posterUrl === "string" ? media.posterUrl.trim() : "";
  if (posterUrl && !safeMediaUrl(posterUrl)) return null;
  if (media.durationSec !== undefined && (typeof media.durationSec !== "number"
    || !Number.isFinite(media.durationSec) || media.durationSec <= 0 || media.durationSec > 3600)) return null;
  return {
    url,
    type: media.type,
    ...(posterUrl ? { posterUrl } : {}),
    ...(typeof media.durationSec === "number" ? { durationSec: media.durationSec } : {}),
  };
}

function safeMediaUrl(value: string): boolean {
  if (!value || value.length > MAX_RETAINED_MEDIA_URL_LENGTH) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
