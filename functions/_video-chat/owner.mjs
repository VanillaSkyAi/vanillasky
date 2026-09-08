import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

const TIMEOUT_MS = 2000;
const MAX_JWKS_BYTES = 65536;
const caches = new WeakMap();

function configuration(env) {
  const issuer = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  const email = env.OWNER_EMAIL;
  if (typeof issuer !== 'string' || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)
    || typeof audience !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(audience)
    || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { issuer, audience, email };
}

function credential(request) {
  const header = request.headers.get('cf-access-jwt-assertion');
  const matches = (request.headers.get('cookie') ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith('CF_Authorization='));
  if (matches.length > 1) return null;
  const cookie = matches[0]?.slice('CF_Authorization='.length);
  if (header && cookie && header !== cookie) return null;
  const token = header || cookie;
  return token && token.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

// Fetch only the configured issuer's keys. Bound transport and body reading,
// even if an injected transport does not honor cancellation.
async function fetchKeys(fetcher, url, options) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Keys unavailable')); }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetcher(url, { ...options, redirect: 'manual', signal: controller.signal });
      if (response.status !== 200 || !response.body) throw new Error('Keys unavailable');
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_JWKS_BYTES) throw new Error('Keys unavailable');
          chunks.push(value);
        }
      } finally { controller.signal.removeEventListener('abort', cancel); cancel(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return new Response(bytes, { headers: { 'content-type': 'application/json' } });
    })()]);
  } finally { clearTimeout(timer); }
}

function keysFor(issuer, fetcher) {
  let cache = caches.get(fetcher);
  if (!cache) { cache = new Map(); caches.set(fetcher, cache); }
  let keys = cache.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
      timeoutDuration: TIMEOUT_MS,
      cooldownDuration: 30000,
      cacheMaxAge: 300000,
      [customFetch]: (url, options) => fetchKeys(fetcher, url, options),
    });
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(issuer, keys);
  }
  return keys;
}

export async function verifyOwner(request, env, { fetcher = fetch } = {}) {
  try {
    const config = configuration(env);
    const token = credential(request);
    if (!config || !token) return false;
    const { payload } = await jwtVerify(token, keysFor(config.issuer, fetcher), {
      algorithms: ['RS256'], issuer: config.issuer, audience: config.audience,
      requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5,
    });
    const now = Math.floor(Date.now() / 1000);
    return payload.email === config.email && typeof payload.sub === 'string' && payload.sub.length > 0
      && Number.isFinite(payload.iat) && Number.isFinite(payload.exp)
      && payload.iat <= now + 5 && payload.exp > payload.iat
      && payload.exp - payload.iat <= 86400;
  } catch { return false; }
}
