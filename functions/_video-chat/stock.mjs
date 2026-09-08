import { normalizeIntent } from './approved-stock.mjs';
const TIMEOUT_MS = 2500;
const MAX_RESPONSE_BYTES = 128 * 1024;
const CACHE_OPERATION_MS = 100;

function mediaUrl(value, host) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === host && !url.port &&
      !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function validateMedia(value) {
  if (!['image', 'video'].includes(value?.type)) return null;
  const url = mediaUrl(value.url, value.type === 'image' ? 'images.pexels.com' : 'videos.pexels.com');
  if (!url) return null;
  const posterUrl = mediaUrl(value.posterUrl, 'images.pexels.com');
  const attributionUrl = mediaUrl(value.attribution?.url, 'www.pexels.com');
  const author = typeof value.attribution?.author === 'string' ? value.attribution.author.slice(0, 160) : '';
  const durationSec = value.type === 'video' && Number.isFinite(value.durationSec) && value.durationSec > 0
    ? value.durationSec : undefined;
  return { url, type: value.type, ...(posterUrl ? { posterUrl } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(attributionUrl ? { attribution: { url: attributionUrl, author, provider: 'Pexels' } } : {}) };
}

class StockResponseError extends Error {}

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new StockResponseError('response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new StockResponseError('invalid_response');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new StockResponseError('response_too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
    try { return JSON.parse(text + decoder.decode()); }
    catch { throw new StockResponseError('invalid_response'); }
  } finally { reader.releaseLock(); }
}

