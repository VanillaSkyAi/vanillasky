import type { VideoChatHandlerOptions } from "./create-video-chat-handler.js";

const READ_ACTIONS = new Set(["capabilities", "welcome"]);
const WRITE_ACTIONS = new Set(["response", "opening-media", "narration", "suggestions", "speech", "transcription"]);

export function jsonError(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

class BodyTooLarge extends Error {}

/** Bound allocation while bytes arrive, including requests without Content-Length. */
async function readBody(request: Request, maximum: number): Promise<Uint8Array> {
  request.signal.throwIfAborted();
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new BodyTooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel(request.signal.reason).catch(() => undefined); };
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      request.signal.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximum) {
        // Cleanup must not delay the bounded admission result or replace its
        // error when an underlying stream has a failing cancellation hook.
        void reader.cancel().catch(() => undefined);
        throw new BodyTooLarge();
      }
      chunks.push(next.value);
    }
  } finally {
    request.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

interface ChatOperation {
  request: Request;
  action: string;
  headers: Headers;
  body?: unknown;
  audio?: Uint8Array;
}

/** Own HTTP admission and decoding; response and provider policy lives in the handler. */
export function createChatHttpHandler(options: Pick<VideoChatHandlerOptions, "authorize" | "allowedOrigins" | "allowCredentials"> & {
  maxBodyBytes: number;
  maxAudioBytes: number;
  transcriptionConfigured: boolean;
  reportError: (cause: unknown) => void;
}, dispatch: (operation: ChatOperation) => Promise<Response>): (request: Request) => Promise<Response> {
  return async request => {
    const origin = request.headers.get("origin");
    const headers = new Headers({ "cache-control": "no-store", vary: "Origin" });
    if (origin && options.allowedOrigins?.includes(origin)) {
      headers.set("access-control-allow-origin", origin);
      if (options.allowCredentials) headers.set("access-control-allow-credentials", "true");
    }
    if (origin && options.allowedOrigins && !options.allowedOrigins.includes(origin)) {
      return jsonError(403, "origin_forbidden", "Origin is not allowed", headers);
    }
    if (request.method === "OPTIONS") {
      headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
      headers.set("access-control-allow-headers", "Authorization, Content-Type");
      return new Response(null, { status: 204, headers });
    }
    if (options.authorize !== "none") {
      let authorized = false;
      try { authorized = await options.authorize(request); } catch (cause) { options.reportError(cause); }
      if (!authorized) return jsonError(401, "unauthorized", "Authentication required", headers);
    }
    const action = new URL(request.url).searchParams.get("action") ?? "";
    if (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action)) return jsonError(404, "unknown_action", "Video chat action was not found", headers);
    const method = READ_ACTIONS.has(action) ? "GET" : "POST";
    if (request.method !== method) return jsonError(405, "method_not_allowed", `Use ${method}`, headers);
    if (method === "GET") return dispatch({ request, action, headers });
    const audio = action === "transcription";
    if (audio && !options.transcriptionConfigured) return jsonError(404, "capability_unavailable", "Transcription is not configured", headers);
    let bytes: Uint8Array;
    try { bytes = await readBody(request, audio ? options.maxAudioBytes : options.maxBodyBytes); }
    catch (cause) {
      if (request.signal.aborted) return jsonError(499, "aborted", "Request cancelled", headers);
      return jsonError(cause instanceof BodyTooLarge ? 413 : 400, audio ? "body_too_large" : "invalid_body",
        cause instanceof BodyTooLarge ? audio ? "The recording is too large" : "Request body is too large" : "Request body could not be read", headers);
    }
    if (audio) return dispatch({ request, action, headers, audio: bytes });
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return jsonError(400, "invalid_body", "Request body must be valid JSON", headers); }
    return dispatch({ request, action, headers, body });
  };
}
