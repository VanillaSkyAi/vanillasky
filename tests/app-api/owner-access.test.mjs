import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { verifyOwner } from '../../functions/_video-chat/owner.mjs';

const env = { ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com', ACCESS_AUD: 'owner-app', OWNER_EMAIL: 'owner@example.com' };
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const now = Math.floor(Date.now() / 1000);
const claims = { iss: env.ACCESS_TEAM_DOMAIN, aud: [env.ACCESS_AUD], email: env.OWNER_EMAIL, sub: 'owner-subject', iat: now, nbf: now - 1, exp: now + 3600 };
const token = (overrides = {}, key = privateKey) => new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
const request = (jwt, headers = {}) => new Request('https://site.example/api/video-chat', { headers: { cookie: `CF_Authorization=${jwt}`, ...headers } });
const fetcher = async (url, init) => {
  assert.equal(String(url), `${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  assert.equal(init.redirect, 'manual');
  return Response.json({ keys: [jwk] });
};

test('accepts a cryptographically verified owner cookie or matching header', async () => {
  const jwt = await token();
  assert.equal(await verifyOwner(request(jwt), env, { fetcher }), true);
  assert.equal(await verifyOwner(request(await token({ nbf: undefined })), env, { fetcher }), true);
  assert.equal(await verifyOwner(request(jwt, { 'cf-access-jwt-assertion': jwt }), env, { fetcher }), true);
  assert.equal(await verifyOwner(new Request('https://site.example/owner', { headers: { 'cf-access-jwt-assertion': jwt } }), env, { fetcher }), true);
});

test('fails closed for wrong claims and missing required timestamps', async () => {
  for (const override of [{ aud: 'other' }, { iss: 'https://evil.example' }, { email: 'other@example.com' }, { exp: now - 60 }, { nbf: now + 60 }, { iat: now + 60 }, { iat: undefined }, { sub: undefined }, { exp: undefined }, { exp: now + 90000 }]) {
    assert.equal(await verifyOwner(request(await token(override)), env, { fetcher }), false);
  }
});

test('rejects forged signatures and ambiguous or oversized credentials', async () => {
  const other = await generateKeyPair('RS256');
  assert.equal(await verifyOwner(request(await token({}, other.privateKey)), env, { fetcher }), false);
  const jwt = await token();
  for (const req of [request(jwt, { 'cf-access-jwt-assertion': 'different' }), request(jwt, { cookie: `CF_Authorization=${jwt}; CF_Authorization=${jwt}` }), request('x'.repeat(9000))]) {
    assert.equal(await verifyOwner(req, env, { fetcher }), false);
  }
});

test('invalid configuration never fetches keys', async () => {
  const failFetch = () => { throw new Error('must not fetch'); };
  for (const bad of [{}, { ...env, ACCESS_TEAM_DOMAIN: 'https://evil.example' }, { ...env, ACCESS_TEAM_DOMAIN: `${env.ACCESS_TEAM_DOMAIN}/path` }, { ...env, ACCESS_AUD: '' }, { ...env, OWNER_EMAIL: '' }]) {
    assert.equal(await verifyOwner(request(await token()), bad, { fetcher: failFetch }), false);
  }
});

test('JWKS outages, redirects, oversized bodies and ignored aborts fail closed', async () => {
  const jwt = await token();
  for (const fetcher of [async () => new Response(null, { status: 503 }), async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }), async () => new Response('x'.repeat(70000)), () => new Promise(() => {})]) {
    const start = Date.now();
    assert.equal(await verifyOwner(request(jwt), env, { fetcher }), false);
    assert.ok(Date.now() - start < 3000);
  }
});
