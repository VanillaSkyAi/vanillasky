import type { VideoOrientation } from "@vanillaskyai/video";

interface StockVideo {
  url: string;
  type: "video";
  posterUrl?: string;
}
interface PexelsVideo {
  url?: string;
  image?: string;
  title?: unknown;
  description?: unknown;
  tags?: unknown;
  video_files?: { link?: string; width?: number; height?: number; file_type?: string }[];
}
const cache = new Map<string, { expires: number; media: StockVideo | null }>();
const words = (value: string): string[] => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const ignored = new Set(['a','an','the','in','on','at','of','with','and','to']);
const terms = (value: string) => words(value).filter(word => !ignored.has(word));
// Only simple English -s forms; avoid aggressive stemming and ambiguous endings.
function wordForm(word: string) {
  return /^[a-z]{3,}s$/.test(word) && !/(?:ss|us|is|ies)$/.test(word) && word !== 'news'
    ? word.slice(0, -1) : word;
}
function selectionHint(value: unknown) {
  const phrase = (input: unknown) => {
    if (typeof input !== 'string') return undefined;
    const normalized = input.trim().toLowerCase().replace(/\s+/gu,' ').replaceAll('’', "'");
    return normalized.length <= 48 && /^[\p{L}\p{N} '-]+$/u.test(normalized) && words(normalized).length <= 4 && terms(normalized).length ? normalized : undefined;
  };
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const subject = phrase(raw.subject);
  if (!subject) return undefined;
  const activity = phrase(raw.activity), equipment = phrase(raw.equipment);
  const exclude = Array.isArray(raw.exclude) && raw.exclude.length <= 3 ? raw.exclude.map(phrase).filter((item): item is string => Boolean(item)) : [];
  return {subject, ...(activity ? {activity} : {}), ...(equipment ? {equipment} : {}), ...(exclude.length ? {exclude} : {})};
}
function pexelsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "pexels.com" || url.hostname.endsWith(".pexels.com"));
  } catch { return false; }
}

/** Full catalog search. Available metadata ranks subject relevance, not factual proof.
 * Applications using this adapter must display a prominent link to Pexels.
 * https://www.pexels.com/api/documentation/#guidelines
 */
export async function findStockFootage(query: string, orientation: VideoOrientation, signal: AbortSignal, rawSelection?: unknown) {
  signal.throwIfAborted();
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  const tokens = words(normalized);
  const selection = selectionHint(rawSelection);
  const key = JSON.stringify({version: 5, orientation, query: normalized, selection});
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey || !tokens.length || normalized.length > 80 || tokens.length > 8) return null;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.media;
  let selected: StockVideo | null = null;
  // Reuse the caller's deadline signal; broadening never starts a new timeout.
  const queries = [...new Set([normalized, ...(selection ? [selection.subject] : [])])];
  for (const searchQuery of queries) {
    signal.throwIfAborted();
    const url = new URL("https://api.pexels.com/v1/videos/search");
    url.search = new URLSearchParams({ query: searchQuery, per_page: "12", size: "medium" }).toString();
    const response = await fetch(url, { headers: { Authorization: apiKey }, signal });
    signal.throwIfAborted();
    if (!response.ok) return null;
    const result = await response.json() as { videos?: PexelsVideo[] };
    signal.throwIfAborted();
    let bestScore = -1, bestOrientation = -1;
    const matchesOrientation = (file: {width?: number; height?: number}) => orientation === "portrait"
      ? file.height! > file.width! : file.width! >= file.height!;
    for (const video of (Array.isArray(result.videos) ? result.videos : []).slice(0, 12)) {
      if (!pexelsUrl(video.url)) continue;
      const slug = new URL(video.url).pathname.replace(/^\/video\//, "");
      const title = typeof video.title === "string" ? video.title : "";
      const tags = Array.isArray(video.tags) ? video.tags.filter((tag): tag is string => typeof tag === "string").join(" ") : "";
      const subject = words(`${slug} ${title} ${typeof video.description === "string" ? video.description : ""} ${tags}`).filter(token => !/^\d+$/.test(token)).map(wordForm);
      let matches = tokens.filter(token => subject.includes(wordForm(token))).length;
      if (selection && subject.length) {
        const covers = (phrase: string) => terms(phrase).every(word => subject.includes(wordForm(word)));
        if (selection.exclude?.some(covers)) continue;
        // Query context breaks equal hint matches without outweighing a hint.
        const contextScore = matches / (tokens.length + 1);
        matches = covers(selection.subject) ? 2 + contextScore + Number(Boolean(selection.activity && covers(selection.activity)))
          + Number(Boolean(selection.equipment && covers(selection.equipment))) : 0;
      }
      // The documented Video resource can have only a numeric page URL and no
      // editorial metadata. Preserve provider search order for unknown relevance;
      // positive overlap ranks above provider-ranked illustrative alternatives.
      const files = (Array.isArray(video.video_files) ? video.video_files : []).filter(file =>
        file.file_type === "video/mp4" && pexelsUrl(file.link)
        && Number.isFinite(file.width) && Number.isFinite(file.height)
        && Math.min(file.width!, file.height!) >= 360,
      ).sort((a, b) => Number(matchesOrientation(b)) - Number(matchesOrientation(a)) || Math.abs(Math.max(a.width!, a.height!) - 1280) - Math.abs(Math.max(b.width!, b.height!) - 1280));
      const file = files[0];
      if (!file) continue;
      const orientationScore = Number(matchesOrientation(file));
      // Prefer composition fit only when subject relevance is equal.
      if (matches < bestScore || (matches === bestScore && orientationScore <= bestOrientation)) continue;
      bestScore = matches;
      bestOrientation = orientationScore;
      selected = { url: file.link!, type: "video", ...(pexelsUrl(video.image) ? { posterUrl: video.image } : {}) };
    }
    if (selected) break;
  }
  // Bounded process-local cache; no request signal or credentials are retained.
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + (selected ? 24 * 60 * 60_000 : 60_000), media: selected });
  return selected;
}