// Cache availability must not consume the provider deadline or delay ready media.
async function optionalCache(work, signal) {
  let timer, stop;
  try {
    return await Promise.race([
      Promise.resolve().then(work).catch(() => undefined),
      new Promise(resolve => {
        stop = () => resolve(undefined);
        timer = setTimeout(stop, CACHE_OPERATION_MS);
        signal.addEventListener('abort', stop, {once: true});
        if (signal.aborted) stop();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

// Editorial metadata can rank search results; missing metadata does not disprove relevance.
const IGNORED_WORDS = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'of', 'with', 'and', 'to']);
function terms(value) {
  return normalizeIntent(value).match(/[\p{L}\p{N}]+/gu)?.filter(word => !IGNORED_WORDS.has(word)) ?? [];
}
// Only simple English -s forms; avoid aggressive stemming and ambiguous endings.
function wordForm(word) {
  return /^[a-z]{3,}s$/.test(word) && !/(?:ss|us|is|ies)$/.test(word) && word !== 'news'
    ? word.slice(0, -1) : word;
}
function selectionHint(value) {
  const phrase = input => {
    if (typeof input !== 'string') return undefined;
    const normalized = normalizeIntent(input).replaceAll('’', "'");
    return normalized && normalized.length <= 48 && /^[\p{L}\p{N} '-]+$/u.test(normalized) && (normalized.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) <= 4 && terms(normalized).length ? normalized : undefined;
  };
  const subject = phrase(value?.subject);
  if (!subject) return undefined;
  const activity = phrase(value.activity), equipment = phrase(value.equipment);
  const exclude = Array.isArray(value.exclude) && value.exclude.length <= 3 ? value.exclude.map(phrase).filter(Boolean) : [];
  return {subject, ...(activity ? {activity} : {}), ...(equipment ? {equipment} : {}), ...(exclude.length ? {exclude} : {})};
}
function relevance(item, queryTerms, selection) {
  const page = mediaUrl(item?.url, 'www.pexels.com');
  if (!page || !queryTerms.length) return -1;
  let description;
  try { description = decodeURIComponent(new URL(page).pathname).replace(/^\/video\//u, ''); } catch { return -1; }
  const words = new Set(terms([description, item.title, item.description, Array.isArray(item.tags) ? item.tags.join(' ') : ''].filter(Boolean).join(' ')).filter(word => /\p{L}/u.test(word)).map(wordForm));
  // Pexels also returns numeric-only page URLs with empty tags and no title.
  // Keep those in provider order, behind results with known literal overlap.
  if (!words.size) return 0;
  if (selection) {
    const covers = phrase => terms(phrase).every(word => words.has(wordForm(word)));
    if (selection.exclude?.some(covers)) return -1;
    if (!covers(selection.subject)) return 0; // Provider-ranked illustration when exact metadata is unavailable.
    // Subject coverage outranks provider-only relevance. Optional distinctions
    // improve ordering but absence of metadata does not establish a conflict.
    // Keep query context below one hint point: it only breaks equal matches.
    const contextScore = queryTerms.filter(word => words.has(wordForm(word))).length / (queryTerms.length + 1);
    return 2 + contextScore + Number(Boolean(selection.activity && covers(selection.activity)))
      + Number(Boolean(selection.equipment && covers(selection.equipment)));
  }
  const score = queryTerms.filter(word => words.has(wordForm(word))).length / queryTerms.length;
  return score;
}

function matchingOrientation(file, direction) {
  return (file.width === file.height ? 'square' : file.width > file.height ? 'landscape' : 'portrait') === direction;
}
function usableFiles(item, direction) {
  return (Array.isArray(item.video_files) ? item.video_files : []).slice(0, 30)
    .filter(file => file.file_type === 'video/mp4' && Number.isFinite(file.width) && Number.isFinite(file.height)
      && Math.min(file.width, file.height) >= 320 && Math.max(file.width, file.height) <= 1920
      && mediaUrl(file.link, 'videos.pexels.com'))
    .sort((a,b) => Number(matchingOrientation(b, direction)) - Number(matchingOrientation(a, direction))
      || Math.abs(Math.min(a.width,a.height)-720)-Math.abs(Math.min(b.width,b.height)-720));
}

// Public video search only. Keys never enter URLs, cache entries or results.
export async function searchStock(query, {
  env, orientation = 'landscape', signal, fetcher = fetch,
  cache = globalThis.caches?.default, onDiagnostic, selection: rawSelection,
} = {}) {
  let diagnosed = false;
  const fail = (reason, httpStatus, counts) => {
    if (!diagnosed) {
      diagnosed = true;
      const event = { reason, stage: 'pexels_search', ...(reason === 'no_match' && counts ? counts : {}), ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? {httpStatus} : {}) };
      try { Promise.resolve(onDiagnostic?.(event)).catch(() => {}); }
      catch { /* Diagnostics cannot change playback. */ }
    }
    return null;
  };
  if (signal?.aborted) return fail('cancelled');
  if (!env?.PEXELS_API_KEY) return fail('configuration');
  if (typeof query !== 'string') return fail('invalid_input');
  const normalized = normalizeIntent(query);
  if (!normalized || normalized.length > 80 || normalized.split(' ').length > 8) return fail('invalid_input');
  const queryTerms = terms(normalized);
  const selection = selectionHint(rawSelection);
  if (!queryTerms.length) return fail('invalid_input');
  const direction = ['landscape', 'portrait', 'square'].includes(orientation) ? orientation : 'landscape';
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const abortReason = () => timedOut ? 'timeout' : 'cancelled';
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({query: normalized, selection})));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const cacheKey = new Request(`https://stock-cache.vanillasky.invalid/video-search-v7/${direction}/${hash}`);
    const cachedMedia = await optionalCache(async () => {
      const cached = await cache?.match(cacheKey);
      return cached && validateMedia(await boundedJson(cached));
    }, controller.signal);
    if (controller.signal.aborted) return fail(abortReason());
    if (cachedMedia?.type === 'video') return cachedMedia;
    // Broaden only to the authored essential subject, never arbitrary topic filler.
    const queries = [...new Set([normalized, ...(selection ? [selection.subject] : [])])];
    let miss;
    for (const searchQuery of queries) {
      if (controller.signal.aborted) return fail(abortReason());
      const url = new URL('https://api.pexels.com/v1/videos/search');
      url.search = new URLSearchParams({query: searchQuery, per_page: '12', page: '1'}).toString();
      const response = await fetcher(url.href, {
        headers: { Authorization: env.PEXELS_API_KEY }, redirect: 'manual', signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return fail(response.status === 429 ? 'rate_limited' : 'provider_error', response.status);
      }
      const payload = await boundedJson(response);
      if (controller.signal.aborted) return fail(abortReason());
      if (!Array.isArray(payload?.videos)) return fail('invalid_response');
      const candidates = payload.videos.slice(0, 12).map(item => ({item, score: relevance(item, queryTerms, selection), files: usableFiles(item, direction)}))
        .filter(candidate => candidate.score >= 0).sort((a, b) => b.score - a.score
          || Number(Boolean(b.files[0] && matchingOrientation(b.files[0], direction))) - Number(Boolean(a.files[0] && matchingOrientation(a.files[0], direction))));
      for (const {item, files} of candidates) {
        if (!files.length) continue;
        const media = validateMedia({url:files[0].link,type:'video',posterUrl:item.image,durationSec:item.duration,
          attribution:{url:item.url,author:item.user?.name}});
        if (!media) continue;
        if (controller.signal.aborted) return fail(abortReason());
        clearTimeout(timeout); // Provider work is complete; optional storage is separate.
        await optionalCache(() => cache?.put(cacheKey, new Response(JSON.stringify(media), {
          headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=86400'},
        })), controller.signal);
        return controller.signal.aborted ? fail(abortReason()) : media;
      }
      miss = {matchStage: payload.videos.length === 0 ? 'empty-results' : candidates.length === 0 ? 'relevance' : 'files', resultCount: Math.min(12, payload.videos.length), relevantCount: candidates.length};
    }
    return fail('no_match', undefined, miss);
  } catch (error) {
    return fail(controller.signal.aborted ? abortReason() : error instanceof StockResponseError ? error.message : 'provider_error');
  }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
