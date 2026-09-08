import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {onRequest} from '../../functions/owner.mjs';

test('owner landing rejects unconfigured and invalid sessions; only signed owner redirects to public root',async()=>{
 const env={ACCESS_TEAM_DOMAIN:'https://owner-route.cloudflareaccess.com',ACCESS_AUD:'owner-route',OWNER_EMAIL:'owner@example.com'};
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk={...await exportJWK(publicKey),kid:'route',alg:'RS256'};
 const fetcher=async()=>Response.json({keys:[jwk]});
 const token=await new SignJWT({email:env.OWNER_EMAIL}).setProtectedHeader({alg:'RS256',kid:'route'}).setIssuer(env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setSubject('owner').setIssuedAt().setExpirationTime('1h').sign(privateKey);
 for(const config of [{},env]) {
  const denied=await onRequest({request:new Request('https://example.com/owner'),env:config,fetcher});
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get('cache-control'),'no-store');
 }
 const request=new Request('https://example.com/owner?next=https://other.example',{headers:{cookie:`CF_Authorization=${token}`}});
 const response=await onRequest({request,env,fetcher});
 assert.equal(response.status,302);
 assert.equal(response.headers.get('location'),'/');
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await onRequest({request:new Request(request,{method:'POST'}),env,fetcher})).status,405);
});
