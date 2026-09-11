import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMediaRequest } from "../../functions/api/media/[[path]].mjs";

const KEY = `clips/${"c".repeat(64)}.mp4`;
const BYTES = new Uint8Array(Array.from({ length: 1000 }, (_, index) => index % 256));

function bucket() {
  const ranges = [];
  const object = { size: BYTES.byteLength, httpEtag: '"clip-etag"', httpMetadata: { contentType: "video/mp4" } };
  return {
    ranges,
    async head(key) { return key === KEY ? object : null; },
    async get(key, options) {
      if (key !== KEY) return null;
      ranges.push(options?.range ?? null);
      const slice = options?.range ? BYTES.subarray(options.range.offset, options.range.offset + options.range.length) : BYTES;
      return { ...object, body: new Blob([slice]).stream() };
    },
  };
}

const call = (path, { method = "GET", headers = {}, env = { VIDEO_CHAT_ANSWER_CACHE: bucket() } } = {}) =>
  handleMediaRequest({ request: new Request(`https://example.com/api/media/${path}`, { method, headers }), env, params: { path: path.split("/") } });

test("whole clips stream with immutable caching, byte-range support and a stable etag", async () => {
  const response = await call(KEY);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), "1000");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("etag"), '"clip-etag"');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), BYTES);
  const head = await call(KEY, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "1000");
  assert.equal(head.body, null);
  const cached = await call(KEY, { headers: { "if-none-match": '"clip-etag"' } });
  assert.equal(cached.status, 304);
});

test("byte ranges return exactly the requested slice so seeking works in every browser", async () => {
  const env = { VIDEO_CHAT_ANSWER_CACHE: bucket() };
  for (const [range, offset, length] of [["bytes=0-99", 0, 100], ["bytes=900-", 900, 100], ["bytes=-50", 950, 50], ["bytes=990-5000", 990, 10]]) {
    const response = await call(KEY, { headers: { range }, env });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get("content-range"), `bytes ${offset}-${offset + length - 1}/1000`);
    assert.equal(response.headers.get("content-length"), String(length));
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), BYTES.subarray(offset, offset + length));
  }
  assert.deepEqual(env.VIDEO_CHAT_ANSWER_CACHE.ranges, [{ offset: 0, length: 100 }, { offset: 900, length: 100 }, { offset: 950, length: 50 }, { offset: 990, length: 10 }]);
  for (const range of ["bytes=1000-", "bytes=5-2", "bytes=-0", "bytes=-", "items=0-1"]) {
    const response = await call(KEY, { headers: { range }, env });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get("content-range"), "bytes */1000");
  }
});

test("only recorded clip keys are reachable and only by reading", async () => {
  for (const path of ["clips/../secrets", "answers/x/events.json", "clips/short.mp4", `clips/${"C".repeat(64)}.mp4`, `clips/${"c".repeat(64)}.json`]) {
    assert.equal((await call(path)).status, 404, path);
  }
  assert.equal((await call(`clips/${"d".repeat(64)}.mp4`)).status, 404);
  assert.equal((await call(KEY, { env: {} })).status, 404);
  const rejected = await call(KEY, { method: "POST" });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get("allow"), "GET, HEAD");
});
