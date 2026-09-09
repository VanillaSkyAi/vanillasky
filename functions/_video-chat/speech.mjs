import { parseSpeechWordTimings } from '../../src/protocol/speech-timing.ts';

const ENDPOINT = 'https://api.x.ai/v1/tts';
const MAX_AUDIO_BYTES = 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_AUDIO_BYTES / 3);
// Base64 audio plus bounded character alignment for the 1000-character input.
const MAX_JSON_BYTES = MAX_BASE64_LENGTH + 128 * 1024;
const unavailable = () => new Error('Speech is temporarily unavailable.');

function decodeAudio(value) {
  if (typeof value !== 'string' || !value.length || value.length > MAX_BASE64_LENGTH ||
    value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(value)) throw unavailable();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.slice(0, value.length - padding).includes('=')) throw unavailable();
  const binary = atob(value);
  if (!binary.length || binary.length > MAX_AUDIO_BYTES) throw unavailable();
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function wordAlignment(value, text, duration) {
  const chars = value?.graph_chars;
  const times = value?.graph_times;
  if (!Array.isArray(chars) || !Array.isArray(times) || !chars.length ||
    chars.length > 1000 || chars.length !== times.length ||
    typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 300) return;
  const words = [];
  let word;
  let previousStart = 0;
  let length = 0;
  for (let index = 0; index < chars.length; index++) {
    const character = chars[index];
    const span = times[index];
    if (typeof character !== 'string' || !character.length ||
      !Array.isArray(span) || span.length !== 2) return;
    length += character.length;
    if (length > 1000) return;
    const [start, end] = span;
    if (typeof start !== 'number' || typeof end !== 'number' ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < previousStart ||
      start < 0 || end < start || end > duration) return;
    previousStart = start;
    if (/^\s+$/u.test(character)) {
      if (word) { words.push(word); word = undefined; }
    } else {
      if (/\s/u.test(character)) return;
      // A written token can have overlapping/interpolated character spans.
      if (word) { word.text += character; word.end = Math.max(word.end, end); }
      else word = { text: character, start, end };
    }
  }
  if (word) words.push(word);
  return parseSpeechWordTimings(words, text, duration);
}

// Fixed server-owned voice and output contract. Never forward client options.
// https://docs.x.ai/developers/rest-api-reference/inference/voice
export async function generateSpeech({ text, signal }, env, fetcher = fetch) {
  if (!env?.XAI_API_KEY || typeof text !== 'string' || !text.trim() ||
    text.length > 1000 || signal?.aborted) throw unavailable();
  let reader;
  let response;
  const abort = () => { void reader?.cancel().catch(() => {}); };
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST', redirect: 'manual', signal,
      headers: {
        Authorization: `Bearer ${env.XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.trim(), voice_id: 'eve', language: 'auto',
        with_timestamps: true,
        output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 },
      }),
    });
    const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const maximum = mediaType === 'application/json' ? MAX_JSON_BYTES : MAX_AUDIO_BYTES;
    if (signal?.aborted || !response.ok || !['audio/mpeg', 'application/json'].includes(mediaType) ||
      Number(response.headers.get('content-length')) > maximum || !response.body) throw unavailable();
    reader = response.body.getReader();
    signal?.addEventListener('abort', abort, { once: true });
    const chunks = [];
    let length = 0;
    while (true) {
      if (signal?.aborted) throw unavailable();
      const { done, value } = await reader.read();
      if (signal?.aborted) throw unavailable();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw unavailable();
      chunks.push(value);
    }
    if (!length) throw unavailable();
    const audio = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
    if (mediaType === 'application/json') {
      const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(audio));
      if (payload?.content_type !== 'audio/mpeg') throw unavailable();
      const decoded = decodeAudio(payload.audio);
      const wordTimings = wordAlignment(payload.audio_timestamps, text, payload.duration);
      return { audio: decoded, mediaType: 'audio/mpeg', ...(wordTimings ? { wordTimings } : {}) };
    }
    return { audio, mediaType: 'audio/mpeg' };
  } catch { throw unavailable(); }
  finally {
    signal?.removeEventListener('abort', abort);
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    } else { await response?.body?.cancel().catch(() => {}); }
  }
}
