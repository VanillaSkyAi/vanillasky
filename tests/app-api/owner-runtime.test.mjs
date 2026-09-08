import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('owner signature verification and bounded JWKS transport work in workerd', { timeout: 15000 }, async () => {
  const env = { ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com', ACCESS_AUD: 'owner-app', OWNER_EMAIL: 'owner@example.com' };
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'runtime-key', alg: 'RS256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email: env.OWNER_EMAIL })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(env.ACCESS_TEAM_DOMAIN)
    .setAudience(env.ACCESS_AUD).setSubject('fictional-owner').setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
  const bundled = await build({
    stdin: { contents: `
      import { verifyOwner } from './functions/_video-chat/owner.mjs';
      export default { async fetch(request) {
        let calls = 0;
        const env = ${JSON.stringify(env)};
        const fetcher = async (url, options) => {
          const native = new Request(url, options);
          if (native.redirect !== 'manual' || native.url !== env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs') throw Error('Invalid key transport');
          calls++;
          return Response.json({ keys: [${JSON.stringify(jwk)}] });
        };
        const valid = await verifyOwner(request, env, { fetcher });
        const wrongEmail = await verifyOwner(request, { ...env, OWNER_EMAIL: 'other@example.com' }, { fetcher });
        return Response.json({ valid, wrongEmail, calls });
      }};
    `, resolveDir: fileURLToPath(new URL('../..', import.meta.url)), sourcefile: 'owner-runtime-entry.mjs' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-04-09', script: bundled.outputFiles[0].text }));
  try {
    const response = await mf.dispatchFetch('https://site.example/api/video-chat', { headers: { cookie: `CF_Authorization=${token}` } });
    assert.deepEqual(await response.json(), { valid: true, wrongEmail: false, calls: 1 });
  } finally { await mf.dispose(); }
});
