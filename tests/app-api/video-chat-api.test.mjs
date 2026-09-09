import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { decodeVideoSse } from "../../src/protocol/sse.ts";
import {
  handleVideoChatRequest,
  configurationStatus,
} from "../../functions/api/video-chat.mjs";
import {
  reserveQuota,
  releaseQuota,
  actorHash,
} from "../../functions/_video-chat/quota.mjs";
function db() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(
      new URL("../../migrations/0001_video_chat_quotas.sql", import.meta.url),
      "utf8",
    ),
  );
  sql.exec(readFileSync(new URL("../../migrations/0002_fal_preview.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../../migrations/0004_public_fal_answers.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../../migrations/0005_double_public_fal_allowance.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../../migrations/0006_daily_public_clip_budget.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../../migrations/0003_owner_fal_previews.sql", import.meta.url), "utf8"));
  return {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() { return sql.prepare(query).get(...args); },
            async run() {
              const result = sql.prepare(query).run(...args);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
  };
}
const request = (
  action = "response",
  body = { prompt: "Why does the Moon always show one face?" },
  extra = {},
) =>
  new Request(`https://example.com/api/video-chat?action=${action}`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "content-type": "application/json",
      "cf-connecting-ip": "192.0.2.1",
      ...extra,
    },
    body: JSON.stringify(body),
  });
