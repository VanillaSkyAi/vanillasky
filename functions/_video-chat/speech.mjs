const ENDPOINT = 'https://api.x.ai/v1/tts';
const MAX_AUDIO_BYTES = 1024 * 1024;
const unavailable = () => new Error('Speech is temporarily unavailable.');

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
        output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 },
      }),
    });
    if (signal?.aborted || !response.ok ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'audio/mpeg' ||
      Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES || !response.body) throw unavailable();
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
      if (length > MAX_AUDIO_BYTES) throw unavailable();
      chunks.push(value);
    }
    if (!length) throw unavailable();
    const audio = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
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
