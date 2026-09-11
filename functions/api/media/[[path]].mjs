// Recorded generated clips, served from the answer cache bucket on this origin
// so the page's own content-security policy and the existing /api route apply.
const CLIP_KEY = /^clips\/[a-f0-9]{64}\.mp4$/;
const HEADERS = {
  "accept-ranges": "bytes",
  "cache-control": "public, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
};

// Only a single byte range; multipart ranges are not needed for playback.
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!match) return header ? { invalid: true } : null;
  const [, first, last] = match;
  if (first === "" && last === "") return { invalid: true };
  if (first === "") {
    const suffix = Math.min(Number(last), size);
    return suffix > 0 ? { offset: size - suffix, length: suffix } : { invalid: true };
  }
  const offset = Number(first);
  if (offset >= size) return { invalid: true };
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return end < offset ? { invalid: true } : { offset, length: end - offset + 1 };
}

export async function handleMediaRequest({ request, env, params }) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const key = Array.isArray(params?.path) ? params.path.join("/") : "";
  const bucket = env?.VIDEO_CHAT_ANSWER_CACHE;
  if (!CLIP_KEY.test(key) || typeof bucket?.head !== "function") return new Response(null, { status: 404 });
  const object = await bucket.head(key);
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers({ ...HEADERS, etag: object.httpEtag, "content-type": object.httpMetadata?.contentType || "video/mp4" });
  if (request.headers.get("if-none-match") === object.httpEtag) return new Response(null, { status: 304, headers });
  const range = parseRange(request.headers.get("range"), object.size);
  if (range?.invalid) {
    headers.set("content-range", `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  headers.set("content-length", String(range ? range.length : object.size));
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const body = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!body) return new Response(null, { status: 404 });
  return new Response(body.body, { status, headers });
}

export const onRequest = (context) => handleMediaRequest(context);