const live = () => ({
  PEXELS_API_KEY: "test-stock",
  ANTHROPIC_API_KEY: "test-only-value",
  VIDEO_CHAT_QUOTA_SALT: "test-salt-that-is-at-least-32-characters",
  VIDEO_CHAT_QUOTAS: db(),
});
async function seedPublicAttempts(database, actor, attempts = 10) {
  await database.prepare("INSERT INTO video_chat_fal_answers(id, actor, created, attempts) VALUES (?, ?, ?, ?)")
    .bind("spent", actor, Date.now(), attempts).run();
}
test("cross-origin, missing origin, huge body and paid modes never call the provider", async () => {
  let calls = 0;
  const fetcher = () => {
    calls++;
    throw Error("not allowed");
  };
  for (const req of [
    request("response", {}, { origin: "https://evil.example" }),
    new Request("https://example.com/api/video-chat?action=response", {
      method: "POST",
      body: "{}",
    }),
    request("response", { prompt: "x".repeat(13000) }),
    request("response", { prompt: "Moon", mode: "full" }),
  ]) {
    const result = await handleVideoChatRequest({
      request: req,
      env: live(),
      fetcher,
    });
    assert.ok(result.status >= 400);
    await result.text();
  }
  assert.equal(calls, 0);
});
test("quota denial and missing trusted IP never call a provider", async () => {
  const env = live();
  let calls = 0;
  const actor = await actorHash("192.0.2.1", env.VIDEO_CHAT_QUOTA_SALT);
  for (let i = 0; i < 4; i++) await reserveQuota(env.VIDEO_CHAT_QUOTAS, actor, 8);
  const result = await handleVideoChatRequest({
    request: request(),
    env,
    fetcher: () => {
      calls++;
    },
  });
  assert.equal(result.status, 429);
  assert.equal(calls, 0);
});
test("single-statement admission enforces global concurrency across separate actors", async () => {
  const database = db();
  const ids = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      reserveQuota(database, `actor-${i}`, 1),
    ),
  );
  assert.equal(ids.filter(Boolean).length, 12);
  await releaseQuota(database, ids[0]);
  assert.ok(await reserveQuota(database, "new-actor", 1));
});
test("per-actor concurrency and minute rate remain bounded without cumulative budgets", async () => {
  const database = db();
  const now = Date.now();
  const ids = await Promise.all(
    Array.from({ length: 5 }, () => reserveQuota(database, "actor", 1, now)),
  );
  assert.equal(ids.filter(Boolean).length, 4);
  for (const id of ids.filter(Boolean)) await releaseQuota(database, id);
  for (let i = 4; i < 20; i++) {
    const id = await reserveQuota(database, "actor", 1, now);
    assert.ok(id);
    await releaseQuota(database, id);
  }
  assert.equal(await reserveQuota(database, "actor", 1, now), null);
  const later = now + 60001;
  const resumed = await reserveQuota(database, 'actor', 8, later);
  assert.ok(resumed);
  await releaseQuota(database, resumed);
  for (let i = 0; i < 30; i++) {
    const id = await reserveQuota(database, `other-${i}`, 8, now);
    assert.ok(id);
    await releaseQuota(database, id);
  }
  assert.ok(await reserveQuota(database, 'new', 8, now));
  const lifetimeDb = db();
  for (let i = 0; i < 15; i++) {
    const id = await reserveQuota(lifetimeDb, 'actor', 8, now);
    assert.ok(id);
    await releaseQuota(lifetimeDb, id);
  }
  // 120 prior units neither exhaust the current day nor this actor's lifetime.
  assert.ok(await reserveQuota(lifetimeDb, 'actor', 8, later));
  assert.ok(await reserveQuota(lifetimeDb, 'actor', 8, now + 86400000));
});
test('abandoned active reservations hold capacity until the180 second lease expires', async () => {
  const database = db();
  const now = Date.now();
  for (const actor of ['one', 'two', 'three']) {
    for (let i=0;i<4;i++) assert.ok(await reserveQuota(database,actor,8,now));
  }
  assert.equal(await reserveQuota(database,'one',8,now+179999),null);
  assert.equal(await reserveQuota(database,'four',8,now+179999),null);
  assert.ok(await reserveQuota(database,'one',8,now+180000));
  assert.ok(await reserveQuota(database,'four',8,now+180000));
});
test("live requests without Cloudflare client identity never call the provider", async () => {
  const incoming = request();
  incoming.headers.delete("cf-connecting-ip");
  let calls = 0;
  const response = await handleVideoChatRequest({
    request: incoming,
    env: live(),
    fetcher: () => {
      calls++;
    },
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("successful live operations use the fixed provider and bounded output tokens", async () => {
  const { plannerStream } = await import("./fixtures/planner.mjs");
  let providerSse = "";
  for await (const text of plannerStream({
    userPrompt: "Why does the Moon turn?",
  })) {
    providerSse += `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`;
  }
  for (const [action, body, limit] of [
    ["response", { prompt: "Why does the Moon turn?" }, 4096],
    [
      "narration",
      {
        prompt: "Why does the Moon turn?",
        scene: {
          id: "s",
          templateId: "cinemaMedia",
          variables: { fallbackText: "The Moon turns" },
        },
        earlier: [],
      },
      256,
    ],
    [
      "suggestions",
      {
        prompt: "Why does the Moon turn?",
        lines: ["It turns in step with its orbit."],
      },
      512,
    ],
  ]) {
    let calls = 0;
    const response = await handleVideoChatRequest({
      request: request(action, body),
      env: live(),
      fetcher: async (url, options) => {
        if (String(url).startsWith("https://api.pexels.com/")) return Response.json({videos:[]});
        calls++;
        const payload = JSON.parse(options.body);
        assert.equal(url, "https://api.anthropic.com/v1/messages");
        assert.equal(payload.model, "claude-haiku-4-5");
        assert.equal(options.redirect, "manual");
        assert.equal(payload.max_tokens, limit);
        assert.ok(
          payload.system.length + payload.messages[0].content.length <= 60000,
        );
        assert.equal(payload.stream, action === "response");
        assert.ok(options.signal instanceof AbortSignal);
        if (payload.stream) return new Response(providerSse);
        return Response.json({
          content: [
            {
              type: "text",
              text:
                action === "suggestions"
                  ? JSON.stringify({
                      suggestions: [
                        {
                          prompt: "How long does an orbit take?",
                          keyword: "moon",
                        },
                      ],
                    })
                  : "The Moon turns in step with its orbit.",
            },
          ],
        });
      },
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(calls, 1);
    if (action === "response") {
      assert.match(text, /response.complete/);
      assert.doesNotMatch(text, /response.error/);
    }
    if (action === "narration") assert.match(JSON.parse(text).line, /Moon/);
    if (action === "suggestions")
      assert.equal(JSON.parse(text).suggestions.length, 1);
  }
});

test("response planning preserves its grammar and accepts one chunked answer-and-shots array without a retry", async () => {
  const prompt = "Explain how energy travels in ocean waves";
  const developing = {
    type: "shot", title: "Passing energy", narration: "Water rises as a wave passes.",
    subject: "ocean waves", action: "A wave passes a floating buoy.", durationSec: 5, continuity: "cut",
  };
  const ending = {
    title: "Wave motion", narration: "The water falls while energy moves onward.",
    subject: "ocean waves", action: "The buoy falls after the wave passes.", durationSec: 5, continuity: "continue",
  };
  const brief = {
    type: "answer", intent: "explanation", visualStyle: "realistic", musicMood: "off",
    opening: "Waves carry energy through water.", subject: "ocean waves",
    development: "A floating buoy reveals how water and energy move.",
    visualDirection: "Observe the same buoy in clear daylight.", ending,
  };
  const modelText = JSON.stringify([brief, developing], null, 2);
  let plannerCalls = 0;
  const response = await handleVideoChatRequest({
    request: request("response", { prompt, mode: "pexels", musicMood: "off" }),
    env: live(),
    fetcher: async (url, options) => {
      if (String(url).startsWith("https://api.pexels.com/")) return Response.json({ videos: [] });
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      plannerCalls++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.stream, true);
      assert.equal(payload.messages[0].role, "user");
      assert.ok(payload.messages[0].content.includes(prompt));
      // Inspect the actual serialized record contracts after admission and all
      // callback wrappers, without depending on the surrounding guidance prose.
      const contracts = payload.system.split("\n").flatMap(line => {
        const start = line.search(/\{\s*"type"\s*:/);
        return start < 0 ? [] : [JSON.parse(line.slice(start, line.lastIndexOf("}") + 1))];
      });
      assert.deepEqual(contracts.map(contract => contract.type), ["answer", "shot"]);
      for (const key of ["opening", "subject", "development"]) assert.equal(typeof contracts[0][key], "string");
      for (const contract of [contracts[0].ending, contracts[1]]) {
        for (const key of ["title", "narration", "subject", "action", "continuity"]) assert.equal(typeof contract[key], "string");
        assert.equal(typeof contract.durationSec, "number");
      }
      const records = [];
      for (let offset = 0; offset < modelText.length; offset += 37) {
        records.push({ type: "content_block_delta", delta: { type: "text_delta", text: modelText.slice(offset, offset + 37) } });
      }
      records.push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
      return new Response(records.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
    },
  });
  assert.equal(response.status, 200);
  const events = [];
  for await (const event of decodeVideoSse(response.body)) events.push(event);
  assert.equal(plannerCalls, 1);
  assert.equal(events.find(event => event.type === "data.video-chat-opening")?.data.line, brief.opening);
  const scenes = events.filter(event => event.type === "scene.add").map(event => event.data.scene);
  assert.deepEqual(scenes.map(scene => scene.narration), [developing.narration, ending.narration]);
  assert.deepEqual(scenes.map(scene => scene.variables.title), [developing.title, ending.title]);
  assert.equal(events.some(event => event.type === "response.error"), false);
  assert.equal(events.at(-1)?.type, "response.complete");
  assert.deepEqual(events.at(-1).data.snapshot.scenes, scenes);
});

test("cancelling a live response aborts its provider and releases its active reservation", async () => {
  const env = live();
  const underlying = env.VIDEO_CHAT_QUOTAS;
  let releases = 0;
  env.VIDEO_CHAT_QUOTAS = {
    prepare(query) {
      const statement = underlying.prepare(query);
      return {
        bind(...args) {
          const bound = statement.bind(...args);
          return {
            async run() {
              if (query.startsWith("UPDATE")) releases++;
              return bound.run();
            },
          };
        },
      };
    },
  };
  let markFetched;
  const fetched = new Promise((resolve) => {
    markFetched = resolve;
  });
  let providerSignal;
  const response = await handleVideoChatRequest({
    request: request(),
    env,
    fetcher: async (_url, { signal }) => {
      providerSignal = signal;
      markFetched();
      return new Response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener(
              "abort",
              () => controller.error(new Error("cancelled")),
              { once: true },
            );
          },
        }),
      );
    },
  });
  await fetched;
  await response.body.cancel("user starts a new session");
  assert.equal(providerSignal.aborted, true);
  assert.equal(releases, 1);
});

test("fal capability requires explicit provider configuration", async () => {
  for (const [env, host, enabled] of [
    [live(), 'example.com', false],
    [{...live(), VIDEO_CHAT_FAL_PREVIEW:'enabled', FAL_KEY:'test-fal'}, 'example.com', true],

  ]) {
    const result = await handleVideoChatRequest({request:new Request(`https://${host}/api/video-chat?action=capabilities`),env,fetcher:()=>{throw Error('No provider for capabilities');}});
    assert.equal((await result.json()).generatedVideo, enabled);
  }
});

for (const identity of ["public", "owner", "forged", "local", "local-flag-remote", "loopback-without-flag"]) test(`fal allowance follows verified identity: ${identity}`, async (t) => {
  const diagnostics = [];
  const plannerLogs = [];
  t.mock.method(console, "info", (...args) => (args[0] === "video-chat.media-fallback" ? diagnostics : plannerLogs).push(args));
  const env = {...live(), PEXELS_API_KEY:undefined, VIDEO_CHAT_FAL_PREVIEW:'enabled', FAL_KEY:'test-fal-secret', ...(['local','local-flag-remote'].includes(identity) ? {VIDEO_CHAT_LOCAL:'enabled'} : {})};
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(publicKey),kid:'owner-test',alg:'RS256'};
  Object.assign(env,{ACCESS_TEAM_DOMAIN:'https://owner-test.cloudflareaccess.com',ACCESS_AUD:'owner-app',OWNER_EMAIL:'owner@example.com'});
  const token = await new SignJWT({email:env.OWNER_EMAIL}).setProtectedHeader({alg:'RS256',kid:'owner-test'})
    .setIssuer(env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setSubject('owner').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const extra = identity === 'owner' ? {cookie:`CF_Authorization=${token}`} : identity === 'forged' ? {cookie:'CF_Authorization=forged.token.signature', 'cf-access-authenticated-user-email':env.OWNER_EMAIL} : {};
  let submissions = 0;
  const shot = (narration, subject) => ({ narration, subject, action: 'The Moon turns in the dark sky.', durationSec: 5, continuity: 'cut' });
  const lines = [
    { type: 'answer', intent: 'explanation', opening: 'The Moon turns in time with Earth', subject: 'moon', development: 'Rotation and orbit', visualDirection: 'Consistent gray Moon illustration', ending: shot('Rotation stays in step.', 'moon ending') },
    ...[0,1,2,3].map(i => ({ type: 'shot', ...shot(`Orbit detail ${i}.`, `moon orbit ${i}`) })),
  ];
  const sse = lines.map(line => `data: ${JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:JSON.stringify(line)+'\n'}})}\n\n`).join('');
  const fetcher = async (url, options) => {
    if (String(url) === env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs') return Response.json({keys:[jwk]});
    if (url === 'https://api.anthropic.com/v1/messages') return new Response(sse);
    if (options.method === 'POST') {
      submissions++;
      assert.equal(url,'https://queue.fal.run/minimax/h3-max-turbo/text-to-video');
      return Response.json({request_id:'test',status_url:'https://queue.fal.run/status',response_url:'https://queue.fal.run/result',cancel_url:'https://queue.fal.run/cancel'});
    }
    if (url === 'https://queue.fal.run/status') return Response.json({status:'COMPLETED'});
    if (url === 'https://queue.fal.run/result') return Response.json({video:{url:'https://v3.fal.media/files/test.mp4'}});
    throw Error(`Unexpected provider URL ${url}`);
  };
  const outputs = [];
  const submissionsPerAnswer = [];
  for (let i=0;i<3;i++) {
    const before = submissions;
    const origin = ['local','loopback-without-flag'].includes(identity) ? 'http://127.0.0.1:8788' : 'https://example.com';
    const incoming = new Request(`${origin}/api/video-chat?action=response`, {method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.1',...extra},body:JSON.stringify({prompt:'Why does the Moon rotate?',mode:'cinematic'})});
    const result = await handleVideoChatRequest({request:incoming,env,fetcher});
    const output = await result.text();
    assert.equal(result.headers.get('x-vanillasky-resolved-video-mode'),'cinematic');
    assert.equal(result.status,200);
    outputs.push(output);
    submissionsPerAnswer.push(submissions - before);
  }
  assert.equal(plannerLogs.filter(([name]) => name === 'video-chat.plan-summary').length, 3);
  assert.doesNotMatch(JSON.stringify(plannerLogs), /test-fal-secret|192\.0\.2\.1|Why does the Moon|v3\.fal\.media/);
  const ownerAllowance = ['owner','local'].includes(identity);
  const ownerRows = await env.VIDEO_CHAT_QUOTAS.prepare('SELECT COUNT(*) AS count FROM video_chat_owner_fal_previews').bind().first();
  const publicRows = await env.VIDEO_CHAT_QUOTAS.prepare('SELECT COUNT(*) AS count FROM video_chat_fal_answers').bind().first();
  assert.equal(ownerRows.count, ownerAllowance ? 3 : 0);
  assert.equal(publicRows.count, ownerAllowance ? 0 : 2);
  if (ownerAllowance) {
    assert.equal(submissions,15);
    assert.deepEqual(submissionsPerAnswer,[5,5,5]);
    assert.equal(diagnostics.length,0);
    assert.match(outputs[1],/v3.fal.media/);
  } else {
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(submissionsPerAnswer,[5,5,0]);
  assert.equal(diagnostics[0][0], "video-chat.media-fallback");
  const { requestId, ...event } = diagnostics[0][1];
  assert.match(requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(event, { reason: "user_limit", stage: "planning_availability" });
  assert.doesNotMatch(JSON.stringify(diagnostics), /test-fal-secret|192\.0\.2\.1|Why does the Moon/);
  assert.equal(submissions,10);
  assert.match(outputs[0],/v3.fal.media/);
  assert.match(outputs[1],/v3.fal.media/);
  assert.doesNotMatch(outputs[2],/v3.fal.media/);
  // Unsupported stock intent cannot inherit an unrelated topic clip.
  assert.doesNotMatch(outputs[1],/videos.pexels.com/);
  assert.match(outputs[2],/Some visuals were replaced so your response can continue/);
  }
  for (const output of outputs) {
    assert.match(output,/response.complete/);

    assert.doesNotMatch(output,/test-fal-secret/);
  }
});

test("public stock actions require the same atomic admission as other live work", async () => {
  const env = {...live(), PEXELS_API_KEY:'test-stock'};
  const req = request('opening-media',{keyword:'forest'});
  req.headers.delete('cf-connecting-ip');
  const result = await handleVideoChatRequest({request:req,env,fetcher:()=>{throw Error('No unadmitted stock call');}});
  assert.equal(result.status,503);
});


test('xAI speech capability requires a configured secret', async () => {
  for (const [env, host, enabled] of [
    [live(), 'example.com', false],
    [{...live(), XAI_API_KEY:'test-xai'}, 'example.com', true],

  ]) {
    const response = await handleVideoChatRequest({request:new Request(`https://${host}/api/video-chat?action=capabilities`),env,fetcher:()=>{throw Error('No paid capability calls');}});
    const capabilities = await response.json();
    assert.equal(capabilities.generatedSpeech,enabled);
    assert.equal(capabilities.transcription,false);
  }
});

test('xAI speech returns private audio beyond100 cumulative units while retaining throughput admission', async () => {
  const env = {...live(),XAI_API_KEY:'private-test-xai'};
  const actor = await actorHash('192.0.2.1',env.VIDEO_CHAT_QUOTA_SALT);
  const old = await reserveQuota(env.VIDEO_CHAT_QUOTAS,actor,96);
  await releaseQuota(env.VIDEO_CHAT_QUOTAS,old);
  let calls = 0;
  const fetcher = async (url,options) => {
    calls++;
    assert.equal(url,'https://api.x.ai/v1/tts');
    assert.equal(JSON.parse(options.body).voice_id,'eve');
    return new Response(new Uint8Array([73,68,51]),{headers:{'content-type':'audio/mpeg'}});
  };
  const response = await handleVideoChatRequest({request:request('speech',{text:'a'.repeat(1000)}),env,fetcher});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('content-type'),'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[73,68,51]);
  const next = await handleVideoChatRequest({request:request('speech',{text:'Hello'}),env,fetcher});
  assert.equal(next.status,200);
  await next.arrayBuffer();
  assert.equal(calls,2);
});

test('speech validates bounds, identity and quota storage before contacting xAI', async () => {
  let calls=0;
  const fetcher=()=>{calls++;throw Error('Unexpected provider call');};
  for (const body of [{text:''},{text:'a'.repeat(1001)},{text:'Hello',voice:'rex'},{text:42}]) {
    const response=await handleVideoChatRequest({request:request('speech',body),env:{...live(),XAI_API_KEY:'test'},fetcher});
    assert.equal(response.status,400);
  }
  const incoming=request('speech',{text:'Hello'});
  incoming.headers.delete('cf-connecting-ip');
  assert.equal((await handleVideoChatRequest({request:incoming,env:{...live(),XAI_API_KEY:'test'},fetcher})).status,503);
  const broken={...live(),XAI_API_KEY:'test',VIDEO_CHAT_QUOTAS:{prepare(){throw Error('offline');}}};
  assert.equal((await handleVideoChatRequest({request:request('speech',{text:'Hello'}),env:broken,fetcher})).status,503);
  assert.equal(calls,0);
});

test('missing xAI key selects browser fallback without spending', async () => {
  for (const env of [live()]) {
    const response=await handleVideoChatRequest({request:request('speech',{text:'Hello'}),env,fetcher:()=>{throw Error('No provider call');}});
    assert.equal(response.status,204);
  }
});

test('xAI failure is sanitized and still counts towards the minute rate', async () => {
  const env={...live(),XAI_API_KEY:'private-xai-test'};
  const actor=await actorHash('192.0.2.1',env.VIDEO_CHAT_QUOTA_SALT);
  for (let i=0;i<19;i++) {
    const id=await reserveQuota(env.VIDEO_CHAT_QUOTAS,actor,1);
    await releaseQuota(env.VIDEO_CHAT_QUOTAS,id);
  }
  const response=await handleVideoChatRequest({request:request('speech',{text:'Hello'}),env,fetcher:async()=>new Response('private-xai-test',{status:401})});
  assert.equal(response.status,502);
  assert.doesNotMatch(await response.text(),/private-xai-test/);
  const denied=await handleVideoChatRequest({request:request('speech',{text:'Hello'}),env,fetcher:()=>{throw Error('No provider call after rate limit');}});
  assert.equal(denied.status,429);
});


test('welcome returns reviewed media for every card without a provider call or quota reservation', async () => {
  for (const env of [live()]) {
    const response = await handleVideoChatRequest({
      request: new Request('https://example.com/api/video-chat?action=welcome'),
      env,
      fetcher: () => { throw Error('Welcome must not call providers'); },
    });
    assert.equal(response.status, 200);
    const { cards } = await response.json();
    const expectedCount = 8;
    assert.equal(cards.length, expectedCount);
    assert.equal(new Set(cards.map(card => card.prompt)).size, expectedCount);
    assert.ok(cards.every(card => !["Why did dinosaurs disappear?", "How does an atom hold itself together?"].includes(card.prompt)));
    for (const card of cards) {
      assert.ok(card.media, `Missing preview for ${card.prompt}`);
      assert.match(card.media.url, /^https:\/\//);
      if (card.media.type === 'video') assert.match(card.media.posterUrl, /^https:\/\//);
    }
  }
});

test('welcome uses the selected cloud timelapse without paid lookup', async () => {
 for (const env of [live()]) {
  const response=await handleVideoChatRequest({request:new Request('https://example.com/api/video-chat?action=welcome'),env,fetcher:()=>{throw Error('Welcome does not call paid providers');}});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.match(JSON.stringify(payload),/11335959-hd_1920_1080_30fps/);
  assert.doesNotMatch(JSON.stringify(payload),/33888830/);
 }
});


test('legacy opening lookups cannot bypass shared request admission through curated assets', async () => {
  const env = live();
  const actor = await actorHash('192.0.2.1', env.VIDEO_CHAT_QUOTA_SALT);
  for (let i=0;i<4;i++) await reserveQuota(env.VIDEO_CHAT_QUOTAS,actor,8);
  for (const keyword of ['full moon night sky','breaking ocean wave','forest']) {
    const result=await handleVideoChatRequest({request:request('opening-media',{keyword}),env,fetcher:()=>assert.fail('No unadmitted provider call')});
    assert.equal(result.status,429);assert.equal((await result.json()).error.code,'request_throttled');
  }
});

test('prepared opening footage still validates origin and request shape', async () => {
  const env = live();
  const fetcher = () => { throw Error('No provider calls'); };
  const crossOrigin = await handleVideoChatRequest({request:request('opening-media',{keyword:'moon'},{origin:'https://other.example'}),env,fetcher});
  assert.equal(crossOrigin.status,403);
  const malformed = await handleVideoChatRequest({request:request('opening-media',{keyword:'moon',unexpected:true}),env,fetcher});
  assert.equal(malformed.status,400);
  await malformed.text();
});

test('live dynamic follow-ups use reviewed topic covers with one admitted text call and no media search', async () => {
  let calls = 0;
  const suggestions = [
    {prompt:'Why does friction slow the wave base?', keyword:'ocean waves'},
    {prompt:'How deep must water be to break?', keyword:'shallow water'},
    {prompt:'What happens to wave energy when breaking?', keyword:'breaking ocean wave'},
    {prompt:'Do all wave types break the same way?', keyword:'ocean surf'},
  ];
  const response = await handleVideoChatRequest({
    request: request('suggestions', {prompt:'What makes ocean waves break?', lines:['The wave slows in shallow water.']}),
    env: live(),
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.match(JSON.parse(options.body).system, /keyword: "ocean waves"/);
      return Response.json({content:[{type:'text', text:JSON.stringify({suggestions})}]});
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.suggestions.length, 4);
  for (const suggestion of payload.suggestions) assert.match(suggestion.media.url, /18680290/);
  assert.equal(calls, 1);
});

test('one answer plus opening and speech burst reproduces request throttling without a video allowance error', async () => {
  const env = {...live(), XAI_API_KEY:'test-speech'};
  const actor = await actorHash('192.0.2.1',env.VIDEO_CHAT_QUOTA_SALT);
  // A streaming answer, opening-media and two speech preparations occupy all four slots.
  const held = await Promise.all([8,1,1,1].map(units=>reserveQuota(env.VIDEO_CHAT_QUOTAS,actor,units)));
  assert.ok(held.every(Boolean));
  const denied=await handleVideoChatRequest({request:request('speech',{text:'The next beat.'}),env,fetcher:()=>assert.fail('No provider after rejection')});
  assert.equal(denied.status,429);assert.equal((await denied.json()).error.code,'request_throttled');
  // Removing the unnecessary opening request leaves room for the runtime's two speech workers.
  await releaseQuota(env.VIDEO_CHAT_QUOTAS,held[1]);
  const admitted=await handleVideoChatRequest({request:request('speech',{text:'The next beat.'}),env,fetcher:async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/mpeg'}})});
  assert.equal(admitted.status,200);await admitted.arrayBuffer();
});

test('Pexels completes a full stock answer without reading or reserving fal allowance', async () => {
  const env={...live(),VIDEO_CHAT_FAL_PREVIEW:'enabled',FAL_KEY:'test-fal',PEXELS_API_KEY:'test-stock'};
  const original=env.VIDEO_CHAT_QUOTAS.prepare.bind(env.VIDEO_CHAT_QUOTAS);
  env.VIDEO_CHAT_QUOTAS.prepare=query=>{assert.doesNotMatch(query,/video_chat_(?:fal|owner_fal)/);return original(query);};
  const shot={title:'A clean golf swing',narration:'The golfer swings through the ball.',subject:'golfer hitting ball',action:'Golfer hits a ball',durationSec:5,continuity:'cut'};
  const brief={type:'answer',opening:'Watch the golfer prepare the next swing',subject:shot.subject,development:'',ending:shot};
  const called=[];
  const response=await handleVideoChatRequest({request:request('response',{prompt:'A golfer hits a ball',mode:'pexels'}),env,fetcher:async url=>{
    called.push(url);
    if(url==='https://api.anthropic.com/v1/messages')return new Response(`data: ${JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:JSON.stringify(brief)+'\n'}})}\n\n`);
    assert.equal(new URL(url).pathname,'/v1/videos/search');
    return Response.json({videos:[{id:12,url:'https://www.pexels.com/video/golfer-hitting-ball-12/',video_files:[{file_type:'video/mp4',width:1280,height:720,link:'https://videos.pexels.com/video-files/golf.mp4'}]}]});
  }});
  const output=await response.text();assert.equal(response.status,200);
  assert.match(output,/response.complete/);assert.match(output,/cinemaMedia/);assert.match(output,/golfer swings through the ball/);assert.match(output,/videos.pexels.com/);
  assert.equal(called.length,2);assert.ok(called.every(url=>!url.includes('fal.run')));
});

test('missing generated video resolves to Pexels before planning and capability discovery', async () => {
  for (const fal of [{}, {FAL_KEY:'test-fal',VIDEO_CHAT_FAL_PREVIEW:'disabled'}, {VIDEO_CHAT_FAL_PREVIEW:'enabled'}, {VIDEO_CHAT_FAL_PREVIEW:'enabled',FAL_KEY:'   '}]) {
    const env={...live(),...fal};
    const prepare=env.VIDEO_CHAT_QUOTAS.prepare.bind(env.VIDEO_CHAT_QUOTAS);
    env.VIDEO_CHAT_QUOTAS.prepare=query=>{assert.doesNotMatch(query,/video_chat_(?:fal|owner_fal)/);return prepare(query);};
    const shot={narration:'The golfer swings through the ball.',subject:'golfer hitting ball',action:'Golfer hits a ball',durationSec:5,continuity:'cut'};
    const brief={type:'answer',opening:'Watch the golfer prepare the next swing',subject:shot.subject,development:'',ending:shot};
    let plans=0, footage=0;
    const response=await handleVideoChatRequest({request:request('response',{prompt:'Show a golf swing',mode:'cinematic'}),env,fetcher:async url=>{
      if (url==='https://api.anthropic.com/v1/messages') {
        plans++;
        return new Response(`data: ${JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:JSON.stringify(brief)+'\n'}})}\n\n`);
      }
      assert.match(url,/^https:\/\/api.pexels.com\//);
      footage++;
      return Response.json({videos:[{url:'https://www.pexels.com/video/golf-123/',video_files:[{file_type:'video/mp4',width:1280,height:720,link:'https://videos.pexels.com/video-files/golf.mp4'}]}]});
    }});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('x-vanillasky-resolved-video-mode'),'pexels');
    const output=await response.text();
    assert.match(output,/videos.pexels.com/);
    assert.match(output,/response.complete/);
    assert.equal(plans,1);assert.equal(footage,1);
    const caps=await handleVideoChatRequest({request:new Request('https://example.com/api/video-chat?action=capabilities'),env,fetcher:()=>assert.fail('No capability provider calls')});
    assert.equal((await caps.json()).generatedVideo,false);
  }
});

test('dynamic suggestion subjects use admitted bounded Pexels search even without Pexels answer mode', async () => {
 const env={...live(),PEXELS_API_KEY:'test-stock'};
 const calls=[];
 const response=await handleVideoChatRequest({request:request('suggestions',{prompt:'Tell a story about a dog at the beach',lines:['A dog plays at the beach.']}),env,fetcher:async (url,options)=>{
  calls.push(url);
  if(url==='https://api.anthropic.com/v1/messages') {
   const input=JSON.parse(options.body);assert.match(input.messages[0].content,/Tell a story about a dog at the beach/);assert.match(input.messages[0].content,/A dog plays at the beach/);
   return Response.json({content:[{type:'text',text:JSON.stringify({suggestions:[{prompt:'What does the dog find?',keyword:'dog beach'}]})}]});
  }
  const target=new URL(url);assert.equal(target.origin+target.pathname,'https://api.pexels.com/v1/videos/search');
  assert.equal(target.searchParams.get('query'),'dog beach');assert.equal(target.searchParams.get('per_page'),'12');assert.equal(options.headers.Authorization,'test-stock');
  return Response.json({videos:[{url:'https://www.pexels.com/video/dog-beach-123/',video_files:[{file_type:'video/mp4',width:1280,height:720,link:'https://videos.pexels.com/video-files/dog.mp4'}]}]});
 }});
 assert.equal(response.status,200);const payload=await response.json();
 assert.equal(payload.suggestions[0].media?.url,'https://videos.pexels.com/video-files/dog.mp4');assert.equal(calls.length,2);
 assert.doesNotMatch(JSON.stringify(payload),/test-stock/);
});

test('exhausted personal AI allowance resolves to stock before planning without new fal reservations', async () => {
 const env={...live(),VIDEO_CHAT_FAL_PREVIEW:'enabled',FAL_KEY:'test-fal',PEXELS_API_KEY:'test-stock'};
 const actor=await actorHash('192.0.2.1',env.VIDEO_CHAT_QUOTA_SALT);
 await seedPublicAttempts(env.VIDEO_CHAT_QUOTAS, actor);
 const shot={title:'Ocean waves',narration:'Waves break as they reach shallow water.',subject:'ocean waves',action:'Waves break',durationSec:5,continuity:'cut'};
 let stockCalls=0;
 const response=await handleVideoChatRequest({request:request('response',{prompt:'Explain waves',mode:'cinematic'}),env,fetcher:async(url)=>{
  if(url==='https://api.anthropic.com/v1/messages') {
   const brief={type:'answer',opening:'Watch waves reach the shore',subject:'ocean waves',development:'',ending:shot};
   return new Response(`data: ${JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:JSON.stringify(brief)}})}\n\n`);
  }
  assert.match(url,/api.pexels.com/);stockCalls++;
  return Response.json({videos:[{url:'https://www.pexels.com/video/ocean-waves-123/',video_files:[{file_type:'video/mp4',width:1280,height:720,link:'https://videos.pexels.com/video-files/waves.mp4'}]}]});
 }});
 const output=await response.text();assert.equal(response.headers.get('x-vanillasky-resolved-video-mode'),'pexels');assert.match(output,/videos.pexels.com/);assert.equal(stockCalls,1);
 assert.equal(response.headers.get('x-vanillasky-video-fallback'),'credits');
});

for (const scenario of ['personal-race','clip-race','global-limit','ledger-error','provider-error']) test(`AI fallback is limited to confirmed credit exhaustion: ${scenario}`, async () => {
 const env={...live(),VIDEO_CHAT_FAL_PREVIEW:'enabled',FAL_KEY:'test-fal',PEXELS_API_KEY:'test-stock',...(scenario==='global-limit'?{VIDEO_CHAT_FAL_DAILY_CLIP_LIMIT:'0'}:{})};
 const actor=await actorHash('192.0.2.1',env.VIDEO_CHAT_QUOTA_SALT);
 const shot={title:'Ocean waves',narration:'Waves break as they reach shallow water.',subject:'ocean waves',action:'Waves break',durationSec:5,continuity:'cut'};
 let stock=0, generated=0;
 const prepare=env.VIDEO_CHAT_QUOTAS.prepare.bind(env.VIDEO_CHAT_QUOTAS);
 if(scenario==='ledger-error') env.VIDEO_CHAT_QUOTAS.prepare=query=>{
  if(query.startsWith('INSERT INTO video_chat_fal_answers')) throw Error('ledger unavailable');
  return prepare(query);
 };
 if(scenario==='clip-race') {
  let raced=false;
  env.VIDEO_CHAT_QUOTAS.prepare=query=>{
   const statement=prepare(query);
   if(!query.startsWith('UPDATE video_chat_fal_answers')) return statement;
   return {bind(...args){return {async run(){
    if(!raced){raced=true;await seedPublicAttempts(env.VIDEO_CHAT_QUOTAS, actor);}
    return statement.bind(...args).run();
   }}}};
  };
 }
 const response=await handleVideoChatRequest({request:request('response',{prompt:'Explain waves',mode:'cinematic'}),env,fetcher:async(url)=>{
  if(url==='https://api.anthropic.com/v1/messages') {
   if(scenario==='personal-race') await seedPublicAttempts(env.VIDEO_CHAT_QUOTAS, actor);
   return new Response(`data: ${JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:JSON.stringify({type:'answer',opening:'Watch waves reach the shore',subject:'ocean waves',development:'',ending:shot})}})}\n\n`);
  }
  if(url.startsWith('https://queue.fal.run/')) {generated++;return new Response('',{status:503});}
  assert.match(url,/api.pexels.com/);stock++;
  return Response.json({videos:[{url:'https://www.pexels.com/video/ocean-waves-123/',video_files:[{file_type:'video/mp4',width:1280,height:720,link:'https://videos.pexels.com/video-files/waves.mp4'}]}]});
 }});
 const output=await response.text();assert.equal(response.status,200);
 assert.equal(response.headers.get('x-vanillasky-resolved-video-mode'),scenario==='global-limit'?'pexels':'cinematic');
 assert.equal(response.headers.get('x-vanillasky-video-fallback'),scenario==='global-limit'?'credits':null);
 assert.equal(stock,['personal-race','clip-race','global-limit'].includes(scenario)?1:0);assert.equal(generated,scenario==='provider-error'?1:0);
 if(['personal-race','clip-race','global-limit'].includes(scenario)) assert.match(output,/videos.pexels.com/);else assert.match(output,/chapterTitle/);
});


test('setup requires real planning and footage credentials and exposes only configuration names', async () => {
  assert.deepEqual(configurationStatus({}), {
    ready:false, missing:['ANTHROPIC_API_KEY','PEXELS_API_KEY','VIDEO_CHAT_QUOTAS','VIDEO_CHAT_QUOTA_SALT'], videoMode:null,speech:'browser',
  });
  assert.deepEqual(configurationStatus(live()), {ready:true,missing:[],videoMode:'pexels',speech:'browser'});
  assert.deepEqual(configurationStatus({...live(),FAL_KEY:'private',VIDEO_CHAT_FAL_PREVIEW:'enabled',XAI_API_KEY:'private'}),
    {ready:true,missing:[],videoMode:'cinematic',speech:'generated'});
  assert.equal(configurationStatus({...live(),FAL_KEY:'private',PEXELS_API_KEY:undefined}).ready,false);
  const response = await handleVideoChatRequest({request:new Request('https://example.com/api/video-chat?action=status'),env:{ANTHROPIC_API_KEY:'private-value'}});
  assert.equal(response.status,200);
  assert.doesNotMatch(await response.text(),/private-value/);
});

test('disabled provider environment refuses preview requests even with all credentials and forged enable headers', async () => {
  const env = {...live(),VIDEO_CHAT_PAID_PROVIDERS:'disabled',FAL_KEY:'private',VIDEO_CHAT_FAL_PREVIEW:'enabled',XAI_API_KEY:'private'};
  assert.deepEqual(configurationStatus(env).missing,['VIDEO_CHAT_PAID_PROVIDERS']);
  for (const action of ['response','speech','suggestions','opening-media']) {
    const response = await handleVideoChatRequest({request:request(action,{prompt:'Tell me about waves',text:'Hello'},{'x-vanillasky-staging-token':'enabled'}),env,fetcher:()=>assert.fail('No provider in preview')});
    assert.equal(response.status,503);
  }
});

test('local identity is permitted only with explicit local binding and a loopback URL', async () => {
  for (const [url,local,expected] of [['http://localhost:8788',true,200],['http://127.0.0.1:8788',true,200],['https://example.com',true,503],['http://localhost:8788',false,503]]) {
    const env={...live(),...(local?{VIDEO_CHAT_LOCAL:'enabled'}:{})};
    let calls=0;
    const response=await handleVideoChatRequest({request:new Request(url+'/api/video-chat?action=narration',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({prompt:'Moon',scene:{id:'s',templateId:'cinemaMedia',variables:{fallbackText:'Moon'}},earlier:[]})}),env,fetcher:async()=>{calls++;return Response.json({content:[{type:'text',text:'The Moon turns.'}]});}});
    assert.equal(response.status,expected);
    await response.text();
    assert.equal(calls,expected===200?1:0);
  }
});

for (const raced of [false,true]) test(`FAL-only exhaustion retains chapter recovery without stock access: raced=${raced}`, async (t) => {
  const diagnostics=[];
  t.mock.method(console,'info',(...event)=>diagnostics.push(event));
  const env={...live(),PEXELS_API_KEY:undefined,VIDEO_CHAT_FAL_PREVIEW:'enabled',FAL_KEY:'test-fal'};
  const actor=await actorHash('192.0.2.1',env.VIDEO_CHAT_QUOTA_SALT);
  const exhaust=()=>seedPublicAttempts(env.VIDEO_CHAT_QUOTAS, actor);
  if (!raced) await exhaust();
  let plans=0;
  const shot={narration:'Waves break in shallow water.',subject:'ocean waves',action:'Waves break',durationSec:5,continuity:'cut'};
  const response=await handleVideoChatRequest({request:request('response',{prompt:'Explain waves',mode:'cinematic'}),env,fetcher:async url=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    plans++;
    if (raced) await exhaust();
    return new Response(`data: ${JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:JSON.stringify({type:'answer',opening:'Watch waves reach the shore',subject:'ocean waves',development:'',ending:shot})}})}\n\n`);
  }});
  assert.equal(response.status,200);
  const output=await response.text();
  assert.equal(response.headers.get('x-vanillasky-resolved-video-mode'),'cinematic');
  assert.match(output,/response.complete/);
  assert.match(output,/chapterTitle/);
  assert.doesNotMatch(output,/videos.pexels.com/);
  assert.equal(plans,1);
  assert.ok(diagnostics.every(event=>event[1]?.stage!=='pexels_search'));
});
