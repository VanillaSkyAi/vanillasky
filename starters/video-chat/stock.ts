import type { VideoOrientation } from "@vanillaskyai/video";

export interface ApprovedStock {
  /** Literal phrases the inspected clip actually depicts; no broad topic aliases. */
  queries: readonly string[];
  orientations: readonly VideoOrientation[];
  description: string;
  reviewedAt: string;
  media: { url: string; type: "video" | "image"; posterUrl?: string };
}

/** Add assets only after watching the clip and checking its crop and poster.
 * An empty collection deliberately declines stock instead of guessing from
 * search rank. The host can maintain this reviewed index independently of the SDK.
 */
export const approvedStock: readonly ApprovedStock[] = [];

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
function approvedUrl(value: string): boolean {
  try { const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.port; }
  catch { return false; }
}

export async function findStockFootage(
  query: string,
  orientation: VideoOrientation,
  signal: AbortSignal,
  _fallbackQuery?: string,
  index: readonly ApprovedStock[] = approvedStock,
) {
  signal.throwIfAborted();
  const intent=normalize(query);
  if(!intent || intent.length>80 || intent.split(' ').length>8)return null;
  const entry=index.find(asset=>asset.reviewedAt && asset.description && asset.orientations.includes(orientation)
    && asset.queries.some(candidate=>normalize(candidate)===intent)
    && approvedUrl(asset.media.url) && (!asset.media.posterUrl || approvedUrl(asset.media.posterUrl)));
  return entry ? {...entry.media} : null;
}
